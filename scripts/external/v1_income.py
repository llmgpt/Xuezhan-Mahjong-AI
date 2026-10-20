"""Exact own-hand score and immediate win payment for the default table V1.

Tile codes are host 0..26, and a completed concealed hand has 14 - 3*m tiles.
The caller includes a ron/robbed tile exactly once in that completed hand.
There is no opponent hand, wall, seed, probability, or policy input.
"""

from collections.abc import Mapping, Sequence
from functools import lru_cache


_SUITS = {"wan": 0, "tiao": 1, "tong": 2}
_EVENTS = (
    ("kongFlower", "杠上花"),
    ("kongShot", "杠后炮"),
    ("robKong", "抢杠胡"),
    ("seaBottom", "海底胡"),
)


def _sequence(value, name):
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ValueError(f"{name} must be a sequence")
    return tuple(value)


def _tile(value):
    if type(value) is not int or not 0 <= value < 27:
        raise ValueError("tile must be an integer in 0..26")
    return value


def _inputs(hand, melds, missing, context, win_kind, active_opponents):
    if not isinstance(missing, str) or missing not in _SUITS:
        raise ValueError("missing must be wan, tiao, or tong")
    if win_kind not in ("self", "discard", "rob-kong"):
        raise ValueError("win_kind must be self, discard, or rob-kong")
    if type(active_opponents) is not int or not 1 <= active_opponents <= 3:
        raise ValueError("active_opponents must count 1..3 not-yet-won opponents")
    flags = {} if context is None else context
    if not isinstance(flags, Mapping) or set(flags) - {key for key, _ in _EVENTS}:
        raise ValueError("context must contain only V1 WinContext flags")
    if any(type(value) is not bool for value in flags.values()):
        raise ValueError("WinContext flags must be booleans")
    flags = dict(flags)
    if flags.get("kongFlower") and win_kind != "self":
        raise ValueError("kongFlower requires a self win")
    if flags.get("kongShot") and win_kind != "discard":
        raise ValueError("kongShot requires a discard win")
    if bool(flags.get("robKong")) != (win_kind == "rob-kong"):
        raise ValueError("rob-kong and robKong must describe the same event")

    concealed = _sequence(hand, "hand")
    exposed = _sequence(melds, "melds")
    if len(exposed) > 4:
        raise ValueError("at most four exposed melds are possible")
    counts = [0] * 27
    for value in concealed:
        counts[_tile(value)] += 1
    total = counts.copy()
    for meld in exposed:
        if not isinstance(meld, Mapping) or not {"type", "tile"} <= set(meld):
            raise ValueError("each meld needs type and tile")
        if set(meld) - {"type", "tile", "from", "kongKind"}:
            raise ValueError("unknown meld field")
        kind = meld["type"]
        if kind not in ("pung", "kong"):
            raise ValueError("V1 meld type must be pung or kong")
        value = _tile(meld["tile"])
        source = meld.get("from")
        if source is not None and (type(source) is not int or not 0 <= source < 4):
            raise ValueError("optional meld from must be null or a seat in 0..3")
        if "kongKind" in meld and (kind != "kong" or meld["kongKind"] not in ("direct", "concealed", "added")):
            raise ValueError("optional kongKind must describe a V1 kong")
        total[value] += 4 if kind == "kong" else 3
    if any(count > 4 for count in total):
        raise ValueError("concealed hand plus melds contains a fifth physical copy")
    return counts, total, len(exposed), flags


def _winning(counts, meld_count):
    if sum(counts) != 14 - 3 * meld_count:
        return False
    if meld_count == 0 and all(count % 2 == 0 for count in counts):
        return True

    @lru_cache(maxsize=None)
    def groups(remaining):
        first = next((tile for tile, count in enumerate(remaining) if count), None)
        if first is None:
            return True
        if remaining[first] >= 3:
            rest = list(remaining)
            rest[first] -= 3
            if groups(tuple(rest)):
                return True
        if first % 9 <= 6 and remaining[first + 1] and remaining[first + 2]:
            rest = list(remaining)
            for tile in (first, first + 1, first + 2):
                rest[tile] -= 1
            if groups(tuple(rest)):
                return True
        return False

    for pair, count in enumerate(counts):
        if count >= 2:
            remaining = counts.copy()
            remaining[pair] -= 2
            if groups(tuple(remaining)):
                return True
    return False


def evaluate_v1_income(hand, melds, missing, context=None, *, win_kind="discard", active_opponents=3):
    """Return ``{base, current, payment}``, or None for a nonwinning hand.

    base/current use host WinEvaluation keys: fan (uncapped), points (3-fan
    capped), patterns (host order). Base omits all event flags; current adds
    their fan before capping points. A gold hook adds no separate fan: its
    pair plus four melds gets all-triplets, ordinary roots and suit bonuses.

    payment has win_kind, payer_count, per_payer, total. Self wins collect
    current.points + 1 from each of active_opponents (1..3); prior winners are
    excluded by the caller. Ron and rob-kong have one payer of current.points.
    Independent kong payments and future outcomes are outside this function.

    Melds require only type/tile. Optional from/kongKind metadata is checked
    for value range and does not affect scoring. Missing suits, wrong completed
    length and nonwinning shapes return None. Malformed values, inconsistent
    event kind, or impossible own physical inventory raise ValueError.

    This is the default V1 (fan cap 3, self-draw bonus 1), not configurable
    regional Mahjong. It does not reconstruct action legality/history: caller
    must supply a legal current win and truthful public event flags. Inputs are
    never changed, and result objects share no state with later calls.
    """
    counts, total, meld_count, flags = _inputs(hand, melds, missing, context, win_kind, active_opponents)
    if any(count and tile // 9 == _SUITS[missing] for tile, count in enumerate(total)):
        return None
    if not _winning(counts, meld_count):
        return None

    fan = 0
    patterns = []
    seven_pairs = meld_count == 0 and all(count % 2 == 0 for count in counts)
    all_triplets = any(
        count >= 2 and all((value - (2 if tile == pair else 0)) % 3 == 0 for tile, value in enumerate(counts))
        for pair, count in enumerate(counts)
    )
    if seven_pairs:
        patterns.append("七对")
        fan += 2
    elif all_triplets:
        patterns.append("对对胡")
        fan += 1
    else:
        patterns.append("平胡")
    if len({tile // 9 for tile, count in enumerate(total) if count}) == 1:
        patterns.append("清一色")
        fan += 2
    roots = total.count(4)
    if roots:
        patterns.append("根" if roots == 1 else f"根×{roots}")
        fan += roots
    base = {"fan": fan, "points": 2 ** min(fan, 3), "patterns": patterns.copy()}
    for key, label in _EVENTS:
        if flags.get(key):
            fan += 1
            patterns.append(label)
    current = {"fan": fan, "points": 2 ** min(fan, 3), "patterns": patterns}
    payer_count = active_opponents if win_kind == "self" else 1
    per_payer = current["points"] + (1 if win_kind == "self" else 0)
    return {
        "base": base,
        "current": current,
        "payment": {"win_kind": win_kind, "payer_count": payer_count, "per_payer": per_payer, "total": payer_count * per_payer},
    }
