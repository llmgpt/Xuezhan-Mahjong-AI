"""Pinned ebony72 initial policy behind a strict public-information JSONL API.

No game engine, opponent concealed tiles, shuffled wall, or seed enters this
process. The strategy's original code is kept byte-for-byte in vendor/.
"""

from collections import Counter
from contextlib import redirect_stdout
from dataclasses import dataclass
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
from typing import Any


sys.dont_write_bytecode = True
VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "ebony72-mahjong"
PINNED_COMMIT = "2d46ffa0ba84f486c336935d8f3e105f4e39e5a2"
PINNED_CLOSURE_SHA256 = "ab085c0b203155dd8f9396ba01d2cf39cf92349b71d8ff6e10f18738450eabe9"
SUITS = ("wan", "tiao", "tong")
HOST_TO_EXTERNAL_SUIT = (1, 0, 2)
EXTERNAL_TO_HOST_SUIT = (1, 0, 2)


class AdapterError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class HiddenInformationError(AdapterError):
    def __init__(self, message: str):
        super().__init__("hidden-field", message)


def verify_vendor() -> dict[str, Any]:
    manifest = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
    expected = {
        "strategy_initial21_7attr.py", "dfncy/block_dfncy.py",
        "utils/xzutils.py", "utils/xzcard.py", "utils/daque.py",
        "utils/pusolx.py", "license.md",
    }
    if manifest.get("commit") != PINNED_COMMIT or set(manifest.get("files", {})) != expected:
        raise AdapterError("provenance-error", "Unexpected upstream commit or dependency closure")
    if manifest.get("closureSha256") != PINNED_CLOSURE_SHA256:
        raise AdapterError("provenance-error", "Unexpected pinned dependency closure digest")
    for relative, expected_hash in manifest["files"].items():
        actual = hashlib.sha256((VENDOR / relative).read_bytes()).hexdigest()
        if actual != expected_hash:
            raise AdapterError("provenance-error", f"Changed upstream file: {relative}")
    closure = "".join(f"{manifest['files'][name]}  {name}\n" for name in sorted(expected))
    if hashlib.sha256(closure.encode()).hexdigest() != manifest.get("closureSha256"):
        raise AdapterError("provenance-error", "Dependency closure digest does not match")
    return manifest


verify_vendor()
sys.path.insert(0, str(VENDOR))
INITIAL = importlib.import_module("strategy_initial21_7attr")
DAQUE = importlib.import_module("utils.daque")
for module_name in (
    "strategy_initial21_7attr", "dfncy.block_dfncy", "utils.xzutils",
    "utils.xzcard", "utils.daque", "utils.pusolx",
):
    module_file = Path(sys.modules[module_name].__file__).resolve()
    if not module_file.is_relative_to(VENDOR):
        raise AdapterError("provenance-error", f"Module resolved outside pinned vendor: {module_name}")


