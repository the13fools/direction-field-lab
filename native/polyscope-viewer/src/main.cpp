#include <polyscope/curve_network.h>
#include <polyscope/polyscope.h>

#if __has_include(<nlohmann/json.hpp>)
#include <nlohmann/json.hpp>
#else
#include <json/json.hpp>
#endif

#include <array>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr const char* structure_name = "Geometry Lab result";
std::filesystem::path snapshot_path;
std::filesystem::file_time_type last_write;
bool loaded_once = false;
std::string load_error;

struct Snapshot {
  std::string name;
  std::vector<std::array<double, 3>> positions;
  std::vector<std::array<std::size_t, 2>> edges;
};

Snapshot read_snapshot(const std::filesystem::path& path) {
  std::ifstream stream(path);
  if (!stream) throw std::runtime_error("Could not open " + path.string());
  const nlohmann::json source = nlohmann::json::parse(stream);
  if (source.value("schema", "") != "geometry-lab/view@1") {
    throw std::runtime_error("Unsupported snapshot schema");
  }
  if (source.value("primitive", "") != "curve-network") {
    throw std::runtime_error("Only curve-network snapshots are supported");
  }

  const std::vector<double> flat_positions = source.at("positions").get<std::vector<double>>();
  const std::vector<std::size_t> flat_edges = source.at("edges").get<std::vector<std::size_t>>();
  if (flat_positions.empty() || flat_positions.size() % 3 != 0) {
    throw std::runtime_error("positions must be a non-empty xyz array");
  }
  if (flat_edges.empty() || flat_edges.size() % 2 != 0) {
    throw std::runtime_error("edges must be a non-empty index-pair array");
  }

  Snapshot snapshot{source.value("name", "Geometry Lab result"), {}, {}};
  snapshot.positions.reserve(flat_positions.size() / 3);
  for (std::size_t index = 0; index < flat_positions.size(); index += 3) {
    snapshot.positions.push_back({flat_positions[index], flat_positions[index + 1], flat_positions[index + 2]});
  }
  snapshot.edges.reserve(flat_edges.size() / 2);
  for (std::size_t index = 0; index < flat_edges.size(); index += 2) {
    if (flat_edges[index] >= snapshot.positions.size() || flat_edges[index + 1] >= snapshot.positions.size()) {
      throw std::runtime_error("An edge index is outside the position array");
    }
    snapshot.edges.push_back({flat_edges[index], flat_edges[index + 1]});
  }
  return snapshot;
}

void reload_if_changed() {
  if (!std::filesystem::exists(snapshot_path)) return;
  const auto write_time = std::filesystem::last_write_time(snapshot_path);
  if (loaded_once && write_time == last_write) return;
  last_write = write_time;
  try {
    const Snapshot snapshot = read_snapshot(snapshot_path);
    if (loaded_once) polyscope::removeStructure(structure_name, false);
    auto* network = polyscope::registerCurveNetwork(structure_name, snapshot.positions, snapshot.edges);
    network->setRadius(0.006, true);
    network->setColor({0.45, 0.78, 0.59});
    load_error.clear();
    if (!loaded_once) polyscope::view::resetCameraToHomeView();
    loaded_once = true;
  } catch (const std::exception& error) {
    load_error = error.what();
    std::cerr << "Snapshot reload failed: " << load_error << '\n';
  }
}

void callback() {
  reload_if_changed();
}

} // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "Usage: geometry-lab-viewer snapshot.geometry-view.json\n";
    return 2;
  }
  snapshot_path = std::filesystem::absolute(argv[1]);
  polyscope::options::programName = "Geometry Processing Lab · Polyscope";
  polyscope::options::autocenterStructures = false;
  polyscope::state::userCallback = callback;
  polyscope::init();
  reload_if_changed();
  polyscope::show();
  return 0;
}
