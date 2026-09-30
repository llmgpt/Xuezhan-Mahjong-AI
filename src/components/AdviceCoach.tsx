import type { DiscardAdvice } from "../game/advice";
import { labelOf } from "../game/tiles";
import { TilePiece } from "./MahjongTile";

export function AdviceCoach({ advice }: { advice: DiscardAdvice[] }) {
  if (!advice.length) return null;
  return (
    <aside className="inlineAdvice" aria-label="推荐原因">
      <div className="coachSummary">
        <TilePiece tile={advice[0].tile} className="tile-coach" />
        <div>
          <strong>建议打出 {labelOf(advice[0].tile)}</strong>
          <p>{advice[0].summary}</p>
        </div>
      </div>
      <details className="adviceDetails">
        <summary>
          <span>详细依据与备选</span>
          <span>只用你的手牌和公开信息 ⌄</span>
        </summary>
        <div className="advicePanel">
          <div className="adviceCards">
            {advice.slice(0, 2).map((item, index) => (
              <article className="adviceCard" key={item.tile}>
                <div className="adviceTile">
                  <TilePiece tile={item.tile} className="tile-advice" />
                  <span>{index === 0 ? "推荐打出" : "也可考虑"}</span>
                </div>
                <div className="adviceReason">
                  <p className="choiceReason">{item.summary}</p>
                  <p>{item.reason}</p>
                  <small>{item.limit}</small>
                </div>
              </article>
            ))}
            {advice.length === 1 && (
              <article className="adviceCard singleChoice">
                <p>当前只有这一种合法出牌，没有不同牌的备选。</p>
              </article>
            )}
          </div>
        </div>
      </details>
    </aside>
  );
}
