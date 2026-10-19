# Fanfou BA composite reference

`fanfou-ba-composite-v1` is a composite reference for this project's V1 rules.
Only a cleared-missing-suit discard is selected by the original `Fan_Fou_basic`
class. The separately written rule shell declares the least frequent suit
(wan, tiao, tong tie order), clears the first sorted legal missing-suit tile,
accepts host-projected wins, prefers sorted concealed then added kongs, and
responds hu, kong, pung, pass. Exchange-three remains a shared host opening.
These rules are not represented as the original competition program.

The original files are pinned to [xingdream/mahjong at
02e3373649699bc73af87db46ee144bba65ae830](https://github.com/xingdream/mahjong/tree/02e3373649699bc73af87db46ee144bba65ae830).
The full MIT license is in `upstream/LICENSE`. `UPSTREAM.json` records all file
hashes, the exact class byte slices and each original method's AST hash. Its
canonical metadata and file closure are pinned by a fixed constant in
`scripts/external/fanfou_policy.py`; editing a file and recomputing its manifest
does not authorize a changed implementation. `.gitattributes` preserves bytes.
`BA_CORE.patch` is empty: no BA or base method body was changed.

Runtime compiles only `derived/base-class.py` and `derived/ba-class.py`. It never
imports the original experiment module, OP/MC classes, engine, four actual
hands, real wall or game seed. The 13-tile-only constructor is bypassed; fresh
request classes are hydrated from the actual 14/11/8/5/2-tile concealed hand and
public melds. Complete real `publicActions` are required and revalidated by the
existing public-history validator. The public stock is current `publicTiles`
plus the four public meld sets, counted once; old claimed discards are not
counted again. Request histories derive from those real public events. Raw
integer discards, own-hand mutations and public-count mutations are checked;
empty, illegal or raising BA output fails without a substitute policy.

The original `choice` is bound to a request-local RNG initialized by a validated
public-snapshot hash. It cannot consume the original game seed or global RNG.
The lookup loader is unchanged; its file handles are closed by the wrapper and
the cached lookup is immutable. Classes, arrays and mutable globals are fresh
for each request. Invocation is sequential: stdout capture is not a thread
sandbox.

This optional reference requires `numpy==2.1.3` from `requirements.txt` only when
the BA runtime is loaded. Importing this adapter and executing its fixed rule
shell do not import NumPy; existing reference policies retain their dependency
boundary. The worker/registry and conditional runtime manifest are integrated
separately.

The [author paper](https://html.rhhz.net/tis/html/20210730.htm) reports a 2020
tournament championship for Fanfou_ba, using Mass Mahjong rules that permit
chow and declared ready and stop after the first win. Its original score is
not a Sichuan Blood Battle result, and the public experiment versions are not
proven byte-identical to the competition submission. This composite has no
strength claim. Old development public-frame compatibility is not a fresh
game evaluation or a high-level player certification.
