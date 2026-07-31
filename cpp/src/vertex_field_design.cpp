#include "geometry_lab/VertexFieldSystem.hh"

#include <emscripten/bind.h>
#include <emscripten/val.h>

namespace {

using emscripten::class_;
using emscripten::typed_memory_view;
using emscripten::val;

// The browser-specific code is deliberately boring. It only turns references
// and value structs from the native core into JavaScript views and objects.
class VertexFieldBinding {
public:
  void init(const int grid_size, const double data_weight,
            const double smoothness_weight, const double integrability_weight,
            const double length_weight, const double target_length,
            const double initialization_noise, const int seed) {
    system_.init(grid_size, data_weight, smoothness_weight,
                 integrability_weight, length_weight, target_length,
                 initialization_noise, seed);
  }

  void step(const int iterations) { system_.step(iterations); }

  [[nodiscard]] val get_positions() {
    const auto &positions = system_.parameter_positions();
    return val(typed_memory_view(positions.size(), positions.data()));
  }

  [[nodiscard]] val get_edges() {
    const auto &edges = system_.edges();
    return val(typed_memory_view(edges.size(), edges.data()));
  }

  [[nodiscard]] val get_field() {
    const auto &field = system_.field();
    return val(typed_memory_view(field.size(), field.data()));
  }

  [[nodiscard]] val get_target_field() {
    const auto &target = system_.target_field();
    return val(typed_memory_view(target.size(), target.data()));
  }

  [[nodiscard]] val get_integrability_metrics() const {
    const geometry_lab::IntegrabilityMetrics metrics =
        system_.integrability_metrics();
    val result = val::object();
    result.set("curlRms", metrics.curl_rms);
    result.set("maxAbsCurl", metrics.max_abs_curl);
    result.set("periodU", metrics.period_u);
    result.set("periodV", metrics.period_v);
    return result;
  }

  [[nodiscard]] val get_diagnostics() const {
    const geometry_lab::SolverDiagnostics diagnostics = system_.diagnostics();
    val result = val::object();
    result.set("energy", diagnostics.energy);
    result.set("gradientNorm", diagnostics.gradient_norm);
    result.set("newtonDecrement", diagnostics.newton_decrement);
    result.set("dofs", diagnostics.dofs);
    result.set("hessianNonzeros", diagnostics.hessian_nonzeros);
    result.set("iterations", diagnostics.accepted_iterations);
    return result;
  }

private:
  geometry_lab::VertexFieldSystem system_;
};

} // namespace

EMSCRIPTEN_BINDINGS(geometry_processing_vertex_field) {
  class_<VertexFieldBinding>("VertexFieldSystem")
      .constructor<>()
      .function("init", &VertexFieldBinding::init)
      .function("step", &VertexFieldBinding::step)
      .function("getPositions", &VertexFieldBinding::get_positions)
      .function("getEdges", &VertexFieldBinding::get_edges)
      .function("getField", &VertexFieldBinding::get_field)
      .function("getTargetField", &VertexFieldBinding::get_target_field)
      .function("getIntegrabilityMetrics",
                &VertexFieldBinding::get_integrability_metrics)
      .function("getDiagnostics", &VertexFieldBinding::get_diagnostics);
}
