#include "HodgeProjectionCallbacks.hh"

#include <TinyAD/Utils/LineSearch.hh>
#include <TinyAD/Utils/NewtonDecrement.hh>
#include <TinyAD/Utils/NewtonDirection.hh>

#include <Eigen/Core>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

using emscripten::class_;
using emscripten::typed_memory_view;
using emscripten::val;

constexpr double pi = 3.14159265358979323846;

std::uint64_t edge_key(const int a, const int b) {
  const auto low = static_cast<std::uint32_t>(std::min(a, b));
  const auto high = static_cast<std::uint32_t>(std::max(a, b));
  return (static_cast<std::uint64_t>(low) << 32U) | high;
}

class HodgeDecompositionSystem {
public:
  void init(
      const int grid_size,
      const double exact_strength,
      const double coexact_strength,
      const double harmonic_x,
      const double harmonic_y,
      const double noise,
      const int seed) {
    if (grid_size < 4 || grid_size > 48) {
      throw std::invalid_argument("gridSize must be between 4 and 48");
    }
    for (const double value : {exact_strength, coexact_strength, harmonic_x, harmonic_y, noise}) {
      if (!std::isfinite(value)) throw std::invalid_argument("Hodge strengths must be finite");
    }
    if (noise < 0.0) throw std::invalid_argument("noise must be nonnegative");

    grid_size_ = grid_size;
    build_periodic_mesh();
    build_input_form(exact_strength, coexact_strength, harmonic_x, harmonic_y, noise, seed);
    build_exact_problem();

    exact_.assign(edges_.size(), 0.0);
    coexact_.assign(edges_.size(), 0.0);
    harmonic_.assign(edges_.size(), 0.0);
    reconstruction_error_ = input_;
    decomposed_ = false;
    initialized_ = true;
    last_iterations_ = 0;
    last_decrement_ = 0.0;
    evaluate_initial_diagnostics();
  }

  void step(const int iterations) {
    require_initialized();
    if (iterations < 1 || iterations > 20) {
      throw std::invalid_argument("iterations must be between 1 and 20");
    }
    if (decomposed_) {
      last_iterations_ = 0;
      return;
    }
    solve_exact_projection();
    solve_coexact_projection();
    evaluate_final_diagnostics();
    decomposed_ = true;
    last_iterations_ = 1;
  }

  [[nodiscard]] val get_positions() {
    require_initialized();
    return val(typed_memory_view(positions_.size(), positions_.data()));
  }

  [[nodiscard]] val get_edges() {
    require_initialized();
    return val(typed_memory_view(edges_flat_.size(), edges_flat_.data()));
  }

  [[nodiscard]] val get_input_field() {
    require_initialized();
    return val(typed_memory_view(input_.size(), input_.data()));
  }

  [[nodiscard]] val get_exact_field() {
    require_initialized();
    return val(typed_memory_view(exact_.size(), exact_.data()));
  }

  [[nodiscard]] val get_coexact_field() {
    require_initialized();
    return val(typed_memory_view(coexact_.size(), coexact_.data()));
  }

  [[nodiscard]] val get_harmonic_field() {
    require_initialized();
    return val(typed_memory_view(harmonic_.size(), harmonic_.data()));
  }

  [[nodiscard]] val get_reconstruction_error() {
    require_initialized();
    return val(typed_memory_view(reconstruction_error_.size(), reconstruction_error_.data()));
  }

  [[nodiscard]] val get_diagnostics() const {
    require_initialized();
    val result = val::object();
    result.set("energy", last_energy_);
    result.set("gradientNorm", last_gradient_norm_);
    result.set("newtonDecrement", last_decrement_);
    result.set("dofs", vertex_count_ + face_count_);
    result.set("hessianNonzeros", last_hessian_nonzeros_);
    result.set("iterations", last_iterations_);
    return result;
  }

