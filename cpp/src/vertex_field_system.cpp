#include "geometry_lab/VertexFieldSystem.hh"

#include <TinyAD/Utils/LineSearch.hh>
#include <TinyAD/Utils/NewtonDecrement.hh>
#include <TinyAD/Utils/NewtonDirection.hh>

#include <Eigen/Geometry>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace geometry_lab {
namespace {

constexpr double pi = 3.14159265358979323846;
constexpr double major_radius = 2.55;
constexpr double minor_radius = 1.02;

std::uint64_t vertex_edge_key(const int a, const int b) {
  const auto low = static_cast<std::uint32_t>(std::min(a, b));
  const auto high = static_cast<std::uint32_t>(std::max(a, b));
  return (static_cast<std::uint64_t>(low) << 32U) | high;
}

} // namespace

void VertexFieldSystem::init(
    const int grid_size, const double data_weight,
    const double smoothness_weight, const double integrability_weight,
    const double length_weight, const double target_length,
    const double initialization_noise, const int seed) {
  if (grid_size < 4 || grid_size > 48) {
    throw std::invalid_argument("gridSize must be between 4 and 48");
  }
  for (const double value : {
           data_weight,
           smoothness_weight,
           integrability_weight,
           length_weight,
           target_length,
           initialization_noise,
       }) {
    if (!std::isfinite(value) || value < 0.0) {
      throw std::invalid_argument(
          "Vertex objective weights must be finite and nonnegative");
    }
  }
  if (data_weight == 0.0 && smoothness_weight == 0.0 &&
      integrability_weight == 0.0 && length_weight == 0.0) {
    throw std::invalid_argument(
        "At least one vertex objective term must have positive weight");
  }

  grid_size_ = grid_size;
  build_periodic_mesh();
  build_frames_and_targets();
  build_triangles();
  build_connections();
  build_objective(data_weight, smoothness_weight, integrability_weight,
                  length_weight, target_length);
  initialize_field(initialization_noise, seed);
  initialized_ = true;
  diagnostics_.accepted_iterations = 0;
  diagnostics_.newton_decrement = 0.0;
  evaluate_diagnostics();
}

void VertexFieldSystem::step(const int iterations) {
  require_initialized();
  if (iterations < 1 || iterations > 20) {
    throw std::invalid_argument("iterations must be between 1 and 20");
  }
  int accepted = 0;
  for (int iteration = 0; iteration < iterations; ++iteration) {
    auto [energy, gradient, hessian] =
        objective_.eval_with_hessian_proj(field_);
    if (gradient.norm() < 1e-9)
      break;
    const Eigen::VectorXd direction =
        TinyAD::newton_direction(gradient, hessian, solver_);
    diagnostics_.newton_decrement =
        TinyAD::newton_decrement(direction, gradient);
    const Eigen::VectorXd candidate =
        TinyAD::line_search(field_, direction, energy, gradient, objective_);
    if ((candidate - field_).norm() < 1e-12)
      break;
    field_ = candidate;
    ++accepted;
  }
  diagnostics_.accepted_iterations = accepted;
  evaluate_diagnostics();
}

const std::vector<double> &VertexFieldSystem::parameter_positions() const {
  require_initialized();
  return positions_;
}

const std::vector<int> &VertexFieldSystem::edges() const {
  require_initialized();
  return edges_flat_;
}

const Eigen::VectorXd &VertexFieldSystem::field() const {
  require_initialized();
  return field_;
}

const std::vector<double> &VertexFieldSystem::target_field() const {
  require_initialized();
  return target_flat_;
}

const std::vector<Eigen::Vector3d> &
VertexFieldSystem::surface_positions() const {
  require_initialized();
  return embedded_positions_;
}

const std::vector<Eigen::Vector3d> &VertexFieldSystem::frames_u() const {
  require_initialized();
  return frames_u_;
}

const std::vector<Eigen::Vector3d> &VertexFieldSystem::frames_v() const {
  require_initialized();
  return frames_v_;
}

const std::vector<std::array<int, 3>> &VertexFieldSystem::faces() const {
  require_initialized();
  return faces_;
}

