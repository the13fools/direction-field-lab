#include "HodgeFaceCallbacks.hh"

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

std::uint64_t face_edge_key(const int a, const int b) {
  const auto low = static_cast<std::uint32_t>(std::min(a, b));
  const auto high = static_cast<std::uint32_t>(std::max(a, b));
  return (static_cast<std::uint64_t>(low) << 32U) | high;
}

struct FaceEdge {
  int tail = -1;
  int head = -1;
};

class FaceHodgeSystem {
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
    build_input_field(exact_strength, coexact_strength, harmonic_x, harmonic_y, noise, seed);
    build_exact_problem();
    exact_.assign(input_.size(), 0.0);
    coexact_.assign(input_.size(), 0.0);
    harmonic_.assign(input_.size(), 0.0);
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
    result.set("dofs", vertex_count_ + static_cast<int>(edges_.size()));
    result.set("hessianNonzeros", last_hessian_nonzeros_);
    result.set("iterations", last_iterations_);
    return result;
  }

  [[nodiscard]] val get_hodge_metrics() const {
    require_initialized();
    std::vector<double> divergence(static_cast<std::size_t>(vertex_count_), 0.0);
    std::vector<double> curl(edges_.size(), 0.0);
    double input_norm_squared = 0.0;
    double exact_norm_squared = 0.0;
    double coexact_norm_squared = 0.0;
    double harmonic_norm_squared = 0.0;
    double reconstruction_norm_squared = 0.0;
    double exact_coexact = 0.0;
    double exact_harmonic = 0.0;
    double coexact_harmonic = 0.0;
    constexpr std::array<int, 3> opposite_corner{2, 0, 1};

    for (std::size_t face_index = 0; face_index < faces_.size(); ++face_index) {
      const HodgeFace& face = faces_[face_index];
      const double hx = harmonic_[2 * face_index];
      const double hy = harmonic_[2 * face_index + 1];
      for (int corner = 0; corner < 3; ++corner) {
        divergence[face.vertices[corner]] += face.area *
            (hx * face.barycentric_gradients[2 * corner] +
             hy * face.barycentric_gradients[2 * corner + 1]);
      }
      for (int local_edge = 0; local_edge < 3; ++local_edge) {
        const int corner = opposite_corner[local_edge];
        const double gradient_x = -2.0 * face.barycentric_gradients[2 * corner];
        const double gradient_y = -2.0 * face.barycentric_gradients[2 * corner + 1];
        const double rotated_x = -gradient_y;
        const double rotated_y = gradient_x;
        curl[face.edges[local_edge]] +=
            face.area * (hx * rotated_x + hy * rotated_y);
      }

      const auto accumulate_norm = [&](const std::vector<double>& field) {
        const double x = field[2 * face_index];
        const double y = field[2 * face_index + 1];
        return face.area * (x * x + y * y);
      };
      input_norm_squared += accumulate_norm(input_);
      exact_norm_squared += accumulate_norm(exact_);
      coexact_norm_squared += accumulate_norm(coexact_);
      harmonic_norm_squared += accumulate_norm(harmonic_);
      reconstruction_norm_squared += accumulate_norm(reconstruction_error_);
      exact_coexact += face.area *
          (exact_[2 * face_index] * coexact_[2 * face_index] +
           exact_[2 * face_index + 1] * coexact_[2 * face_index + 1]);
      exact_harmonic += face.area *
          (exact_[2 * face_index] * harmonic_[2 * face_index] +
           exact_[2 * face_index + 1] * harmonic_[2 * face_index + 1]);
      coexact_harmonic += face.area *
          (coexact_[2 * face_index] * harmonic_[2 * face_index] +
           coexact_[2 * face_index + 1] * harmonic_[2 * face_index + 1]);
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
    if (!initialized_) throw std::runtime_error("Initialize the face Hodge system before using it");
  }

  int vertex(const int x, const int y) const {
    const int wrapped_x = (x % grid_size_ + grid_size_) % grid_size_;
    const int wrapped_y = (y % grid_size_ + grid_size_) % grid_size_;
    return wrapped_y * grid_size_ + wrapped_x;
  }

  int edge(const int tail, const int head) {
    const std::uint64_t key = face_edge_key(tail, head);
    const auto found = edge_lookup_.find(key);
    if (found != edge_lookup_.end()) return found->second;
    const int index = static_cast<int>(edges_.size());
    edge_lookup_[key] = index;
    edges_.push_back({tail, head});
    return index;
  }

  void add_face(
      const std::array<int, 3>& vertices,
      const std::array<std::array<double, 2>, 3>& points) {
    HodgeFace face;
    face.vertices = vertices;
    face.edges = {
        edge(vertices[0], vertices[1]),
        edge(vertices[1], vertices[2]),
        edge(vertices[2], vertices[0]),
    };
    const double twice_area =
        (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) -
        (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
    if (twice_area <= 0.0) throw std::runtime_error("Periodic face must be counterclockwise");
    face.area = 0.5 * twice_area;
    face.barycentric_gradients = {
        (points[1][1] - points[2][1]) / twice_area,
        (points[2][0] - points[1][0]) / twice_area,
        (points[2][1] - points[0][1]) / twice_area,
        (points[0][0] - points[2][0]) / twice_area,
        (points[0][1] - points[1][1]) / twice_area,
        (points[1][0] - points[0][0]) / twice_area,
    };
    faces_.push_back(face);
  }

  void build_periodic_mesh() {
    vertex_count_ = grid_size_ * grid_size_;
    positions_.assign(static_cast<std::size_t>(vertex_count_) * 2, 0.0);
    faces_.clear();
    edges_.clear();
    edges_flat_.clear();
    edge_lookup_.clear();
    for (int y = 0; y < grid_size_; ++y) {
      for (int x = 0; x < grid_size_; ++x) {
        const int v = vertex(x, y);
        positions_[2 * static_cast<std::size_t>(v)] = static_cast<double>(x);
        positions_[2 * static_cast<std::size_t>(v) + 1] = static_cast<double>(y);
        const int v00 = vertex(x, y);
        const int v10 = vertex(x + 1, y);
        const int v11 = vertex(x + 1, y + 1);
        const int v01 = vertex(x, y + 1);
        add_face(
            {v00, v10, v11},
            {{{static_cast<double>(x), static_cast<double>(y)},
              {static_cast<double>(x + 1), static_cast<double>(y)},
              {static_cast<double>(x + 1), static_cast<double>(y + 1)}}});
        add_face(
            {v00, v11, v01},
            {{{static_cast<double>(x), static_cast<double>(y)},
              {static_cast<double>(x + 1), static_cast<double>(y + 1)},
              {static_cast<double>(x), static_cast<double>(y + 1)}}});
      }
    }
    for (const FaceEdge& item : edges_) {
      edges_flat_.push_back(item.tail);
      edges_flat_.push_back(item.head);
    }
  }

  std::pair<double, double> wrapped_edge_vector(const FaceEdge& item) const {
    double dx = positions_[2 * static_cast<std::size_t>(item.head)] -
                positions_[2 * static_cast<std::size_t>(item.tail)];
    double dy = positions_[2 * static_cast<std::size_t>(item.head) + 1] -
                positions_[2 * static_cast<std::size_t>(item.tail) + 1];
    const double half = 0.5 * static_cast<double>(grid_size_);
    if (dx > half) dx -= grid_size_;
    if (dx < -half) dx += grid_size_;
    if (dy > half) dy -= grid_size_;
    if (dy < -half) dy += grid_size_;
    return {dx, dy};
  }

  void build_input_field(
      const double exact_strength,
      const double coexact_strength,
      const double harmonic_x,
      const double harmonic_y,
      const double noise,
      const int seed) {
    Eigen::VectorXd vertex_potential(vertex_count_);
    Eigen::VectorXd edge_potential(edges_.size());
    for (int y = 0; y < grid_size_; ++y) {
      for (int x = 0; x < grid_size_; ++x) {
        const double u = 2.0 * pi * static_cast<double>(x) / grid_size_;
        const double v = 2.0 * pi * static_cast<double>(y) / grid_size_;
        vertex_potential[vertex(x, y)] = exact_strength * std::sin(u) * std::cos(v);
      }
    }
    for (std::size_t edge_index = 0; edge_index < edges_.size(); ++edge_index) {
      const FaceEdge& item = edges_[edge_index];
      const auto [dx, dy] = wrapped_edge_vector(item);
      const double midpoint_x = positions_[2 * static_cast<std::size_t>(item.tail)] + 0.5 * dx;
      const double midpoint_y = positions_[2 * static_cast<std::size_t>(item.tail) + 1] + 0.5 * dy;
      const double u = 2.0 * pi * midpoint_x / grid_size_;
      const double v = 2.0 * pi * midpoint_y / grid_size_;
      edge_potential[static_cast<Eigen::Index>(edge_index)] =
          coexact_strength * std::cos(u) * std::sin(v);
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

    input_.assign(2 * faces_.size(), 0.0);
    for (std::size_t face_index = 0; face_index < faces_.size(); ++face_index) {
      const HodgeFace& face = faces_[face_index];
      double exact_x = 0.0;
      double exact_y = 0.0;
      for (int corner = 0; corner < 3; ++corner) {
        const double potential = vertex_potential[face.vertices[corner]];
        exact_x += potential * face.barycentric_gradients[2 * corner];
        exact_y += potential * face.barycentric_gradients[2 * corner + 1];
      }
      double gradient_x = 0.0;
      double gradient_y = 0.0;
      constexpr std::array<int, 3> opposite_corner{2, 0, 1};
      for (int local_edge = 0; local_edge < 3; ++local_edge) {
        const int corner = opposite_corner[local_edge];
        const double potential = edge_potential[face.edges[local_edge]];
        gradient_x -= 2.0 * potential * face.barycentric_gradients[2 * corner];
        gradient_y -= 2.0 * potential * face.barycentric_gradients[2 * corner + 1];
      }
      input_[2 * face_index] =
          exact_x - gradient_y + harmonic_x / grid_size_ + noise * random_signed();
      input_[2 * face_index + 1] =
          exact_y + gradient_x + harmonic_y / grid_size_ + noise * random_signed();
    }
  }

  void build_exact_problem() {
    exact_function_ = TinyAD::scalar_function<1>(TinyAD::range(vertex_count_));
    exact_function_.add_elements<3>(TinyAD::range(faces_.size()), [&](auto& element) {
      const std::size_t face = static_cast<std::size_t>(element.handle);
      return face_exact_projection_callback(
          element, faces_[face], input_[2 * face], input_[2 * face + 1]);
    });
    exact_function_.add_elements<1>(std::vector<int>{0}, [&](auto& element) {
      using Scalar = TINYAD_SCALAR_TYPE(element);
      const Scalar gauge = element.variables(0)[0];
      return 0.5 * gauge * gauge;
    });
    exact_variables_ = Eigen::VectorXd::Zero(vertex_count_);
  }

  void reconstruct_exact() {
    for (std::size_t face_index = 0; face_index < faces_.size(); ++face_index) {
      const HodgeFace& face = faces_[face_index];
      double x = 0.0;
      double y = 0.0;
      for (int corner = 0; corner < 3; ++corner) {
        x += exact_variables_[face.vertices[corner]] * face.barycentric_gradients[2 * corner];
        y += exact_variables_[face.vertices[corner]] * face.barycentric_gradients[2 * corner + 1];
      }
      exact_[2 * face_index] = x;
      exact_[2 * face_index + 1] = y;
    }
  }

  void solve_exact_projection() {
    auto [energy, gradient, hessian] = exact_function_.eval_with_hessian_proj(exact_variables_);
    Eigen::VectorXd direction = TinyAD::newton_direction(gradient, hessian, exact_solver_);
    last_decrement_ = TinyAD::newton_decrement(direction, gradient);
    exact_variables_ = TinyAD::line_search(
        exact_variables_, direction, energy, gradient, exact_function_);
    reconstruct_exact();
  }

  void solve_coexact_projection() {
    std::vector<double> residual(input_.size());
    for (std::size_t i = 0; i < input_.size(); ++i) residual[i] = input_[i] - exact_[i];
    coexact_function_ = TinyAD::scalar_function<1>(TinyAD::range(edges_.size()));
    coexact_function_.add_elements<3>(TinyAD::range(faces_.size()), [this, residual](auto& element) {
      const std::size_t face = static_cast<std::size_t>(element.handle);
      return face_coexact_projection_callback(
          element, faces_[face], residual[2 * face], residual[2 * face + 1]);
    });
    coexact_function_.add_elements<1>(std::vector<int>{0}, [&](auto& element) {
      using Scalar = TINYAD_SCALAR_TYPE(element);
      const Scalar gauge = element.variables(0)[0];
      return 0.5 * gauge * gauge;
    });
    coexact_variables_ = Eigen::VectorXd::Zero(edges_.size());
    auto [energy, gradient, hessian] =
        coexact_function_.eval_with_hessian_proj(coexact_variables_);
    Eigen::VectorXd direction =
        TinyAD::newton_direction(gradient, hessian, coexact_solver_);
    last_decrement_ = std::max(last_decrement_, TinyAD::newton_decrement(direction, gradient));
    coexact_variables_ = TinyAD::line_search(
        coexact_variables_, direction, energy, gradient, coexact_function_);

    constexpr std::array<int, 3> opposite_corner{2, 0, 1};
    for (std::size_t face_index = 0; face_index < faces_.size(); ++face_index) {
      const HodgeFace& face = faces_[face_index];
      double gradient_x = 0.0;
      double gradient_y = 0.0;
      for (int local_edge = 0; local_edge < 3; ++local_edge) {
        const int corner = opposite_corner[local_edge];
        const double potential = coexact_variables_[face.edges[local_edge]];
        gradient_x -= 2.0 * potential * face.barycentric_gradients[2 * corner];
        gradient_y -= 2.0 * potential * face.barycentric_gradients[2 * corner + 1];
      }
      coexact_[2 * face_index] = -gradient_y;
      coexact_[2 * face_index + 1] = gradient_x;
      for (int axis = 0; axis < 2; ++axis) {
        const std::size_t index = 2 * face_index + static_cast<std::size_t>(axis);
        harmonic_[index] = input_[index] - exact_[index] - coexact_[index];
        reconstruction_error_[index] =
            input_[index] - exact_[index] - coexact_[index] - harmonic_[index];
      }
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
  std::vector<double> positions_;
  std::vector<FaceEdge> edges_;
  std::vector<int> edges_flat_;
  std::unordered_map<std::uint64_t, int> edge_lookup_;
  std::vector<HodgeFace> faces_;
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

EMSCRIPTEN_BINDINGS(geometry_processing_face_hodge) {
  class_<FaceHodgeSystem>("FaceHodgeSystem")
      .constructor<>()
      .function("init", &FaceHodgeSystem::init)
      .function("step", &FaceHodgeSystem::step)
      .function("getPositions", &FaceHodgeSystem::get_positions)
      .function("getEdges", &FaceHodgeSystem::get_edges)
      .function("getInputField", &FaceHodgeSystem::get_input_field)
      .function("getExactField", &FaceHodgeSystem::get_exact_field)
      .function("getCoexactField", &FaceHodgeSystem::get_coexact_field)
      .function("getHarmonicField", &FaceHodgeSystem::get_harmonic_field)
      .function("getReconstructionError", &FaceHodgeSystem::get_reconstruction_error)
      .function("getHodgeMetrics", &FaceHodgeSystem::get_hodge_metrics)
      .function("getDiagnostics", &FaceHodgeSystem::get_diagnostics);
}
