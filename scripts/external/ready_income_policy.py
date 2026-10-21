"""Current waiting-hand money model, not a full continuation EV estimate.

Caller: strict worker + advanced_policy.build_context, with a host-offered
legal discard win. Only own tiles and public facade fields are read. Future
hand/payers and the original opportunity approximation are held fixed; old
speculative meld/pure-suit/kong-money terms are removed, not recalibrated.
"""

from collections import Counter
import difflib
import hashlib
import inspect
from pathlib import Path
from types import SimpleNamespace

import advanced_policy
import v1_income
import v1_income_policy


POLICY_ID = "ebony72-advanced-ready-income-v1"
HU_DECLINE_THRESHOLD = 1
_PINS = {
    "v1_income_policy": "d1154d77fc5f3c859cf4a25104b40ab0ded354aa277b5754a6640dbd4806e4c3",
    "v1_income": "9666989c49e3ab7b4336fb942b016a374ed4c76989ff87c892e8d30227d98b0c",
}
_LEGACY_LENGTHS = {"draw": 2, "discard": 3, "pong": 3, "kong": 4,
                   "ankong": 3, "jiakong": 3, "hu": 4, "zimo": 4, "robkong": 4}


def _source_bytes(path):
    return path.read_bytes()


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _verify_sources():
    for module in (v1_income_policy, v1_income):
        path = Path(module.__file__).resolve()
        if path != Path(__file__).with_name(module.__name__ + ".py").resolve() or _sha(_source_bytes(path)) != _PINS[module.__name__]:
            raise ValueError("Ready-income dependency source differs from pinned provenance")


def _integer(value, minimum, maximum, name):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(name + " is outside its public integer domain")
    return value


def _sequence(value, name):
    if type(value) not in (list, tuple):
        raise ValueError(name + " must be a public sequence")
    return value


def _event(value):
    event = _sequence(value, "public legacy event")
    if len(event) < 2 or type(event[1]) is not str or event[1] not in _LEGACY_LENGTHS:
        raise ValueError("Unknown public legacy event")
    if len(event) != _LEGACY_LENGTHS[event[1]]:
        raise ValueError("Malformed public legacy event")
    _integer(event[0], 0, 3, "event actor")
    return event


def _own_state(player):
    missing = _integer(player.daque_color, 0, 2, "declared missing suit")
    concealed = [v1_income_policy._host_tile(tile) for tile in _sequence(player.hand, "own hand")]
    melds = []
    known = Counter(concealed)
    for pile in _sequence(player.pile, "own melds"):
        group = _sequence(pile, "own meld")
        if len(group) not in (3, 4):
            raise ValueError("Own public meld must have three or four tiles")
        tile = v1_income_policy._host_tile(group[0])
        if any(v1_income_policy._host_tile(item) != tile for item in group):
            raise ValueError("Own public meld tiles differ")
        known[tile] += len(group)
        melds.append({"type": "kong" if len(group) == 4 else "pung", "tile": tile})
    if len(melds) > 4 or len(concealed) != 13 - 3 * len(melds) or any(count > 4 for count in known.values()):
        raise ValueError("Own thirteen-effective-tile state is invalid")
    return concealed, melds, ("tiao", "wan", "tong")[missing], known


