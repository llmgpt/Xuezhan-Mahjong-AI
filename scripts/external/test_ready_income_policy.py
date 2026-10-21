"""Fixed public-state money and preserved routes; never runs a game or seed."""

import copy
from collections import Counter
import hashlib
import inspect
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import advanced_policy
import ready_income_policy as ready
import v1_income_policy
import worker
from test_v1_income_policy import CASES


advanced_policy.load_policy()
from ebony72_advanced_public.own_hand_helpers import OwnHandHelpers
from ebony72_advanced_public.public_history import PublicHistoryModel


def hand(text):
    offsets = {"w": 0, "s": 9, "t": 18}
    return [offsets[group[0]] + int(rank) - 1 for group in text.split() for rank in group[1:]]


def piles(tiles, kind="pung"):
    return [{"type": kind, "tile": tile} for tile in tiles]


class Own(OwnHandHelpers):
    def kgbase(self, dealer, players):
        return list(self.knowledge)


class PublicDealer(PublicHistoryModel):
    @property
    def deck(self):
        raise AssertionError("Wall identity/order was requested")

    @property
    def seed(self):
        raise AssertionError("Original seed was requested")

    def n_hu(self):
        return self.winners


class PublicOpponent:
    pile = []

    @property
    def hand(self):
        raise AssertionError("Opponent concealed tiles were requested")


def state(concealed, melds, incoming, weights, *, wall=20, payers=3, total=30, kong_shot=False, history=None):
    """Synthetic own/public money facade, not a reconstructed engine game."""
    own = Own()
    own.player_id, own.daque_color = 0, 2
    own.hand = [worker.to_external(tile) for tile in concealed]
    own.pile = [[worker.to_external(meld["tile"]) for _ in range(4 if meld["type"] == "kong" else 3)] for meld in melds]
    own.hu_way = ["kongshangpao"] if kong_shot else []
    knowledge = [0] * 27
    for tile, copies in weights.items():
        suit, rank = worker.to_external(tile)
        knowledge[suit * 9 + rank - 1] = copies
    remaining = total - sum(knowledge)
    for tile in range(18, 27):  # unknown missing-suit stock cannot complete own hand
        suit, rank = worker.to_external(tile)
        index = suit * 9 + rank - 1
        added = min(4 - knowledge[index], remaining)
        knowledge[index] += added
        remaining -= added
    if remaining:
        raise AssertionError("Synthetic knowledge budget exceeds its filler domain")
    own.knowledge = knowledge
    external = worker.to_external(incoming)
    actions = history if history is not None else [[1, "draw"], [1, "discard", external[:]]]
    dealer = PublicDealer(copy.deepcopy(actions), [0, 0, 0, 0])
    dealer.table, dealer.numWl, dealer.winners = [external[:]], wall, 3 - payers
    return own, dealer, 1, [own, PublicOpponent(), PublicOpponent(), PublicOpponent()]


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def factor(wall, payers, knowledge):
    return payers * .99 ** (55 - wall) * (1 - .8 ** (wall / (payers + 1))) / (knowledge * (1 - .8))


def bindings(module):
    def token(value):
        if type(value) in (type(None), bool, int, float, str):
            return (type(value), value)
        if type(value) in (list, tuple):
            return tuple(token(item) for item in value)
        if type(value) is dict:
            return tuple((key, token(item)) for key, item in value.items())
        return ("identity", id(value))
    return ({key: id(value) for key, value in vars(module).items()},
            {key: token(value) for key, value in vars(module).items() if key != "__builtins__"})


