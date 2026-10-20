"""Actual public hu-branch observation, never a second policy recommendation."""

import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

import advanced_policy
import worker
import v1_income_policy
import public_decision_diagnostics as observer
from test_v1_income_policy import CASES


A = "ebony72-advanced-public-v1"
V7 = "ebony72-advanced-current-income-v1"
KONG_SHOT = "e597e5944d796dc52d801937a35ad0a96d49138d6475556b26dee33158166c65"
ROB_KONG = "11c64c3ac12d147987b147d642a5f7a4e89f96858d1ba6a22a978a82dd11a935"


def case_for(identifier):
    return next(case for case in CASES if case["id"] == identifier)


def context(view):
    return advanced_policy.build_context(view, worker.build_context(view), worker)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def globals_snapshot(policy):
    # Exact bindings plus independent ordinary-container contents; opaque
    # function/module identities are checked without serializing those objects.
    def token(value, seen=()):
        if type(value) in (type(None), bool, int, float, str):
            return (type(value), value)
        if type(value) not in (list, tuple, dict, set, frozenset):
            return ("identity", id(value))
        if id(value) in seen:
            return ("cycle", id(value))
        nested = (*seen, id(value))
        if type(value) is dict:
            return {key: token(item, nested) for key, item in value.items()}
        items = [token(item, nested) for item in value]
        return items if type(value) in (list, tuple) else frozenset(items)
    return [
        ({name: id(value) for name, value in vars(module).items()},
         {name: token(value) for name, value in vars(module).items() if name != "__builtins__"})
        for module in (policy, policy.score)
    ]


class PublicDecisionDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.original = advanced_policy.load_policy()
        self.candidate = v1_income_policy.load_policy()

    def observe(self, policy_id, case, api=worker):
        view = copy.deepcopy(case["view"])
        policy = self.original if policy_id == A else self.candidate
        return observer.observe_decision(api, case["phase"], view, context(view), policy, policy_id)

    def test_real_target_branches_are_observed_without_changing_the_one_actual_choice(self):
        for case_id in (KONG_SHOT, ROB_KONG):
            case = case_for(case_id)
            for policy_id in (A, V7):
                calls = []
                def choose(*args, **kwargs):
                    calls.append(1)
                    return worker.choose_action(*args, **kwargs)
                api = SimpleNamespace(choose_action=choose)
                with self.subTest(case=case_id, policy=policy_id):
                    result = self.observe(policy_id, case, api)
                    expected = case["originalAction"] if policy_id == A else case["candidateAction"]
                    self.assertEqual(result["action"], expected)
                    self.assertEqual(calls, [1])
                    diagnostics = result["diagnostics"]
                    self.assertEqual(diagnostics["coverage"], "observed-hu-branch")
                    self.assertEqual(diagnostics["policyId"], policy_id)
                    self.assertEqual(diagnostics["publicViewHash"], hashlib.sha256(canonical(case["view"]).encode()).hexdigest())
                    self.assertIn(diagnostics["branch"]["returnValue"], {"hu", "stand", "robkong"})
                    self.assertEqual(len(diagnostics["branch"]["functionSha256"]), 64)
                    self.assertGreater(diagnostics["branch"]["returnLine"]["source"], 800)
                    if policy_id == A:
                        self.assertEqual(diagnostics["currentIncome"], {"status": "not-called"})
                        self.assertEqual(diagnostics["comparison"]["utlUnit"], "legacy-base-score")
                    else:
                        self.assertEqual(diagnostics["currentIncome"]["basePoints"], 1)
                        self.assertEqual(diagnostics["currentIncome"]["currentPoints"], 2)
                        self.assertEqual(diagnostics["currentIncome"]["payerCount"], 1)
                        if case_id == KONG_SHOT:
                            self.assertEqual(diagnostics["comparison"]["currentEventRatio"], .5)
                            self.assertEqual(diagnostics["comparison"]["utlUnit"], "legacy-base-score")
                        else:
                            self.assertEqual(diagnostics["comparison"]["actualUtl"], 2)
                            self.assertEqual(diagnostics["comparison"]["baseScoreThreshold"], 1)
                            self.assertEqual(diagnostics["comparison"]["utlUnit"], "V1-current-single-payer-points")

    def test_all263_A_and_V7_observed_vs_bare_match_and_A_V7_A_is_isolated(self):
        self.assertEqual(len(CASES), 263)
        before_globals = globals_snapshot(self.original)
        for case in CASES:
            with self.subTest(case=case["id"]):
                before_view = canonical(case["view"])
                for policy_id, policy, expected in ((A, self.original, case["originalAction"]), (V7, self.candidate, case["candidateAction"])):
                    view = copy.deepcopy(case["view"])
                    self.assertEqual(worker.choose_action(case["phase"], view, context(view), policy, advanced=True), expected)
                    observed = self.observe(policy_id, case)
                    self.assertEqual(observed["action"], expected)
                    self.assertEqual(canonical(case["view"]), before_view)
                    self.assertIsNone(sys.gettrace())
                view = copy.deepcopy(case["view"])
                self.assertEqual(worker.choose_action(case["phase"], view, context(view), self.original, advanced=True), case["originalAction"])
                self.assertEqual(globals_snapshot(self.original), before_globals)

    def test_ordinary_hu_never_labels_legacy_utl_as_actual_V1_income(self):
        case = next(case for case in CASES if case["target"] == "delegate" and case["phase"] == "respond")
        for policy_id in (A, V7):
            with patch.object(observer, "_income_projection", side_effect=AssertionError("ordinary branch invented income")):
                result = self.observe(policy_id, case)
            diagnostics = result["diagnostics"]
            self.assertEqual(diagnostics["currentIncome"], {"status": "not-called"})
            self.assertEqual(diagnostics["comparison"]["utlUnit"], "legacy-base-score")
            self.assertEqual(diagnostics["branch"]["returnValue"], "stand")
            self.assertEqual(diagnostics["postHuMeldStage"], "not-observed")

    def test_cap_ratio_comes_from_actual_helper_and_returns_are_source_bound(self):
        for case in CASES:
            if case["target"] != "known-kong-shot":
                continue
            result = self.observe(V7, case)
            data = result["diagnostics"]
            income = data["currentIncome"]
            comparison = data["comparison"]
            self.assertEqual(comparison["currentEventRatio"], income["basePoints"] / income["currentPoints"])
            step = comparison["eventFactorStep"]
            self.assertEqual(step["after"], step["before"] * comparison["currentEventRatio"])
            if income["basePoints"] == 8:
                self.assertEqual(income["currentPoints"], 8)
                self.assertEqual(comparison["currentEventRatio"], 1)
        self.assertEqual(self.observe(V7, case_for(KONG_SHOT))["diagnostics"]["branch"]["returnLine"]["source"], 1010)
        self.assertEqual(self.observe(V7, case_for(ROB_KONG))["diagnostics"]["branch"]["returnLine"]["source"], 1266)

    def test_non_hu_nodes_never_enable_trace_and_do_not_offer_detailed_reasons(self):
        case = next(case for case in CASES if case["phase"] == "discard")
        for policy_id in (A, V7):
            with patch.object(observer.sys, "settrace", side_effect=AssertionError("non-hu tracing")):
                result = self.observe(policy_id, case)
            self.assertEqual(result["diagnostics"]["coverage"], "not-covered")
            self.assertIsNone(result["diagnostics"]["branch"])
            self.assertIsNone(result["diagnostics"]["comparison"])
            self.assertEqual(result["diagnostics"]["currentIncome"], {"status": "not-called"})

    def test_unknown_policy_source_and_private_global_replacements_fail_closed(self):
        case = case_for(KONG_SHOT)
        view = copy.deepcopy(case["view"])
        ctx = context(view)
        with self.assertRaisesRegex(ValueError, "policy|策略"):
            observer.observe_decision(worker, "respond", view, ctx, self.original, "unknown")
        fake = SimpleNamespace(**vars(self.original))
        with self.assertRaisesRegex(ValueError, "policy|source|策略|源码"):
            observer.observe_decision(worker, "respond", view, ctx, fake, A)
        fake = v1_income_policy.load_policy()
        fake.check_hu.__globals__["HU_DECLINE_THRESHOLD"] = 99
        with self.assertRaisesRegex(ValueError, "source|global|源码"):
            observer.observe_decision(worker, "respond", view, ctx, fake, V7)
        with patch.object(observer, "_source_bytes", return_value=b"changed"):
            with self.assertRaisesRegex(ValueError, "source|源码"):
                observer.observe_decision(worker, "respond", view, ctx, self.original, A)

    def test_nonfinite_or_unknown_capture_objects_are_refused_without_repr(self):
        class Bomb:
            def __repr__(self):
                raise AssertionError("unknown object repr was accessed")
        for value in (Bomb(), [], {}, lambda: None, float("nan"), float("inf")):
            with self.subTest(kind=type(value).__name__), self.assertRaises((TypeError, ValueError)):
                observer._primitive(value)
        with self.assertRaises(TypeError):
            observer._income_projection(Bomb(), {}, "discard")

    def test_trace_is_restored_on_capture_or_upstream_error_and_choice_is_not_repeated(self):
        case = case_for(KONG_SHOT)
        calls = []
        def choose(*args, **kwargs):
            calls.append(1)
            return worker.choose_action(*args, **kwargs)
        with patch.object(observer, "_income_projection", side_effect=TypeError("capture refused")):
            with self.assertRaises((TypeError, worker.AdapterError)):
                self.observe(V7, case, SimpleNamespace(choose_action=choose))
        self.assertEqual(calls, [1])
        self.assertIsNone(sys.gettrace())
        calls.clear()
        def fail(*args, **kwargs):
            calls.append(1)
            raise worker.AdapterError("test-failure", "one choice failed")
        with self.assertRaises(worker.AdapterError):
            self.observe(A, case, SimpleNamespace(choose_action=fail))
        self.assertEqual(calls, [1])
        self.assertIsNone(sys.gettrace())

    def test_existing_trace_is_not_overwritten_and_A_does_not_load_V7(self):
        def other_trace(frame, event, arg):
            return None
        previous = sys.gettrace()
        try:
            sys.settrace(other_trace)
            with self.assertRaisesRegex(ValueError, "trace"):
                self.observe(A, case_for(KONG_SHOT))
            self.assertIs(sys.gettrace(), other_trace)
        finally:
            sys.settrace(previous)
        with patch.object(observer, "_load_v7", side_effect=AssertionError("A loaded V7")):
            self.assertEqual(self.observe(A, case_for(KONG_SHOT))["action"], case_for(KONG_SHOT)["originalAction"])

    def test_fixed_fixture_source_is_the_previously_frozen_public_population(self):
        path = Path(__file__).with_name("test_v1_income_policy.py")
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), "1efeb75c1af6927aeadea4dfa86ee3aef773b4fd49e85768093052aab8e3bace")

    def test_actual_income_projection_rejects_invalid_types_domains_and_extra_objects(self):
        result = {
            "base": {"fan": 0, "points": 1, "patterns": ["平胡"]},
            "current": {"fan": 1, "points": 2, "patterns": ["平胡", "杠后炮"]},
            "payment": {"win_kind": "discard", "payer_count": 1, "per_payer": 2, "total": 2},
        }
        self.assertEqual(observer._income_projection(result, {"kongShot": True}, "discard")["currentPoints"], 2)
        for group, field, value in [
            ("base", "points", None), ("base", "points", True),
            ("base", "points", 0), ("current", "points", 16),
            ("current", "fan", -1), ("payment", "payer_count", 3),
            ("payment", "per_payer", 4), ("payment", "total", float("nan")),
            ("base", "patterns", [object()]),
        ]:
            malformed = copy.deepcopy(result)
            malformed[group][field] = value
            with self.subTest(group=group, field=field), self.assertRaises((TypeError, ValueError)):
                observer._income_projection(malformed, {"kongShot": True}, "discard")
        for flags, win_kind in [({"unknown": True}, "discard"), ({"kongShot": 1}, "discard"), ({}, "self")]:
            with self.assertRaises((TypeError, ValueError)):
                observer._income_projection(result, flags, win_kind)

    def test_code_identity_filters_before_locals_and_orphan_helpers_fail(self):
        class UnknownFrame:
            f_code = canonical.__code__
            @property
            def f_locals(self):
                raise AssertionError("Unknown frame locals were accessed")
        self.assertIsNone(observer._Observation([]).trace(UnknownFrame(), "call", object()))
        specs = observer._verified_specs(self.candidate, V7)
        class Orphan:
            f_code = v1_income_policy._income.__code__
            f_back = None
            @property
            def f_locals(self):
                raise AssertionError("Orphan helper locals were accessed")
        with self.assertRaisesRegex(ValueError, "escaped"):
            observer._Observation(specs).trace(Orphan(), "call", object())

    def test_same_provenance_metadata_cannot_hide_changed_bytecode_or_return_lines(self):
        case = case_for(KONG_SHOT)
        for change in ("constant", "line"):
            fake = v1_income_policy.load_policy()
            code = fake.check_hu.__code__
            if change == "constant":
                constants = tuple("hu" if value == "stand" else value for value in code.co_consts)
                fake.check_hu.__code__ = code.replace(co_consts=constants)
            else:
                fake.check_hu.__code__ = code.replace(co_firstlineno=code.co_firstlineno + 1)
            view = copy.deepcopy(case["view"])
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "code|source"):
                observer.observe_decision(worker, "respond", view, context(view), fake, V7)

    def test_python314_slice_constants_are_structural_and_unknown_endpoints_stay_refused(self):
        # Python 3.14 places slices in co_consts. Construct the same exact
        # constant domain on 3.13 without executing any modified bytecode.
        original = canonical.__code__
        def with_slice(value):
            return original.replace(co_consts=(*original.co_consts, value))
        code = with_slice(slice(0, 2, None))
        same = with_slice(slice(0, 2, None))
        changed = with_slice(slice(0, 3, None))
        self.assertEqual(observer._code_token(code), observer._code_token(same))
        self.assertNotEqual(observer._code_token(code), observer._code_token(changed))
        self.assertNotEqual(observer._code_token(code), observer._code_token(with_slice(slice(None))))

        class UnknownEndpoint:
            def __repr__(self):
                raise AssertionError("Unknown slice endpoint repr was accessed")
        for value in (slice(UnknownEndpoint(), 2, None), slice(0, UnknownEndpoint(), None),
                      slice(0, 2, UnknownEndpoint()), slice(0, float("nan"), None)):
            with self.subTest(endpoint=value.__class__.__name__), self.assertRaises((TypeError, ValueError)):
                observer._code_token(with_slice(value))

    def test_invalid_view_or_action_is_not_emitted_and_never_repeats_choice(self):
        case = case_for(KONG_SHOT)
        view = copy.deepcopy(case["view"])
        ctx = context(view)
        view["opponents"][0]["score"] = float("nan")
        calls = []
        def choose(*args, **kwargs):
            calls.append(1)
            return {"type": "respond", "choice": "unknown"}
        api = SimpleNamespace(choose_action=choose)
        with self.assertRaises(ValueError):
            observer.observe_decision(api, "respond", view, ctx, self.original, A)
        self.assertEqual(calls, [])
        with self.assertRaises(ValueError):
            self.observe(A, case, api)
        self.assertEqual(calls, [1])
        self.assertIsNone(sys.gettrace())

    def test_exception_unwind_keeps_original_failure_and_never_inspects_exception_objects(self):
        with self.subTest(boundary="trace-protocol"):
            class FailedFrame:
                f_code = self.original.check_hu.__code__
                f_globals = {"HU_DECLINE_THRESHOLD": 1}
                f_lineno = f_code.co_firstlineno

                @property
                def f_locals(self):
                    raise AssertionError("Exception-frame locals were accessed")

            class UnknownException:
                def __repr__(self):
                    raise AssertionError("Exception object was inspected")

            frame = FailedFrame()
            observation = observer._Observation(observer._verified_specs(self.original, A))
            callback = observation.trace(frame, "call", None)
            self.assertIs(callback(frame, "exception", UnknownException()), callback)
            self.assertIsNone(callback(frame, "return", None))
            self.assertEqual(observation.active, set())
            self.assertNotIn("returnValue", observation.roots[0])
            self.assertEqual(observation.income, {"status": "not-called"})

        with self.subTest(boundary="actual-upstream-error"):
            failure = RuntimeError("original upstream sentinel")
            calls = []
            def choose(*args, **kwargs):
                calls.append(1)
                return worker.choose_action(*args, **kwargs)
            with patch.object(self.original.score, "compute_handScore", side_effect=failure):
                with self.assertRaises(worker.AdapterError) as caught:
                    self.observe(A, case_for(KONG_SHOT), SimpleNamespace(choose_action=choose))
            self.assertEqual(calls, [1])
            self.assertEqual(caught.exception.code, "upstream-error")
            self.assertEqual(str(caught.exception), "RuntimeError: original upstream sentinel")
            self.assertIs(caught.exception.__cause__, failure)
            self.assertIsNone(sys.gettrace())


if __name__ == "__main__":
    unittest.main()
