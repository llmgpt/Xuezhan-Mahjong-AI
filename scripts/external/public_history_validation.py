"""Replay only public events to verify that history matches its snapshot.

This is not a rules engine: the host supplies legal choices and win legality.
No concealed opponent tile is reconstructed or accepted.
"""

from collections import Counter
from dataclasses import dataclass


@dataclass
class HistorySummary:
    actions: list
    pending_added: tuple | None
    kong_shot: bool


def validate(view, api):
    events = view["publicActions"]
    if not isinstance(events, list) or len(events) > 512:
        raise api.AdapterError("invalid-history", "publicActions must be a complete ordered event array")
    counts = [14, 13, 13, 13]
    melds = [[] for _ in range(4)]
    missing = {view["seat"]: view.get("missing")}
    missing.update({other["seat"]: other.get("missing") for other in view["opponents"]})
    table, legacy = [], []
    winners = set()
    draws = 0
    pending = None
    offered = None
    last_rob = None
    after_kong = [False] * 4
    kong_shot = False

    def fail(message):
        raise api.AdapterError("invalid-history", message)

    def effective(seat):
        return counts[seat] + 3 * len(melds[seat])

    def external(tile):
        return api.to_external(tile)

    def offered_meld(actor, tile):
        return next((meld for meld in melds[actor] if meld["type"] == "pung" and meld["tile"] == tile), None)

    def claim(actor, tile, source, kind):
        nonlocal pending
        if pending != (source, tile) or not table or table[-1] != {"seat": source, "tile": tile, "kind": "discard"}:
            fail("Claimed meld does not match the latest unclaimed discard")
        table.pop()
        counts[actor] -= 3 if kind == "kong" else 2
        melds[actor].append({"type": kind, "tile": tile, "from": source, **({"kongKind": "direct"} if kind == "kong" else {})})
        pending = None

    for event in events:
        if not isinstance(event, dict):
            fail("Every public action must be an object")
        kind = event.get("kind")
        keys = {
            "draw": {"seat", "kind"},
            "discard": {"seat", "kind", "tile"},
            "pung": {"seat", "kind", "tile", "from"},
            "kong": {"seat", "kind", "tile", "kongKind", "from"},
            "added-kong-offer": {"seat", "kind", "tile"},
            "win": {"seat", "kind", "tile", "winKind", "from"},
        }.get(kind)
        if keys is None:
            fail("Unknown public action kind; passes and initial deals are not events")
        api.fields(event, keys, keys, "public action")
        if kind != "win" or event.get("winKind") != "rob-kong":
            last_rob = None
        actor = api.integer(event["seat"], 0, 3, "public action seat")
        if actor in winners:
            fail("A winner cannot take another action")
        tile = api.integer(event["tile"], 0, 26, "public action tile") if kind != "draw" else None
        source = event.get("from")
        if "from" in event and source is not None:
            api.integer(source, 0, 3, "public action from")
            if source == actor:
                fail("An action cannot claim from self")
        if kind == "draw":
            if offered is not None:
                seat, added_tile = offered
                if actor != seat:
                    fail("Unresolved added kong must be followed by its replacement draw or rob-kong win")
                meld = offered_meld(seat, added_tile)
                if meld is None:
                    fail("Added kong has no prior pung")
                counts[seat] -= 1
                meld.update(type="kong", kongKind="added")
                offered = None
            if effective(actor) != 13:
                fail("A public draw must start with thirteen effective tiles")
            counts[actor] += 1
            draws += 1
            pending = None
            legacy.append([actor, "draw"])
        elif kind == "discard":
            if offered is not None or effective(actor) != 14:
                fail("A public discard must follow a resolved fourteen-tile turn")
            counts[actor] -= 1
            table.append({"seat": actor, "tile": tile, "kind": "discard"})
            pending = (actor, tile)
            kong_shot = after_kong[actor]
            after_kong[actor] = False
            legacy.append([actor, "discard", external(tile)])
        elif kind == "pung":
            if source is None or offered is not None or effective(actor) != 13:
                fail("Invalid public pung context")
            claim(actor, tile, source, "pung")
            after_kong[actor] = False
            legacy.append([actor, "pong", external(tile)])
        elif kind == "kong":
            if event["kongKind"] not in {"direct", "concealed"} or offered is not None:
                fail("Only completed direct/concealed kongs use the kong event")
            if event["kongKind"] == "direct":
                if source is None or effective(actor) != 13:
                    fail("Invalid public direct kong context")
                claim(actor, tile, source, "kong")
                legacy.append([actor, "kong", external(tile), source])
            else:
                if source is not None or effective(actor) != 14:
                    fail("Invalid public concealed kong context")
                counts[actor] -= 4
                melds[actor].append({"type": "kong", "tile": tile, "from": None, "kongKind": "concealed"})
                legacy.append([actor, "ankong", external(tile)])
            after_kong[actor] = True
            pending = None
        elif kind == "added-kong-offer":
            if offered is not None or effective(actor) != 14 or offered_meld(actor, tile) is None:
                fail("An added-kong offer requires one prior pung and fourteen effective tiles")
            offered = (actor, tile)
            after_kong[actor] = True
            pending = None
            legacy.append([actor, "jiakong", external(tile)])
        elif kind == "win":
            mode = event["winKind"]
            if mode not in {"discard", "self", "rob-kong"}:
                fail("Unknown public win kind")
            if mode == "rob-kong":
                if source is None or effective(actor) != 13:
                    fail("Invalid public rob-kong context")
                if offered == (source, tile):
                    counts[source] -= 1
                    offered = None
                    after_kong[source] = False
                    table.append({"seat": source, "tile": tile, "kind": "discard"})
                    pending = (source, tile)
                    last_rob = (source, tile)
                elif last_rob != (source, tile):
                    fail("Rob-kong win must match a public added-kong offer")
            elif mode == "self":
                if source is not None or offered is not None or effective(actor) != 14:
                    fail("Invalid public self-win context")
                table.append({"seat": actor, "tile": tile, "kind": "self-win"})
                pending = None
            elif source is None or offered is not None or effective(actor) != 13 or pending != (source, tile):
                fail("Discard win must match the current public discard")
            winners.add(actor)
            legacy.append([actor, {"self": "zimo", "discard": "hu", "rob-kong": "robkong"}[mode], external(tile), source])
        if tile is not None and kind not in {"discard", "draw"} and missing.get(actor) == api.SUITS[tile // 9]:
            fail("A public meld or win cannot use the declared missing suit")
        if any(value < 0 or value > 14 for value in counts):
            fail("Public history produces an impossible concealed tile count")
    if draws > 55 or 55 - draws != view["wallRemaining"]:
        fail("Public draw history does not match wallRemaining")
    if table != view["publicTiles"]:
        fail("Public actions do not reproduce the current ordered publicTiles")
    snapshots = {other["seat"]: other for other in view["opponents"]}
    snapshots[view["seat"]] = {"handCount": len(view["hand"]), "melds": view["melds"], "won": False}

    def signature(meld):
        return (meld["type"], meld["tile"], meld["from"], meld.get("kongKind"))

    for seat, snapshot in snapshots.items():
        if counts[seat] != snapshot["handCount"] or (seat in winners) != snapshot["won"]:
            fail("Public actions do not match concealed counts or winner status")
        if Counter(map(signature, melds[seat])) != Counter(map(signature, snapshot["melds"])):
            fail("Public actions do not match public melds and their origins")
    current = view.get("decision", {})
    if current.get("kind") == "respond" and current.get("responseKind") == "discard":
        kong_shot = kong_shot and pending == (current.get("from"), current.get("tile"))
    else:
        kong_shot = False
    return HistorySummary(legacy, offered, kong_shot)
