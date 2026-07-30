#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// This file is both compiled into the WebAssembly kernel and imported verbatim
// into the browser's editable source panel. Keep the callbacks small enough to
// discuss line by line.

struct HodgeEdge {
  int tail = -1;
  int head = -1;
  std::array<int, 2> faces{-1, -1};
  std::array<double, 2> face_signs{0.0, 0.0};
};

template <typename Element>
auto exact_projection_callback(
    Element& element,
    const HodgeEdge& edge,
    const double target) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const Scalar potential_tail = element.variables(edge.tail)[0];
  const Scalar potential_head = element.variables(edge.head)[0];
  const Scalar error = (potential_head - potential_tail) - target;
  return 0.5 * error * error;
}

template <typename Element>
auto coexact_projection_callback(
    Element& element,
    const HodgeEdge& edge,
    const double target) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  const Scalar reconstructed =
      edge.face_signs[0] * element.variables(edge.faces[0])[0] +
      edge.face_signs[1] * element.variables(edge.faces[1])[0];
  const Scalar error = reconstructed - target;
  return 0.5 * error * error;
}
