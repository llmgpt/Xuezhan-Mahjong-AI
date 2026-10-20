"""Exact default-V1 score/payment arithmetic; no policy or game execution."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from v1_income import evaluate_v1_income


FIXTURE_PATH = Path(__file__).with_name("fixtures") / "v1-income-host495.json"
FIXTURE_SHA256 = "39aa4d7042607f2920bbc338d0c8ff3b82fd7ad9fd7fa4d94a8ac0593fa944ba"


def hand(text):
    offsets = {"w": 0, "s": 9, "t": 18}
    result = []
    for group in text.split():
        result.extend(offsets[group[0]] + int(rank) - 1 for rank in group[1:])
    return result


PLAIN = hand("w11123499 s345678")


class V1IncomeTests(unittest.TestCase):
    def test_plain_discard_and_self_draw_use_different_payment_units(self):
        ron = evaluate_v1_income(PLAIN, [], "tong")
        self.assertEqual(ron["base"], {"fan": 0, "points": 1, "patterns": ["平胡"]})
        self.assertEqual(ron["current"], ron["base"])
        self.assertEqual(ron["payment"], {
            "win_kind": "discard", "payer_count": 1, "per_payer": 1, "total": 1,
        })
        drawn = evaluate_v1_income(PLAIN, [], "tong", win_kind="self")
        self.assertEqual(drawn["payment"], {
            "win_kind": "self", "payer_count": 3, "per_payer": 2, "total": 6,
        })

    def test_prior_winners_are_excluded_by_explicit_active_opponent_count(self):
        for count in (1, 2, 3):
            with self.subTest(count=count):
                result = evaluate_v1_income(PLAIN, [], "tong", win_kind="self", active_opponents=count)
                self.assertEqual(result["payment"]["payer_count"], count)
                self.assertEqual(result["payment"]["total"], count * 2)
                ron = evaluate_v1_income(PLAIN, [], "tong", active_opponents=count)
                self.assertEqual(ron["payment"]["total"], 1)

    def test_all_triplets_and_pure_suit_are_added_before_cap(self):
        result = evaluate_v1_income(hand("w11122233344455"), [], "tong")
        self.assertEqual(result["base"], {"fan": 3, "points": 8, "patterns": ["对对胡", "清一色"]})

    def test_seven_pairs_quad_is_two_pairs_and_one_root_not_triplets(self):
        result = evaluate_v1_income(hand("w11112233445566"), [], "tong")
        self.assertEqual(result["base"], {"fan": 5, "points": 8, "patterns": ["七对", "清一色", "根"]})

    def test_mixed_suit_seven_pairs_scores_two_fan(self):
        result = evaluate_v1_income(hand("w112233 s11223344"), [], "tong")
        self.assertEqual(result["base"], {"fan": 2, "points": 4, "patterns": ["七对"]})

    def test_gold_hook_has_triplets_but_no_additional_gold_hook_fan(self):
        melds = [{"type": "pung", "tile": tile} for tile in (0, 1, 9, 10)]
        result = evaluate_v1_income([2, 2], melds, "tong")
        self.assertEqual(result["base"], {"fan": 1, "points": 2, "patterns": ["对对胡"]})
        self.assertEqual(result["payment"]["total"], 2)

    def test_gold_hook_and_multiple_kong_roots_are_counted_normally(self):
        melds = [{"type": "kong", "tile": tile} for tile in (0, 1, 9, 10)]
        result = evaluate_v1_income([2, 2], melds, "tong", win_kind="self", active_opponents=2)
        self.assertEqual(result["base"], {"fan": 5, "points": 8, "patterns": ["对对胡", "根×4"]})
        self.assertEqual(result["payment"], {
            "win_kind": "self", "payer_count": 2, "per_payer": 9, "total": 18,
        })

    def test_root_can_span_concealed_tile_and_exposed_pung(self):
        concealed = hand("w12399 s345678")
        result = evaluate_v1_income(concealed, [{"type": "pung", "tile": 0}], "tong")
        self.assertEqual(result["base"], {"fan": 1, "points": 2, "patterns": ["平胡", "根"]})

    def test_two_roots_and_seven_pairs_remain_exclusive_with_triplets(self):
        result = evaluate_v1_income(hand("w11112222 s334455"), [], "tong")
        self.assertEqual(result["base"], {"fan": 4, "points": 8, "patterns": ["七对", "根×2"]})

    def test_kong_shot_increases_current_ron_payment_not_base(self):
        result = evaluate_v1_income(PLAIN, [], "tong", {"kongShot": True})
        self.assertEqual(result["base"]["points"], 1)
        self.assertEqual(result["current"], {"fan": 1, "points": 2, "patterns": ["平胡", "杠后炮"]})
        self.assertEqual(result["payment"]["per_payer"], 2)

    def test_rob_kong_scores_event_and_single_payer(self):
        result = evaluate_v1_income(PLAIN, [], "tong", {"robKong": True}, win_kind="rob-kong")
        self.assertEqual(result["base"]["points"], 1)
        self.assertEqual(result["current"], {"fan": 1, "points": 2, "patterns": ["平胡", "抢杠胡"]})
        self.assertEqual(result["payment"], {
            "win_kind": "rob-kong", "payer_count": 1, "per_payer": 2, "total": 2,
        })

    def test_kong_flower_and_last_wall_self_draw_stack(self):
        result = evaluate_v1_income(PLAIN, [], "tong", {"kongFlower": True, "seaBottom": True}, win_kind="self")
        self.assertEqual(result["current"], {"fan": 2, "points": 4, "patterns": ["平胡", "杠上花", "海底胡"]})
        self.assertEqual(result["payment"]["total"], 15)

    def test_last_wall_discard_and_kong_shot_stack(self):
        result = evaluate_v1_income(PLAIN, [], "tong", {"kongShot": True, "seaBottom": True})
        self.assertEqual(result["current"], {"fan": 2, "points": 4, "patterns": ["平胡", "杠后炮", "海底胡"]})
        self.assertEqual(result["payment"]["total"], 4)

    def test_cap_preserves_raw_fan_and_patterns_but_caps_current_points(self):
        result = evaluate_v1_income(hand("w11112233445566"), [], "tong", {"kongFlower": True, "seaBottom": True}, win_kind="self")
        self.assertEqual(result["base"]["fan"], 5)
        self.assertEqual(result["current"], {
            "fan": 7, "points": 8, "patterns": ["七对", "清一色", "根", "杠上花", "海底胡"],
        })
        self.assertEqual(result["payment"]["total"], 27)

    def test_short_completed_lengths_and_meld_metadata_do_not_change_scoring(self):
        for meld_count in range(5):
            with self.subTest(meld_count=meld_count):
                concealed = hand("w11") + [tile for tile in (1, 9, 10, 11)[meld_count:] for _ in range(3)]
                melds = [{"type": "pung", "tile": tile} for tile in (1, 9, 10, 11)[:meld_count]]
                result = evaluate_v1_income(concealed, melds, "tong")
                self.assertEqual(len(concealed), 14 - 3 * meld_count)
                self.assertEqual(result["base"]["points"], 2)
        concealed = hand("w12399 s345678")
        short = [{"type": "pung", "tile": 0}]
        full = [{"type": "pung", "tile": 0, "from": 3}]
        self.assertEqual(evaluate_v1_income(concealed, short, "tong"), evaluate_v1_income(concealed, full, "tong"))

    def test_nonwinning_missing_and_uncompleted_inputs_return_none(self):
        self.assertIsNone(evaluate_v1_income(PLAIN[:-1], [], "tong"))
        self.assertIsNone(evaluate_v1_income(hand("w123456789 s12345"), [], "tong"))
        self.assertIsNone(evaluate_v1_income(PLAIN, [], "wan"))
        self.assertIsNone(evaluate_v1_income(hand("w12399 s345678"), [{"type": "pung", "tile": 18}], "tong"))

    def test_fifth_physical_copy_in_concealed_or_meld_is_rejected(self):
        bad = list(PLAIN)
        bad[:5] = [0] * 5
        with self.assertRaises(ValueError):
            evaluate_v1_income(bad, [], "tong")
        with self.assertRaises(ValueError):
            evaluate_v1_income(hand("w12399 s345678"), [{"type": "kong", "tile": 0}], "tong")

    def test_invalid_tiles_melds_missing_and_non_boolean_context_fail(self):
        for tile in (-1, 27, 1.5, True, "1"):
            with self.subTest(tile=tile), self.assertRaises(ValueError):
                evaluate_v1_income([tile] + PLAIN[1:], [], "tong")
        for meld in ({"type": "chow", "tile": 0}, {"type": "pung"}, {"type": "kong", "tile": 27}, {"type": "pung", "tile": 0, "from": 4}):
            with self.subTest(meld=meld), self.assertRaises(ValueError):
                evaluate_v1_income(PLAIN, [meld], "tong")
        for missing in (None, "suo", 0):
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                evaluate_v1_income(PLAIN, [], missing)
        for context in ({"kongShot": 1}, {"seaBottom": "yes"}, {"seed": 123}):
            with self.subTest(context=context), self.assertRaises(ValueError):
                evaluate_v1_income(PLAIN, [], "tong", context)

    def test_incompatible_event_kind_and_unavailable_payer_counts_fail(self):
        cases = [
            ({"kongFlower": True}, "discard"),
            ({"kongShot": True}, "self"),
            ({"robKong": True}, "discard"),
            ({}, "rob-kong"),
            ({"robKong": True, "kongShot": True}, "rob-kong"),
            ({}, "other"),
        ]
        for context, kind in cases:
            with self.subTest(context=context, kind=kind), self.assertRaises(ValueError):
                evaluate_v1_income(PLAIN, [], "tong", context, win_kind=kind)
        for count in (0, 4, True, 1.5):
            with self.subTest(count=count), self.assertRaises(ValueError):
                evaluate_v1_income(PLAIN, [], "tong", active_opponents=count)

    def test_input_is_unchanged_and_results_do_not_alias_future_calls(self):
        args = (list(PLAIN), [], "tong", {"kongShot": True})
        original = deepcopy(args)
        first = evaluate_v1_income(*args)
        first["current"]["patterns"].append("mutated")
        self.assertEqual(args, original)
        self.assertNotIn("mutated", evaluate_v1_income(*args)["current"]["patterns"])
        first["base"]["patterns"].append("base-only")
        self.assertNotIn("base-only", first["current"]["patterns"])

    def test_all_495_fixed_public_completions_match_host_fan_points_and_patterns(self):
        fixture_bytes = FIXTURE_PATH.read_bytes()
        self.assertEqual(hashlib.sha256(fixture_bytes).hexdigest(), FIXTURE_SHA256)
        fixture = json.loads(fixture_bytes)
        self.assertEqual(len(fixture["cases"]), 495)
        self.assertEqual(fixture["sourceScoringSha256"], "c579f573293ae35b3365e30edb640ce790c2bb1e50045c7dfe644866d4052e0e")
        self.assertEqual(len({row["id"] for row in fixture["cases"]}), 495)
        self.assertEqual(fixture["gamesExecuted"], 0)
        for row in fixture["cases"]:
            with self.subTest(id=row["id"]):
                kind = "rob-kong" if row["context"].get("robKong") else "discard"
                result = evaluate_v1_income(row["hand"], row["melds"], row["missing"], row["context"], win_kind=kind)
                self.assertIsNotNone(result)
                self.assertEqual(result["current"], row["expected"])
                self.assertEqual(result["base"], row["baseExpected"])


if __name__ == "__main__":
    unittest.main()
