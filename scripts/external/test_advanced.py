"""Public-history and real advanced-policy integration boundaries."""

import ast
import copy
from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import advanced_policy
import worker
from test_worker import view_for


POLICY = "ebony72-advanced-public-v1"


def opening_view():
    view = view_for([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17])
    view["wallRemaining"] = 55
    view["publicActions"] = []
    for opponent in view["opponents"]:
        opponent["missing"] = "tong"
    return view


def claimed_view():
    view = opening_view()
    view["seat"] = 2
    view["opponents"] = [
        {"seat": seat, "handCount": 13, "melds": [], "discards": [], "missing": "tong", "won": False, "score": 0}
        for seat in [0, 1, 3]
    ]
    opponent = view["opponents"][1]
    opponent["handCount"] = 10
    opponent["melds"] = [{"type": "pung", "tile": 18, "from": 0}]
    opponent["missing"] = "wan"
    opponent["discards"] = [19]
    view["publicTiles"] = [{"seat": 1, "kind": "discard", "tile": 19}]
    view["wallRemaining"] = 54
    view["publicActions"] = [
        {"seat": 0, "kind": "discard", "tile": 18},
        {"seat": 1, "kind": "pung", "tile": 18, "from": 0},
        {"seat": 1, "kind": "discard", "tile": 19},
        {"seat": 2, "kind": "draw"},
    ]
    return view


def pending_added_view():
    view = opening_view()
    view["seat"] = 2
    view["hand"] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12]
    view["legalDiscards"] = []
    view["ownDiscards"] = [19]
    view["opponents"] = [
        {"seat": seat, "handCount": 13, "melds": [], "discards": [], "missing": "tong", "won": False, "score": 0}
        for seat in [0, 1, 3]
    ]
    view["opponents"][0]["discards"] = [21]
    view["opponents"][1].update(handCount=11, melds=[{"type": "pung", "tile": 0, "from": 0}], discards=[18])
    view["opponents"][2]["discards"] = [20]
    view["publicTiles"] = [
        {"seat": 1, "kind": "discard", "tile": 18},
        {"seat": 2, "kind": "discard", "tile": 19},
        {"seat": 3, "kind": "discard", "tile": 20},
        {"seat": 0, "kind": "discard", "tile": 21},
    ]
    view["publicActions"] = [
        {"seat": 0, "kind": "discard", "tile": 0},
        {"seat": 1, "kind": "pung", "tile": 0, "from": 0},
        {"seat": 1, "kind": "discard", "tile": 18},
        {"seat": 2, "kind": "draw"},
        {"seat": 2, "kind": "discard", "tile": 19},
        {"seat": 3, "kind": "draw"},
        {"seat": 3, "kind": "discard", "tile": 20},
        {"seat": 0, "kind": "draw"},
        {"seat": 0, "kind": "discard", "tile": 21},
        {"seat": 1, "kind": "draw"},
        {"seat": 1, "kind": "added-kong-offer", "tile": 0},
    ]
    view["wallRemaining"] = 51
    view["decision"] = {"kind": "respond", "responseKind": "rob-kong", "from": 1, "tile": 0, "choices": ["pass", "hu"]}
    return view


def opening_response(hand, choices):
    view = opening_view()
    view["seat"] = 1
    view["hand"] = hand
    view["legalDiscards"] = []
    view["opponents"] = [
        {"seat": seat, "handCount": 13, "melds": [], "discards": [0] if seat == 0 else [], "missing": "tong", "won": False, "score": 0}
        for seat in [0, 2, 3]
    ]
    view["publicTiles"] = [{"seat": 0, "kind": "discard", "tile": 0}]
    view["publicActions"] = [{"seat": 0, "kind": "discard", "tile": 0}]
    view["decision"] = {"kind": "respond", "responseKind": "discard", "from": 0, "tile": 0, "choices": choices}
    return view


