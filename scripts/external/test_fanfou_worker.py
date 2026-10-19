"""Wire routing and process boundaries for the explicitly composite BA policy."""

import copy
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import worker


def public_view():
    fixture = Path(__file__).with_name("fixtures") / "fanfou-dev-public.json"
    return json.loads(fixture.read_text(encoding="utf-8"))["cleared"][0]["view"]


class FanfouWireTests(unittest.TestCase):
    def test_named_wire_calls_ba_module_and_only_exports_its_action(self):
        view = public_view()
        before = copy.deepcopy(view)
        action = {"type": "discard", "tile": view["legalDiscards"][0]}
        calls = []

        def decide(phase, received, context, api):
            self.assertEqual(phase, "discard")
            self.assertEqual(received, view)
            self.assertIs(api, worker)
            self.assertIsNotNone(context.history)
            calls.append(phase)
            return {"action": action, "origin": "ba-discard", "details": {"test": True}}

        with patch.dict(sys.modules, {"fanfou_policy": SimpleNamespace(decide=decide)}):
            result = worker.handle_request({
                "id": "BA", "policy": "fanfou-ba-composite-v1",
                "phase": "discard", "view": view,
            })
        self.assertEqual(calls, ["discard"])
        self.assertEqual(result, {"id": "BA", "action": action})
        self.assertEqual(view, before)

    def test_ba_failure_is_explicit_and_never_calls_the_initial_discard(self):
        def decide(*_args):
            raise worker.AdapterError("illegal-action", "BA returned no discard")

        with patch.dict(sys.modules, {"fanfou_policy": SimpleNamespace(decide=decide)}), \
                patch.object(worker.INITIAL, "select_a_card_to_discard", side_effect=AssertionError("fallback")):
            result = worker.handle_request({
                "id": "BA", "policy": "fanfou-ba-composite-v1",
                "phase": "discard", "view": public_view(),
            })
        self.assertEqual(result["error"]["code"], "illegal-action")
        self.assertIn("BA returned no discard", result["error"]["message"])

    def test_existing_initial_worker_remains_standard_library_only(self):
        request = {
            "id": "old-without-site-packages", "phase": "discard",
            "view": public_view(),
        }
        completed = subprocess.run(
            [sys.executable, "-S", "-B", str(Path(worker.__file__))],
            input=json.dumps(request) + "\n", text=True,
            capture_output=True, encoding="utf-8", timeout=20,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["id"], request["id"])
        self.assertIn("action", result)
        self.assertIn(result["action"]["tile"], request["view"]["legalDiscards"])


if __name__ == "__main__":
    unittest.main()
