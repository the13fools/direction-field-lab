from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from tools.polyscope_viewer import load_document, normalize_document


class PolyscopeViewerFormatTests(unittest.TestCase):
    def write(self, source: object) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        with handle:
            json.dump(source, handle)
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_reads_legacy_curve_network(self) -> None:
        document = load_document(
            self.write(
                {
                    "schema": "geometry-lab/view@1",
                    "name": "edge",
                    "primitive": "curve-network",
                    "positions": [0, 0, 0, 1, 0, 0],
                    "edges": [0, 1],
                }
            )
        )
        self.assertEqual(document["meshes"][0]["edges"], [[0, 1]])

    def test_reads_mesh_fields_with_explicit_tangent_bases(self) -> None:
        document = load_document(
            self.write(
                {
                    "schema": "geometry-lab/result@2",
                    "experimentId": "field",
                    "status": "complete",
                    "meshes": [
                        {
                            "id": "mesh",
                            "positions": [0, 0, 0, 1, 0, 0, 0, 1, 0],
                            "faces": [0, 1, 2],
                            "edges": [0, 1, 1, 2, 2, 0],
                        }
                    ],
                    "fields": [
                        {
                            "id": "tangent",
                            "meshId": "mesh",
                            "association": "vertex",
                            "valueType": "vector",
                            "frame": "local-tangent",
                            "components": 2,
                            "values": [1, 0, 1, 0, 1, 0],
                            "basisX": [1, 0, 0, 1, 0, 0, 1, 0, 0],
                            "basisY": [0, 1, 0, 0, 1, 0, 0, 1, 0],
                        }
                    ],
                    "metrics": [],
                    "series": [],
                    "messages": [],
                    "provenance": {},
                }
            )
        )
        self.assertEqual(document["fields"][0]["basisX"][0], [1, 0, 0])

    def test_rejects_field_association_mismatch(self) -> None:
        path = self.write(
            {
                "schema": "geometry-lab/result@2",
                "meshes": [
                    {
                        "id": "mesh",
                        "positions": [0, 0, 0, 1, 0, 0, 0, 1, 0],
                        "faces": [0, 1, 2],
                    }
                ],
                "fields": [
                    {
                        "id": "bad",
                        "meshId": "mesh",
                        "association": "face",
                        "valueType": "scalar",
                        "frame": "ambient",
                        "components": 1,
                        "values": [0, 1],
                    }
                ],
            }
        )
        with self.assertRaisesRegex(ValueError, "association"):
            load_document(path)

    def test_bridge_validation_can_use_the_same_schema_parser(self) -> None:
        document = normalize_document(
            {
                "schema": "geometry-lab/view@1",
                "primitive": "curve-network",
                "positions": [0, 0, 0, 1, 0, 0],
                "edges": [0, 1],
            }
        )
        self.assertEqual(document["schema"], "geometry-lab/view@1")


if __name__ == "__main__":
    unittest.main()