class AdvancedTests(unittest.TestCase):
    def request(self, view, phase="discard", **extra):
        return worker.handle_request({"id": "advanced-case", "phase": phase, "view": view, "policy": POLICY, **extra})

    def test_missing_history_is_rejected_without_reconstructing_seat_buckets(self):
        view = opening_view()
        del view["publicActions"]
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")

    def test_initial_legacy_view_remains_supported_and_real_history_is_optional(self):
        legacy = view_for()
        self.assertIn("action", worker.handle_request({"id": 1, "phase": "discard", "view": legacy}))
        current = opening_view()
        self.assertIn("action", worker.handle_request({"id": 2, "phase": "discard", "view": current}))

    def test_unknown_policy_is_explicitly_unsupported(self):
        self.assertEqual(self.request(opening_view(), policy="unknown")["error"]["code"], "unsupported")

    def test_real_advanced_regular_discard_never_accesses_opponent_hands(self):
        view = opening_view()
        result = self.request(view)
        self.assertNotIn("error", result)
        self.assertEqual(result["action"]["type"], "discard")
        self.assertIn(result["action"]["tile"], view["legalDiscards"])

    def test_real_advanced_pung_and_direct_kong_use_host_legal_choices(self):
        pung = opening_response([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13], ["pass", "pung"])
        self.assertEqual(self.request(pung, "respond")["action"], {"type": "respond", "choice": "pung"})
        kong = opening_response([0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12], ["pass", "pung", "kong"])
        self.assertEqual(self.request(kong, "respond")["action"], {"type": "respond", "choice": "kong"})

    def test_real_advanced_concealed_kong_and_self_win(self):
        view = opening_view()
        view["hand"] = [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12]
        view["legalDiscards"] = sorted(set(view["hand"]))
        view["decision"]["concealedKongs"] = [0]
        self.assertEqual(self.request(view)["action"], {"type": "kong", "kind": "concealed", "tile": 0})
        view = opening_view()
        view["hand"] = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 12]
        view["legalDiscards"] = sorted(set(view["hand"]))
        view["decision"]["canWin"] = True
        self.assertEqual(self.request(view)["action"], {"type": "win"})

    def test_advanced_choose_missing_requires_no_fake_opening_draw(self):
        view = opening_view()
        view.pop("decision")
        view.pop("missing")
        view["legalDiscards"] = []
        self.assertEqual(self.request(view, "choose-missing")["action"], {"type": "missing", "suit": "tong"})

    def test_derived_ast_has_no_oracle_or_opponent_hand_access(self):
        module = advanced_policy.load_policy()
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        self.assertNotIn("Oracle", names)
        self.assertNotIn("GPhi", names)
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "hand":
                self.assertIsInstance(node.value, ast.Name)
                self.assertEqual(node.value.id, "player")

    def test_actual_claimed_discard_is_preserved_in_history_but_not_public_stock(self):
        view = claimed_view()
        context = worker.build_context(view)
        advanced = advanced_policy.build_context(view, context, worker)
        self.assertEqual(len(advanced.dealer.act_history), 4)
        self.assertEqual(advanced.dealer.table, [worker.to_external(19)])
        self.assertEqual(advanced.dealer.guess_color_distribution(1), [6, 0, 4])
        with self.assertRaises(worker.HiddenInformationError):
            _ = advanced.players[0].hand
        with self.assertRaises(worker.HiddenInformationError):
            _ = advanced.dealer.deck[0]

    def test_history_requires_true_draw_count_and_full_retained_discard_history(self):
        for mutation in ("wall", "missing-event", "hand-count", "public-order"):
            view = claimed_view()
            if mutation == "wall":
                view["wallRemaining"] = 55
            elif mutation == "missing-event":
                view["publicActions"].pop(0)
            elif mutation == "hand-count":
                view["opponents"][1]["handCount"] = 11
            else:
                view["publicTiles"].append({"seat": 0, "kind": "discard", "tile": 18})
            with self.subTest(mutation=mutation):
                self.assertIn(self.request(view)["error"]["code"], {"invalid-view", "invalid-history"})

    def test_draw_events_cannot_carry_concealed_tiles(self):
        view = claimed_view()
        view["publicActions"][-1]["tile"] = 0
        self.assertEqual(self.request(view)["error"]["code"], "hidden-field")

    def test_pending_added_kong_is_public_once_and_not_a_fake_discard(self):
        view = pending_added_view()
        context = advanced_policy.build_context(view, worker.build_context(view), worker)
        suit, rank = worker.to_external(0)
        self.assertEqual(context.player.kgbase(context.dealer, context.players)[suit * 9 + rank - 1], 0)
        self.assertNotIn(worker.to_external(0), context.dealer.table)
        result = self.request(view, "respond")
        self.assertNotIn("error", result)
        self.assertIn(result["action"]["choice"], {"hu", "pass"})

    def test_same_actor_replacement_draw_completes_added_offer_once(self):
        view = pending_added_view()
        view["publicActions"].append({"seat": 1, "kind": "draw"})
        view["wallRemaining"] = 50
        view["opponents"][1]["melds"] = [{"type": "kong", "tile": 0, "from": 0, "kongKind": "added"}]
        view.pop("decision")
        # The requesting seat remains a 13-tile observer; validate just context.
        context = worker.build_context(view)
        self.assertIsNotNone(context.history)

    def test_robbed_added_offer_keeps_original_pung_and_adds_one_discard(self):
        view = pending_added_view()
        view["publicActions"].append({"seat": 3, "kind": "win", "tile": 0, "winKind": "rob-kong", "from": 1})
        view["publicTiles"].append({"seat": 1, "kind": "discard", "tile": 0})
        view["opponents"][1]["handCount"] = 10
        view["opponents"][1]["discards"].append(0)
        view["opponents"][2]["won"] = True
        view.pop("decision")
        context = worker.build_context(view)
        self.assertIsNotNone(context.history)

    def test_history_rejects_post_win_draws_and_wrong_meld_origin(self):
        view = claimed_view()
        view["publicActions"][1]["from"] = 3
        self.assertEqual(self.request(view)["error"]["code"], "invalid-history")

    def test_an_old_rob_kong_cannot_be_reused_after_a_later_turn(self):
        view = pending_added_view()
        view["publicActions"] += [
            {"seat": 3, "kind": "win", "tile": 0, "winKind": "rob-kong", "from": 1},
            {"seat": 0, "kind": "draw"},
            {"seat": 0, "kind": "discard", "tile": 21},
            {"seat": 0, "kind": "win", "tile": 0, "winKind": "rob-kong", "from": 1},
        ]
        view["publicTiles"] += [{"seat": 1, "kind": "discard", "tile": 0}, {"seat": 0, "kind": "discard", "tile": 21}]
        view["wallRemaining"] = 50
        view["opponents"][0].update(won=True, discards=[21, 21])
        view["opponents"][1].update(handCount=10, discards=[18, 0])
        view["opponents"][2]["won"] = True
        view.pop("decision")
        with self.assertRaises(worker.AdapterError) as raised:
            worker.build_context(view)
        self.assertEqual(raised.exception.code, "invalid-history")
        view = pending_added_view()
        view["publicActions"] += [
            {"seat": 3, "kind": "win", "tile": 0, "winKind": "rob-kong", "from": 1},
            {"seat": 3, "kind": "draw"},
        ]
        self.assertEqual(self.request(view)["error"]["code"], "invalid-history")

    def test_advanced_declining_hu_can_then_choose_legal_pung(self):
        view = claimed_view()
        view["seat"] = 2
        # Use a physically valid pair of the pending 2-dot tile.
        view["hand"] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 19]
        view["missing"] = "wan"
        view["publicActions"].pop()
        view["wallRemaining"] = 55
        view["legalDiscards"] = []
        view["decision"] = {"kind": "respond", "responseKind": "discard", "from": 1, "tile": 19, "choices": ["pass", "hu", "pung"]}
        module = advanced_policy.load_policy()
        with patch.object(module, "check_hu", return_value="stand"), patch.object(module, "check_pong", return_value="pong"):
            result = self.request(view, "respond")
        self.assertEqual(result["action"], {"type": "respond", "choice": "pung"})

    def test_invalid_advanced_action_is_not_replaced_by_initial(self):
        module = advanced_policy.load_policy()
        with patch.object(module, "select_a_card_to_discard", return_value=[2, 9]):
            self.assertEqual(self.request(opening_view())["error"]["code"], "illegal-action")

    def test_out_of_range_upstream_tile_is_an_illegal_action_not_input_error(self):
        module = advanced_policy.load_policy()
        with patch.object(module, "select_a_card_to_discard", return_value=[-1, 1]):
            self.assertEqual(self.request(opening_view())["error"]["code"], "illegal-action")

    def test_empty_wall_fixture_without_real_history_is_rejected(self):
        request = json.loads((Path(__file__).parent / "fixtures/upstream-empty-wall.request.json").read_text())
        request["policy"] = POLICY
        self.assertEqual(worker.handle_request(request)["error"]["code"], "invalid-view")

    def test_real_development_wall_empty_snapshot_is_supported(self):
        path = Path(__file__).parent / "fixtures" / "advanced-dev-80007-wall-empty.request.json"
        request = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(request["view"]["wallRemaining"], 0)
        self.assertGreater(len(request["view"]["publicActions"]), 100)
        with redirect_stderr(io.StringIO()):
            result = worker.handle_request(request)
        self.assertNotIn("error", result)
        self.assertEqual(result["action"]["type"], "discard")
        self.assertIn(result["action"]["tile"], request["view"]["legalDiscards"])

    def test_a_b_a_does_not_mutate_advanced_snapshot(self):
        view = opening_view()
        before = copy.deepcopy(view)
        first = self.request(view)
        self.request(claimed_view())
        worker.handle_request({"id": "initial-between-advanced", "phase": "discard", "view": view_for()})
        self.assertEqual(self.request(view), first)
        self.assertEqual(view, before)

    def test_separate_vendor_provenance_detects_derived_source_tampering(self):
        manifest = advanced_policy.verify_vendor()
        self.assertEqual(manifest["commit"], worker.PINNED_COMMIT)
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "vendor"
            shutil.copytree(advanced_policy.VENDOR, target)
            source = target / "derived" / "ebony72_advanced_public" / "strategyz0614.py"
            source.write_bytes(source.read_bytes() + b"\n# modified\n")
            with patch.object(advanced_policy, "VENDOR", target), self.assertRaises(Exception):
                advanced_policy.verify_vendor()


if __name__ == "__main__":
    unittest.main()
