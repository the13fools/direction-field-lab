#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// These callbacks are deliberately data driven. The browser edits the term
// weights in the problem JSON; the worker passes those numbers into this
// compiled callback when it constructs the TinyAD objective.

struct VertexFieldTarget {
  std::array<double, 2> vector{0.0, 0.0};
};

struct VertexFieldConnection {
  int tail = -1;
  int head = -1;
  // Parallel transport from the tail frame into the head frame.
  std::array<double, 4> rotation{1.0, 0.0, 0.0, 1.0};
};

template <typename Element>
auto vertex_data_and_length_callback(
    Element& element,
    const int vertex,
    const VertexFieldTarget& target,
    const double data_weight,
    const double length_weight,
    const double target_length) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const auto field = element.variables(vertex);
  const Scalar error_x = field[0] - target.vector[0];
  const Scalar error_y = field[1] - target.vector[1];
  const Scalar squared_length = field[0] * field[0] + field[1] * field[1];
  const Scalar length_error = squared_length - target_length * target_length;
  return 0.5 * data_weight * (error_x * error_x + error_y * error_y) +
         0.5 * length_weight * length_error * length_error;
}

template <typename Element>
auto vertex_connection_callback(
    Element& element,
    const VertexFieldConnection& connection,
    const double smoothness_weight) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const auto tail = element.variables(connection.tail);
  const auto head = element.variables(connection.head);
  const Scalar transported_x =
      connection.rotation[0] * tail[0] + connection.rotation[1] * tail[1];
  const Scalar transported_y =
      connection.rotation[2] * tail[0] + connection.rotation[3] * tail[1];
  const Scalar error_x = head[0] - transported_x;
  const Scalar error_y = head[1] - transported_y;
  return 0.5 * smoothness_weight * (error_x * error_x + error_y * error_y);
}
