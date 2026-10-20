"""Observe one actual public hu decision, without choosing again.

The caller supplies the strict advanced public context for this view. Only
pinned A/v7 sources are accepted. Waiting factors are uncalibrated heuristics;
absent V1 helper calls never become invented current-payment explanations.
"""

import hashlib
import importlib
import inspect
import json
import math
from pathlib import Path
import sys
from types import CodeType, FunctionType

import advanced_policy


A = "ebony72-advanced-public-v1"
V7 = "ebony72-advanced-current-income-v1"
_STRATEGY_SHA = "12fc6958cc0466292fc2352578a34ac89eb7e73b9938f885fd17852497932fd2"
_METHODS = {
    "check_hu": (
        "02b4ab62ea1c829456a5f2d3ee5f64a21dc1497fe534d09ca056c8b3ee93e1a8",
        "49694b3ab5248396f84e5cc56d1e90c77dab432426a0ad3eef1d13e098d09fd7",
        "zimo_factor = zimo_factor * ( 2*(1 + 1/utl) )",
        "zimo_factor = zimo_factor * _known_discard_reward_ratio(player, dealer, last_player)",
    ),
    "check_robkong": (
        "81a4a29da0758fbe93ae2dc87342f10c4738f24960117381e265a0b272c25e0e",
        "0f44ff7af202c5e1794c20fed4ae02a8d07aea3597116245873c5ac8ad691dbc",
        "utl = score.compute_handScore(NH, Pile)",
        "utl = _known_rob_points(player, jiakong_card)",
    ),
}
_HELPERS = {
    "_known_discard_reward_ratio": "2ecdb06f9bad6fa79e793fab6136d0f3fcfcf6499068cc85f55f54fb447dbfb8",
    "_known_rob_points": "bac09d97a487d64bed19e46aa52b433e700f3e67d03b7ea1d6dab64acca582c6",
    "_income": "2959fb14f3589e98d59879eab84a5df462690b72d5d371e907a65d2c37a7ea1a",
}
_VARIABLES = {
    "check_hu": frozenset({"utl", "numWl", "rnumWl", "numS", "n_hu", "factor", "zimo_factor", "zimo_factorx"}),
    "check_robkong": frozenset({"utl", "numWl", "rnumWl", "numS", "n_hu"}),
}
_GLOBALS = {"check_hu": "HU_DECLINE_THRESHOLD", "check_robkong": "base_score"}
_RETURNS = {"check_hu": {"hu", "stand"}, "check_robkong": {"robkong", "stand"}}
_FLAGS = frozenset({"kongFlower", "kongShot", "robKong", "seaBottom"})


def _source_bytes(path):
    return path.read_bytes()


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _primitive(value):
    if type(value) not in (type(None), bool, int, float):
        raise TypeError("Unknown diagnostic object refused")
    if type(value) is float and not math.isfinite(value):
        raise ValueError("Non-finite diagnostic scalar refused")
    return value


def _code_token(code):
    def constant(value):
        if isinstance(value, CodeType):
            return ("code", _code_token(value))
        if type(value) in (tuple, frozenset):
            nested = tuple(constant(item) for item in value)
            return (type(value), nested if type(value) is tuple else frozenset(nested))
        if type(value) is slice:
            # CPython 3.14 uses exact slice constants, including within lambdas.
            # Preserve each endpoint structurally; never stringify an object.
            return (slice, constant(value.start), constant(value.stop), constant(value.step))
        if type(value) not in (type(None), bool, int, float, str, bytes):
            raise TypeError("Unknown policy code constant refused")
        if type(value) is float:
            _primitive(value)
        return (type(value), value)
    constants = tuple(constant(value) for value in code.co_consts)
    return (code.co_code, constants, code.co_names, code.co_varnames, code.co_argcount,
            code.co_posonlyargcount, code.co_kwonlyargcount, code.co_flags,
            code.co_freevars, code.co_cellvars, code.co_exceptiontable,
            code.co_firstlineno, code.co_linetable)


