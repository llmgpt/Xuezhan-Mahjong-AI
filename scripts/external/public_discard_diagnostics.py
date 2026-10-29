"""Observe fixed A discard frames from one real choice, without extra scoring.

Only selected public numeric/tile locals escape. No frame/player/dealer object,
probability calibration or alternative policy is serialized or evaluated.
"""
import inspect
import math
import sys
from types import CodeType

import advanced_policy
import public_decision_diagnostics as common

A = common.A
_PINS = {
    "select_a_card_to_discard": "41782be08857750fd316a434c45468329f964cd95428b987ec2d46942efe51ad",
    "discard": "5623db7920b45b6b2145de4db38c6974b2fdd34c5ac9c7e2b59497db58e1719c",
    "Discard_Q_tile": "2bd402526a3cf6f4037c48e201cc7cb939f161e43ca1ddb480bdb076b0647082",
    "Discard_minor_tile": "f161924cc280a5e92fb5360bd7421be710721f8a0ecf23c3be08062c8eb48991",
}
_ROOT = "select_a_card_to_discard"
_ROOT_PATHS = {
    666: "missing-suit", 722: "pure-suit", 800: "normal-comparison",
    **{line: "seven-pairs" for line in (736, 738, 741, 747, 749, 755, 757, 764)},
    **{line: "all-triplets" for line in (780, 789, 791)},
}
_NUMBERS = frozenset({"numWl", "n_hu", "rnumWl", "cur_dfncy", "wgt", "c", "c1", "c2", "cx", "dc", "val1", "val2"})


def _number(value):
    if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
        raise TypeError("Only finite public discard numbers are allowed")
    return value


def _tile(value):
    if (type(value) is not list or len(value) != 2 or type(value[0]) is not int
            or value[0] not in (0, 1, 2) or type(value[1]) is not int or not 1 <= value[1] <= 9):
        raise TypeError("Only an exact external tile pair is allowed")
    return (1, 0, 2)[value[0]] * 9 + value[1] - 1


def _vector(value, reversed_pair=False):
    if type(value) is not list or len(value) > 27:
        raise TypeError("Invalid actual discard vector")
    result = []
    for pair in value:
        if type(pair) is not list or len(pair) != 2:
            raise TypeError("Unknown actual discard vector entry")
        tile, number = pair if reversed_pair else (pair[1], pair[0])
        if number is None:
            raise TypeError("Missing actual discard vector value")
        result.append({"tile": _tile(tile), "value": _number(number)})
    return result


def _stock(value):
    if type(value) is not list or len(value) != 27 or any(type(n) is not int or not 0 <= n <= 4 for n in value):
        raise TypeError("Invalid public unseen inventory")
    return value[9:18] + value[:9] + value[18:]


def _specs(policy, policy_id):
    if policy_id != A or policy is not advanced_policy.load_policy():
        raise ValueError("Discard observer requires the original pinned A object")
    # Reuse the existing source/code verifier, not its choice or hu observer.
    common._verified_specs(policy, policy_id)
    path = inspect.getsourcefile(policy.select_a_card_to_discard)
    source = common._source_bytes(advanced_policy.VENDOR / "derived/ebony72_advanced_public/strategyz0614.py")
    codes = {c.co_name: c for c in compile(source, path, "exec", dont_inherit=True).co_consts if isinstance(c, CodeType)}
    specs = []
    for name, digest in _PINS.items():
        function = getattr(policy, name)
        lines, start = inspect.getsourcelines(function)
        specs.append(common._Spec(name, function, "".join(lines), start, digest, codes[name]))
    return specs


