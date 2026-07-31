#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// These callbacks are deliberately data driven. The browser edits the term
// weights in the problem JSON; the worker passes those numbers into this
// compiled callback when it constructs the TinyAD objective.
//
// LAB NOTE: A vertex stores TWO numbers: coordinates in its local tangent
// frame, not an ambient R^3 vector. TinyAD treats those two numbers as the
// unknowns and differentiates every returned scalar energy automatically.
//
// TRY: Set one JSON weight to zero before editing C++. This isolates a term and
// makes it much easier to predict what a source-code change should do.

struct VertexFieldTarget {
  // Desired vector coordinates in the same local tangent frame as the unknown.
  std::array<double, 2> vector{0.0, 0.0};
};

struct VertexFieldConnection {
  int tail = -1;
  int head = -1;
  // Parallel transport from the tail frame into the head frame.
  std::array<double, 4> rotation{1.0, 0.0, 0.0, 1.0};
};

struct VertexFieldTriangle {
  std::array<int, 3> vertices{-1, -1, -1};
  // Local tangent bases at the three vertices, expressed in R^3.
  std::array<std::array<double, 3>, 3> frame_u{};
  std::array<std::array<double, 3>, 3> frame_v{};
  // Oriented chord vectors p1-p0, p2-p1, and p0-p2.
  std::array<std::array<double, 3>, 3> edge_vectors{};
  double area = 1.0;
};

template <typename Element>
auto vertex_data_and_length_callback(
    Element &element, const int vertex, const VertexFieldTarget &target,
    const double data_weight, const double length_weight,
    const double target_length) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  // LAB NOTE: `field` is an automatic-differentiation vector with two entries.
  const auto field = element.variables(vertex);
  const Scalar error_x = field[0] - target.vector[0];
  const Scalar error_y = field[1] - target.vector[1];
  const Scalar squared_length = field[0] * field[0] + field[1] * field[1];
  const Scalar length_error = squared_length - target_length * target_length;
  // The global objective is the sum of this return value over all vertices.
  return 0.5 * data_weight * (error_x * error_x + error_y * error_y) +
         0.5 * length_weight * length_error * length_error;
}

template <typename Element>
auto vertex_connection_callback(
    Element &element, const VertexFieldConnection &connection,
    const double smoothness_weight) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const auto tail = element.variables(connection.tail);
  const auto head = element.variables(connection.head);
  // LAB NOTE: Vectors at different vertices use different tangent frames. We
  // must parallel-transport `tail` before subtracting it from `head`.
  const Scalar transported_x =
      connection.rotation[0] * tail[0] + connection.rotation[1] * tail[1];
  const Scalar transported_y =
      connection.rotation[2] * tail[0] + connection.rotation[3] * tail[1];
  const Scalar error_x = head[0] - transported_x;
  const Scalar error_y = head[1] - transported_y;
  return 0.5 * smoothness_weight * (error_x * error_x + error_y * error_y);
}

// LAB NOTE: This third term asks whether the vertex field could locally be the
// gradient of a scalar function. Build a discrete circulation from native
// vertex vectors. Each endpoint
// vector is lifted from its local tangent frame into R^3, trapezoid-averaged
// along an oriented triangle edge, and paired with that edge's chord.
//
//     circulation_f = sum_(i,j in boundary f) (u_i + u_j)/2 . (p_j - p_i)
//
// Dividing by area gives a facewise curl estimate. The weighted square below
// is therefore an area-integrated local integrability penalty. Zero triangle
// circulation means locally closed; on a torus, two global periods must still
// be checked before calling the field globally integrable.
template <typename Element>
auto vertex_integrability_callback(
    Element &element, const VertexFieldTriangle &triangle,
    const double integrability_weight) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  Scalar circulation = Scalar(0.0);
  for (int edge = 0; edge < 3; ++edge) {
    const int next = (edge + 1) % 3;
    const auto tail = element.variables(triangle.vertices[edge]);
    const auto head = element.variables(triangle.vertices[next]);
    for (int axis = 0; axis < 3; ++axis) {
      // Lift both endpoint vectors from their own 2D frames into ambient R^3.
      const Scalar tail_ambient = triangle.frame_u[edge][axis] * tail[0] +
                                  triangle.frame_v[edge][axis] * tail[1];
      const Scalar head_ambient = triangle.frame_u[next][axis] * head[0] +
                                  triangle.frame_v[next][axis] * head[1];
      circulation += 0.5 * (tail_ambient + head_ambient) *
                     triangle.edge_vectors[edge][axis];
    }
  }
  // TRY: Remove `/ triangle.area` and compare coarse/fine meshes. The result
  // exposes why discretization weights matter even when the residual is right.
  return 0.5 * integrability_weight * circulation * circulation / triangle.area;
}
