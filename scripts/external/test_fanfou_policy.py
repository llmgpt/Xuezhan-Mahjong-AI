"""Pinned BA, independent rule shell and public-wire contract tests.

The fixture contains only public frames from already spent development traces.
Controlled projections below test host-rule boundaries, not game strength.
"""

import ast
from collections import Counter
import copy
import hashlib
import io
import json
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import PropertyMock, patch
import warnings

import worker
import fanfou_policy


FIXTURE_PATH = Path(__file__).with_name("fixtures") / "fanfou-dev-public.json"
FIXTURE_SHA256 = "04c7504b9f54e00a7c8c5ec5d59f8e083d317bda6ef68614aabe688e118bad26"
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def tagged(name):
    return copy.deepcopy(FIXTURE["tagged"][name])


def decide(view, phase="discard"):
    return fanfou_policy.decide(phase, view, worker.build_context(view), worker)


def controlled_kongs():
    """Consistent public snapshot with one pung, one concealed and one added kong."""
    view = tagged("choose-missing")["view"]
    view.update(seat=1, hand=[0, 9, 9, 9, 9, 10, 11, 12, 13, 14, 15], missing="tong",
                melds=[{"type": "pung", "tile": 0, "from": 0}], ownDiscards=[18], wallRemaining=51)
    view["opponents"] = [
        {"seat": seat, "handCount": 13, "melds": [], "discards": [tile], "missing": "tong", "won": False, "score": 0}
        for seat, tile in [(0, 21), (2, 19), (3, 20)]
    ]
    view["publicActions"] = [
        {"seat": 0, "kind": "discard", "tile": 0},
        {"seat": 1, "kind": "pung", "tile": 0, "from": 0},
        {"seat": 1, "kind": "discard", "tile": 18},
        {"seat": 2, "kind": "draw"}, {"seat": 2, "kind": "discard", "tile": 19},
        {"seat": 3, "kind": "draw"}, {"seat": 3, "kind": "discard", "tile": 20},
        {"seat": 0, "kind": "draw"}, {"seat": 0, "kind": "discard", "tile": 21},
        {"seat": 1, "kind": "draw"},
    ]
    view["publicTiles"] = [{"seat": seat, "tile": tile, "kind": "discard"} for seat, tile in [(1, 18), (2, 19), (3, 20), (0, 21)]]
    view["legalDiscards"] = sorted(set(view["hand"]))
    view["decision"] = {"kind": "self", "canWin": False, "concealedKongs": [9], "addedKongs": [0]}
    return view


