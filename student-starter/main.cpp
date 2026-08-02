#include <TinyAD/ScalarFunction.hh>
#include <TinyAD/Utils/LineSearch.hh>
#include <TinyAD/Utils/NewtonDirection.hh>

#include "starter_support.hh"

#include <polyscope/polyscope.h>

#include <imgui.h>

#include <Eigen/Core>

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string_view>
#include <vector>

namespace {

using Face = sgi_starter::Face;
using Objective = TinyAD::ScalarFunction<2, double, Eigen::Index>;

struct Controls {
  int grid = 12;
  float data_weight = 1.0F;
  float curl_weight = 4.0F;
  float unit_weight = 0.08F;
};

Controls controls;
sgi_starter::Mesh mesh;
Objective objective;
Eigen::VectorXd field;
std::vector<double> curls;
std::unique_ptr<TinyAD::LinearSolver<>> solver;
double energy = 0.0;
double gradient_norm = 0.0;
double curl_rms = 0.0;
int accepted_steps = 0;

void build_problem() {
  mesh = sgi_starter::make_grid(controls.grid);
  objective = TinyAD::scalar_function<2>(
      TinyAD::range(static_cast<Eigen::Index>(mesh.vertices.size())));

  const double data_weight = controls.data_weight;
  const double curl_weight = controls.curl_weight;
  const double unit_weight = controls.unit_weight;

  // ------------------------------------------------------------------------
  // START HERE: this is the objective. Change these two callbacks first.
  // TinyAD evaluates the same code with doubles, first-order AD scalars, and
  // second-order AD scalars, then assembles the sparse global derivatives.
  // ------------------------------------------------------------------------

  // One element per vertex: stay near the target and optionally prefer unit
  // vectors. The data term also removes the constant-vector null space.
  objective.add_elements<1>(
      TinyAD::range(static_cast<Eigen::Index>(mesh.vertices.size())),
      [data_weight, unit_weight](auto &element) {
        using Scalar = TINYAD_SCALAR_TYPE(element);
        const Eigen::Index vertex = element.handle;
        const auto u = element.variables(vertex);
        const Eigen::Vector2d target = mesh.vertices[vertex].target;
        const Scalar error_x = u[0] - target.x();
        const Scalar error_y = u[1] - target.y();
        const Scalar length_error = u[0] * u[0] + u[1] * u[1] - 1.0;
        return 0.5 * data_weight *
                   (error_x * error_x + error_y * error_y) +
               0.5 * unit_weight * length_error * length_error;
      });

  // One element per triangle: approximate boundary circulation with endpoint
  // trapezoids. circulation / area is a facewise curl estimate, so
  // circulation^2 / area is an area-integrated squared-curl penalty.
  objective.add_elements<3>(
      TinyAD::range(static_cast<Eigen::Index>(mesh.faces.size())),
      [curl_weight](auto &element) {
        using Scalar = TINYAD_SCALAR_TYPE(element);
        const Face &face = mesh.faces[element.handle];
        Scalar circulation = Scalar(0.0);
        for (int corner = 0; corner < 3; ++corner) {
          const int next = (corner + 1) % 3;
          const int tail = face[corner];
          const int head = face[next];
          const auto u_tail = element.variables(tail);
          const auto u_head = element.variables(head);
          const Eigen::Vector2d edge =
              mesh.vertices[head].position - mesh.vertices[tail].position;
          circulation += 0.5 * (u_tail[0] + u_head[0]) * edge.x() +
                         0.5 * (u_tail[1] + u_head[1]) * edge.y();
        }
        return 0.5 * curl_weight * circulation * circulation /
               sgi_starter::triangle_area(mesh, face);
      });

  // ------------------------------------------------------------------------
  // END OF THE OBJECTIVE. Everything below is the solve/view loop.
  // ------------------------------------------------------------------------

  field = objective.x_from_data([](const Eigen::Index vertex) {
    const Eigen::Vector2d target = mesh.vertices[vertex].target;
    const double perturbation = 0.12 * std::sin(2.17 * vertex);
    // Construct an owned vector. Returning an unevaluated Eigen expression
    // that refers to a local variable would leave TinyAD with dangling data.
    return Eigen::Vector2d(
        0.25 * target.x() + perturbation,
        0.25 * target.y() - perturbation);
  });
  solver = std::make_unique<TinyAD::LinearSolver<>>();
  accepted_steps = 0;
}

void update_diagnostics() {
  const auto [current_energy, gradient, hessian] =
      objective.eval_with_hessian_proj(field);
  (void)hessian;
  energy = current_energy;
  gradient_norm = gradient.norm();

  curls = sgi_starter::face_curl(mesh, field);
  curl_rms = sgi_starter::curl_rms(mesh, curls);
}

void take_steps(const int count) {
  for (int step = 0; step < count; ++step) {
    auto [old_energy, gradient, hessian] =
        objective.eval_with_hessian_proj(field);
    if (gradient.norm() < 1e-9)
      break;
    const Eigen::VectorXd direction =
        TinyAD::newton_direction(gradient, hessian, *solver);
    const Eigen::VectorXd next =
        TinyAD::line_search(field, direction, old_energy, gradient, objective);
    if ((next - field).norm() < 1e-12)
      break;
    field = next;
    ++accepted_steps;
  }
  update_diagnostics();
}

void reset_viewer() {
  build_problem();
  update_diagnostics();
  sgi_starter::reset_polyscope_mesh(mesh, field, curls);
}

void optimize_and_publish(const int count) {
  take_steps(count);
  sgi_starter::publish_quantities(mesh, field, curls);
}

void user_interface() {
  ImGui::TextUnformatted("Summer Geometry Initiative · TinyAD starter");
  ImGui::TextWrapped(
      "Edit the block marked START HERE in main.cpp. Change weights here, "
      "then Reset objective.");
  ImGui::Separator();
  ImGui::SliderInt("grid", &controls.grid, 4, 32);
  ImGui::SliderFloat(
      "data weight", &controls.data_weight, 0.05F, 5.0F, "%.3f");
  ImGui::SliderFloat(
      "curl weight", &controls.curl_weight, 0.0F, 20.0F, "%.3f");
  ImGui::SliderFloat(
      "unit-length weight", &controls.unit_weight, 0.0F, 2.0F, "%.3f");
  if (ImGui::Button("Reset objective"))
    reset_viewer();
  ImGui::SameLine();
  if (ImGui::Button("One Newton step"))
    optimize_and_publish(1);
  ImGui::SameLine();
  if (ImGui::Button("Ten steps"))
    optimize_and_publish(10);
  ImGui::Separator();
  ImGui::Text("energy            %.6e", energy);
  ImGui::Text("gradient norm     %.6e", gradient_norm);
  ImGui::Text("triangle curl RMS %.6e", curl_rms);
  ImGui::Text("accepted steps    %d", accepted_steps);
}

int run_headless() {
  controls.grid = 8;
  build_problem();
  update_diagnostics();
  const double initial_energy = energy;
  take_steps(8);
  std::cout << "energy: " << initial_energy << " -> " << energy << '\n'
            << "gradient norm: " << gradient_norm << '\n'
            << "triangle curl RMS: " << curl_rms << '\n';
  const bool passed = std::isfinite(energy) && std::isfinite(gradient_norm) &&
                      std::isfinite(curl_rms) && energy <= initial_energy;
  return passed ? EXIT_SUCCESS : EXIT_FAILURE;
}

} // namespace

int main(const int argc, const char *const *argv) {
  if (argc == 2 && std::string_view(argv[1]) == "--headless")
    return run_headless();

  polyscope::options::programName = "SGI TinyAD vertex-field starter";
  polyscope::options::groundPlaneMode = polyscope::GroundPlaneMode::None;
  polyscope::state::userCallback = user_interface;
  polyscope::init();
  reset_viewer();
  polyscope::show();
  return EXIT_SUCCESS;
}
