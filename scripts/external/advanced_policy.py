"""Isolated advanced-public derivation; no external game engine is imported."""

import hashlib
import importlib
import json
from pathlib import Path
import sys


POLICY_ID = "ebony72-advanced-public-v1"
VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "ebony72-advanced"
PINNED_COMMIT = "2d46ffa0ba84f486c336935d8f3e105f4e39e5a2"
PINNED_CLOSURE_SHA256 = "94b96f0e3586b89975968a04f1321d29ece825633422447436db7644af8b4c20"
_policy = None


def verify_vendor():
    manifest = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
    if manifest.get("commit") != PINNED_COMMIT or manifest.get("policy") != POLICY_ID or manifest.get("closureSha256") != PINNED_CLOSURE_SHA256:
        raise ValueError("Unexpected advanced-public provenance")
    files = manifest["files"]
    closure = "".join(f"{files[name]}  {name}\n" for name in sorted(files))
    if hashlib.sha256(closure.encode()).hexdigest() != PINNED_CLOSURE_SHA256:
        raise ValueError("Advanced-public dependency manifest differs from the pinned closure")
    for relative, expected in files.items():
        source = (VENDOR / relative).resolve()
        if not source.is_relative_to(VENDOR.resolve()) or hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Changed advanced-public source: {relative}")
    return manifest


def load_policy():
    global _policy
    if _policy is None:
        verify_vendor()
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(VENDOR / "derived"))
        _policy = importlib.import_module("ebony72_advanced_public.strategyz0614")
        for name, module in list(sys.modules.items()):
            if name == "ebony72_advanced_public" or name.startswith("ebony72_advanced_public."):
                if not Path(module.__file__).resolve().is_relative_to((VENDOR / "derived").resolve()):
                    raise ValueError(f"Advanced-public import escaped its isolated package: {name}")
    return _policy


def build_context(view, context, api):
    if "publicActions" not in view or context.history is None:
        raise api.AdapterError("invalid-view", "Advanced-public requires complete real publicActions")
    load_policy()
    from ebony72_advanced_public.own_hand_helpers import OwnHandHelpers
    from ebony72_advanced_public.public_history import PublicHistoryModel

    # A new facade for every request; no hidden hand exists on any opponent.
    class Player(OwnHandHelpers):
        __slots__ = ("player_id", "hand", "pile", "daque_color", "hu_way", "_knowledge", "_concealed", "_added")

        def kgbase(self, dealer, players):
            return list(self._knowledge)

        def ankong_list(self):
            return [tile[:] for tile in self._concealed]

        def jiakong_list(self):
            return [tile[:] for tile in self._added]

    class Dealer(PublicHistoryModel):
        __slots__ = ("table", "deck", "numWl", "_winners")

        def n_hu(self):
            return self._winners

    original = context.player
    player = Player()
    player.player_id = original.player_id
    player.hand = [tile[:] for tile in original.hand]
    player.pile = [[tile[:] for tile in meld] for meld in original.pile]
    player.daque_color = original.daque_color
    player._knowledge = original.kgbase(context.dealer, context.players)
    decision = view.get("decision", {})
    player._concealed = [api.to_external(tile) for tile in api.tile_list(decision.get("concealedKongs", []), "concealedKongs", 4)]
    player._added = [api.to_external(tile) for tile in api.tile_list(decision.get("addedKongs", []), "addedKongs", 4)]
    player.hu_way = ["kongshangpao"] if context.history.kong_shot else []
    if decision.get("responseKind") == "rob-kong":
        if context.history.pending_added != (decision.get("from"), decision.get("tile")):
            raise api.AdapterError("invalid-history", "Rob-kong decision must match the pending public added-kong offer")
        suit, rank = api.to_external(decision["tile"])
        index = suit * 9 + rank - 1
        player._knowledge[index] -= 1
        if player._knowledge[index] < 0:
            raise api.AdapterError("invalid-view", "Added-kong offer exceeds four public copies")
    missing = [None] * 4
    missing[view["seat"]] = original.daque_color
    for opponent in view["opponents"]:
        missing[opponent["seat"]] = api.missing_suit(opponent.get("missing"))
    if decision and any(suit is None for suit in missing):
        raise api.AdapterError("invalid-view", "Advanced gameplay requires all four public missing suits")
    dealer = Dealer(context.history.actions, missing)
    dealer.table = [tile[:] for tile in context.dealer.table]
    dealer.deck = context.dealer.deck
    dealer.numWl = view["wallRemaining"]
    dealer._winners = sum(opponent["won"] for opponent in view["opponents"])
    players = list(context.players)
    players[view["seat"]] = player
    return api.Context(player, dealer, players, context.history)
