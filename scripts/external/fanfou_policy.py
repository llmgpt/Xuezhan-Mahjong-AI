"""Pinned original BA discards inside a separately specified V1 rule shell.

No worker, old policy, teacher, engine or NumPy is imported at module startup.
The caller supplies the existing worker API and its strict public Context.
Only ``decide(...)["action"]`` belongs on the existing JSONL response wire.
"""

import ast
from collections import Counter
from contextlib import redirect_stderr, redirect_stdout
import copy
from dataclasses import dataclass
import hashlib
import importlib
import io
import json
import logging
from pathlib import Path
import random
import re
from types import MappingProxyType, SimpleNamespace


POLICY_ID = "fanfou-ba-composite-v1"
VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "fanfou-ba"
PINNED_COMMIT = "02e3373649699bc73af87db46ee144bba65ae830"
PINNED_CLOSURE_SHA256 = "ffcf71fdb5c7817a89ec78ffc30210fe52f5dd1f7d281929b0674a6922c7bcd0"
PINNED_NUMPY_VERSION = "2.1.3"
SUITS = ("wan", "tiao", "tong")
_RUNTIME = None


class DependencyError(ValueError):
    pass


def verify_vendor():
    """Pin canonical metadata as well as all raw/derived/runtime file bytes."""
    manifest = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
    if manifest.get("commit") != PINNED_COMMIT or manifest.get("policy") != POLICY_ID:
        raise ValueError("Unexpected Fanfou provenance")
    content = {key: value for key, value in manifest.items() if key != "closureSha256"}
    canonical = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    if manifest.get("closureSha256") != PINNED_CLOSURE_SHA256 or hashlib.sha256(canonical).hexdigest() != PINNED_CLOSURE_SHA256:
        raise ValueError("Fanfou manifest differs from the fixed dependency closure")
    root = VENDOR.resolve()
    for relative, expected in manifest["files"].items():
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Changed Fanfou dependency: {relative}")
    return manifest


def _checked_class_code(manifest):
    result = {}
    for entry in manifest["derivation"]["classes"]:
        raw = (VENDOR / entry["source"]).read_bytes()
        selected_path = VENDOR / entry["derived"]
        selected = selected_path.read_bytes()
        expected = b"".join(raw.splitlines(keepends=True)[entry["line"] - 1:entry["endLine"]])
        nodes = ast.parse(selected.decode("utf-8-sig")).body
        if selected != expected or len(nodes) != 1 or not isinstance(nodes[0], ast.ClassDef) or nodes[0].name != entry["name"]:
            raise ValueError("Fanfou derived class is not its unchanged original byte slice")
        methods = {node.name: node for node in nodes[0].body if isinstance(node, ast.FunctionDef)}
        if set(methods) != {row["name"] for row in entry["methods"]}:
            raise ValueError("Fanfou class method set changed")
        for row in entry["methods"]:
            digest = hashlib.sha256(ast.dump(methods[row["name"]], include_attributes=False).encode()).hexdigest()
            if digest != row["astSha256"]:
                raise ValueError(f"Changed Fanfou method: {entry['name']}.{row['name']}")
        result[entry["name"]] = compile(selected, str(selected_path), "exec")
    if set(result) != {"MahJong_NO_State_Base", "Fan_Fou_basic"}:
        raise ValueError("Only the original BA and base classes may be loaded")
    return result


@dataclass(frozen=True)
class Runtime:
    numpy: object
    class_code: object
    hu_table: object


def load_runtime():
    """Recheck the fixed closure even when compiled code and lookup are warm."""
    global _RUNTIME
    manifest = verify_vendor()
    if _RUNTIME is not None:
        return _RUNTIME
    try:
        numpy = importlib.import_module("numpy")
    except ImportError as error:
        raise DependencyError("Fanfou BA requires optional numpy==2.1.3") from error
    if numpy.__version__ != PINNED_NUMPY_VERSION:
        raise DependencyError(f"Fanfou BA requires numpy==2.1.3, found {numpy.__version__}")
    class_code = _checked_class_code(manifest)
    import codecs
    from itertools import islice
    config = VENDOR / "upstream/完整实验2.1/ai-demo/config/game_config.py"
    loader = next(node for node in ast.parse(config.read_bytes().decode("utf-8-sig")).body if isinstance(node, ast.FunctionDef) and node.name == "LoadData")
    opened = []

    def tracked_open(*args, **kwargs):
        handle = codecs.open(*args, **kwargs)
        opened.append(handle)
        return handle

    namespace = {"codecs": SimpleNamespace(open=tracked_open), "islice": islice}
    exec(compile(ast.Module(body=[loader], type_ignores=[]), str(config), "exec"), namespace)
    try:
        original_table = namespace["LoadData"](str(config.with_name("HuIndex.csv")))
    finally:
        for handle in opened:
            handle.close()
    table = MappingProxyType({key: tuple(value) for key, value in original_table.items()})
    _RUNTIME = Runtime(numpy, MappingProxyType(class_code), table)
    return _RUNTIME


