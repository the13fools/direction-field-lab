#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// The smallest TinyAD example in the course. The global program only chooses
// element ranges; all differentiable modeling decisions live in these two
// callbacks.

template <typename Element>
auto mass_spring_pin_callback(
    Element& element,
    const int vertex,
    const std::array<double, 2>& target,
    const double pin_weight) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const auto point = element.variables(vertex);
  const Scalar error_x = point[0] - target[0];
  const Scalar error_y = point[1] - target[1];
  return 0.5 * pin_weight * (error_x * error_x + error_y * error_y);
}

template <typename Element>
auto mass_spring_edge_callback(
    Element& element,
    const int tail,
    const int head,
    const double rest_length,
    const double spring_weight) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const auto p0 = element.variables(tail);
  const auto p1 = element.variables(head);
  const Scalar dx = p1[0] - p0[0];
  const Scalar dy = p1[1] - p0[1];
  const Scalar extension = sqrt(dx * dx + dy * dy) - rest_length;
  return 0.5 * spring_weight * extension * extension;
}
