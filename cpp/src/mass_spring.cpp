#include <TinyAD/ScalarFunction.hh>
#include <TinyAD/Utils/LineSearch.hh>
#include <TinyAD/Utils/NewtonDecrement.hh>
#include <TinyAD/Utils/NewtonDirection.hh>

#include "MassSpringCallbacks.hh"

#include <Eigen/Core>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

using Positions = Eigen::Matrix<double, Eigen::Dynamic, 2, Eigen::RowMajor>;
using emscripten::class_;
using emscripten::typed_memory_view;
using emscripten::val;

class MassSpringSystem {
public:
  void init(
      const int grid_size,
      const double rest_length,
      const double spring_weight,
      const double pin_weight,
      const double jitter,
      const int seed) {
    if (grid_size < 2 || grid_size > 128) {
      throw std::invalid_argument("gridSize must be between 2 and 128");
    }
    if (!(rest_length > 0.0) || !(spring_weight > 0.0) || !(pin_weight > 0.0)) {
      throw std::invalid_argument("restLength, springWeight, and pinWeight must be positive");
    }
    if (jitter < 0.0 || !std::isfinite(jitter)) {
      throw std::invalid_argument("jitter must be finite and nonnegative");
    }

    grid_size_ = grid_size;
    rest_length_ = rest_length;
    spring_weight_ = spring_weight;
    pin_weight_ = pin_weight;
    edges_.clear();

    const int vertex_count = grid_size * grid_size;
    positions_.resize(vertex_count, 2);
    std::uint32_t random_state = static_cast<std::uint32_t>(seed == 0 ? 1 : seed);
    auto random01 = [&random_state]() {
      random_state ^= random_state << 13U;
      random_state ^= random_state >> 17U;
      random_state ^= random_state << 5U;
      return static_cast<double>(random_state) /
             static_cast<double>(std::numeric_limits<std::uint32_t>::max());
    };

    for (int row = 0; row < grid_size; ++row) {
      for (int column = 0; column < grid_size; ++column) {
        const int index = row * grid_size + column;
        positions_(index, 0) = static_cast<double>(column) * rest_length;
        positions_(index, 1) = static_cast<double>(row) * rest_length;
        if (row > 0 && row + 1 < grid_size && column > 0 && column + 1 < grid_size) {
          positions_(index, 0) += jitter * (random01() - 0.5);
          positions_(index, 1) += jitter * (random01() - 0.5);
        }
        if (column + 1 < grid_size) edges_.emplace_back(index, index + 1);
        if (row + 1 < grid_size) edges_.emplace_back(index, index + grid_size);
      }
    }
    rest_positions_ = positions_;

    function_ = TinyAD::scalar_function<2>(TinyAD::range(vertex_count));
    const std::vector<int> pinned = {
        0,
        grid_size - 1,
        (grid_size - 1) * grid_size,
        grid_size * grid_size - 1,
    };
    for (const int vertex : pinned) {
      function_.add_elements<1>(std::vector<int>{vertex}, [&, vertex](auto& element) {
        const std::array<double, 2> target{
            rest_positions_(vertex, 0),
            rest_positions_(vertex, 1),
        };
        return mass_spring_pin_callback(element, vertex, target, pin_weight_);
      });
    }

    function_.add_elements<2>(TinyAD::range(edges_.size()), [&](auto& element) {
      const auto [first, second] = edges_.at(static_cast<std::size_t>(element.handle));
      return mass_spring_edge_callback(
          element, first, second, rest_length_, spring_weight_);
    });

    variables_ = function_.x_from_data([&](const int vertex) {
      return Eigen::Vector2d(positions_.row(vertex));
    });
    initialized_ = true;
    last_iterations_ = 0;
    evaluate_diagnostics();
  }

  void step(const int iterations) {
    require_initialized();
    if (iterations < 1 || iterations > 20) {
      throw std::invalid_argument("iterations must be between 1 and 20");
    }
    last_iterations_ = 0;
    for (int iteration = 0; iteration < iterations; ++iteration) {
      auto [energy, gradient, projected_hessian] = function_.eval_with_hessian_proj(variables_);
      Eigen::VectorXd direction = TinyAD::newton_direction(gradient, projected_hessian, linear_solver_);
      last_decrement_ = TinyAD::newton_decrement(direction, gradient);
      if (!std::isfinite(last_decrement_) || last_decrement_ < 1e-8) break;
      variables_ = TinyAD::line_search(variables_, direction, energy, gradient, function_);
      ++last_iterations_;
    }
    function_.x_to_data(variables_, [&](const int vertex, const Eigen::Vector2d& point) {
      positions_.row(vertex) = point;
    });
    evaluate_diagnostics();
  }

  [[nodiscard]] val get_positions() {
    require_initialized();
    return val(typed_memory_view(positions_.size(), positions_.data()));
  }

  [[nodiscard]] val get_edges() const {
    require_initialized();
    val result = val::array();
    for (std::size_t edge = 0; edge < edges_.size(); ++edge) {
      result.set(edge * 2, edges_[edge].first);
      result.set(edge * 2 + 1, edges_[edge].second);
    }
    return result;
  }

  [[nodiscard]] val get_diagnostics() const {
    require_initialized();
    val result = val::object();
    result.set("energy", last_energy_);
    result.set("gradientNorm", last_gradient_norm_);
    result.set("newtonDecrement", last_decrement_);
    result.set("dofs", static_cast<int>(variables_.size()));
    result.set("hessianNonzeros", last_hessian_nonzeros_);
    result.set("iterations", last_iterations_);
    return result;
  }

private:
  void require_initialized() const {
    if (!initialized_) throw std::runtime_error("Initialize the system before using it");
  }

  void evaluate_diagnostics() {
    auto [energy, gradient, projected_hessian] = function_.eval_with_hessian_proj(variables_);
    last_energy_ = energy;
    last_gradient_norm_ = gradient.norm();
    last_hessian_nonzeros_ = static_cast<int>(projected_hessian.nonZeros());
  }

  Positions positions_;
  Positions rest_positions_;
  std::vector<std::pair<int, int>> edges_;
  TinyAD::ScalarFunction<2, double, Eigen::Index> function_;
  Eigen::VectorXd variables_;
  TinyAD::LinearSolver<> linear_solver_;
  int grid_size_ = 0;
  double rest_length_ = 1.0;
  double spring_weight_ = 1.0;
  double pin_weight_ = 1000.0;
  double last_energy_ = 0.0;
  double last_gradient_norm_ = 0.0;
  double last_decrement_ = 0.0;
  int last_hessian_nonzeros_ = 0;
  int last_iterations_ = 0;
  bool initialized_ = false;
};

} // namespace

EMSCRIPTEN_BINDINGS(geometry_processing_lab) {
  class_<MassSpringSystem>("MassSpringSystem")
      .constructor<>()
      .function("init", &MassSpringSystem::init)
      .function("step", &MassSpringSystem::step)
      .function("getPositions", &MassSpringSystem::get_positions)
      .function("getEdges", &MassSpringSystem::get_edges)
      .function("getDiagnostics", &MassSpringSystem::get_diagnostics);
}