def _history(view, context, api):
    if "publicActions" not in view or context.history is None:
        raise api.AdapterError("invalid-view", "Fanfou composite requires complete real publicActions")
    # Validate the actual current events, never synthesize history from buckets
    # or accept a stale previously built context as evidence for edited events.
    from public_history_validation import validate
    history = validate(view, api)
    known = Counter(view["hand"])
    known.update(item["tile"] for item in view["publicTiles"])
    for owner in [{"melds": view["melds"]}] + view["opponents"]:
        for meld in owner["melds"]:
            known[meld["tile"]] += 4 if meld["type"] == "kong" else 3
    if history.pending_added is not None and history.pending_added[0] != view["seat"]:
        # During rob-kong responses the offer is public but not yet a kong or
        # ordinary discard. For its owner that same tile is already in own hand.
        known[history.pending_added[1]] += 1
    if any(value > 4 for value in known.values()) or sum(known.values()) > 108:
        raise api.AdapterError("invalid-view", "Own hand and revealed public tiles exceed the 108-tile inventory")
    return history


def _ba_history(events):
    """Translate only real public events; unknown draw tiles stay absent."""
    actions = []
    labels = {"draw": "Draw", "discard": "Discard", "pung": "Pen", "kong": "Kon", "added-kong-offer": "BuKon", "win": "Win"}
    for event in events:
        prefix = f"{event['seat']},{labels[event['kind']]}"
        if "tile" in event:
            tile = event["tile"]
            prefix += f",{'BCD'[tile // 9]}{tile % 9 + 1}"
        actions.append(prefix)
    return actions


@dataclass
class BAContext:
    agent: object
    base: object
    namespace: dict
    projected: dict
    audit: dict


