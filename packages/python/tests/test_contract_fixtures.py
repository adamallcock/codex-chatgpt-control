import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "node" / "contracts" / "v1"
MATRIX = CONTRACT / "parity-suite.json"


class ContractFixtureInventoryTests(unittest.TestCase):
    def test_manifest_contains_parity_suite_fixture_matrix(self) -> None:
        manifest = json.loads((CONTRACT / "manifest.json").read_text(encoding="utf-8"))
        matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
        listed = {fixture["file"] for fixture in manifest["fixtures"]}
        required = {
            fixture
            for surface in matrix["surfaces"]
            for fixture in surface.get("fixtures", [])
        } | {
            fixture
            for command in matrix["backendCommands"].values()
            for fixture in command.get("fixtures", [])
        }

        self.assertEqual(required, listed)


if __name__ == "__main__":
    unittest.main()