def observe_discard_decision(api, phase, public_view, context, policy, policy_id):
    specs = _specs(policy, policy_id)
    if phase != "discard" or public_view.get("decision", {}).get("kind") != "self":
        raise ValueError("Discard observation requires a public self decision")
    if context.history is None or type(public_view.get("publicActions")) is not list:
        raise ValueError("Strict public history/context is required")
    previous = sys.gettrace()
    if previous is not None:
        raise ValueError("Refusing to overwrite an existing trace")
    view_hash = common._hash_view(public_view)
    by_code = {id(s.code): s for s in specs}
    root_code = next(s.code for s in specs if s.name == _ROOT)
    frames, roots, active = [], [], set()

    def trace(frame, event, arg):
        spec = by_code.get(id(frame.f_code))
        if event != "call" or spec is None or spec.code is not frame.f_code:
            return None
        if spec.name != _ROOT and (frame.f_back.f_code is not root_code or id(frame.f_back) not in active):
            raise ValueError("Discard helper escaped the one actual root call")
        active.add(id(frame))
        failed = False

        def local(current, kind, returned):
            nonlocal failed
            if kind == "exception":
                failed = True
                return local
            if kind == "line":
                failed = False
            if kind != "return":
                return local
            active.remove(id(current))
            if failed and returned is None:
                return None  # Preserve the original policy exception.
            values = current.f_locals
            location = spec.location(current.f_lineno)
            # Names are function/path specific: A also uses p for an opponent
            # meld loop and for a scalar inventory index. Never serialize either
            # as a tile merely because the spelling matches a pair branch.
            tile_names = ("t1", "t2") if spec.name == "discard" else (
                ("p", "q") if spec.name == _ROOT and location["source"] in (736, 738, 747, 749, 755, 757, 789, 791) else ()
            )
            ranks = values.get("Q")
            if ranks is not None and (type(ranks) is not list or len(ranks) > 14 or any(type(n) is not int or not 1 <= n <= 9 for n in ranks)):
                raise TypeError("Invalid public missing-suit ranks")
            row = {"function": spec.name, "functionSha256": spec.digest, "sourceFileSha256": common._STRATEGY_SHA,
                   "returnLine": location, "tile": _tile(returned),
                   "numbers": {k: _number(values[k]) for k in sorted(_NUMBERS) if k in values},
                   "tiles": {k: None if values[k] is None else _tile(values[k]) for k in tile_names if k in values},
                   "vectors": {k: _vector(values[k]) for k in ("vec", "B1", "B2") if k in values},
                   "singleCandidates": _vector(values["X1R"], True) if "X1R" in values else None,
                   "missingRanks": list(ranks) if ranks is not None else None,
                   "stock": _stock(values["KB"]) if "KB" in values else None}
            frames.append(row)
            if spec.name == _ROOT:
                roots.append(row)
            return None
        return local

    try:
        sys.settrace(trace)
        action = common._checked_action(api.choose_action(phase, public_view, context, policy, advanced=True))
    finally:
        sys.settrace(previous)
    if common._hash_view(public_view) != view_hash:
        raise ValueError("Actual discard mutated the public input")
    diagnostics = {"version": 1, "policyId": policy_id, "publicViewHash": view_hash,
                   "coverage": "not-covered", "branch": None, "comparison": None,
                   "currentIncome": {"status": "not-called"}, "postHuMeldStage": "not-covered"}
    if action["type"] != "discard":
        if frames or active:
            raise ValueError("Non-discard action unexpectedly executed the discard branch")
        return {"action": action, "diagnostics": diagnostics}
    if len(roots) != 1 or active or len(frames) not in (1, 2):
        raise ValueError("Missing or ambiguous actual discard branch")
    root = roots[0]
    if root["tile"] != action["tile"]:
        raise ValueError("Observed discard differs from the actual action")
    path = _ROOT_PATHS.get(root["returnLine"]["source"])
    expected_child = {"missing-suit": "Discard_Q_tile", "pure-suit": "Discard_minor_tile", "normal-comparison": "discard"}.get(path)
    children = [f for f in frames if f["function"] != _ROOT]
    if path is None or len(children) != (1 if expected_child else 0) or (expected_child and (children[0]["function"] != expected_child or children[0]["tile"] != root["tile"])):
        raise ValueError("Actual discard source path is not covered")
    diagnostics.update(version=2, coverage="observed-discard-branch", discard={"path": path, "root": root, "frames": frames})
    return {"action": action, "diagnostics": diagnostics}