class _Spec:
    def __init__(self, name, function, text, source_start, digest, expected_code=None):
        if type(function) is not FunctionType or _sha(text.encode()) != digest:
            raise ValueError("Unknown diagnostic function source")
        compiled = compile(text, "<verified-diagnostic-source>", "exec", dont_inherit=True)
        expected = expected_code or next(value for value in compiled.co_consts if isinstance(value, CodeType) and value.co_name == name)
        if _code_token(function.__code__) != _code_token(expected):
            raise ValueError("Actual policy code differs from verified source")
        self.name, self.code, self.digest = name, function.__code__, digest
        self.offset, self.start = self.code.co_firstlineno - 1, source_start
        lines = text.splitlines()
        self.event_line = next((i + 1 for i, line in enumerate(lines) if "zimo_factor = zimo_factor *" in line), None)
        self.kong_line = next((i + 1 for i, line in enumerate(lines) if "zimo_factor += len(Kong_Tile)" in line), None)

    def location(self, line):
        relative = line - self.offset
        return {"function": relative, "source": self.start + relative - 1}


def _load_v7():
    # A / browser E and D must not acquire either optional import.
    module = importlib.import_module("v1_income_policy")
    income = importlib.import_module("v1_income")
    for loaded, digest in (
        (module, "d1154d77fc5f3c859cf4a25104b40ab0ded354aa277b5754a6640dbd4806e4c3"),
        (income, "9666989c49e3ab7b4336fb942b016a374ed4c76989ff87c892e8d30227d98b0c"),
    ):
        path = Path(loaded.__file__).resolve()
        if path != Path(__file__).with_name(loaded.__name__ + ".py").resolve() or _sha(_source_bytes(path)) != digest:
            raise ValueError("Unknown current-income source")
    return module


def _verified_specs(policy, policy_id):
    if policy_id not in {A, V7}:
        raise ValueError("Unknown diagnostics policy")
    advanced_policy.verify_vendor()
    original = advanced_policy.load_policy()
    path = Path(original.__file__).resolve()
    expected = (advanced_policy.VENDOR / "derived/ebony72_advanced_public/strategyz0614.py").resolve()
    original_bytes = _source_bytes(path)
    if path != expected or _sha(original_bytes) != _STRATEGY_SHA:
        raise ValueError("Unknown advanced policy source")
    # CPython can optimize imported module attributes differently when compiling
    # an entire module versus a standalone function fragment. Match the same
    # compilation unit, while never executing this verification compilation.
    original_codes = {value.co_name: value for value in compile(original_bytes, str(path), "exec", dont_inherit=True).co_consts if isinstance(value, CodeType)}
    module = _load_v7() if policy_id == V7 else None
    if policy_id == A and policy is not original:
        raise ValueError("Unknown original policy object/source")
    if module is not None:
        if set(vars(policy)) != set(vars(original)) | {"_v1_income_derivation"}:
            raise ValueError("Unknown derived policy source")
        if any(getattr(policy, key) is not value for key, value in vars(original).items() if key not in _METHODS):
            raise ValueError("Unknown derived policy globals/source")
    specs = []
    for name, (old_sha, new_sha, before, after) in _METHODS.items():
        source, start = inspect.getsourcelines(getattr(original, name))
        text = "".join(source)
        if _sha(text.encode()) != old_sha:
            raise ValueError("Unknown original method source")
        function = getattr(policy, name)
        if module is not None:
            if text.count(before) != 1:
                raise ValueError("Unknown current-income derivation source")
            text = text.replace(before, after)
            globals_ = function.__globals__
            if set(globals_) != set(vars(original)) | {"_known_discard_reward_ratio", "_known_rob_points"}:
                raise ValueError("Unknown derived function globals/source")
            for key, value in vars(original).items():
                if globals_[key] is not (function if key == name else value):
                    raise ValueError("Changed policy global/source")
            for helper in ("_known_discard_reward_ratio", "_known_rob_points"):
                if globals_[helper] is not getattr(module, helper):
                    raise ValueError("Changed current-income helper/source")
        threshold = function.__globals__[_GLOBALS[name]]
        if type(threshold) is not int or threshold != 1:
            raise ValueError("Changed policy global threshold/source")
        specs.append(_Spec(name, function, text, start, new_sha if module else old_sha,
                           None if module else original_codes[name]))
    if module is not None:
        helper_codes = {value.co_name: value for value in compile(_source_bytes(Path(module.__file__)), module.__file__, "exec", dont_inherit=True).co_consts if isinstance(value, CodeType)}
        for name, digest in _HELPERS.items():
            function = getattr(module, name)
            source, start = inspect.getsourcelines(function)
            specs.append(_Spec(name, function, "".join(source), start, digest, helper_codes[name]))
    return specs