def analyze_waiting_income(player, dealer, last_player, players):
    """Inspect one current legal ron and its static KB-weighted self waits.

    This checks used public fields, not the complete history/host hu legality.
    The caller must first construct the matching strict public context. Report
    objects contain no live facade references and no input is changed.
    """
    _verify_sources()
    seat = _integer(player.player_id, 0, 3, "own seat")
    actor = _integer(last_player, 0, 3, "discard actor")
    if actor == seat:
        raise ValueError("A current discard win cannot respond to self")
    wall = _integer(dealer.numWl, 0, 55, "wallRemaining")
    winners = _integer(dealer.n_hu(), 0, 2, "prior winners")
    payers = 3 - winners
    concealed, melds, missing, known = _own_state(player)
    table = [v1_income_policy._host_tile(tile) for tile in _sequence(dealer.table, "public table")]
    history = _sequence(dealer.act_history, "complete public history")
    if not table or not history:
        raise ValueError("Current discard requires public table and complete history")
    last = _event(history[-1])
    incoming = table[-1]
    if last[0] != actor or last[1] != "discard" or v1_income_policy._host_tile(last[2]) != incoming:
        raise ValueError("Current discard actor/tile differs from latest public action")
    previous = _event(history[-2]) if len(history) > 1 else None
    directly_drawn = previous is not None and previous[0] == actor and previous[1] == "draw"
    ways = _sequence(player.hu_way, "public current win flags")
    if any(type(way) is not str or way != "kongshangpao" for way in ways) or len(ways) > 1:
        raise ValueError("Unknown current public win flags")
    kong_shot = "kongshangpao" in ways
    if kong_shot and not directly_drawn:
        raise ValueError("Current kong-shot requires its directly preceding public draw")
    current_context = {"kongShot": kong_shot, "seaBottom": wall == 0 and directly_drawn}
    current = v1_income.evaluate_v1_income(concealed + [incoming], melds, missing, current_context,
                                          win_kind="discard", active_opponents=payers)
    if current is None:
        raise ValueError("Host-offered current discard has no legal default-V1 completion")
    current_income = current["payment"]["total"]

    external_knowledge = _sequence(player.kgbase(dealer, players), "public knowledge")
    if len(external_knowledge) != 27:
        raise ValueError("Public knowledge requires exactly twenty-seven counts")
    knowledge = [0] * 27
    for index, count in enumerate(external_knowledge):
        _integer(count, 0, 4, "public unseen count")
        tile = v1_income_policy._host_tile([index // 9, index % 9 + 1])
        knowledge[tile] = count
    # Full stock/history consistency belongs to the strict caller. These used
    # local constraints also reject restoring an already public fourth tile.
    known.update(table)
    if any(known[tile] + knowledge[tile] > 4 for tile in range(27)):
        raise ValueError("Public stock plus own/table knowledge exceeds four copies")
    total = sum(knowledge)
    if total < wall:
        raise ValueError("Public unseen stock cannot be smaller than the remaining wall")
    future_context = {"seaBottom": wall == 1}
    waiting, copies, money = [], 0, 0
    for tile, count in enumerate(knowledge):
        if not count:
            continue
        result = v1_income.evaluate_v1_income(concealed + [tile], melds, missing, future_context,
                                             win_kind="self", active_opponents=payers)
        if result is None:
            continue
        per_payer = result["payment"]["per_payer"]
        waiting.append({"tile": tile, "unseenCopies": count,
                        "baseFan": result["base"]["fan"], "basePoints": result["base"]["points"],
                        "fan": result["current"]["fan"], "points": result["current"]["points"],
                        "selfPerPayer": per_payer})
        copies += count
        money += count * per_payer
    draws = wall / (payers + 1)
    discount = .99 ** (55 - wall)
    series = (1 - .8 ** draws) / (1 - .8)
    # N is already in this original opportunity factor. Per-payer money is
    # normalized directly by the actual current single-payer income once.
    factor = payers * discount * (1 - .8 ** draws) / (total * (1 - .8)) if wall else 0.0
    ratio = factor * money / current_income
    return {"model": POLICY_ID, "currentEvaluation": current, "currentContext": current_context,
            "currentIncome": current_income, "futureContext": future_context,
            "waiting": waiting, "waitingCopies": copies, "weightedSelfPerPayer": money,
            "activeOpponents": payers, "wallRemaining": wall, "knowledgeTotal": total,
            "opportunity": {"discount": discount, "drawSeries": series,
                            "approxRemainingDraws": draws, "factor": factor},
            "waitingRatio": ratio, "threshold": HU_DECLINE_THRESHOLD,
            "assumptions": {"shape": "current-hand-and-melds-held-fixed", "payers": "current-count-held-fixed",
                            "opportunity": "original-uncalibrated-approximation",
                            "futureEvents": "last-wall-only-when-one-remains",
                            "speculativeMeldsAndKongMoney": "removed"}}


def check_hu(player, dealer, last_player, players):
    report = analyze_waiting_income(player, dealer, last_player, players)
    return "stand" if report["waitingRatio"] > HU_DECLINE_THRESHOLD else "hu"


def load_policy():
    """Fresh facade: only hu changes; A/V7 modules and score stay untouched."""
    _verify_sources()
    base = v1_income_policy.load_policy()
    original = advanced_policy.load_policy()
    source = inspect.getsource(original.check_hu)
    specification = v1_income_policy._FUNCTIONS["check_hu"]
    prior = source.replace(specification["before"], specification["after"])
    if _sha(prior.encode()) != specification["derived"]:
        raise ValueError("Ready-income V7 base source differs from pinned provenance")
    actual = inspect.getsource(check_hu)
    facade = SimpleNamespace(**vars(base))
    facade.check_hu = check_hu
    facade._ready_income_derivation = {
        "policy": POLICY_ID, "basePolicy": v1_income_policy.POLICY_ID,
        "baseClosureSha256": advanced_policy.PINNED_CLOSURE_SHA256,
        "pinnedDependencies": dict(_PINS), "sourceFileSha256": _sha(_source_bytes(Path(__file__))),
        "checkHuSourceSha256": _sha(actual.encode()),
        "analyzerSourceSha256": _sha(inspect.getsource(analyze_waiting_income).encode()),
        "diff": "".join(difflib.unified_diff(prior.splitlines(keepends=True), actual.splitlines(keepends=True),
                                            fromfile=v1_income_policy.POLICY_ID + "/check_hu",
                                            tofile=POLICY_ID + "/check_hu")),
        "scope": "Current waiting-hand money; old speculative meld/pure/kong terms removed; other V7 actions retained",
        "scoring": "Default V1 fanCap3/selfDrawBonus1; current income once, future per-payer money",
    }
    return facade