def integer(value: Any, minimum: int, maximum: int, name: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise AdapterError("invalid-view", f"{name} must be an integer in {minimum}..{maximum}")
    return value


def to_external(tile: int) -> list[int]:
    integer(tile, 0, 26, "tile")
    return [HOST_TO_EXTERNAL_SUIT[tile // 9], tile % 9 + 1]


def from_external(tile: Any) -> int:
    if not isinstance(tile, (list, tuple)) or len(tile) != 2:
        raise AdapterError("illegal-action", "Upstream tile must be a [suit, rank] pair")
    try:
        suit = integer(tile[0], 0, 2, "upstream suit")
        rank = integer(tile[1], 1, 9, "upstream rank")
    except AdapterError as error:
        raise AdapterError("illegal-action", str(error)) from error
    return EXTERNAL_TO_HOST_SUIT[suit] * 9 + rank - 1


def fields(value: Any, allowed: set[str], required: set[str], name: str) -> dict:
    if not isinstance(value, dict):
        raise AdapterError("invalid-view", f"{name} must be an object")
    unknown = set(value) - allowed
    if unknown:
        raise HiddenInformationError(f"Unexpected {name} fields: {', '.join(sorted(unknown))}")
    absent = required - set(value)
    if absent:
        raise AdapterError("invalid-view", f"Missing {name} fields: {', '.join(sorted(absent))}")
    return value


def tile_list(value: Any, name: str, maximum: int = 108) -> list[int]:
    if not isinstance(value, list) or len(value) > maximum:
        raise AdapterError("invalid-view", f"{name} must be a tile array of at most {maximum} entries")
    return [integer(tile, 0, 26, name) for tile in value]


def meld_list(value: Any, name: str) -> list[list[list[int]]]:
    if not isinstance(value, list) or len(value) > 4:
        raise AdapterError("invalid-view", f"{name} must contain at most four melds")
    result = []
    for meld in value:
        fields(meld, {"type", "tile", "from", "kongKind"}, {"type", "tile", "from"}, "meld")
        if meld["type"] not in {"pung", "kong"}:
            raise AdapterError("invalid-view", "Unknown meld type")
        tile = to_external(meld["tile"])
        if meld["from"] is not None:
            integer(meld["from"], 0, 3, "meld.from")
        if "kongKind" in meld and (meld["type"] != "kong" or meld["kongKind"] not in {"direct", "concealed", "added"}):
            raise AdapterError("invalid-view", "Invalid kong kind")
        result.append([tile[:] for _ in range(4 if meld["type"] == "kong" else 3)])
    return result


def missing_suit(value: Any, required: bool = False) -> int | None:
    if value is None and not required:
        return None
    if value not in SUITS:
        raise AdapterError("invalid-view", "missing must be wan, tiao, or tong")
    return HOST_TO_EXTERNAL_SUIT[SUITS.index(value)]


class LengthOnlyWall:
    __slots__ = ("_length",)

    def __init__(self, length: int):
        self._length = length

    def __len__(self):
        return self._length

    def __iter__(self):
        raise HiddenInformationError("Wall order is unavailable")

    def __getitem__(self, key):
        raise HiddenInformationError("Wall tiles are unavailable")


class PublicPlayer:
    __slots__ = ("player_id", "pile")

    def __init__(self, seat: int, pile: list):
        self.player_id = seat
        self.pile = pile

    @property
    def hand(self):
        raise HiddenInformationError("Opponent concealed hand is unavailable")


class OwnPlayer:
    __slots__ = ("player_id", "hand", "pile", "daque_color", "_knowledge")

    def __init__(self, seat: int, hand: list, pile: list, missing: int | None, knowledge: list[int]):
        self.player_id = seat
        self.hand = hand
        self.pile = pile
        self.daque_color = missing
        self._knowledge = tuple(knowledge)

    def kgbase(self, dealer, players):
        return list(self._knowledge)


@dataclass
class Dealer:
    table: list[list[int]]
    deck: LengthOnlyWall


@dataclass
class Context:
    player: OwnPlayer
    dealer: Dealer
    players: list
    history: Any = None


def build_context(view: Any) -> Context:
    allowed = {"seat", "hand", "melds", "missing", "legalDiscards", "ownDiscards", "opponents", "wallRemaining", "decision", "publicTiles", "publicActions"}
    fields(view, allowed, allowed - {"missing", "decision", "publicActions"}, "view")
    seat = integer(view["seat"], 0, 3, "seat")
    hand = [to_external(tile) for tile in tile_list(view["hand"], "hand", 14)]
    pile = meld_list(view["melds"], "melds")
    missing = missing_suit(view.get("missing"))
    if "decision" in view:
        decision = view["decision"]
        if not isinstance(decision, dict) or decision.get("kind") not in {"self", "respond"}:
            raise AdapterError("invalid-view", "Unknown public decision kind")
        keys = {"kind", "canWin", "concealedKongs", "addedKongs"} if decision["kind"] == "self" else {"kind", "responseKind", "from", "tile", "choices"}
        fields(decision, keys, keys, "decision")
    tile_list(view["legalDiscards"], "legalDiscards", 27)
    own_discards = tile_list(view["ownDiscards"], "ownDiscards")
    wall = LengthOnlyWall(integer(view["wallRemaining"], 0, 55, "wallRemaining"))
    opponents = view["opponents"]
    if not isinstance(opponents, list) or len(opponents) != 3:
        raise AdapterError("invalid-view", "Exactly three public opponents are required")
    players = [None] * 4
    expected_discards = Counter((seat, tile) for tile in own_discards)
    winners = set()
    for opponent in opponents:
        keys = {"seat", "handCount", "melds", "discards", "missing", "won", "score"}
        fields(opponent, keys, keys - {"missing"}, "opponent")
        other_seat = integer(opponent["seat"], 0, 3, "opponent.seat")
        if other_seat == seat or players[other_seat] is not None:
            raise AdapterError("invalid-view", "Opponent seats must be distinct and exclude self")
        integer(opponent["handCount"], 0, 14, "opponent.handCount")
        missing_suit(opponent.get("missing"))
        if type(opponent["won"]) is not bool or type(opponent["score"]) not in (int, float) or not math.isfinite(opponent["score"]):
            raise AdapterError("invalid-view", "Invalid opponent public status")
        if opponent["won"]:
            winners.add(other_seat)
        expected_discards.update((other_seat, tile) for tile in tile_list(opponent["discards"], "opponent.discards"))
        players[other_seat] = PublicPlayer(other_seat, meld_list(opponent["melds"], "opponent.melds"))
    public_tiles = view["publicTiles"]
    if not isinstance(public_tiles, list) or len(public_tiles) > 108:
        raise AdapterError("invalid-view", "publicTiles must be an ordered public tile array")
    table = []
    actual_discards = Counter()
    self_wins = set()
    for event in public_tiles:
        fields(event, {"seat", "tile", "kind"}, {"seat", "tile", "kind"}, "public tile")
        actor = integer(event["seat"], 0, 3, "public tile seat")
        tile = integer(event["tile"], 0, 26, "public tile")
        if event["kind"] == "discard":
            actual_discards[(actor, tile)] += 1
        elif event["kind"] == "self-win":
            if actor not in winners or actor in self_wins:
                raise AdapterError("invalid-view", "A self-win tile must belong to one public winner")
            self_wins.add(actor)
        else:
            raise AdapterError("invalid-view", "Unknown public tile kind")
        table.append(to_external(tile))
    if actual_discards != expected_discards:
        raise AdapterError("invalid-view", "publicTiles must match unclaimed discard multiplicity")
    knowledge = [4] * 27
    known_tiles = hand + table + [tile for meld in pile for tile in meld]
    known_tiles += [tile for other in players if other is not None for meld in other.pile for tile in meld]
    for suit, rank in known_tiles:
        index = suit * 9 + rank - 1
        knowledge[index] -= 1
        if knowledge[index] < 0:
            raise AdapterError("invalid-view", "More than four copies of a known tile")
    player = OwnPlayer(seat, hand, pile, missing, knowledge)
    players[seat] = player
    context = Context(player, Dealer(table, wall), players)
    if "publicActions" in view:
        from public_history_validation import validate
        context.history = validate(view, sys.modules[__name__])
    return context


def upstream_call(function, *args):
    try:
        with redirect_stdout(sys.stderr):
            return function(*args)
    except Exception as error:
        raise AdapterError("upstream-error", f"{type(error).__name__}: {error}") from error


def checked_response(value: Any, choices: list[str]) -> dict:
    translated = {"stand": "pass", "pong": "pung", "kong": "kong", "hu": "hu", "robkong": "hu"}
    if not isinstance(value, str) or value not in translated or translated[value] not in choices:
        raise AdapterError("illegal-action", f"Upstream response is not legal: {value!r}")
    return {"type": "respond", "choice": translated[value]}


def choose_action(phase: str, view: dict, context: Context, policy=INITIAL, advanced=False) -> dict:
    player, dealer, players = context.player, context.dealer, context.players
    total = len(player.hand) + 3 * len(player.pile)
    if phase == "exchange":
        raise AdapterError("unsupported", "Upstream initial has no exchange-three algorithm; the host must use a shared opening policy")
    if phase == "choose-missing":
        if total not in {13, 14} or player.pile or player.daque_color is not None:
            raise AdapterError("invalid-view", "choose-missing requires an undeclared starting hand")
        result = upstream_call(DAQUE.daquex, [tile[:] for tile in player.hand])
        suit = integer(result, 0, 2, "upstream missing suit")
        return {"type": "missing", "suit": SUITS[EXTERNAL_TO_HOST_SUIT[suit]]}
    missing_suit(view.get("missing"), required=True)
    decision = view.get("decision")
    if phase == "respond":
        keys = {"kind", "responseKind", "from", "tile", "choices"}
        fields(decision, keys, keys, "response decision")
        if decision["kind"] != "respond" or decision["responseKind"] not in {"discard", "rob-kong"} or total != 13:
            raise AdapterError("invalid-view", "Invalid response decision or concealed hand count")
        actor = integer(decision["from"], 0, 3, "response.from")
        if actor == view["seat"]:
            raise AdapterError("invalid-view", "Cannot respond to self")
        pending = to_external(decision["tile"])
        choices = decision["choices"]
        if not isinstance(choices, list) or not choices or len(set(choices)) != len(choices) or not set(choices) <= {"pass", "hu", "pung", "kong"} or "pass" not in choices:
            raise AdapterError("invalid-view", "Invalid host response choices")
        if decision["responseKind"] == "discard":
            if not view["publicTiles"] or view["publicTiles"][-1] != {"seat": actor, "tile": decision["tile"], "kind": "discard"}:
                raise AdapterError("invalid-view", "The pending discard must be the latest public tile")
        elif not set(choices) <= {"pass", "hu"}:
            raise AdapterError("invalid-view", "Rob-kong permits only pass or hu")
        if "hu" in choices:
            if decision["responseKind"] == "rob-kong":
                result = upstream_call(policy.check_robkong, player, dealer, pending, players)
            else:
                result = upstream_call(policy.check_hu, player, dealer, actor, players)
            if advanced and result == "stand" and decision["responseKind"] == "discard":
                # The source engine asks about melds after hu was declined.
                # V1 collects these choices together, so preserve that sequence.
                if "kong" in choices:
                    result = upstream_call(policy.check_kong, player, dealer, players)
                elif "pung" in choices:
                    result = upstream_call(policy.check_pong, player, dealer, players)
        elif "kong" in choices:
            if len(dealer.deck) == 0 or player.hand.count(pending) != 3 or pending[0] == player.daque_color:
                raise AdapterError("invalid-view", "Host offered an invalid direct kong")
            result = upstream_call(policy.check_kong, player, dealer, players)
        elif "pung" in choices:
            if player.hand.count(pending) < 2 or pending[0] == player.daque_color:
                raise AdapterError("invalid-view", "Host offered an invalid pung")
            result = upstream_call(policy.check_pong, player, dealer, players)
        else:
            result = "stand"
        return checked_response(result, choices)
    if phase != "discard":
        raise AdapterError("unsupported", f"Unsupported phase: {phase}")
    keys = {"kind", "canWin", "concealedKongs", "addedKongs"}
    fields(decision, keys, keys, "self decision")
    if decision["kind"] != "self" or type(decision["canWin"]) is not bool or total != 14:
        raise AdapterError("invalid-view", "Invalid self decision or concealed hand count")
    concealed = tile_list(decision["concealedKongs"], "concealedKongs", 4)
    added = tile_list(decision["addedKongs"], "addedKongs", 4)
    legal_discards = view["legalDiscards"]
    own = view["hand"]
    forced = [tile for tile in own if to_external(tile)[0] == player.daque_color]
    if not legal_discards or legal_discards != sorted(set(forced or own)):
        raise AdapterError("invalid-view", "Host legalDiscards do not match the declared missing suit")
    for tile in concealed:
        if own.count(tile) != 4 or to_external(tile)[0] == player.daque_color or not len(dealer.deck):
            raise AdapterError("invalid-view", "Host offered an invalid concealed kong")
    for tile in added:
        target = [to_external(tile)] * 3
        if tile not in own or target not in player.pile or to_external(tile)[0] == player.daque_color or not len(dealer.deck):
            raise AdapterError("invalid-view", "Host offered an invalid added kong")
    if decision["canWin"]:
        result = upstream_call(policy.check_zimo, player, dealer, None, players)
        if result != "zimo":
            raise AdapterError("illegal-action", f"Unexpected self-win response: {result!r}")
        return {"type": "win"}
    if concealed or added:
        result = upstream_call(policy.check_zikong, player, dealer, players)
        if not isinstance(result, list) or len(result) != 2:
            raise AdapterError("illegal-action", f"Unexpected self-kong response: {result!r}")
        if result != ["stand", "zikong"]:
            tile = from_external(result[1])
            if result[0] == "ankong" and tile in concealed:
                return {"type": "kong", "kind": "concealed", "tile": tile}
            if result[0] == "jiakong" and tile in added:
                return {"type": "kong", "kind": "added", "tile": tile}
            raise AdapterError("illegal-action", f"Upstream self-kong is not in host legal actions: {result!r}")
    result = upstream_call(policy.select_a_card_to_discard, player, dealer, players)
    tile = from_external(result)
    if tile not in legal_discards:
        raise AdapterError("illegal-action", f"Upstream discard is not legal: {tile}")
    return {"type": "discard", "tile": tile}


def handle_request(request: Any) -> dict:
    identifier = request.get("id") if isinstance(request, dict) else None
    if type(identifier) not in (str, int):
        identifier = None
    try:
        fields(request, {"id", "phase", "view", "policy"}, {"id", "phase", "view"}, "request")
        if type(request["id"]) not in (str, int) or not isinstance(request["phase"], str):
            raise AdapterError("invalid-request", "id must be a string/integer and phase must be a string")
        context = build_context(request["view"])
        policy_id = request.get("policy", "ebony72-initial")
        if policy_id == "ebony72-initial":
            action = choose_action(request["phase"], request["view"], context)
        elif policy_id == "fanfou-ba-composite-v1":
            import fanfou_policy
            # Origin/details stay available for direct public-node audits. The
            # existing JSONL contract deliberately exports the action alone.
            action = fanfou_policy.decide(
                request["phase"], request["view"], context, sys.modules[__name__]
            )["action"]
        elif policy_id in {"ebony72-advanced-public-v1", "ebony72-advanced-cap8-discard-v1"}:
            import advanced_policy
            try:
                context = advanced_policy.build_context(request["view"], context, sys.modules[__name__])
                if policy_id == "ebony72-advanced-cap8-discard-v1":
                    import cap8_policy
                    policy = cap8_policy.load_policy()
                else:
                    policy = advanced_policy.load_policy()
            except ValueError as error:
                raise AdapterError("provenance-error", str(error)) from error
            action = choose_action(request["phase"], request["view"], context, policy, advanced=True)
        else:
            raise AdapterError("unsupported", f"Unknown external policy: {policy_id}")
        return {"id": identifier, "action": action}
    except AdapterError as error:
        return {"id": identifier, "error": {"code": error.code, "message": str(error)}}
    except Exception as error:
        return {"id": identifier, "error": {"code": "adapter-error", "message": f"{type(error).__name__}: {error}"}}


def main():
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except (ValueError, TypeError) as error:
            result = {"id": None, "error": {"code": "invalid-json", "message": str(error)}}
        else:
            result = handle_request(request)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
