#include "geometry_lab/VertexFieldSystem.hh"

#include <polyscope/polyscope.h>
#include <polyscope/surface_mesh.h>

#include <imgui.h>

#include <algorithm>
#include <array>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Controls {
  int grid = 12;
  int seed = 17;
  float data = 1.0F;
  float smoothness = 0.35F;
  float integrability = 4.0F;
  float length = 0.08F;
  float target_length = 0.85F;
  float noise = 0.25F;
};

Controls controls;
std::unique_ptr<geometry_lab::VertexFieldSystem> system;
std::string status;

std::vector<std::array<double, 3>>
as_positions(const std::vector<Eigen::Vector3d> &values) {
  std::vector<std::array<double, 3>> result;
  result.reserve(values.size());
  for (const Eigen::Vector3d &value : values) {
    result.push_back({value.x(), value.y(), value.z()});
  }
  return result;
}

std::vector<std::array<std::size_t, 3>>
as_faces(const std::vector<std::array<int, 3>> &values) {
  std::vector<std::array<std::size_t, 3>> result;
  result.reserve(values.size());
  for (const auto &value : values) {
    result.push_back({
        static_cast<std::size_t>(value[0]),
        static_cast<std::size_t>(value[1]),
        static_cast<std::size_t>(value[2]),
    });
  }
  return result;
}

void publish_quantities() {
  auto *mesh = polyscope::getSurfaceMesh("vertex field torus");
  auto *target = mesh->addVertexVectorQuantity(
      "target", as_positions(system->ambient_target_field()));
  target->setEnabled(false);
  target->setVectorColor({0.45, 0.86, 1.0});
  auto *solution = mesh->addVertexVectorQuantity(
      "solution", as_positions(system->ambient_field()));
  solution->setEnabled(true);
  solution->setVectorColor({0.87, 1.0, 0.36});
  mesh->addFaceScalarQuantity("face curl", system->face_curl());

  const auto diagnostics = system->diagnostics();
  const auto integrability = system->integrability_metrics();
  status = "E=" + std::to_string(diagnostics.energy) +
           "  |g|=" + std::to_string(diagnostics.gradient_norm) +
           "  curl RMS=" + std::to_string(integrability.curl_rms);
}

void reset_experiment() {
  system = std::make_unique<geometry_lab::VertexFieldSystem>();
  system->init(
      controls.grid, controls.data, controls.smoothness,
      controls.integrability, controls.length, controls.target_length,
      controls.noise, controls.seed);

  if (polyscope::hasSurfaceMesh("vertex field torus")) {
    polyscope::removeSurfaceMesh("vertex field torus");
  }
  auto *mesh = polyscope::registerSurfaceMesh(
      "vertex field torus", as_positions(system->surface_positions()),
      as_faces(system->faces()));
  mesh->setSurfaceColor({0.13, 0.18, 0.22});
  mesh->setEdgeWidth(0.35);
  publish_quantities();
}

void take_steps(const int count) {
  system->step(count);
  publish_quantities();
}

void user_interface() {
  ImGui::TextUnformatted("The browser and this app use the same C++ system.");
  ImGui::Separator();
  ImGui::SliderInt("grid", &controls.grid, 4, 32);
  ImGui::InputInt("seed", &controls.seed);
  ImGui::SliderFloat("data", &controls.data, 0.0F, 8.0F, "%.3f");
  ImGui::SliderFloat(
      "connection smoothness", &controls.smoothness, 0.0F, 8.0F, "%.3f");
  ImGui::SliderFloat(
      "integrability", &controls.integrability, 0.0F, 20.0F, "%.3f");
  ImGui::SliderFloat("length", &controls.length, 0.0F, 2.0F, "%.3f");
  ImGui::SliderFloat(
      "target length", &controls.target_length, 0.0F, 2.0F, "%.3f");
  ImGui::SliderFloat("initial noise", &controls.noise, 0.0F, 1.0F, "%.3f");
  if (ImGui::Button("Reset from controls"))
    reset_experiment();
  ImGui::SameLine();
  if (ImGui::Button("One Newton step"))
    take_steps(1);
  ImGui::SameLine();
  if (ImGui::Button("Ten steps"))
    take_steps(10);
  ImGui::Separator();
  ImGui::TextWrapped("%s", status.c_str());
}

void print_usage() {
  std::cout
      << "geometry-lab-vertex-field [options]\n"
         "  --grid N --steps N --seed N\n"
         "  --data X --smoothness X --integrability X --length X\n"
         "  --target-length X --noise X\n"
         "  Opens the native Polyscope form of the browser's vertex-field "
         "experiment.\n";
}

} // namespace

int main(int argc, char **argv) {
  int initial_steps = 0;
  for (int argument = 1; argument < argc; ++argument) {
    const std::string option = argv[argument];
    auto next_int = [&]() {
      if (argument + 1 >= argc)
        throw std::invalid_argument("Missing value after " + option);
      return std::stoi(argv[++argument]);
    };
    auto next_float = [&]() {
      if (argument + 1 >= argc)
        throw std::invalid_argument("Missing value after " + option);
      return std::stof(argv[++argument]);
    };
    if (option == "--help" || option == "-h") {
      print_usage();
      return 0;
    }
    if (option == "--grid")
      controls.grid = next_int();
    else if (option == "--seed")
      controls.seed = next_int();
    else if (option == "--steps")
      initial_steps = next_int();
    else if (option == "--data")
      controls.data = next_float();
    else if (option == "--smoothness")
      controls.smoothness = next_float();
    else if (option == "--integrability")
      controls.integrability = next_float();
    else if (option == "--length")
      controls.length = next_float();
    else if (option == "--target-length")
      controls.target_length = next_float();
    else if (option == "--noise")
      controls.noise = next_float();
    else
      throw std::invalid_argument("Unknown option: " + option);
  }

  polyscope::options::programName =
      "Direction Field Lab - native vertex fields";
  polyscope::options::groundPlaneMode = polyscope::GroundPlaneMode::None;
  polyscope::state::userCallback = user_interface;
  polyscope::init();
  reset_experiment();
  while (initial_steps > 0) {
    const int batch = std::min(initial_steps, 20);
    take_steps(batch);
    initial_steps -= batch;
  }
  polyscope::show();
  return EXIT_SUCCESS;
}