  [[nodiscard]] val get_hodge_metrics() const {
    require_initialized();
    std::vector<double> divergence(static_cast<std::size_t>(vertex_count_), 0.0);
    std::vector<double> curl(static_cast<std::size_t>(face_count_), 0.0);
    double input_norm_squared = 0.0;
    double exact_norm_squared = 0.0;
    double coexact_norm_squared = 0.0;
    double harmonic_norm_squared = 0.0;
    double reconstruction_norm_squared = 0.0;
    double exact_coexact = 0.0;
    double exact_harmonic = 0.0;
    double coexact_harmonic = 0.0;
    for (std::size_t e = 0; e < edges_.size(); ++e) {
      const HodgeEdge& edge = edges_[e];
      divergence[edge.tail] -= harmonic_[e];
      divergence[edge.head] += harmonic_[e];
      curl[edge.faces[0]] += edge.face_signs[0] * harmonic_[e];
      curl[edge.faces[1]] += edge.face_signs[1] * harmonic_[e];
      input_norm_squared += input_[e] * input_[e];
      exact_norm_squared += exact_[e] * exact_[e];
      coexact_norm_squared += coexact_[e] * coexact_[e];
      harmonic_norm_squared += harmonic_[e] * harmonic_[e];
      reconstruction_norm_squared += reconstruction_error_[e] * reconstruction_error_[e];
      exact_coexact += exact_[e] * coexact_[e];
      exact_harmonic += exact_[e] * harmonic_[e];
      coexact_harmonic += coexact_[e] * harmonic_[e];
    }
    const auto maximum_absolute = [](const std::vector<double>& values) {
      double maximum = 0.0;
      for (const double value : values) maximum = std::max(maximum, std::abs(value));
      return maximum;
    };
    const auto normalized_dot = [](const double dot, const double norm_a, const double norm_b) {
      return std::abs(dot) / std::max(1e-30, std::sqrt(norm_a * norm_b));
    };
    const double orthogonality = std::max({
        normalized_dot(exact_coexact, exact_norm_squared, coexact_norm_squared),
        normalized_dot(exact_harmonic, exact_norm_squared, harmonic_norm_squared),
        normalized_dot(coexact_harmonic, coexact_norm_squared, harmonic_norm_squared),
    });
    const double pythagorean = std::abs(
        input_norm_squared - exact_norm_squared - coexact_norm_squared - harmonic_norm_squared) /
        std::max(1.0, input_norm_squared);

    val result = val::object();
    result.set("inputNorm", std::sqrt(input_norm_squared));
    result.set("exactNorm", std::sqrt(exact_norm_squared));
    result.set("coexactNorm", std::sqrt(coexact_norm_squared));
    result.set("harmonicNorm", std::sqrt(harmonic_norm_squared));
    result.set("reconstructionNorm", std::sqrt(reconstruction_norm_squared));
    result.set("harmonicDivergenceMax", maximum_absolute(divergence));
    result.set("harmonicCurlMax", maximum_absolute(curl));
    result.set("orthogonalityDefect", orthogonality);
    result.set("pythagoreanDefect", pythagorean);
    return result;
  }

private:
  void require_initialized() const {
    if (!initialized_) throw std::runtime_error("Initialize the Hodge system before using it");
  }

  int vertex(const int x, const int y) const {
    const int wrapped_x = (x % grid_size_ + grid_size_) % grid_size_;
    const int wrapped_y = (y % grid_size_ + grid_size_) % grid_size_;
    return wrapped_y * grid_size_ + wrapped_x;
  }

  void add_face(const int a, const int b, const int c) {
    const int face = face_count_++;
    for (const auto [tail, head] : {std::pair{a, b}, std::pair{b, c}, std::pair{c, a}}) {
      const std::uint64_t key = edge_key(tail, head);
      auto found = edge_lookup_.find(key);
      int edge_index = -1;
      if (found == edge_lookup_.end()) {
        edge_index = static_cast<int>(edges_.size());
        edge_lookup_[key] = edge_index;
        HodgeEdge edge;
        edge.tail = tail;
        edge.head = head;
        edges_.push_back(edge);
      } else {
        edge_index = found->second;
      }
      HodgeEdge& edge = edges_.at(static_cast<std::size_t>(edge_index));
      const double sign = edge.tail == tail && edge.head == head ? 1.0 : -1.0;
      const int slot = edge.faces[0] < 0 ? 0 : 1;
      if (edge.faces[slot] >= 0) throw std::runtime_error("Nonmanifold periodic grid edge");
      edge.faces[slot] = face;
      edge.face_signs[slot] = sign;
    }
  }

  void build_periodic_mesh() {
    vertex_count_ = grid_size_ * grid_size_;
    face_count_ = 0;
    positions_.assign(static_cast<std::size_t>(vertex_count_) * 2, 0.0);
    edges_.clear();
    edges_flat_.clear();
    edge_lookup_.clear();

    for (int y = 0; y < grid_size_; ++y) {
      for (int x = 0; x < grid_size_; ++x) {
        const int v = vertex(x, y);
        positions_[static_cast<std::size_t>(v) * 2] = static_cast<double>(x);
        positions_[static_cast<std::size_t>(v) * 2 + 1] = static_cast<double>(y);
        const int v00 = vertex(x, y);
        const int v10 = vertex(x + 1, y);
        const int v11 = vertex(x + 1, y + 1);
        const int v01 = vertex(x, y + 1);
        add_face(v00, v10, v11);
        add_face(v00, v11, v01);
      }
    }

    for (const HodgeEdge& edge : edges_) {
      if (edge.faces[0] < 0 || edge.faces[1] < 0) {
        throw std::runtime_error("Periodic grid unexpectedly has a boundary");
      }
      edges_flat_.push_back(edge.tail);
      edges_flat_.push_back(edge.head);
    }
  }