def _income_projection(result, flags, win_kind):
    if type(result) is not dict or set(result) != {"base", "current", "payment"}:
        raise TypeError("Unknown actual income object refused")
    if type(flags) is not dict or set(flags) - _FLAGS or any(type(value) is not bool for value in flags.values()):
        raise TypeError("Unknown public event flags refused")
    if win_kind not in {"discard", "rob-kong"}:
        raise ValueError("Unknown observed win kind")
    values = {"status": "observed-actual-helper", "winKind": win_kind, "events": dict(flags)}
    for group in ("base", "current"):
        if type(result[group]) is not dict or set(result[group]) != {"fan", "points", "patterns"}:
            raise TypeError("Unknown actual income group refused")
        if type(result[group]["patterns"]) is not list or any(type(item) is not str for item in result[group]["patterns"]):
            raise TypeError("Unknown score-pattern objects refused")
        for field in ("fan", "points"):
            value = result[group][field]
            if type(value) is not int or value < 0:
                raise TypeError("Invalid actual score scalar")
            values[group + field.title()] = value
        if values[group + "Points"] != 1 << min(values[group + "Fan"], 3):
            raise ValueError("Actual points differ from default V1 cap")
    payment = result["payment"]
    if type(payment) is not dict or set(payment) != {"win_kind", "payer_count", "per_payer", "total"} or payment["win_kind"] != win_kind:
        raise TypeError("Unknown actual payment refused")
    for old, new in (("payer_count", "payerCount"), ("per_payer", "perPayerPoints"), ("total", "totalPoints")):
        if type(payment[old]) is not int:
            raise TypeError("Invalid actual payment scalar")
        values[new] = payment[old]
    if values["payerCount"] != 1 or values["perPayerPoints"] != values["currentPoints"] or values["totalPoints"] != values["currentPoints"]:
        raise ValueError("Invalid single-payer immediate income")
    return values


class _Observation:
    def __init__(self, specs):
        self.specs = {id(spec.code): spec for spec in specs}
        self.active, self.roots = set(), []
        self.income, self.ratio = {"status": "not-called"}, None

    def trace(self, frame, event, arg):
        spec = self.specs.get(id(frame.f_code))
        if event != "call" or spec is None or spec.code is not frame.f_code:
            return None
        root = spec.name in _VARIABLES
        if not root and id(frame.f_back) not in self.active:
            raise ValueError("Observed helper escaped the actual hu branch")
        self.active.add(id(frame))
        call = {"function": spec.name, "functionSha256": spec.digest}
        if root:
            call["threshold"] = _primitive(frame.f_globals[_GLOBALS[spec.name]])
            self.roots.append(call)
        pending, failed = None, False

        def local(current, kind, returned):
            nonlocal pending, failed
            if current.f_code is not spec.code:
                raise ValueError("Trace code identity changed")
            if kind == "exception":
                # Never inspect the exception tuple or snapshot failed-frame
                # locals. Preserve the actual policy exception and traceback.
                pending, failed = None, True
                return local
            if kind == "return" and failed and returned is None:
                self.active.remove(id(current))
                return None
            if kind == "line":
                failed = False
            values = {key: _primitive(current.f_locals[key]) for key in _VARIABLES.get(spec.name, ()) if key in current.f_locals}
            relative = spec.location(current.f_lineno)["function"]
            if pending is not None:
                field, before = pending
                call[field] = {"before": before, "after": values["zimo_factor"], "delta": values["zimo_factor"] - before}
                pending = None
            if kind == "line" and relative in {spec.event_line, spec.kong_line}:
                pending = ("eventFactorStep" if relative == spec.event_line else "futureKongStep", values["zimo_factor"])
            if kind == "return":
                if root:
                    if type(returned) is not str or returned not in _RETURNS[spec.name]:
                        raise TypeError("Unknown hu branch return refused")
                    call.update(returnValue=returned, returnLine=spec.location(current.f_lineno), values=values)
                elif spec.name == "_income":
                    self.income = _income_projection(returned, current.f_locals["context"], current.f_locals["win_kind"])
                elif spec.name == "_known_discard_reward_ratio":
                    self.ratio = _primitive(returned)
                else:
                    _primitive(returned)
                self.active.remove(id(current))
                return None
            return local
        return local


