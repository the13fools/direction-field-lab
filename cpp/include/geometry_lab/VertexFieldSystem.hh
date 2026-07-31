#pragma once

#include <VertexFieldCallbacks.hh>

#include <TinyAD/ScalarFunction.hh>
#include <TinyAD/Utils/NewtonDirection.hh>

#include <Eigen/Core>

#include <array>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace geometry_lab {

struct SolverDiagnostics {
  double energy = 0.0;
  double gradient_norm = 0.0;
  double newton_decrement = 0.0;
  int dofs = 0;
  int hessian_nonzeros = 0;
  int accepted_iterations = 0;
};

struct IntegrabilityMetrics {
  double curl_rms = 0.0;
  double max_abs_curl = 0.0;
  double period_u = 0.0;
  double period_v = 0.0;
};

// The platform-neutral numerical experiment. Both the native Polyscope app and
// the WebAssembly binding instantiate this exact class.
class VertexFieldSystem {
public:
  void init(int grid_size, double data_weight, double smoothness_weight,
            double integrability_weight, double length_weight,
            double target_length, double initialization_noise, int seed);
  void step(int iterations);

  [[nodiscard]] const std::vector<double> &parameter_positions() const;
  [[nodiscard]] const std::vector<int> &edges() const;
  [[nodiscard]] const Eigen::VectorXd &field() const;
  [[nodiscard]] const std::vector<double> &target_field() const;
  [[nodiscard]] const std::vector<Eigen::Vector3d> &surface_positions() const;
  [[nodiscard]] const std::vector<Eigen::Vector3d> &frames_u() const;
  [[nodiscard]] const std::vector<Eigen::Vector3d> &frames_v() const;
  [[nodiscard]] const std::vector<std::array<int, 3>> &faces() const;

  [[nodiscard]] std::vector<Eigen::Vector3d> ambient_field() const;
  [[nodiscard]] std::vector<Eigen::Vector3d> ambient_target_field() const;
  [[nodiscard]] std::vector<double> face_curl() const;
  [[nodiscard]] IntegrabilityMetrics integrability_metrics() const;
  [[nodiscard]] SolverDiagnostics diagnostics() const;

private:
  void require_initialized() const;
  [[nodiscard]] int vertex(int x, int y) const;
  void add_edge(int tail, int head);
  void build_periodic_mesh();
  void build_frames_and_targets();
  void add_triangle(const std::array<int, 3> &vertices);
  void build_triangles();
  [[nodiscard]] Eigen::Vector3d
  minimally_rotate(const Eigen::Vector3d &vector,
                   const Eigen::Vector3d &from_normal,
                   const Eigen::Vector3d &to_normal) const;
  void build_connections();
  void build_objective(double data_weight, double smoothness_weight,
                       double integrability_weight, double length_weight,
                       double target_length);
  [[nodiscard]] Eigen::Vector3d ambient_field(int vertex_index) const;
  [[nodiscard]] double edge_integral(int tail, int head) const;
  [[nodiscard]] double
  triangle_circulation(const VertexFieldTriangle &triangle) const;
  [[nodiscard]] double canonical_period(bool u_direction) const;
  void initialize_field(double noise, int seed);
  void evaluate_diagnostics();

  int grid_size_ = 0;
  int vertex_count_ = 0;
  std::vector<double> positions_;
  std::vector<VertexFieldConnection> edge_data_;
  std::vector<int> edges_flat_;
  std::unordered_map<std::uint64_t, int> edge_lookup_;
  std::vector<Eigen::Vector3d> frames_u_;
  std::vector<Eigen::Vector3d> frames_v_;
  std::vector<Eigen::Vector3d> normals_;
  std::vector<Eigen::Vector3d> embedded_positions_;
  std::vector<VertexFieldTarget> targets_;
  std::vector<VertexFieldTriangle> triangles_;
  std::vector<std::array<int, 3>> faces_;
  std::vector<double> target_flat_;
  TinyAD::ScalarFunction<2, double, Eigen::Index> objective_;
  Eigen::VectorXd field_;
  TinyAD::LinearSolver<> solver_;
  SolverDiagnostics diagnostics_;
  bool initialized_ = false;
};

} // namespace geometry_lab