  std::pair<double, double> wrapped_edge_vector(const HodgeEdge& edge) const {
    double dx = positions_[static_cast<std::size_t>(edge.head) * 2] -
                positions_[static_cast<std::size_t>(edge.tail) * 2];
    double dy = positions_[static_cast<std::size_t>(edge.head) * 2 + 1] -
                positions_[static_cast<std::size_t>(edge.tail) * 2 + 1];
    const double half = 0.5 * static_cast<double>(grid_size_);
    if (dx > half) dx -= grid_size_;
    if (dx < -half) dx += grid_size_;
    if (dy > half) dy -= grid_size_;
    if (dy < -half) dy += grid_size_;
    return {dx, dy};
  }

  void build_input_form(
      const double exact_strength,
      const double coexact_strength,
      const double harmonic_x,
      const double harmonic_y,
      const double noise,
      const int seed) {
    Eigen::VectorXd vertex_potential(vertex_count_);
    Eigen::VectorXd face_potential(face_count_);
    for (int y = 0; y < grid_size_; ++y) {
      for (int x = 0; x < grid_size_; ++x) {
        const double u = 2.0 * pi * static_cast<double>(x) / grid_size_;
        const double v = 2.0 * pi * static_cast<double>(y) / grid_size_;
        vertex_potential[vertex(x, y)] = exact_strength * std::sin(u) * std::cos(v);
        const int first_face = 2 * (y * grid_size_ + x);
        face_potential[first_face] =
            coexact_strength * std::cos(u + pi / grid_size_) * std::sin(v + pi / (2.0 * grid_size_));
        face_potential[first_face + 1] =
            coexact_strength * std::cos(u + pi / (2.0 * grid_size_)) * std::sin(v + pi / grid_size_);
      }
    }

    std::uint32_t random_state = static_cast<std::uint32_t>(seed == 0 ? 1 : seed);
    auto random_signed = [&random_state]() {
      random_state ^= random_state << 13U;
      random_state ^= random_state >> 17U;
      random_state ^= random_state << 5U;
      return 2.0 * static_cast<double>(random_state) /
                 static_cast<double>(std::numeric_limits<std::uint32_t>::max()) -
             1.0;
    };

    input_.resize(edges_.size());
    for (std::size_t e = 0; e < edges_.size(); ++e) {
      const HodgeEdge& edge = edges_[e];
      const double exact = vertex_potential[edge.head] - vertex_potential[edge.tail];
      const double coexact = edge.face_signs[0] * face_potential[edge.faces[0]] +
                             edge.face_signs[1] * face_potential[edge.faces[1]];
      const auto [dx, dy] = wrapped_edge_vector(edge);
      const double harmonic =
          (harmonic_x * dx + harmonic_y * dy) / static_cast<double>(grid_size_);
      input_[e] = exact + coexact + harmonic + noise * random_signed();
    }
  }

  void build_exact_problem() {
    exact_function_ = TinyAD::scalar_function<1>(TinyAD::range(vertex_count_));
    exact_function_.add_elements<2>(TinyAD::range(edges_.size()), [&](auto& element) {
      const std::size_t edge = static_cast<std::size_t>(element.handle);
      return exact_projection_callback(element, edges_.at(edge), input_.at(edge));
    });
    exact_function_.add_elements<1>(std::vector<int>{0}, [&](auto& element) {
      using Scalar = TINYAD_SCALAR_TYPE(element);
      const Scalar gauge = element.variables(0)[0];
      return 0.5 * gauge * gauge;
    });
    exact_variables_ = Eigen::VectorXd::Zero(vertex_count_);
  }

  void solve_exact_projection() {
    auto [energy, gradient, hessian] = exact_function_.eval_with_hessian_proj(exact_variables_);
    Eigen::VectorXd direction = TinyAD::newton_direction(gradient, hessian, exact_solver_);
    last_decrement_ = TinyAD::newton_decrement(direction, gradient);
    exact_variables_ = TinyAD::line_search(
        exact_variables_, direction, energy, gradient, exact_function_);
    for (std::size_t e = 0; e < edges_.size(); ++e) {
      const HodgeEdge& edge = edges_[e];
      exact_[e] = exact_variables_[edge.head] - exact_variables_[edge.tail];
    }
  }