std::vector<Eigen::Vector3d> VertexFieldSystem::ambient_field() const {
  require_initialized();
  std::vector<Eigen::Vector3d> result;
  result.reserve(static_cast<std::size_t>(vertex_count_));
  for (int vertex_index = 0; vertex_index < vertex_count_; ++vertex_index) {
    result.push_back(ambient_field(vertex_index));
  }
  return result;
}

std::vector<Eigen::Vector3d>
VertexFieldSystem::ambient_target_field() const {
  require_initialized();
  std::vector<Eigen::Vector3d> result;
  result.reserve(static_cast<std::size_t>(vertex_count_));
  for (int vertex_index = 0; vertex_index < vertex_count_; ++vertex_index) {
    result.push_back(
        targets_[vertex_index].vector[0] * frames_u_[vertex_index] +
        targets_[vertex_index].vector[1] * frames_v_[vertex_index]);
  }
  return result;
}

std::vector<double> VertexFieldSystem::face_curl() const {
  require_initialized();
  std::vector<double> result;
  result.reserve(triangles_.size());
  for (const VertexFieldTriangle &triangle : triangles_) {
    result.push_back(triangle_circulation(triangle) / triangle.area);
  }
  return result;
}

IntegrabilityMetrics VertexFieldSystem::integrability_metrics() const {
  require_initialized();
  double curl_squared_integral = 0.0;
  double total_area = 0.0;
  double max_abs_curl = 0.0;
  for (const VertexFieldTriangle &triangle : triangles_) {
    const double curl = triangle_circulation(triangle) / triangle.area;
    curl_squared_integral += triangle.area * curl * curl;
    total_area += triangle.area;
    max_abs_curl = std::max(max_abs_curl, std::abs(curl));
  }
  return {
      total_area > 0.0 ? std::sqrt(curl_squared_integral / total_area) : 0.0,
      max_abs_curl,
      canonical_period(true),
      canonical_period(false),
  };
}

SolverDiagnostics VertexFieldSystem::diagnostics() const {
  require_initialized();
  return diagnostics_;
}

void VertexFieldSystem::require_initialized() const {
  if (!initialized_) {
    throw std::runtime_error(
        "Initialize the vertex field system before using it");
  }
}

int VertexFieldSystem::vertex(const int x, const int y) const {
  const int wrapped_x = (x % grid_size_ + grid_size_) % grid_size_;
  const int wrapped_y = (y % grid_size_ + grid_size_) % grid_size_;
  return wrapped_y * grid_size_ + wrapped_x;
}

void VertexFieldSystem::add_edge(const int tail, const int head) {
  const std::uint64_t key = vertex_edge_key(tail, head);
  if (edge_lookup_.contains(key))
    return;
  edge_lookup_[key] = static_cast<int>(edge_data_.size());
  VertexFieldConnection connection;
  connection.tail = tail;
  connection.head = head;
  edge_data_.push_back(connection);
}

void VertexFieldSystem::build_periodic_mesh() {
  vertex_count_ = grid_size_ * grid_size_;
  positions_.assign(2 * static_cast<std::size_t>(vertex_count_), 0.0);
  edge_data_.clear();
  edges_flat_.clear();
  edge_lookup_.clear();
  for (int y = 0; y < grid_size_; ++y) {
    for (int x = 0; x < grid_size_; ++x) {
      const int vertex_index = vertex(x, y);
      positions_[2 * static_cast<std::size_t>(vertex_index)] =
          static_cast<double>(x);
      positions_[2 * static_cast<std::size_t>(vertex_index) + 1] =
          static_cast<double>(y);
      add_edge(vertex_index, vertex(x + 1, y));
      add_edge(vertex_index, vertex(x + 1, y + 1));
      add_edge(vertex_index, vertex(x, y + 1));
    }
  }
  for (const VertexFieldConnection &edge : edge_data_) {
    edges_flat_.push_back(edge.tail);
    edges_flat_.push_back(edge.head);
  }
}