def _hash_view(view):
    text = json.dumps(view, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return _sha(text.encode())


def _checked_action(action):
    if type(action) is not dict or type(action.get("type")) is not str:
        raise TypeError("Unknown action object refused")
    keys = {"win": {"type"}, "discard": {"type", "tile"}, "kong": {"type", "tile", "kind"}, "respond": {"type", "choice"}, "missing": {"type", "suit"}}
    if action["type"] not in keys or set(action) != keys[action["type"]]:
        raise ValueError("Unknown action fields refused")
    if "tile" in action and (type(action["tile"]) is not int or not 0 <= action["tile"] <= 26):
        raise ValueError("Invalid action tile")
    for key, allowed in (("kind", {"concealed", "added"}), ("choice", {"pass", "pung", "kong", "hu"}), ("suit", {"wan", "tiao", "tong"})):
        if key in action and (type(action[key]) is not str or action[key] not in allowed):
            raise ValueError("Unknown action enum refused")
    return action


def _hu_response(phase, view):
    decision = view.get("decision")
    if phase != "respond" or type(decision) is not dict or decision.get("kind") != "respond" or decision.get("responseKind") not in {"discard", "rob-kong"}:
        return False
    choices = decision.get("choices")
    return (type(choices) is list and all(type(choice) is str for choice in choices)
            and len(set(choices)) == len(choices) and {"pass", "hu"} <= set(choices)
            and set(choices) <= ({"pass", "hu"} if decision["responseKind"] == "rob-kong" else {"pass", "hu", "pung", "kong"}))


def observe_decision(api, phase, public_view, context, policy, policy_id):
    """Return action + diagnostics from exactly one actual choose_action call.

    The caller owns strict matching PublicView/context construction. Only a
    host-offered legal hu response enables tracing. Source/capture/choice errors
    propagate without fallback. Detailed downstream meld reasons are outside
    this module. No trace is enabled for other nodes.
    """
    specs = _verified_specs(policy, policy_id)
    if context.history is None or type(public_view.get("publicActions")) is not list:
        raise ValueError("Strict advanced public history/context is required")
    view_hash = _hash_view(public_view)
    eligible = _hu_response(phase, public_view)
    diagnostics = {"version": 1, "policyId": policy_id, "publicViewHash": view_hash,
                   "coverage": "not-covered", "branch": None, "comparison": None,
                   "currentIncome": {"status": "not-called"}, "postHuMeldStage": "not-covered"}
    observation = _Observation(specs) if eligible else None
    previous = sys.gettrace()
    if eligible and previous is not None:
        raise ValueError("Refusing to overwrite an existing trace")
    try:
        if observation is not None:
            sys.settrace(observation.trace)
        action = _checked_action(api.choose_action(phase, public_view, context, policy, advanced=True))
    finally:
        if observation is not None:
            sys.settrace(previous)
    if _hash_view(public_view) != view_hash:
        raise ValueError("Actual decision mutated the public input")
    if observation is not None:
        if len(observation.roots) != 1 or observation.active:
            raise ValueError("Missing or ambiguous actual hu branch")
        root = observation.roots[0]
        values = root["values"]
        branch = {key: root[key] for key in ("function", "functionSha256", "returnValue", "returnLine")}
        branch["sourceFileSha256"] = _STRATEGY_SHA
        comparison = {"actualUtl": values["utl"], "utlUnit": "V1-current-single-payer-points" if policy_id == V7 and root["function"] == "check_robkong" else "legacy-base-score",
                      "numS": values["numS"], "wallRemaining": values["numWl"], "approxRemainingDraws": values["rnumWl"],
                      "finalHeuristicWaitingFactor": values.get("zimo_factor"),
                      "declineThreshold": root["threshold"] if root["function"] == "check_hu" else None,
                      "baseScoreThreshold": root["threshold"] if root["function"] == "check_robkong" else None,
                      "currentEventRatio": observation.ratio, "eventFactorStep": root.get("eventFactorStep"),
                      "futureKongStep": root.get("futureKongStep"), "calibration": "heuristic-not-exact-probability"}
        diagnostics.update(coverage="observed-hu-branch", branch=branch, comparison=comparison,
                           currentIncome=observation.income,
                           postHuMeldStage="not-observed" if root["returnValue"] == "stand" else "not-run")
    return {"action": action, "diagnostics": diagnostics}