  void solve_coexact_projection() {
    std::vector<double> residual(edges_.size());
    for (std::size_t e = 0; e < edges_.size(); ++e) residual[e] = input_[e] - exact_[e];

    coexact_function_ = TinyAD::scalar_function<1>(TinyAD::range(face_count_));
    coexact_function_.add_elements<2>(TinyAD::range(edges_.size()), [this, residual](auto& element) {
      const std::size_t edge = static_cast<std::size_t>(element.handle);
      return coexact_projection_callback(element, edges_.at(edge), residual.at(edge));
    });
    coexact_function_.add_elements<1>(std::vector<int>{0}, [&](auto& element) {
      using Scalar = TINYAD_SCALAR_TYPE(element);
      const Scalar gauge = element.variables(0)[0];
      return 0.5 * gauge * gauge;
    });
    coexact_variables_ = Eigen::VectorXd::Zero(face_count_);

    auto [energy, gradient, hessian] =
        coexact_function_.eval_with_hessian_proj(coexact_variables_);
    Eigen::VectorXd direction =
        TinyAD::newton_direction(gradient, hessian, coexact_solver_);
    last_decrement_ = std::max(
        last_decrement_, TinyAD::newton_decrement(direction, gradient));
    coexact_variables_ = TinyAD::line_search(
        coexact_variables_, direction, energy, gradient, coexact_function_);

    for (std::size_t e = 0; e < edges_.size(); ++e) {
      const HodgeEdge& edge = edges_[e];
      coexact_[e] = edge.face_signs[0] * coexact_variables_[edge.faces[0]] +
                    edge.face_signs[1] * coexact_variables_[edge.faces[1]];
      harmonic_[e] = input_[e] - exact_[e] - coexact_[e];
      reconstruction_error_[e] = input_[e] - exact_[e] - coexact_[e] - harmonic_[e];
    }
  }

  void evaluate_initial_diagnostics() {
    auto [energy, gradient, hessian] = exact_function_.eval_with_hessian_proj(exact_variables_);
    last_energy_ = energy;
    last_gradient_norm_ = gradient.norm();
    last_hessian_nonzeros_ = static_cast<int>(hessian.nonZeros());
  }

  void evaluate_final_diagnostics() {
    auto [exact_energy, exact_gradient, exact_hessian] =
        exact_function_.eval_with_hessian_proj(exact_variables_);
    auto [coexact_energy, coexact_gradient, coexact_hessian] =
        coexact_function_.eval_with_hessian_proj(coexact_variables_);
    double error_energy = 0.0;
    for (const double error : reconstruction_error_) error_energy += 0.5 * error * error;
    last_energy_ = error_energy;
    last_gradient_norm_ = std::hypot(exact_gradient.norm(), coexact_gradient.norm());
    last_hessian_nonzeros_ =
        static_cast<int>(exact_hessian.nonZeros() + coexact_hessian.nonZeros());
    (void)exact_energy;
    (void)coexact_energy;
  }

  int grid_size_ = 0;
  int vertex_count_ = 0;
  int face_count_ = 0;
  std::vector<double> positions_;
  std::vector<HodgeEdge> edges_;
  std::vector<int> edges_flat_;
  std::unordered_map<std::uint64_t, int> edge_lookup_;
  std::vector<double> input_;
  std::vector<double> exact_;
  std::vector<double> coexact_;
  std::vector<double> harmonic_;
  std::vector<double> reconstruction_error_;

  TinyAD::ScalarFunction<1, double, Eigen::Index> exact_function_;
  TinyAD::ScalarFunction<1, double, Eigen::Index> coexact_function_;
  Eigen::VectorXd exact_variables_;
  Eigen::VectorXd coexact_variables_;
  TinyAD::LinearSolver<> exact_solver_;
  TinyAD::LinearSolver<> coexact_solver_;

  double last_energy_ = 0.0;
  double last_gradient_norm_ = 0.0;
  double last_decrement_ = 0.0;
  int last_hessian_nonzeros_ = 0;
  int last_iterations_ = 0;
  bool initialized_ = false;
  bool decomposed_ = false;
};

} // namespace

EMSCRIPTEN_BINDINGS(geometry_processing_hodge) {
  class_<HodgeDecompositionSystem>("HodgeDecompositionSystem")
      .constructor<>()
      .function("init", &HodgeDecompositionSystem::init)
      .function("step", &HodgeDecompositionSystem::step)
      .function("getPositions", &HodgeDecompositionSystem::get_positions)
      .function("getEdges", &HodgeDecompositionSystem::get_edges)
      .function("getInputField", &HodgeDecompositionSystem::get_input_field)
      .function("getExactField", &HodgeDecompositionSystem::get_exact_field)
      .function("getCoexactField", &HodgeDecompositionSystem::get_coexact_field)
      .function("getHarmonicField", &HodgeDecompositionSystem::get_harmonic_field)
      .function("getReconstructionError", &HodgeDecompositionSystem::get_reconstruction_error)
      .function("getHodgeMetrics", &HodgeDecompositionSystem::get_hodge_metrics)
      .function("getDiagnostics", &HodgeDecompositionSystem::get_diagnostics);
}
