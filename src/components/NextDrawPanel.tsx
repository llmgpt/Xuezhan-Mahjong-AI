import { useState } from "react";
import { analyzeNextDraw, type NextDrawEstimate } from "../game/lookahead";
import { labelOf, suitOf, type Tile } from "../game/tiles";
import type { PlayerView } from "../game/view";

export function NextDrawPanel({
  view,
  candidates,
}: {
  view: PlayerView;
  candidates: readonly Tile[];
}) {
  const [cached, setCached] = useState<{
    view: PlayerView;
    estimates: NextDrawEstimate[];
  } | null>(null);
  const estimates = cached?.view === view ? cached.estimates : null;
  if (
    candidates.length < 2 ||
    !view.missing ||
    view.wallRemaining < 2 ||
    view.hand.some((tile) => suitOf(tile) === view.missing)
  )
    return null;

  return (
    <section className="lookaheadPanel" aria-label="未来两摸牌效比较">
      <button
        type="button"
        onClick={() =>
          setCached({ view, estimates: analyzeNextDraw(view, candidates) })
        }
      >
        比较未来两次摸牌
      </button>
      {estimates && (
        <>
          <p>
            只按当时未见牌均匀枚举；假设下次轮到你时仍能摸牌，并忽略他家操作、点炮风险和番型收益。
          </p>
          <div className="lookaheadResults">
            {estimates.map((item) => (
              <p key={item.tile}>
                打{labelOf(item.tile)}：下一摸直接成胡的未见牌{" "}
                {item.winningDraws}/{item.drawsConsidered}{" "}
                张；简化两摸模型成胡占比{" "}
                {(item.twoDrawWinChance * 100).toFixed(1)}%。
              </p>
            ))}
          </div>
          {estimates.every((item) => item.twoDrawWinChance === 0) && (
            <p>两张牌在这个两摸模型中都无法成胡，不能据此判断长期优劣。</p>
          )}
          <small>
            未见牌可能在别人手里；这些数字不是真实摸牌概率，也不用于当前推荐排序。
          </small>
        </>
      )}
    </section>
  );
}
