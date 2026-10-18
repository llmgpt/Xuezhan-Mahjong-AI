"""Boundary and real-policy tests for the pinned, public-information worker."""

import copy
from contextlib import redirect_stderr
import io
import json
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import worker


def view_for(hand=None, missing="tong"):
    hand = list(hand if hand is not None else [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 18, 26])
    missing_index = {"wan": 0, "tiao": 1, "tong": 2}.get(missing)
    forced = [tile for tile in hand if tile // 9 == missing_index]
    return {
        "seat": 0,
        "hand": hand,
        "melds": [],
        "missing": missing,
        "legalDiscards": sorted(set(forced or hand)),
        "ownDiscards": [],
        "opponents": [
            {"seat": seat, "handCount": 13, "melds": [], "discards": [], "missing": "wan", "won": False, "score": 0}
            for seat in [1, 2, 3]
        ],
        "wallRemaining": 50,
        "publicTiles": [],
        "decision": {"kind": "self", "canWin": False, "concealedKongs": [], "addedKongs": []},
    }


def add_discard(view, seat, tile):
    view["publicTiles"].append({"seat": seat, "tile": tile, "kind": "discard"})
    if seat == view["seat"]:
        view["ownDiscards"].append(tile)
    else:
        next(opponent for opponent in view["opponents"] if opponent["seat"] == seat)["discards"].append(tile)


def response_view(hand, tile=0, choices=None, response_kind="discard"):
    view = view_for(hand)
    view["legalDiscards"] = []
    view["decision"] = {
        "kind": "respond", "responseKind": response_kind,
        "from": 1, "tile": tile,
        "choices": choices if choices is not None else ["pass", "pung"],
    }
    if response_kind == "discard":
        add_discard(view, 1, tile)
    return view


class WorkerTests(unittest.TestCase):
    def request(self, view, phase="discard", identifier="case"):
        return worker.handle_request({"id": identifier, "phase": phase, "view": view})

    def assert_action(self, view, expected, phase="discard"):
        self.assertEqual(self.request(view, phase), {"id": "case", "action": expected})

    def test_all_tile_encodings_round_trip_and_suits_are_explicit(self):
        self.assertEqual(worker.to_external(0), [1, 1])
        self.assertEqual(worker.to_external(9), [0, 1])
        self.assertEqual(worker.to_external(18), [2, 1])
        for tile in range(27):
            self.assertEqual(worker.from_external(worker.to_external(tile)), tile)
        for tile in [-1, 27, True, 1.5, "0"]:
            with self.subTest(tile=tile), self.assertRaises(worker.AdapterError):
                worker.to_external(tile)
        for tile in [[3, 1], [0, 0], [1, 10], [True, 1], [0], "01"]:
            with self.subTest(tile=tile), self.assertRaises(worker.AdapterError):
                worker.from_external(tile)

    def test_knowledge_counts_each_public_tile_and_meld_once(self):
        view = view_for([0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        view["melds"] = [{"type": "pung", "tile": 1, "from": 3}]
        view["opponents"][0]["melds"] = [{"type": "kong", "tile": 2, "from": 2, "kongKind": "direct"}]
        view["opponents"][0]["handCount"] = 10
        add_discard(view, 1, 0)
        view["opponents"][1]["won"] = True
        view["publicTiles"].append({"seat": 2, "tile": 18, "kind": "self-win"})
        context = worker.build_context(view)
        knowledge = context.player.kgbase(context.dealer, context.players)
        for tile, expected in [(0, 2), (1, 1), (2, 0), (18, 3)]:
            suit, rank = worker.to_external(tile)
            self.assertEqual(knowledge[suit * 9 + rank - 1], expected)
        knowledge[0] = -20
        self.assertNotEqual(context.player.kgbase(context.dealer, context.players)[0], -20)

    def test_wall_exposes_only_length_and_opponents_refuse_hidden_hands(self):
        context = worker.build_context(view_for())
        self.assertEqual(len(context.dealer.deck), 50)
        with self.assertRaises(worker.HiddenInformationError):
            _ = context.dealer.deck[0]
        with self.assertRaises(worker.HiddenInformationError):
            list(context.dealer.deck)
        with self.assertRaises(worker.HiddenInformationError):
            _ = context.players[1].hand

    def test_real_upstream_missing_discard_uses_actual_recent_order(self):
        first = view_for()
        add_discard(first, 1, 18)
        add_discard(first, 2, 26)
        second = copy.deepcopy(first)
        second["publicTiles"].reverse()
        self.assert_action(first, {"type": "discard", "tile": 26})
        self.assert_action(second, {"type": "discard", "tile": 18})

    def test_real_upstream_regular_discard_retains_wider_ready_shape(self):
        view = view_for([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17])
        self.assert_action(view, {"type": "discard", "tile": 17})

    def test_recent_public_window_uses_four_entries_and_ignores_the_fifth(self):
        view = view_for()
        for seat, tile in [(1, 18), (2, 0), (3, 1), (1, 2), (2, 3)]:
            add_discard(view, seat, tile)
        self.assert_action(view, {"type": "discard", "tile": 26})
        view["publicTiles"] = [view["publicTiles"][1], view["publicTiles"][2], view["publicTiles"][3], view["publicTiles"][4], view["publicTiles"][0]]
        self.assert_action(view, {"type": "discard", "tile": 18})

    def test_winner_full_hand_count_reveals_only_the_self_win_tile(self):
        view = view_for()
        view["opponents"][0]["won"] = True
        view["opponents"][0]["handCount"] = 14
        view["publicTiles"] = [{"seat": 1, "tile": 18, "kind": "self-win"}]
        context = worker.build_context(view)
        self.assertEqual(context.player.kgbase(context.dealer, context.players)[18], 2)
        self.assert_action(view, {"type": "discard", "tile": 18})

    def test_real_upstream_choose_missing_handles_absent_suit(self):
        view = view_for([0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14])
        view.pop("missing")
        view.pop("decision")
        view["legalDiscards"] = []
        self.assert_action(view, {"type": "missing", "suit": "tong"}, "choose-missing")

    def test_missing_selection_accepts_other_players_not_having_declared_yet(self):
        view = view_for([0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14])
        view.pop("missing")
        view.pop("decision")
        view["legalDiscards"] = []
        del view["opponents"][1]["missing"]
        del view["opponents"][2]["missing"]
        self.assert_action(view, {"type": "missing", "suit": "tong"}, "choose-missing")

    def test_legal_self_win_precedes_other_actions(self):
        view = view_for([0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 12])
        view["decision"]["canWin"] = True
        self.assert_action(view, {"type": "win"})

    def test_legal_discard_win_precedes_pung_and_pass(self):
        view = response_view([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 12], choices=["pass", "pung", "hu"])
        self.assert_action(view, {"type": "respond", "choice": "hu"}, "respond")

    def test_legal_rob_kong_win_does_not_require_tile_in_public_discard(self):
        view = response_view([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 12], choices=["pass", "hu"], response_kind="rob-kong")
        self.assert_action(view, {"type": "respond", "choice": "hu"}, "respond")

    def test_real_upstream_pong_maps_to_host_pung(self):
        view = response_view([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13])
        self.assert_action(view, {"type": "respond", "choice": "pung"}, "respond")

    def test_real_upstream_direct_kong(self):
        view = response_view([0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12], choices=["pass", "pung", "kong"])
        self.assert_action(view, {"type": "respond", "choice": "kong"}, "respond")

    def test_real_upstream_concealed_kong(self):
        view = view_for([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12])
        view["decision"]["concealedKongs"] = [0]
        self.assert_action(view, {"type": "kong", "kind": "concealed", "tile": 0})

    def test_real_upstream_added_kong(self):
        view = view_for([0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12])
        view["melds"] = [{"type": "pung", "tile": 0, "from": 2}]
        view["decision"]["addedKongs"] = [0]
        self.assert_action(view, {"type": "kong", "kind": "added", "tile": 0})

    def test_multiple_kong_options_preserve_upstream_first_candidate_rule(self):
        view = view_for([0, 0, 0, 0, 17, 1, 2, 3, 10, 11, 12])
        view["melds"] = [{"type": "pung", "tile": 17, "from": 1}]
        view["decision"]["concealedKongs"] = [0]
        view["decision"]["addedKongs"] = [17]
        self.assert_action(view, {"type": "kong", "kind": "concealed", "tile": 0})

    def test_two_tile_endgame_with_four_melds_and_empty_wall(self):
        view = view_for([0, 1])
        view["melds"] = [{"type": "pung", "tile": tile, "from": 1} for tile in [9, 10, 11, 12]]
        view["wallRemaining"] = 0
        self.assert_action(view, {"type": "discard", "tile": 0})

    def test_upstream_dead_end_at_empty_wall_is_an_explicit_error(self):
        # Legal V1 non-winning shape: 1111m 2222m 123s 567s, missing dots.
        # With no replacement tile, neither concealed kong is legal. Upstream
        # excludes quads from its candidate list and cannot choose a discard.
        view = view_for([0, 0, 0, 0, 1, 1, 1, 1, 9, 10, 11, 13, 14, 15])
        view["wallRemaining"] = 0
        diagnostics = io.StringIO()
        with redirect_stderr(diagnostics):
            result = self.request(view)
        self.assertEqual(result["error"]["code"], "upstream-error")
        self.assertIn("No preferrable discard tiles", result["error"]["message"])
        self.assertIn("T =", diagnostics.getvalue())

    def test_full_public_endgame_fixture_has_108_tiles_and_still_reports_upstream_error(self):
        path = Path(__file__).parent / "fixtures" / "upstream-empty-wall.request.json"
        request = json.loads(path.read_text(encoding="utf-8"))
        view = request["view"]
        accounted = len(view["hand"]) + len(view["publicTiles"]) + sum(opponent["handCount"] for opponent in view["opponents"])
        self.assertEqual(accounted, 108)
        self.assertEqual(view["wallRemaining"], 0)
        with redirect_stderr(io.StringIO()):
            result = worker.handle_request(request)
        self.assertEqual(result["error"]["code"], "upstream-error")
        self.assertIn("No preferrable discard tiles", result["error"]["message"])

    def test_host_pass_only_returns_pass(self):
        view = response_view([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], choices=["pass"])
        self.assert_action(view, {"type": "respond", "choice": "pass"}, "respond")

    def test_upstream_stand_maps_to_pass(self):
        view = response_view([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13])
        with patch.object(worker.INITIAL, "check_pong", return_value="stand"):
            self.assert_action(view, {"type": "respond", "choice": "pass"}, "respond")

    def test_missing_ordered_public_projection_is_rejected(self):
        view = view_for()
        del view["publicTiles"]
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")

    def test_hidden_fields_and_seed_are_rejected_at_each_input_boundary(self):
        cases = []
        request = {"id": "hidden", "phase": "discard", "view": view_for(), "seed": 42}
        cases.append(request)
        for path, key, value in [("view", "wall", [0]), ("opponent", "hand", [0]), ("view", "gameState", {})]:
            request = {"id": "hidden", "phase": "discard", "view": view_for()}
            target = request["view"] if path == "view" else request["view"]["opponents"][0]
            target[key] = value
            cases.append(request)
        for request in cases:
            with self.subTest(request=request):
                self.assertEqual(worker.handle_request(request)["error"]["code"], "hidden-field")

    def test_public_projection_must_match_actual_discard_multiplicity(self):
        view = view_for()
        view["opponents"][0]["discards"] = [18]
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")

    def test_more_than_four_known_copies_is_rejected(self):
        view = view_for([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12])
        add_discard(view, 1, 0)
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")

    def test_nested_hidden_decision_is_rejected_even_before_missing_selection(self):
        view = view_for([0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14])
        view.pop("missing")
        view["legalDiscards"] = []
        view["decision"]["opponentHand"] = [0, 0]
        self.assertEqual(self.request(view, "choose-missing")["error"]["code"], "hidden-field")

    def test_non_finite_public_score_is_rejected(self):
        view = view_for()
        view["opponents"][0]["score"] = float("nan")
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")

    def test_invalid_host_and_upstream_actions_are_errors_without_fallback(self):
        view = view_for()
        view["legalDiscards"] = [0]
        self.assertEqual(self.request(view)["error"]["code"], "invalid-view")
        view = view_for()
        with patch.object(worker.INITIAL, "select_a_card_to_discard", return_value=[1, 1]):
            self.assertEqual(self.request(view)["error"]["code"], "illegal-action")
        view = response_view([0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13])
        with patch.object(worker.INITIAL, "check_pong", return_value="kong"):
            self.assertEqual(self.request(view, "respond")["error"]["code"], "illegal-action")

    def test_upstream_exception_is_reported_without_fallback(self):
        with patch.object(worker.INITIAL, "select_a_card_to_discard", side_effect=RuntimeError("No preferrable discard tiles")):
            result = self.request(view_for())
        self.assertEqual(result["error"]["code"], "upstream-error")
        self.assertIn("No preferrable discard tiles", result["error"]["message"])

    def test_exchange_is_explicitly_unsupported(self):
        self.assertEqual(self.request(view_for(), "exchange")["error"]["code"], "unsupported")

    def test_a_b_a_does_not_mutate_inputs_or_carry_game_state(self):
        first = view_for()
        add_discard(first, 1, 18)
        second = view_for()
        add_discard(second, 1, 26)
        before = copy.deepcopy(first)
        expected = self.request(first)
        self.request(second)
        self.assertEqual(self.request(first), expected)
        self.assertEqual(first, before)

    def test_source_manifest_verifies_exact_pinned_dependency_bytes(self):
        manifest = worker.verify_vendor()
        self.assertEqual(manifest["commit"], "2d46ffa0ba84f486c336935d8f3e105f4e39e5a2")
        self.assertEqual(set(manifest["files"]), {"strategy_initial21_7attr.py", "dfncy/block_dfncy.py", "utils/xzutils.py", "utils/xzcard.py", "utils/daque.py", "utils/pusolx.py", "license.md"})

    def test_changed_source_cannot_be_hidden_by_regenerating_the_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "vendor"
            shutil.copytree(worker.VENDOR, copied)
            source = copied / "strategy_initial21_7attr.py"
            source.write_bytes(source.read_bytes() + b"\n# changed\n")
            manifest_path = copied / "UPSTREAM.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"][source.name] = hashlib.sha256(source.read_bytes()).hexdigest()
            closure = "".join(f"{manifest['files'][name]}  {name}\n" for name in sorted(manifest["files"]))
            manifest["closureSha256"] = hashlib.sha256(closure.encode()).hexdigest()
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with patch.object(worker, "VENDOR", copied), self.assertRaises(worker.AdapterError) as raised:
                worker.verify_vendor()
            self.assertEqual(raised.exception.code, "provenance-error")

    def test_worker_stream_keeps_running_and_stdout_is_only_jsonl(self):
        request = {"id": "first", "phase": "discard", "view": view_for()}
        final = copy.deepcopy(request)
        final["id"] = "last"
        completed = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).with_name("worker.py"))],
            input=json.dumps(request) + "\nnot-json\n" + json.dumps(final) + "\n",
            text=True, capture_output=True, encoding="utf-8", timeout=20,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        rows = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["id"], "first")
        self.assertEqual(rows[1]["error"]["code"], "invalid-json")
        self.assertEqual(rows[2]["id"], "last")


if __name__ == "__main__":
    unittest.main()
