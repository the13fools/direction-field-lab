#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// This file is both compiled into the WebAssembly kernel and imported verbatim
// into the browser's editable source panel. Keep the callbacks small enough to
// discuss line by line.
//
// LAB NOTE: Each callback returns ONE local scalar energy. TinyAD differentiates
// it and scatters the local gradient/Hessian into a global sparse system.
// Students therefore write the mathematical residual, not derivative code.
//
// TRY: Replace `target` by `0.5 * target`, rebuild, and predict which displayed
// Hodge component changes. Restore the source before the next exercise.

struct HodgeEdge {
  // tail -> head fixes the sign of the edge integral.
  int tail = -1;
  int head = -1;
  // A closed surface gives every edge two incident faces with opposite signs.
  std::array<int, 2> faces{-1, -1};
  std::array<double, 2> face_signs{0.0, 0.0};
};

template <typename Element>
auto exact_projection_callback(
    Element& element,
    const HodgeEdge& edge,
    const double target) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  // LAB NOTE: d(phi) on an oriented edge is phi(head) - phi(tail).
  const Scalar potential_tail = element.variables(edge.tail)[0];
  const Scalar potential_head = element.variables(edge.head)[0];
  const Scalar error = (potential_head - potential_tail) - target;
  // 1/2 r^2 is conventional: its first derivative is simply r dr.
  return 0.5 * error * error;
}

template <typename Element>
auto coexact_projection_callback(
    Element& element,
    const HodgeEdge& edge,
    const double target) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  // LAB NOTE: This is the signed transpose-incidence action from the two
  // neighboring face potentials back to their shared edge.
  const Scalar reconstructed =
      edge.face_signs[0] * element.variables(edge.faces[0])[0] +
      edge.face_signs[1] * element.variables(edge.faces[1])[0];
  const Scalar error = reconstructed - target;
  return 0.5 * error * error;
}
