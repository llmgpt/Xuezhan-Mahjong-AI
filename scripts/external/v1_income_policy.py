"""Advanced reference with only known current-discard-win income corrected.

The original module and its score/probability helpers are never patched. Two
source-pinned functions are compiled in private globals with one exact statement
replacement each. Future probability, discount, self-draw x2, gold-hook, meld and
discard heuristics remain the original objects and source statements.

Use the existing strict worker plus advanced_policy.build_context first. This
facade receives the same own-hand/public-history objects as the original policy;
it never accepts an engine state, original seed, wall order or opponent hand.
It is a behavior candidate, not evidence of improved long-run playing strength.
"""

import difflib
import hashlib
import inspect
from pathlib import Path
from types import SimpleNamespace

import advanced_policy
from v1_income import evaluate_v1_income


POLICY_ID = "ebony72-advanced-current-income-v1"
PINNED_SOURCE_SHA256 = "12fc6958cc0466292fc2352578a34ac89eb7e73b9938f885fd17852497932fd2"
_FUNCTIONS = {
    "check_hu": {
        "original": "02b4ab62ea1c829456a5f2d3ee5f64a21dc1497fe534d09ca056c8b3ee93e1a8",
        "derived": "49694b3ab5248396f84e5cc56d1e90c77dab432426a0ad3eef1d13e098d09fd7",
        "before": "zimo_factor = zimo_factor * ( 2*(1 + 1/utl) )",
        "after": "zimo_factor = zimo_factor * _known_discard_reward_ratio(player, dealer, last_player)",
    },
    "check_robkong": {
        "original": "81a4a29da0758fbe93ae2dc87342f10c4738f24960117381e265a0b272c25e0e",
        "derived": "0f44ff7af202c5e1794c20fed4ae02a8d07aea3597116245873c5ac8ad691dbc",
        "before": "utl = score.compute_handScore(NH, Pile)",
        "after": "utl = _known_rob_points(player, jiakong_card)",
    },
}


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _source_bytes(path):
    return path.read_bytes()


def _host_tile(value):
    if (
        not isinstance(value, (list, tuple)) or len(value) != 2
        or type(value[0]) is not int or value[0] not in (0, 1, 2)
        or type(value[1]) is not int or not 1 <= value[1] <= 9
    ):
        raise ValueError("Current-income helper requires an external suit/rank tile")
    # The pinned adapter uses external 0=bamboo, 1=characters, 2=dots.
    return (1, 0, 2)[value[0]] * 9 + value[1] - 1


def _income(player, incoming, context, win_kind):
    missing = player.daque_color
    if type(missing) is not int or missing not in (0, 1, 2):
        raise ValueError("Current-income helper requires the declared missing suit")
    hand = [_host_tile(tile) for tile in player.hand] + [_host_tile(incoming)]
    melds = []
    for pile in player.pile:
        if not isinstance(pile, list) or len(pile) not in (3, 4):
            raise ValueError("Current-income helper received an invalid public meld")
        tile = _host_tile(pile[0])
        if any(_host_tile(item) != tile for item in pile):
            raise ValueError("Current-income helper requires identical meld tiles")
        # Legacy public facade keeps the tile group, not original source/kong
        # metadata. Pure V1 scoring requires only type/tile; do not invent from.
        melds.append({"type": "kong" if len(pile) == 4 else "pung", "tile": tile})
    result = evaluate_v1_income(
        hand, melds, ("tiao", "wan", "tong")[missing], context,
        win_kind=win_kind,
    )
    if result is None:
        raise ValueError("Host-offered current win has no legal V1 completion")
    return result


def _known_discard_reward_ratio(player, dealer, last_player):
    """Only called inside the original known kong-shot branch.

    The original model is normalized to its base hand reward. A current event
    changes that denominator by base/current, with no call-transfer payment.
    At the V1 cap the ratio can be one; it is not always a reciprocal two.
    """
    if not dealer.table or "kongshangpao" not in player.hu_way:
        raise ValueError("Current-income ratio requires a known public kong-shot")
    if type(last_player) is not int or last_player not in range(4):
        raise ValueError("Current-income ratio requires the public discard actor")
    last_draw = next(
        (event[0] for event in reversed(dealer.act_history) if event[1] == "draw"),
        None,
    )
    # Merely wallRemaining==0 is insufficient: seaBottom requires the actual
    # last draw actor to discard. A validated kong-shot includes that draw.
    context = {
        "kongShot": True,
        "seaBottom": dealer.numWl == 0 and last_draw == last_player,
    }
    income = _income(player, dealer.table[-1], context, "discard")
    return income["base"]["points"] / income["current"]["points"]


def _known_rob_points(player, incoming):
    """Value the offered rob-kong win including V1's known +1 fan."""
    return _income(player, incoming, {"robKong": True}, "rob-kong")["current"]["points"]


def _derive(original, name):
    specification = _FUNCTIONS[name]
    function = getattr(original, name)
    source = inspect.getsource(function)
    if _sha(source.encode()) != specification["original"]:
        raise ValueError(f"Unexpected pinned current-income function source: {name}")
    if source.count(specification["before"]) != 1:
        raise ValueError(f"Current-income replacement is not unique: {name}")
    derived = source.replace(specification["before"], specification["after"])
    if _sha(derived.encode()) != specification["derived"]:
        raise ValueError(f"Unexpected deterministic current-income derivation: {name}")
    private_globals = dict(function.__globals__)
    private_globals.update(
        _known_discard_reward_ratio=_known_discard_reward_ratio,
        _known_rob_points=_known_rob_points,
    )
    exec(compile(derived, str(original.__file__) + "::" + POLICY_ID, "exec"), private_globals)
    result = private_globals[name]
    information = {
        "replacements": 1,
        "originalSourceSha256": specification["original"],
        "derivedSourceSha256": specification["derived"],
        "diff": "".join(difflib.unified_diff(
            source.splitlines(keepends=True), derived.splitlines(keepends=True),
            fromfile="advanced-public/" + name,
            tofile=POLICY_ID + "/" + name,
        )),
    }
    return result, information


def load_policy():
    """Return a fresh private facade; never mutate the cached old reference."""
    advanced_policy.verify_vendor()
    original = advanced_policy.load_policy()
    path = Path(original.__file__).resolve()
    expected_path = (
        advanced_policy.VENDOR / "derived/ebony72_advanced_public/strategyz0614.py"
    ).resolve()
    if path != expected_path or _sha(_source_bytes(path)) != PINNED_SOURCE_SHA256:
        raise ValueError("Current-income source differs from pinned provenance")
    facade = SimpleNamespace(**vars(original))
    functions = {}
    for name in _FUNCTIONS:
        function, information = _derive(original, name)
        setattr(facade, name, function)
        functions[name] = information
    facade._v1_income_derivation = {
        "policy": POLICY_ID,
        "basePolicy": advanced_policy.POLICY_ID,
        "upstreamCommit": advanced_policy.PINNED_COMMIT,
        "baseClosureSha256": advanced_policy.PINNED_CLOSURE_SHA256,
        "sourceSha256": PINNED_SOURCE_SHA256,
        "functions": functions,
        "scope": "Known current kong-shot/rob-kong income only; future heuristics unchanged",
        "scoring": "v1_income.evaluate_v1_income; V1 default fanCap3 and selfDrawBonus1",
    }
    return facade
