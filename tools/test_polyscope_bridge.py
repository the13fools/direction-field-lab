from __future__ import annotations

import unittest

from tools.polyscope_bridge import local_capabilities, native_arguments, validate_project


class ConnectedProjectTests(unittest.TestCase):
    def project(self) -> dict:
        return {
            "problem": {
                "schema": "geometry-lab/problem@1",
                "kernel": "vertex-field",
                "parameters": {
                    "gridSize": 9,
                    "seed": 23,
                    "initializationNoise": 0.2,
                    "objective": {
                        "dataWeight": 1,
                        "connectionSmoothnessWeight": 0.4,
                        "integrabilityWeight": 5,
                        "lengthWeight": 0.1,
                        "targetLength": 0.9,
                    },
                },
                "solver": {"iterationsPerStep": 3},
            },
            "sourceFiles": {
                "cpp/include/VertexFieldCallbacks.hh": "// callback\n",
            },
        }

    def test_validates_fixed_project_paths(self) -> None:
        problem, source_files = validate_project(self.project())
        self.assertEqual(problem["parameters"]["gridSize"], 9)
        self.assertEqual(
            source_files["cpp/include/VertexFieldCallbacks.hh"], "// callback\n"
        )

    def test_rejects_arbitrary_paths(self) -> None:
        project = self.project()
        project["sourceFiles"]["../../outside"] = "bad"
        with self.assertRaisesRegex(ValueError, "Unsupported source file"):
            validate_project(project)

    def test_maps_problem_parameters_to_native_cli(self) -> None:
        arguments = native_arguments(self.project()["problem"])
        self.assertEqual(arguments[arguments.index("--grid") + 1], "9")
        self.assertEqual(arguments[arguments.index("--integrability") + 1], "5")
        self.assertEqual(arguments[arguments.index("--steps") + 1], "3")

    def test_reports_connected_actions_without_exposing_host_paths(self) -> None:
        capabilities = local_capabilities(viewer_available=True)
        self.assertEqual(capabilities["mode"], "connected")
        self.assertTrue(capabilities["actions"]["openPolyscope"])
        self.assertTrue(capabilities["actions"]["buildNativeVertexField"])
        self.assertEqual(capabilities["workspace"], ".lab-workspace/current")


if __name__ == "__main__":
    unittest.main()
