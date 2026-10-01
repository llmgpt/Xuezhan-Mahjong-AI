import type { DiscardAdvice } from "../game/advice";
import { actionKey, type ActionAdvice } from "../game/actionAdvice";
import { labelOf } from "../game/tiles";
import { TilePiece } from "./MahjongTile";
import { GameDialog } from "./GameDialog";

export function AdviceCoach({
  advice,
  actions = [],
}: {
  advice: DiscardAdvice[];
  actions?: ActionAdvice[];
}) {
  const choices = actions.length
    ? actions.map((item) => ({ ...item, key: actionKey(item.action) }))
    : advice.slice(0, 2).map((item) => ({
        ...item,
        label: `打出 ${labelOf(item.tile)}`,
        key: String(item.tile),
      }));
  if (!choices.length) return null;
  const first = choices[0];
  return (
    <aside className="inlineAdvice" aria-label="推荐原因">
      <div className="coachSummary">
        {first.tile !== undefined ? (
          <TilePiece tile={first.tile} className="tile-coach" />
        ) : (
          <span className="actionCoachIcon">胡</span>
        )}
        <div>
          <strong>建议{first.label}</strong>
          <p>{first.summary}</p>
        </div>
      </div>
      <GameDialog
        title="详细依据与备选"
        trigger="查看依据"
        triggerClassName="adviceDetailsButton"
      >
        <p className="dialogIntro">
          只用你的手牌和公开信息，建议为启发式估算。
        </p>
        <div className="advicePanel">
          <div className="adviceCards">
            {choices.map((item, index) => (
              <article className="adviceCard" key={item.key}>
                <div className="adviceTile">
                  {item.tile !== undefined ? (
                    <TilePiece tile={item.tile} className="tile-advice" />
                  ) : (
                    <span className="actionCoachIcon">胡</span>
                  )}
                  <span>
                    {index === 0 ? "推荐" : "备选"} · {item.label}
                  </span>
                </div>
                <div className="adviceReason">
                  <p className="choiceReason">{item.summary}</p>
                  <p>{item.reason}</p>
                  <small>{item.limit}</small>
                </div>
              </article>
            ))}
            {choices.length === 1 && (
              <article className="adviceCard singleChoice">
                <p>当前只有这一种合法选择。</p>
              </article>
            )}
          </div>
        </div>
      </GameDialog>
    </aside>
  );
}