class FanfouPolicyTests(unittest.TestCase):
    def test_module_and_rule_shell_do_not_import_numpy(self):
        script = (
            "import sys,json;from pathlib import Path;"
            f"sys.path.insert(0,{str(Path(__file__).parent)!r});"
            "import worker,fanfou_policy;"
            f"v=json.loads(Path({str(FIXTURE_PATH)!r}).read_text(encoding='utf-8'))['tagged']['choose-missing']['view'];"
            "fanfou_policy.decide('choose-missing',v,worker.build_context(v),worker);"
            "assert 'numpy' not in sys.modules"
        )
        result = subprocess.run([sys.executable, "-B", "-c", script], text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_pinned_original_closure_and_all_37_methods_are_unchanged(self):
        manifest = fanfou_policy.verify_vendor()
        self.assertEqual(manifest["commit"], "02e3373649699bc73af87db46ee144bba65ae830")
        self.assertEqual(manifest["closureSha256"], fanfou_policy.PINNED_CLOSURE_SHA256)
        methods = 0
        for entry in manifest["derivation"]["classes"]:
            raw = (fanfou_policy.VENDOR / entry["source"]).read_bytes()
            selected = (fanfou_policy.VENDOR / entry["derived"]).read_bytes()
            self.assertEqual(selected, b"".join(raw.splitlines(keepends=True)[entry["line"] - 1:entry["endLine"]]))
            raw_node = next(node for node in ast.parse(raw.decode("utf-8-sig")).body if isinstance(node, ast.ClassDef) and node.name == entry["name"])
            selected_node = ast.parse(selected.decode("utf-8-sig")).body[0]
            self.assertEqual(ast.dump(raw_node, include_attributes=False), ast.dump(selected_node, include_attributes=False))
            methods += len(entry["methods"])
        self.assertEqual(methods, 37)
        self.assertEqual((fanfou_policy.VENDOR / "BA_CORE.patch").read_bytes(), b"")

    def test_source_and_manifest_recomputed_together_still_fail_fixed_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "vendor"
            shutil.copytree(fanfou_policy.VENDOR, target)
            manifest = json.loads((target / "UPSTREAM.json").read_text(encoding="utf-8"))
            source = "derived/ba-class.py"
            (target / source).write_bytes((target / source).read_bytes() + b"\n# edited\n")
            manifest["files"][source] = hashlib.sha256((target / source).read_bytes()).hexdigest()
            content = {key: value for key, value in manifest.items() if key != "closureSha256"}
            manifest["closureSha256"] = hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
            (target / "UPSTREAM.json").write_text(json.dumps(manifest), encoding="utf-8")
            with patch.object(fanfou_policy, "VENDOR", target):
                with self.assertRaises(ValueError):
                    fanfou_policy.verify_vendor()

    def test_warm_loader_rechecks_csv_and_manifest_metadata(self):
        fanfou_policy.load_runtime()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "vendor"
            shutil.copytree(fanfou_policy.VENDOR, target)
            csv = next(target.rglob("HuIndex.csv"))
            csv.write_bytes(csv.read_bytes() + b"\n")
            with patch.object(fanfou_policy, "VENDOR", target):
                with self.assertRaises(ValueError):
                    fanfou_policy.load_runtime()

    def test_fixture_is_frozen_and_all_125_raw_decisions_match_prototype(self):
        self.assertEqual(hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(), FIXTURE_SHA256)
        self.assertEqual(len(FIXTURE["cleared"]), 125)
        counts = Counter()
        for entry in FIXTURE["cleared"]:
            view = copy.deepcopy(entry["view"])
            before = copy.deepcopy(view)
            result = fanfou_policy.raw_discard(view, worker.build_context(view), worker)
            self.assertEqual(result["raw"], entry["expectedRaw"], entry["id"])
            self.assertIn(result["raw"], view["legalDiscards"])
            self.assertEqual(view, before)
            counts[len(view["hand"])] += 1
        self.assertEqual(counts, {2: 25, 5: 25, 8: 25, 11: 25, 14: 25})

    def test_ordinary_discard_metadata_and_stdout_stay_outside_wire_action(self):
        view = copy.deepcopy(FIXTURE["cleared"][0]["view"])
        output = io.StringIO()
        from contextlib import redirect_stdout
        with redirect_stdout(output):
            result = decide(view)
        self.assertEqual(result["origin"], "ba-discard")
        self.assertEqual(result["action"], {"type": "discard", "tile": 0})
        self.assertEqual(output.getvalue(), "")
        self.assertIn("Fan_fou_basic", result["details"]["stdout"])

    def test_missing_uses_fewest_count_and_wan_tiao_tong_tie_order(self):
        view = tagged("choose-missing")["view"]
        view["hand"] = [0] * 4 + [9] * 4 + [18, 19, 20, 21, 22, 23]
        with patch.object(worker.DAQUE, "daquex", side_effect=AssertionError("Not the new rule shell")):
            result = decide(view, "choose-missing")
        self.assertEqual(result["action"], {"type": "missing", "suit": "wan"})
        self.assertEqual(result["origin"], "missing")
        view["hand"] = [0, 1, 2, 3, 4, 5] + [9] * 4 + [18] * 4
        self.assertEqual(decide(view, "choose-missing")["action"]["suit"], "tiao")

    def test_forced_missing_uses_first_sorted_legal_tile_without_ba(self):
        view = tagged("forced-missing")["view"]
        with patch.object(fanfou_policy, "raw_discard", side_effect=AssertionError("BA must not decide forced missing")):
            result = decide(view)
        self.assertEqual(result["origin"], "forced-missing")
        self.assertEqual(result["action"], {"type": "discard", "tile": min(view["legalDiscards"])})

    def test_legal_self_win_is_accepted_before_any_raw_discard(self):
        view = tagged("self-win")["view"]
        with patch.object(fanfou_policy, "raw_discard", side_effect=AssertionError("Must accept legal hu")):
            result = decide(view)
        self.assertEqual(result["action"], {"type": "win"})
        self.assertEqual(result["origin"], "self-win")

    def test_self_kong_prefers_concealed_then_added_with_sorted_tile(self):
        view = controlled_kongs()
        view["hand"] = [0] + [9] * 4 + [10] * 4 + [11, 12]
        view["legalDiscards"] = sorted(set(view["hand"]))
        view["decision"]["concealedKongs"] = [10, 9]
        self.assertEqual(decide(view)["action"], {"type": "kong", "kind": "concealed", "tile": 9})
        view["hand"] = [0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 9]
        view["legalDiscards"] = sorted(set(view["hand"]))
        view["decision"]["concealedKongs"] = []
        result = decide(view)
        self.assertEqual(result["action"], {"type": "kong", "kind": "added", "tile": 0})
        self.assertEqual(result["origin"], "self-kong")
        for tag in ("concealed-kong", "added-kong"):
            actual = tagged(tag)["view"]
            # The first real concealed-kong frame also permits hu: the shell
            # must take hu before even considering a legal kong.
            expected = "self-win" if actual["decision"]["canWin"] else "self-kong"
            self.assertEqual(decide(actual)["origin"], expected)

    def test_response_order_is_hu_kong_pung_pass_and_includes_rob_kong(self):
        for tag, expected in [("response-hu", "hu"), ("response-rob-hu", "hu"), ("response-kong", "kong"), ("response-pung", "pung")]:
            with self.subTest(tag=tag):
                case = tagged(tag)
                case["view"]["decision"]["choices"].reverse()
                result = decide(case["view"], "respond")
                self.assertEqual(result["action"], {"type": "respond", "choice": expected})
                self.assertEqual(result["origin"], "response")
        case = tagged("response-pung")
        case["view"]["decision"]["choices"] = ["pass"]
        self.assertEqual(decide(case["view"], "respond")["action"], {"type": "respond", "choice": "pass"})

    def test_missing_real_public_history_fails_even_with_prebuilt_context(self):
        view = copy.deepcopy(FIXTURE["cleared"][0]["view"])
        context = worker.build_context(view)
        del view["publicActions"]
        with self.assertRaises(worker.AdapterError) as caught:
            fanfou_policy.decide("discard", view, context, worker)
        self.assertEqual(caught.exception.code, "invalid-view")

    def test_changed_history_is_revalidated_against_stock(self):
        view = tagged("added-kong")["view"]
        context = worker.build_context(view)
        view["publicActions"].pop()
        with self.assertRaises(worker.AdapterError):
            fanfou_policy.decide("discard", view, context, worker)

    def test_rob_kong_must_match_current_public_offer(self):
        view = tagged("response-rob-hu")["view"]
        context = worker.build_context(view)
        view["decision"]["tile"] = (view["decision"]["tile"] + 1) % 27
        with self.assertRaises(worker.AdapterError) as caught:
            fanfou_policy.decide("respond", view, context, worker)
        self.assertEqual(caught.exception.code, "invalid-history")

    def test_rob_kong_offer_counts_the_revealed_fourth_tile_once(self):
        view = tagged("response-rob-hu")["view"]
        offered = view["decision"]["tile"]
        self.assertNotIn(offered, view["hand"])
        # A publicly offered fourth tile cannot also be in the observer's hand.
        # The ordinary stock still contains only the prior three-tile pung.
        view["hand"][0] = offered
        context = worker.build_context(view)
        with self.assertRaises(worker.AdapterError) as caught:
            fanfou_policy.decide("respond", view, context, worker)
        self.assertEqual(caught.exception.code, "invalid-view")

    def test_private_facades_are_never_read_by_the_rule_shell_or_ba(self):
        view = copy.deepcopy(FIXTURE["cleared"][0]["view"])
        with patch.object(worker.PublicPlayer, "hand", new_callable=PropertyMock) as hidden_hand, patch.object(worker.LengthOnlyWall, "__iter__") as hidden_wall, patch.object(worker.LengthOnlyWall, "__getitem__") as hidden_tile:
            hidden_hand.side_effect = AssertionError("Opponent hand is unavailable")
            hidden_wall.side_effect = AssertionError("Real wall order is unavailable")
            hidden_tile.side_effect = AssertionError("Real wall tile is unavailable")
            result = decide(view)
            self.assertEqual(result["origin"], "ba-discard")
            hidden_hand.assert_not_called()
            hidden_wall.assert_not_called()
            hidden_tile.assert_not_called()

    def test_exchange_and_unknown_phases_are_explicitly_unsupported(self):
        view = tagged("exchange")["view"]
        for phase in ("exchange", "finished"):
            with self.assertRaises(worker.AdapterError) as caught:
                decide(view, phase)
            self.assertEqual(caught.exception.code, "unsupported")

    def test_invalid_phase_counts_and_wall_zero_kong_fail(self):
        case = tagged("response-pung")
        with self.assertRaises(worker.AdapterError):
            decide(case["view"], "discard")
        view = tagged("concealed-kong")["view"]
        context = worker.build_context(view)
        view["wallRemaining"] = 0
        with self.assertRaises(worker.AdapterError):
            fanfou_policy.decide("discard", view, context, worker)

    def test_empty_illegal_and_raising_raw_ba_never_fall_back(self):
        view = copy.deepcopy(FIXTURE["cleared"][0]["view"])
        for raw, code in [(None, "upstream-error"), (99, "illegal-action")]:
            context = fanfou_policy.build_ba_context(view, worker.build_context(view), worker)
            context.agent.del_ourself_drw = lambda value=raw: value
            with patch.object(fanfou_policy, "build_ba_context", return_value=context):
                with self.assertRaises(worker.AdapterError) as caught:
                    decide(view)
            self.assertEqual(caught.exception.code, code)
        context = fanfou_policy.build_ba_context(view, worker.build_context(view), worker)
        def broken():
            raise RuntimeError("raw BA failure")
        context.agent.del_ourself_drw = broken
        with patch.object(fanfou_policy, "build_ba_context", return_value=context):
            with self.assertRaises(worker.AdapterError) as caught:
                decide(view)
        self.assertEqual(caught.exception.code, "upstream-error")

    def test_actual_short_hands_public_stock_winners_and_globals_are_isolated(self):
        for size in (14, 11, 8, 5, 2):
            view = next(copy.deepcopy(item["view"]) for item in FIXTURE["cleared"] if len(item["view"]["hand"]) == size)
            first = fanfou_policy.build_ba_context(view, worker.build_context(view), worker)
            second = fanfou_policy.build_ba_context(view, worker.build_context(view), worker)
            self.assertEqual(first.agent.majiang, view["hand"])
            self.assertEqual(int(first.agent.StateData[view["seat"], 0].sum()), size)
            self.assertIsNot(first.base, second.base)
            self.assertIsNot(first.base.ShowCount, second.base.ShowCount)
            self.assertIsNot(first.base.history, second.base.history)
            self.assertNotIn("Fan_Fou_MC", first.namespace)
            self.assertNotIn("Fan_Fou", first.namespace)
            self.assertEqual(first.audit["publicActionCount"], len(view["publicActions"]))
            for seat in range(4):
                if seat != view["seat"]:
                    self.assertEqual(int(first.agent.StateData[seat, 0].sum()), 0)

    def test_a_b_a_replay_has_no_global_rng_or_input_pollution(self):
        a = copy.deepcopy(FIXTURE["cleared"][-1]["view"])
        b = copy.deepcopy(FIXTURE["cleared"][0]["view"])
        state = random.getstate()
        before = copy.deepcopy(a)
        one = fanfou_policy.raw_discard(a, worker.build_context(a), worker)
        fanfou_policy.raw_discard(b, worker.build_context(b), worker)
        again = fanfou_policy.raw_discard(a, worker.build_context(a), worker)
        self.assertEqual(one["raw"], again["raw"])
        self.assertEqual(a, before)
        self.assertEqual(random.getstate(), state)

    def test_lookup_is_immutable_and_original_loader_handles_are_closed(self):
        import gc
        with patch.object(fanfou_policy, "_RUNTIME", None):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", ResourceWarning)
                runtime = fanfou_policy.load_runtime()
                gc.collect()
            self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])
        table = runtime.hu_table
        key = next(iter(table))
        with self.assertRaises(TypeError):
            table[key] = (1,)
        with self.assertRaises(TypeError):
            table[key][0] = 1

    def test_unexpected_numpy_version_is_explicit_dependency_failure(self):
        from types import SimpleNamespace
        with patch.object(fanfou_policy, "_RUNTIME", None), patch.dict(sys.modules, {"numpy": SimpleNamespace(__version__="0.0")}), self.assertRaisesRegex(ValueError, "numpy==2.1.3"):
            fanfou_policy.load_runtime()


if __name__ == "__main__":
    unittest.main()
