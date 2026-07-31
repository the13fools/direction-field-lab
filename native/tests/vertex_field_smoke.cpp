#include "geometry_lab/VertexFieldSystem.hh"

#include <cmath>
#include <iostream>

int main() {
  geometry_lab::VertexFieldSystem system;
  system.init(
      8,   // grid
      1.0, // data
      0.35, // connection smoothness
      4.0, // integrability
      0.08, // length
      0.85, // target length
      0.25, // initialization noise
      17);
  const auto before = system.diagnostics();
  system.step(4);
  const auto after = system.diagnostics();
  const auto integrability = system.integrability_metrics();

  std::cout << "energy: " << before.energy << " -> " << after.energy << '\n'
            << "gradient: " << after.gradient_norm << '\n'
            << "curl RMS: " << integrability.curl_rms << '\n';

  const bool finite = std::isfinite(after.energy) &&
                      std::isfinite(after.gradient_norm) &&
                      std::isfinite(integrability.curl_rms);
  if (!finite || after.energy > before.energy + 1e-10 ||
      system.faces().empty() || system.ambient_field().empty()) {
    std::cerr << "Native vertex-field smoke test failed.\n";
    return 1;
  }
  return 0;
}
