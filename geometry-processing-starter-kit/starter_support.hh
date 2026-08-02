#pragma once

// Mesh generation, passive diagnostics, and Polyscope conversions live here so
// that a first-time reader can focus on main.cpp. Nothing in this file is
// required to understand the TinyAD objective.

#include <polyscope/polyscope.h>
#include <polyscope/surface_mesh.h>

#include <Eigen/Core>

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace sgi_starter {

using Face = std::array<int, 3>;

struct Vertex {
  Eigen::Vector2d position;
  Eigen::Vector2d target;
};

struct Mesh {
  std::vector<Vertex> vertices;
  std::vector<Face> faces;
};

inline int vertex_index(const int x, const int y, const int grid) {
  return y * grid + x;
}

inline Mesh make_grid(const int grid) {
  Mesh mesh;
  mesh.vertices.reserve(static_cast<std::size_t>(grid * grid));
  mesh.faces.reserve(static_cast<std::size_t>(2 * (grid - 1) * (grid - 1)));

  for (int y = 0; y < grid; ++y) {
    for (int x = 0; x < grid; ++x) {
      const Eigen::Vector2d p(
          -1.0 + 2.0 * x / static_cast<double>(grid - 1),
          -1.0 + 2.0 * y / static_cast<double>(grid - 1));
      // A rotating field is a positive control: its curl is not zero.
      mesh.vertices.push_back({p, Eigen::Vector2d(-p.y(), p.x())});
    }
  }

  for (int y = 0; y + 1 < grid; ++y) {
    for (int x = 0; x + 1 < grid; ++x) {
      const int v00 = vertex_index(x, y, grid);
      const int v10 = vertex_index(x + 1, y, grid);
      const int v11 = vertex_index(x + 1, y + 1, grid);
      const int v01 = vertex_index(x, y + 1, grid);
      mesh.faces.push_back({v00, v10, v11});
      mesh.faces.push_back({v00, v11, v01});
    }
  }
  return mesh;
}

inline double triangle_area(const Mesh &mesh, const Face &face) {
  const Eigen::Vector2d a = mesh.vertices[face[0]].position;
  const Eigen::Vector2d b = mesh.vertices[face[1]].position;
  const Eigen::Vector2d c = mesh.vertices[face[2]].position;
  const Eigen::Vector2d ab = b - a;
  const Eigen::Vector2d ac = c - a;
  return 0.5 * std::abs(ab.x() * ac.y() - ab.y() * ac.x());
}

inline double circulation(
    const Mesh &mesh, const Eigen::VectorXd &field, const Face &face) {
  double value = 0.0;
  for (int corner = 0; corner < 3; ++corner) {
    const int next = (corner + 1) % 3;
    const int tail = face[corner];
    const int head = face[next];
    const Eigen::Vector2d u_tail = field.segment<2>(2 * tail);
    const Eigen::Vector2d u_head = field.segment<2>(2 * head);
    const Eigen::Vector2d edge =
        mesh.vertices[head].position - mesh.vertices[tail].position;
    value += 0.5 * (u_tail + u_head).dot(edge);
  }
  return value;
}

inline std::vector<double>
face_curl(const Mesh &mesh, const Eigen::VectorXd &field) {
  std::vector<double> values;
  values.reserve(mesh.faces.size());
  for (const Face &face : mesh.faces) {
    values.push_back(
        circulation(mesh, field, face) / triangle_area(mesh, face));
  }
  return values;
}

inline double curl_rms(
    const Mesh &mesh, const std::vector<double> &curls) {
  double weighted_square_sum = 0.0;
  double area_sum = 0.0;
  for (std::size_t index = 0; index < mesh.faces.size(); ++index) {
    const double area = triangle_area(mesh, mesh.faces[index]);
    weighted_square_sum += area * curls[index] * curls[index];
    area_sum += area;
  }
  return std::sqrt(weighted_square_sum / area_sum);
}

inline std::vector<std::array<double, 3>> mesh_positions(const Mesh &mesh) {
  std::vector<std::array<double, 3>> result;
  result.reserve(mesh.vertices.size());
  for (const Vertex &vertex : mesh.vertices) {
    result.push_back({vertex.position.x(), vertex.position.y(), 0.0});
  }
  return result;
}

inline std::vector<std::array<std::size_t, 3>> mesh_faces(const Mesh &mesh) {
  std::vector<std::array<std::size_t, 3>> result;
  result.reserve(mesh.faces.size());
  for (const Face &face : mesh.faces) {
    result.push_back({
        static_cast<std::size_t>(face[0]),
        static_cast<std::size_t>(face[1]),
        static_cast<std::size_t>(face[2]),
    });
  }
  return result;
}

inline std::vector<std::array<double, 3>> field_vectors(
    const Mesh &mesh, const Eigen::VectorXd &field, const bool target) {
  std::vector<std::array<double, 3>> result;
  result.reserve(mesh.vertices.size());
  for (std::size_t vertex = 0; vertex < mesh.vertices.size(); ++vertex) {
    const Eigen::Vector2d value = target
        ? mesh.vertices[vertex].target
        : field.segment<2>(2 * static_cast<Eigen::Index>(vertex));
    result.push_back({value.x(), value.y(), 0.0});
  }
  return result;
}

inline void publish_quantities(
    const Mesh &mesh, const Eigen::VectorXd &field,
    const std::vector<double> &curls) {
  auto *surface = polyscope::getSurfaceMesh("starter grid");
  auto *target = surface->addVertexVectorQuantity(
      "target field", field_vectors(mesh, field, true));
  target->setEnabled(false);
  target->setVectorColor({1.0, 0.50, 0.78});
  auto *solution = surface->addVertexVectorQuantity(
      "optimized field", field_vectors(mesh, field, false));
  solution->setEnabled(true);
  solution->setVectorColor({0.45, 0.86, 1.0});
  surface->addFaceScalarQuantity("triangle curl", curls);
}

inline void reset_polyscope_mesh(
    const Mesh &mesh, const Eigen::VectorXd &field,
    const std::vector<double> &curls) {
  if (polyscope::hasSurfaceMesh("starter grid"))
    polyscope::removeSurfaceMesh("starter grid");
  auto *surface = polyscope::registerSurfaceMesh(
      "starter grid", mesh_positions(mesh), mesh_faces(mesh));
  surface->setSurfaceColor({0.13, 0.10, 0.22});
  surface->setEdgeWidth(0.45);
  publish_quantities(mesh, field, curls);
}

} // namespace sgi_starter