void VertexFieldSystem::build_frames_and_targets() {
  frames_u_.resize(static_cast<std::size_t>(vertex_count_));
  frames_v_.resize(static_cast<std::size_t>(vertex_count_));
  normals_.resize(static_cast<std::size_t>(vertex_count_));
  embedded_positions_.resize(static_cast<std::size_t>(vertex_count_));
  targets_.resize(static_cast<std::size_t>(vertex_count_));
  target_flat_.assign(2 * static_cast<std::size_t>(vertex_count_), 0.0);
  for (int y = 0; y < grid_size_; ++y) {
    for (int x = 0; x < grid_size_; ++x) {
      const int index = vertex(x, y);
      const double u = 2.0 * pi * static_cast<double>(x) / grid_size_;
      const double v = 2.0 * pi * static_cast<double>(y) / grid_size_;
      const Eigen::Vector3d frame_u(-std::sin(u), std::cos(u), 0.0);
      const Eigen::Vector3d frame_v(-std::sin(v) * std::cos(u),
                                    -std::sin(v) * std::sin(u), std::cos(v));
      frames_u_[index] = frame_u.normalized();
      frames_v_[index] = frame_v.normalized();
      normals_[index] = frames_u_[index].cross(frames_v_[index]).normalized();
      const double radius = major_radius + minor_radius * std::cos(v);
      embedded_positions_[index] = {
          radius * std::cos(u),
          radius * std::sin(u),
          minor_radius * std::sin(v),
      };
      const double angle =
          0.7 * std::sin(u) - 0.45 * std::cos(v) + 0.3 * std::sin(u + v);
      const double magnitude = 0.75 + 0.2 * std::cos(u - 2.0 * v);
      targets_[index].vector = {magnitude * std::cos(angle),
                                magnitude * std::sin(angle)};
      target_flat_[2 * static_cast<std::size_t>(index)] =
          targets_[index].vector[0];
      target_flat_[2 * static_cast<std::size_t>(index) + 1] =
          targets_[index].vector[1];
    }
  }
}

void VertexFieldSystem::add_triangle(
    const std::array<int, 3> &vertices) {
  VertexFieldTriangle triangle;
  triangle.vertices = vertices;
  for (int corner = 0; corner < 3; ++corner) {
    for (int axis = 0; axis < 3; ++axis) {
      triangle.frame_u[corner][axis] = frames_u_[vertices[corner]][axis];
      triangle.frame_v[corner][axis] = frames_v_[vertices[corner]][axis];
    }
    const int next = (corner + 1) % 3;
    const Eigen::Vector3d edge =
        embedded_positions_[vertices[next]] -
        embedded_positions_[vertices[corner]];
    for (int axis = 0; axis < 3; ++axis) {
      triangle.edge_vectors[corner][axis] = edge[axis];
    }
  }
  const Eigen::Vector3d first_edge =
      embedded_positions_[vertices[1]] - embedded_positions_[vertices[0]];
  const Eigen::Vector3d second_edge =
      embedded_positions_[vertices[2]] - embedded_positions_[vertices[0]];
  triangle.area = 0.5 * first_edge.cross(second_edge).norm();
  if (triangle.area <= 1e-12) {
    throw std::runtime_error("Periodic triangle must have positive area");
  }
  triangles_.push_back(triangle);
  faces_.push_back(vertices);
}

void VertexFieldSystem::build_triangles() {
  triangles_.clear();
  faces_.clear();
  triangles_.reserve(2 * static_cast<std::size_t>(grid_size_ * grid_size_));
  faces_.reserve(2 * static_cast<std::size_t>(grid_size_ * grid_size_));
  for (int y = 0; y < grid_size_; ++y) {
    for (int x = 0; x < grid_size_; ++x) {
      const int v00 = vertex(x, y);
      const int v10 = vertex(x + 1, y);
      const int v11 = vertex(x + 1, y + 1);
      const int v01 = vertex(x, y + 1);
      add_triangle({v00, v10, v11});
      add_triangle({v00, v11, v01});
    }
  }
}

Eigen::Vector3d VertexFieldSystem::minimally_rotate(
    const Eigen::Vector3d &vector, const Eigen::Vector3d &from_normal,
    const Eigen::Vector3d &to_normal) const {
  const Eigen::Vector3d axis = from_normal.cross(to_normal);
  const double sine = axis.norm();
  const double cosine = std::clamp(from_normal.dot(to_normal), -1.0, 1.0);
  if (sine < 1e-12)
    return cosine > 0.0 ? vector : -vector;
  return Eigen::AngleAxisd(std::atan2(sine, cosine), axis / sine) * vector;
}