class ReadyIncomePolicyTests(unittest.TestCase):
    def mixed(self, **kwargs):
        return state(hand("w11123 s23467899"), [], 3, {0: 1, 3: 2}, **kwargs)

    def test_mixed_root_waits_use_KB_money_instead_of_one_global_multiplier(self):
        report = ready.analyze_waiting_income(*self.mixed())
        self.assertEqual(report["currentIncome"], 1)
        self.assertEqual(report["waitingCopies"], 3)
        self.assertEqual(report["weightedSelfPerPayer"], 7)
        self.assertEqual([(row["tile"], row["unseenCopies"], row["basePoints"], row["selfPerPayer"]) for row in report["waiting"]], [(0, 1, 2, 3), (3, 2, 1, 2)])
        self.assertAlmostEqual(report["waitingRatio"], factor(20, 3, 30) * 7)

    def test_capped_real_short_hand_changes_legacy_decline_to_accept(self):
        args = state([4], piles((0, 1, 2, 3)), 4, {4: 2}, total=26)
        self.assertEqual(v1_income_policy.load_policy().check_hu(*args), "stand")
        self.assertEqual(ready.load_policy().check_hu(*args), "hu")

    def test_B1_B2_B4_B8_and_each_active_payer_count_keep_one_payer_factor(self):
        forms = [(hand("w11123499 s345678"), 1), (hand("w11122255 s333444"), 2),
                 (hand("w11123434567899"), 4), (hand("w11122233344455"), 8)]
        for completed, points in forms:
            for payers in (1, 2, 3):
                args = state(completed[:-1], [], completed[-1], {completed[-1]: 1}, payers=payers)
                report = ready.analyze_waiting_income(*args)
                with self.subTest(points=points, payers=payers):
                    self.assertEqual(report["currentIncome"], points)
                    self.assertEqual(report["waiting"][0]["selfPerPayer"], points + 1)
                    self.assertEqual(report["activeOpponents"], payers)
                    self.assertAlmostEqual(report["waitingRatio"], factor(20, payers, 30) * (points + 1) / points)

    def test_current_kong_shot_denominator_is_applied_once_and_never_becomes_future_event(self):
        normal = ready.analyze_waiting_income(*self.mixed())
        event = ready.analyze_waiting_income(*self.mixed(kong_shot=True))
        self.assertEqual(event["currentIncome"], 2)
        self.assertEqual(event["futureContext"], {"seaBottom": False})
        self.assertEqual(event["weightedSelfPerPayer"], 7)
        self.assertAlmostEqual(event["waitingRatio"], normal["waitingRatio"] / 2)
        args = state([4], piles((0, 1, 2, 3)), 4, {4: 2}, kong_shot=True)
        self.assertEqual(ready.analyze_waiting_income(*args)["currentIncome"], 8)

    def test_original_opportunity_expression_keeps_its_floating_operation_order(self):
        for wall, total in ((1, 30), (20, 30), (35, 38)):
            for payers in (1, 2, 3):
                report = ready.analyze_waiting_income(*self.mixed(wall=wall, total=total, payers=payers))
                with self.subTest(wall=wall, payers=payers):
                    self.assertEqual(report["opportunity"]["factor"], factor(wall, payers, total))

    def test_own_and_public_inputs_and_independent_reports_are_not_mutated(self):
        args = self.mixed(kong_shot=True)
        own, dealer, _, _ = args
        def snapshot():
            return copy.deepcopy((own.hand, own.pile, own.knowledge, own.hu_way,
                                  dealer.table, dealer.act_history, dealer.dqc, dealer.numWl, dealer.winners))
        before = snapshot()
        first = ready.analyze_waiting_income(*args)
        self.assertEqual(snapshot(), before)
        first["waiting"][0]["selfPerPayer"] = 999
        first["currentEvaluation"]["current"]["points"] = 999
        second = ready.analyze_waiting_income(*args)
        self.assertEqual(second["currentIncome"], 2)
        self.assertEqual(second["waiting"][0]["selfPerPayer"], 3)
        self.assertEqual(snapshot(), before)

    def test_four_exposed_melds_and_existing_kong_roots_have_no_new_gold_hook_or_kong_money(self):
        args = state([2], piles((0, 1, 9, 10)), 2, {2: 1})
        report = ready.analyze_waiting_income(*args)
        self.assertEqual(report["currentIncome"], 2)
        self.assertEqual(report["weightedSelfPerPayer"], 3)
        completed = hand("w22255 s333444")
        args = state(completed[:-1], piles((0,), "kong"), completed[-1], {completed[-1]: 1})
        report = ready.analyze_waiting_income(*args)
        self.assertEqual(report["currentIncome"], 4)
        self.assertEqual(report["waiting"][0]["selfPerPayer"], 5)
        self.assertAlmostEqual(report["waitingRatio"], factor(20, 3, 30) * 5 / 4)

    def test_zero_wall_is_zero_future_and_one_wall_self_win_is_sea_bottom(self):
        zero = ready.analyze_waiting_income(*self.mixed(wall=0))
        self.assertEqual(zero["currentIncome"], 2)
        self.assertEqual(zero["waitingRatio"], 0)
        self.assertEqual(ready.load_policy().check_hu(*self.mixed(wall=0)), "hu")
        one = ready.analyze_waiting_income(*self.mixed(wall=1))
        self.assertEqual(one["currentIncome"], 1)
        self.assertEqual(one["futureContext"], {"seaBottom": True})
        self.assertEqual(one["weightedSelfPerPayer"], 11)
        self.assertAlmostEqual(one["waitingRatio"], factor(1, 3, 30) * 11)
        both = ready.analyze_waiting_income(*self.mixed(wall=0, kong_shot=True))
        self.assertEqual(both["currentIncome"], 4)

    def test_last_draw_actor_who_pungs_again_does_not_keep_sea_bottom(self):
        tile = worker.to_external(3)
        history = [[1, "draw"], [1, "discard", [0, 1]], [2, "pong", [0, 1]],
                   [2, "discard", [0, 2]], [1, "pong", [0, 2]], [1, "discard", tile]]
        report = ready.analyze_waiting_income(*self.mixed(wall=0, history=history))
        self.assertFalse(report["currentContext"]["seaBottom"])
        self.assertEqual(report["currentIncome"], 1)

    def test_offered_fourth_root_stays_out_of_KB_and_other_copies_are_not_banned(self):
        args = state(hand("w11123 s23467899"), [], 0, {0: 0, 3: 2})
        before = copy.deepcopy(args[0].knowledge)
        report = ready.analyze_waiting_income(*args)
        self.assertEqual(report["currentIncome"], 2)
        self.assertEqual(report["waitingCopies"], 2)
        self.assertEqual(report["weightedSelfPerPayer"], 4)
        self.assertEqual([row["tile"] for row in report["waiting"]], [3])
        self.assertEqual(args[0].knowledge, before)
        self.assertEqual([row["tile"] for row in ready.analyze_waiting_income(*self.mixed())["waiting"]], [0, 3])

    def test_exhausted_waits_and_nonwinning_unknown_tiles_add_no_money(self):
        args = state(hand("w11123 s23467899"), [], 3, {}, total=30)
        report = ready.analyze_waiting_income(*args)
        self.assertEqual(report["waiting"], [])
        self.assertEqual(report["waitingRatio"], 0)
        zero = state(hand("w11123 s23467899"), [], 3, {}, wall=0, total=0)
        self.assertEqual(ready.analyze_waiting_income(*zero)["waitingRatio"], 0)

    def test_invalid_current_own_state_history_stock_or_scalars_fail_without_fallback(self):
        changes = [lambda p, d: p.hand.pop(), lambda p, d: p.hu_way.append("private-event"),
                   lambda p, d: p.knowledge.__setitem__(0, True), lambda p, d: p.knowledge.__setitem__(0, -1),
                   lambda p, d: p.knowledge.__setitem__(0, float("nan")), lambda p, d: setattr(d, "numWl", True),
                   lambda p, d: setattr(d, "numWl", 56), lambda p, d: setattr(d, "winners", 3),
                   lambda p, d: setattr(d, "act_history", []),
                   lambda p, d: d.act_history[-1].__setitem__(0, 2),
                   lambda p, d: d.act_history[-1].__setitem__(2, worker.to_external(7))]
        for change in changes:
            args = self.mixed()
            change(args[0], args[1])
            with self.subTest(change=changes.index(change)), self.assertRaises(ValueError):
                ready.analyze_waiting_income(*args)
        args = state(hand("w11123 s23467899"), [], 0, {0: 1, 3: 2})  # restores a fifth known copy
        with self.assertRaises(ValueError):
            ready.analyze_waiting_income(*args)

    def test_check_hu_uses_one_same_report_and_fixed_strict_threshold(self):
        policy = ready.load_policy()
        for value, expected in ((.9, "hu"), (1, "hu"), (1.000001, "stand")):
            with patch.object(ready, "analyze_waiting_income", return_value={"waitingRatio": value}) as analyze:
                self.assertEqual(policy.check_hu(*self.mixed()), expected)
                analyze.assert_called_once()

    def test_facade_is_fresh_and_only_check_hu_changes_from_its_V7_base(self):
        base = v1_income_policy.load_policy()
        with patch.object(v1_income_policy, "load_policy", return_value=base):
            policy = ready.load_policy()
        self.assertIsNot(policy, base)
        self.assertIsNot(policy.check_hu, base.check_hu)
        for name, value in vars(base).items():
            if name != "check_hu":
                self.assertIs(getattr(policy, name), value)
        self.assertIs(policy.check_robkong, base.check_robkong)
        self.assertEqual(policy._ready_income_derivation["policy"], ready.POLICY_ID)
        self.assertNotEqual(id(ready.load_policy()), id(policy))

    def test_all263_existing_public_frames_are_legal_deterministic_and_A_V7_V8_V7_A_isolated(self):
        original = advanced_policy.load_policy()
        v7, candidate = v1_income_policy.load_policy(), ready.load_policy()
        snapshot = (bindings(original), bindings(original.score))
        for case in CASES:
            before = canonical(case["view"])
            actions = []
            for policy in (original, v7, candidate, candidate, v7, original):
                view = copy.deepcopy(case["view"])
                context = advanced_policy.build_context(view, worker.build_context(view), worker)
                actions.append(worker.choose_action(case["phase"], view, context, policy, advanced=True))
                self.assertEqual(canonical(view), before)
            with self.subTest(case=case["id"]):
                self.assertEqual(actions[0], case["originalAction"])
                self.assertEqual(actions[-1], actions[0])
                self.assertEqual(actions[1], case["candidateAction"])
                self.assertEqual(actions[-2], actions[1])
                self.assertEqual(actions[2], actions[3])
                self.assertEqual((bindings(original), bindings(original.score)), snapshot)

    def test_other_routes_delegate_and_new_hu_never_uses_shared_legacy_score_or_potential_helpers(self):
        policy = ready.load_policy()
        for case in CASES:
            if case["phase"] == "discard" or case["view"].get("decision", {}).get("responseKind") == "rob-kong":
                view = copy.deepcopy(case["view"])
                context = advanced_policy.build_context(view, worker.build_context(view), worker)
                with patch.object(ready, "analyze_waiting_income", side_effect=AssertionError("non-target route")):
                    self.assertEqual(worker.choose_action(case["phase"], view, context, policy, advanced=True), case["candidateAction"])
        original = advanced_policy.load_policy()
        with patch.object(original.score, "compute_handScore", side_effect=AssertionError("legacy score")), \
             patch.object(original.hs, "numS", side_effect=AssertionError("legacy opportunity inflation")):
            self.assertIn(policy.check_hu(*self.mixed()), {"hu", "stand"})

    def test_provenance_is_pinned_and_fixture_is_the_original_public_population(self):
        with patch.object(ready, "_source_bytes", return_value=b"changed"):
            with self.assertRaisesRegex(ValueError, "source|provenance"):
                ready.load_policy()
        fixture = Path(__file__).with_name("test_v1_income_policy.py")
        self.assertEqual(hashlib.sha256(fixture.read_bytes()).hexdigest(), "1efeb75c1af6927aeadea4dfa86ee3aef773b4fd49e85768093052aab8e3bace")


if __name__ == "__main__":
    unittest.main()
