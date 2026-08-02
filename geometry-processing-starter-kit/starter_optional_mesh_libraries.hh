#pragma once

// This header is the only adapter needed to opt in to a larger mesh library.
// The starter objective itself remains library-neutral, so students can begin
// without either dependency and choose one only when their project needs it.

#ifdef GEOMETRY_STARTER_WITH_LIBIGL
#include <igl/edges.h>
#endif

#ifdef GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL
#include <geometrycentral/surface/manifold_surface_mesh.h>
#include <geometrycentral/surface/meshio.h>
#endif

namespace geometry_starter {

constexpr const char *configured_mesh_libraries() {
#if defined(GEOMETRY_STARTER_WITH_LIBIGL) &&                              \
    defined(GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL)
  return "libigl + Geometry Central";
#elif defined(GEOMETRY_STARTER_WITH_LIBIGL)
  return "libigl";
#elif defined(GEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL)
  return "Geometry Central";
#else
  return "built-in minimal grid (no optional mesh library)";
#endif
}

} // namespace geometry_starter
