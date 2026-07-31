#pragma once

#include <TinyAD/ScalarFunction.hh>

#include <array>

// LAB NOTE: TinyAD calls these functions once per triangle. `element.variables`
// returns automatic-differentiation scalars, so ordinary arithmetic below
// produces the local value, gradient, and Hessian together.
//
// We use mixed finite elements for a piecewise-constant vector field. The exact
// potential is conforming P1 (one scalar per vertex); the coexact potential is
// non-conforming Crouzeix-Raviart P1 (one scalar per edge midpoint).
//
// TRY: Start by changing the 0.5 in one returned energy. The minimizer stays the
// same if this is the only term, but the gradient and Hessian scale together.

struct HodgeFace {
  // Global unknown indices touched by this one local triangle.
  std::array<int, 3> vertices{-1, -1, -1};
  std::array<int, 3> edges{-1, -1, -1};
  // Two components of grad(phi_i) for each barycentric basis function.
  std::array<double, 6> barycentric_gradients{0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
  double area = 0.0;
};

template <typename Element>
auto face_exact_projection_callback(
    Element& element,
    const HodgeFace& face,
    const double target_x,
    const double target_y) -> TINYAD_SCALAR_TYPE(element) {
  // LAB NOTE: Scalar is `double` for value-only evaluation and a TinyAD scalar
  // when derivatives are requested. The callback source is identical for both.
  using Scalar = TINYAD_SCALAR_TYPE(element);
  Scalar reconstructed_x = 0.0;
  Scalar reconstructed_y = 0.0;
  for (int corner = 0; corner < 3; ++corner) {
    // A P1 function is linear on a triangle, hence this gradient is constant.
    const Scalar potential = element.variables(face.vertices[corner])[0];
    reconstructed_x += potential * face.barycentric_gradients[2 * corner];
    reconstructed_y += potential * face.barycentric_gradients[2 * corner + 1];
  }
  const Scalar error_x = reconstructed_x - target_x;
  const Scalar error_y = reconstructed_y - target_y;
  // Area is the mass/inner-product weight for this facewise vector residual.
  return 0.5 * face.area * (error_x * error_x + error_y * error_y);
}

template <typename Element>
auto face_coexact_projection_callback(
    Element& element,
    const HodgeFace& face,
    const double target_x,
    const double target_y) -> TINYAD_SCALAR_TYPE(element) {
  using Scalar = TINYAD_SCALAR_TYPE(element);
  Scalar gradient_x = 0.0;
  Scalar gradient_y = 0.0;
  // LAB NOTE: A Crouzeix-Raviart basis function lives at an edge midpoint.
  // Local edges (01, 12, 20) are opposite local vertices (2, 0, 1).
  constexpr std::array<int, 3> opposite_corner{2, 0, 1};
  for (int local_edge = 0; local_edge < 3; ++local_edge) {
    const Scalar midpoint_value = element.variables(face.edges[local_edge])[0];
    const int corner = opposite_corner[local_edge];
    gradient_x -= 2.0 * midpoint_value * face.barycentric_gradients[2 * corner];
    gradient_y -= 2.0 * midpoint_value * face.barycentric_gradients[2 * corner + 1];
  }
  const Scalar reconstructed_x = -gradient_y;
  const Scalar reconstructed_y = gradient_x;
  // Rotating a gradient by 90 degrees produces the coexact face field.
  const Scalar error_x = reconstructed_x - target_x;
  const Scalar error_y = reconstructed_y - target_y;
  return 0.5 * face.area * (error_x * error_x + error_y * error_y);
}
