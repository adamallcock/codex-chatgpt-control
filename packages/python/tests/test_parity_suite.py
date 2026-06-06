import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NODE_PACKAGE = ROOT / "node"
PYTHON_PACKAGE = ROOT / "python"
CONTRACT = NODE_PACKAGE / "contracts" / "v1"
MATRIX = CONTRACT / "parity-suite.json"


class ParitySuiteMatrixTests(unittest.TestCase):
    def test_matrix_covers_every_contract_fixture_and_backend_command(self) -> None:
        matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
        manifest = json.loads((CONTRACT / "manifest.json").read_text(encoding="utf-8"))
        capabilities = json.loads((CONTRACT / "fixtures" / "backend-capabilities.json").read_text(encoding="utf-8"))

        manifest_fixtures = {fixture["file"] for fixture in manifest["fixtures"]}
        covered_fixtures = {
            fixture
            for surface in matrix["surfaces"]
            for fixture in surface.get("fixtures", [])
        } | {
            fixture
            for command in matrix["backendCommands"].values()
            for fixture in command.get("fixtures", [])
        }
        self.assertEqual(covered_fixtures, manifest_fixtures)

        self.assertEqual(set(matrix["backendCommands"]), set(capabilities["commands"]))

    def test_python_evidence_files_exist_for_every_command(self) -> None:
        matrix = json.loads(MATRIX.read_text(encoding="utf-8"))

        for command, coverage in matrix["backendCommands"].items():
            with self.subTest(command=command):
                python_tests = coverage.get("pythonTests", [])
                docs = coverage.get("docs", [])
                self.assertGreater(len(python_tests), 0)
                self.assertGreater(len(docs), 0)
                for path in python_tests:
                    self.assertTrue((PYTHON_PACKAGE / path).exists(), path)
                for path in docs:
                    self.assertTrue((NODE_PACKAGE / path).exists() or (ROOT / path).exists(), path)


if __name__ == "__main__":
    unittest.main()