def build_ba_context(view, context, api):
    _history(view, context, api)
    try:
        runtime = load_runtime()
    except DependencyError as error:
        raise api.AdapterError("dependency-error", str(error)) from error
    except ValueError as error:
        raise api.AdapterError("provenance-error", str(error)) from error
    seat = api.integer(view["seat"], 0, 3, "seat")
    hand = api.tile_list(view["hand"], "hand", 14)
    legal = api.tile_list(view["legalDiscards"], "legalDiscards", 27)
    api.missing_suit(view.get("missing"), required=True)
    if len(hand) not in {2, 5, 8, 11, 14} or len(hand) + 3 * len(view["melds"]) != 14:
        raise api.AdapterError("invalid-view", "BA requires the actual 14/11/8/5/2-tile discard hand")
    if any(tile // 9 == SUITS.index(view["missing"]) for tile in hand):
        raise api.AdapterError("invalid-view", "Raw BA only selects cleared-missing-suit discards")
    if legal != sorted(set(hand)):
        raise api.AdapterError("invalid-view", "Raw BA legalDiscards do not match its cleared hand")
    owners = [{"seat": seat, "melds": view["melds"]}] + view["opponents"]
    public_counts = [0] * 27
    melds = []
    for owner in owners:
        for item in owner["melds"]:
            tile = item["tile"]
            count = 4 if item["type"] == "kong" else 3
            public_counts[tile] += count
            melds.append({"seat": owner["seat"], "type": item["type"], "tile": tile, "from": item["from"], "count": count})
    stocks = [dict(item) for item in view["publicTiles"]]
    for item in stocks:
        public_counts[item["tile"]] += 1
    known = public_counts.copy()
    for tile in hand:
        known[tile] += 1
    if any(value > 4 for value in known) or sum(known) > 108:
        raise api.AdapterError("invalid-view", "Own hand and public stock exceed the 108-tile inventory")
    opponents = [{"seat": other["seat"], "won": other["won"]} for other in view["opponents"]]
    projected = {"seat": seat, "hand": hand, "missing": view["missing"], "legalDiscards": legal,
                 "melds": melds, "publicTiles": stocks, "opponents": opponents,
                 "hostCanWin": bool(view.get("decision", {}).get("canWin", False))}
    fingerprint = hashlib.sha256(json.dumps(projected, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    rng = random.Random(int(fingerprint, 16))
    audit = {"concealedBefore": len(hand), "publicCountsBefore": public_counts.copy(),
             "knownTiles": sum(known), "pastWinners": sum(other["won"] for other in opponents),
             "publicActionCount": len(view["publicActions"]), "publicFingerprint": fingerprint,
             "randomChoiceCalls": 0, "classGlobalsRecreated": True}

    def choice(values):
        audit["randomChoiceCalls"] += 1
        return rng.choice(values)

    numpy = runtime.numpy
    namespace = {"__name__": "isolated_fanfou_ba_request", "np": numpy, "copy": copy,
                 "choice": choice, "random": rng, "json": json, "re": re, "logging": logging,
                 "HuTable": runtime.hu_table, "card_kind": 27}
    exec(runtime.class_code["MahJong_NO_State_Base"], namespace)
    exec(runtime.class_code["Fan_Fou_basic"], namespace)
    base = namespace["MahJong_NO_State_Base"]
    base.ShowCount = numpy.zeros((4, 9), dtype=numpy.int8)
    base.ShowCount[:3] = numpy.array(public_counts, dtype=numpy.int8).reshape(3, 9)
    base.history = _ba_history(view["publicActions"])
    last = view["publicActions"][-1] if view["publicActions"] else {}
    base.Now_deal = f"{'BCD'[last['tile'] // 9]}{last['tile'] % 9 + 1}" if "tile" in last else ""
    agent = namespace["Fan_Fou_basic"].__new__(namespace["Fan_Fou_basic"])
    agent.player_seat = seat
    agent.StateData = numpy.zeros((4, 7, 4, 9), dtype=numpy.int8)
    for tile in hand:
        agent.StateData[seat, 0, tile // 9, tile % 9] += 1
    for item in melds:
        slot = 3 if item["type"] == "kong" else 2
        agent.StateData[item["seat"], slot, item["tile"] // 9, item["tile"] % 9] += item["count"]
    own_melds = [item for item in melds if item["seat"] == seat]
    agent.majiang = hand.copy()
    agent.peng = [f"{seat},Pen,{agent._get_card_str(item['tile'] // 9, item['tile'] % 9)}" for item in own_melds if item["type"] == "pung"]
    agent.gang = [f"{seat},Kon,{agent._get_card_str(item['tile'] // 9, item['tile'] % 9)}" for item in own_melds if item["type"] == "kong"]
    agent.chi = []
    return BAContext(agent, base, namespace, projected, audit)


def raw_discard(view, context, api):
    """Audit helper for the BA integer return, including counterfactual frames."""
    state = build_ba_context(view, context, api)
    output = io.StringIO()
    history_before = state.base.history.copy()
    try:
        with redirect_stdout(output), redirect_stderr(output):
            raw = state.agent.del_ourself_drw()
    except Exception as error:
        raise api.AdapterError("upstream-error", f"Original BA raised {type(error).__name__}: {error}") from error
    if raw is None:
        raise api.AdapterError("upstream-error", "Original BA returned no tile; no fallback applied")
    if type(raw) is not int or raw not in state.projected["legalDiscards"]:
        raise api.AdapterError("illegal-action", f"Original BA returned an illegal tile: {raw!r}; no fallback applied")
    expected_hand = state.projected["hand"].copy()
    expected_hand.remove(raw)
    expected_counts = state.audit["publicCountsBefore"].copy()
    expected_counts[raw] += 1
    expected_concealed = [Counter(expected_hand)[tile] for tile in range(27)]
    expected_history = history_before + [f"{view['seat']},Discard,{'BCD'[raw // 9]}{raw % 9 + 1}"]
    if state.agent.majiang != expected_hand or state.agent.StateData[view["seat"], 0, :3].reshape(-1).tolist() != expected_concealed or state.base.ShowCount[:3].reshape(-1).tolist() != expected_counts or state.base.history != expected_history:
        raise api.AdapterError("upstream-error", "Original BA mutation does not match its raw discard")
    return {"raw": raw, "stdout": output.getvalue(),
            "audit": {**state.audit, "concealedAfter": len(expected_hand)}}


def decide(phase, view, context, api):
    """Return action plus internal origin metadata; the caller strips metadata.

    ``api`` is the current worker module: AdapterError, choose_action,
    integer/tile_list/missing_suit/to_external, fields and SUITS. ``context`` is
    its strict Context(player, dealer, players, history) built from this view.
    No INITIAL/DAQUE/teacher decision function is called by this module.
    """
    if phase not in {"choose-missing", "discard", "respond"}:
        raise api.AdapterError("unsupported", f"Fanfou composite does not implement {phase}; exchange is supplied by the shared host opening")
    history = _history(view, context, api)
    try:
        verify_vendor()
    except ValueError as error:
        raise api.AdapterError("provenance-error", str(error)) from error
    if phase == "choose-missing":
        total = len(context.player.hand) + 3 * len(context.player.pile)
        if total not in {13, 14} or context.player.pile or context.player.daque_color is not None or view.get("decision") is not None or view["legalDiscards"]:
            raise api.AdapterError("invalid-view", "choose-missing requires an undeclared starting hand")
        counts = [sum(tile // 9 == suit for tile in view["hand"]) for suit in range(3)]
        suit = min(range(3), key=lambda index: (counts[index], index))
        return {"action": {"type": "missing", "suit": SUITS[suit]}, "origin": "missing", "policy": POLICY_ID,
                "details": {"rule": "fewest-suit-wan-tiao-tong", "counts": counts}}
    api.missing_suit(view.get("missing"), required=True)
    forced = [tile for tile in view["hand"] if tile // 9 == SUITS.index(view["missing"])]
    decision = view.get("decision", {})
    if decision.get("responseKind") == "rob-kong" and history.pending_added != (decision.get("from"), decision.get("tile")):
        raise api.AdapterError("invalid-history", "Rob-kong decision must match the pending real added-kong offer")
    if phase == "discard" and history.pending_added is not None:
        raise api.AdapterError("invalid-history", "A pending added kong requires responses before another self action")
    if forced and (decision.get("canWin") or "hu" in decision.get("choices", [])):
        raise api.AdapterError("invalid-view", "A hand containing the missing suit cannot be offered hu")
    raw_result = None
    raw_error = None

    class RuleShell:
        @staticmethod
        def check_hu(*args):
            return "hu"

        @staticmethod
        def check_robkong(*args):
            return "robkong"

        @staticmethod
        def check_zimo(*args):
            return "zimo"

        @staticmethod
        def check_kong(*args):
            return "kong"

        @staticmethod
        def check_pong(*args):
            return "pong"

        @staticmethod
        def check_zikong(*args):
            if decision["concealedKongs"]:
                return ["ankong", api.to_external(min(decision["concealedKongs"]))]
            return ["jiakong", api.to_external(min(decision["addedKongs"]))]

        @staticmethod
        def select_a_card_to_discard(*args):
            nonlocal raw_result, raw_error
            if forced:
                return api.to_external(min(view["legalDiscards"]))
            try:
                raw_result = raw_discard(view, context, api)
            except api.AdapterError as error:
                # The shared upstream_call wrapper translates any callback
                # exception. Preserve this adapter's precise failure below.
                raw_error = error
                raise
            return api.to_external(raw_result["raw"])

    # Explicit independent selectors replace every old strategy callback. The
    # shared function supplies only host phase/count/legal-set validation.
    try:
        action = api.choose_action(phase, view, context, RuleShell, advanced=False)
    except api.AdapterError as error:
        if raw_error is not None:
            raise raw_error from error
        raise
    if phase == "respond":
        origin = "response"
        details = {"choice": action["choice"], "responseKind": decision["responseKind"]}
    elif action["type"] == "win":
        origin, details = "self-win", {"rule": "accept-host-legal-win"}
    elif action["type"] == "kong":
        origin, details = "self-kong", {"rule": "concealed-before-added-sorted", "kind": action["kind"]}
    elif forced:
        origin, details = "forced-missing", {"rule": "first-sorted-legal-missing"}
    else:
        origin, details = "ba-discard", raw_result
    return {"action": action, "origin": origin, "policy": POLICY_ID, "details": details}