void VertexFieldSystem::build_connections() {
  for (VertexFieldConnection &edge : edge_data_) {
    const Eigen::Vector3d transported_u = minimally_rotate(
        frames_u_[edge.tail], normals_[edge.tail], normals_[edge.head]);
    const Eigen::Vector3d transported_v = minimally_rotate(
        frames_v_[edge.tail], normals_[edge.tail], normals_[edge.head]);
    edge.rotation = {
        frames_u_[edge.head].dot(transported_u),
        frames_u_[edge.head].dot(transported_v),
        frames_v_[edge.head].dot(transported_u),
        frames_v_[edge.head].dot(transported_v),
    };
  }
}

void VertexFieldSystem::build_objective(
    const double data_weight, const double smoothness_weight,
    const double integrability_weight, const double length_weight,
    const double target_length) {
  objective_ = TinyAD::scalar_function<2>(TinyAD::range(vertex_count_));
  objective_.add_elements<1>(
      TinyAD::range(vertex_count_),
      [this, data_weight, length_weight, target_length](auto &element) {
        const int vertex_index = static_cast<int>(element.handle);
        return vertex_data_and_length_callback(
            element, vertex_index, targets_[vertex_index], data_weight,
            length_weight, target_length);
      });
  objective_.add_elements<2>(
      TinyAD::range(edge_data_.size()),
      [this, smoothness_weight](auto &element) {
        const std::size_t edge = static_cast<std::size_t>(element.handle);
        return vertex_connection_callback(element, edge_data_[edge],
                                          smoothness_weight);
      });
  objective_.add_elements<3>(
      TinyAD::range(triangles_.size()),
      [this, integrability_weight](auto &element) {
        const std::size_t triangle = static_cast<std::size_t>(element.handle);
        return vertex_integrability_callback(element, triangles_[triangle],
                                             integrability_weight);
      });
}

Eigen::Vector3d
VertexFieldSystem::ambient_field(const int vertex_index) const {
  return field_[2 * vertex_index] * frames_u_[vertex_index] +
         field_[2 * vertex_index + 1] * frames_v_[vertex_index];
}

double VertexFieldSystem::edge_integral(const int tail, const int head) const {
  const Eigen::Vector3d edge =
      embedded_positions_[head] - embedded_positions_[tail];
  return 0.5 * (ambient_field(tail) + ambient_field(head)).dot(edge);
}

double VertexFieldSystem::triangle_circulation(
    const VertexFieldTriangle &triangle) const {
  double circulation = 0.0;
  for (int edge = 0; edge < 3; ++edge) {
    circulation += edge_integral(
        triangle.vertices[edge], triangle.vertices[(edge + 1) % 3]);
  }
  return circulation;
}

double VertexFieldSystem::canonical_period(const bool u_direction) const {
  double period = 0.0;
  for (int coordinate = 0; coordinate < grid_size_; ++coordinate) {
    const int tail =
        u_direction ? vertex(coordinate, 0) : vertex(0, coordinate);
    const int head =
        u_direction ? vertex(coordinate + 1, 0) : vertex(0, coordinate + 1);
    period += edge_integral(tail, head);
  }
  return period;
}

void VertexFieldSystem::initialize_field(const double noise, const int seed) {
  std::uint32_t random_state =
      static_cast<std::uint32_t>(seed == 0 ? 1 : seed);
  auto random_signed = [&random_state]() {
    random_state ^= random_state << 13U;
    random_state ^= random_state >> 17U;
    random_state ^= random_state << 5U;
    return 2.0 * static_cast<double>(random_state) /
               static_cast<double>(
                   std::numeric_limits<std::uint32_t>::max()) -
           1.0;
  };
  field_.resize(2 * vertex_count_);
  for (int vertex_index = 0; vertex_index < vertex_count_; ++vertex_index) {
    field_[2 * vertex_index] =
        0.2 * targets_[vertex_index].vector[0] + noise * random_signed();
    field_[2 * vertex_index + 1] =
        0.2 * targets_[vertex_index].vector[1] + noise * random_signed();
  }
}

void VertexFieldSystem::evaluate_diagnostics() {
  auto [energy, gradient, hessian] =
      objective_.eval_with_hessian_proj(field_);
  diagnostics_.energy = energy;
  diagnostics_.gradient_norm = gradient.norm();
  diagnostics_.dofs = 2 * vertex_count_;
  diagnostics_.hessian_nonzeros = static_cast<int>(hessian.nonZeros());
}

} // namespace geometry_lab
