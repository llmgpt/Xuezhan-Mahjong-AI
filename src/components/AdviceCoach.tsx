import type { DiscardAdvice } from "../game/advice";
import { actionKey, type ActionAdvice } from "../game/actionAdvice";
import type { DecisionChoice } from "../game/decision";
import { labelOf, type Tile } from "../game/tiles";
import type { PlayerView } from "../game/view";
import { TilePiece } from "./MahjongTile";
import { GameDialog } from "./GameDialog";
import { NextDrawPanel } from "./NextDrawPanel";
import type { ProductionAdviceState } from "../strategy/productionAdvice";

interface CoachChoice {
  key: string;
  label: string;
  summary: string;
  reason: string;
  limit: string;
  tile?: Tile;
  symbol?: string;
}

export function AdviceCoach({
  advice,
  view,
  actions = [],
  openingChoices = [],
  onOpen,
  onSpeak,
  current,
}: {
  advice: DiscardAdvice[];
  view: PlayerView;
  actions?: ActionAdvice[];
  openingChoices?: DecisionChoice[];
  onOpen?: () => void;
  onSpeak?: (choice: { label: string; reason: string }) => void;
  current?: ProductionAdviceState;
}) {
  if (current && current.status !== "ready") {
    if (current.status === "idle") return null;
    return (
      <aside
        className="inlineAdvice"
        aria-label="当前策略状态"
        role={current.status === "error" ? "alert" : "status"}
      >
        <div className="coachSummary">
          <div>
            <strong>
              {current.status === "loading"
                ? "正在计算当前建议"
                : "当前建议不可用"}
            </strong>
            <p>
              {current.status === "error"
                ? current.error
                : "计算完成后显示本步建议；你仍可手动操作。"}
            </p>
          </div>
        </div>
      </aside>
    );
  }
  const choices: CoachChoice[] =
    current?.status === "ready"
      ? current.presentation.choices.map((item, index) => ({
          ...item,
          key: `current:${index}`,
          tile: item.action.type === "discard" ? item.action.tile : undefined,
          symbol:
            item.action.type === "exchange"
              ? "换"
              : item.action.type === "missing"
                ? "缺"
                : item.action.type === "respond"
                  ? { pass: "过", pung: "碰", kong: "杠", hu: "胡" }[
                      item.action.choice
                    ]
                  : item.action.type === "kong"
                    ? "杠"
                    : undefined,
        }))
      : openingChoices.length
        ? openingChoices.map((item, index) => ({
            ...item,
            key: `opening:${index}`,
            symbol: item.action.type === "exchange" ? "换" : "缺",
          }))
        : actions.length
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
          <span className="actionCoachIcon">{first.symbol ?? "胡"}</span>
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
        onOpen={onOpen}
      >
        <p className="dialogIntro">
          只用你的手牌和公开信息，建议为启发式估算。
        </p>
        <button
          className="speakAdviceButton"
          type="button"
          disabled={!onSpeak}
          onClick={() => onSpeak?.(first)}
        >
          朗读当前建议依据
        </button>
        <div className="advicePanel">
          <div className="adviceCards">
            {choices.map((item, index) => (
              <article className="adviceCard" key={item.key}>
                <div className="adviceTile">
                  {item.tile !== undefined ? (
                    <TilePiece tile={item.tile} className="tile-advice" />
                  ) : (
                    <span className="actionCoachIcon">
                      {item.symbol ?? "胡"}
                    </span>
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
                <p>
                  {current?.status === "ready" &&
                  current.presentation.legalActionCount === 1
                    ? "当前只有这一种合法选择。"
                    : "这里仅展示当前策略首选，你仍可自行选择其他合法方案。"}
                </p>
              </article>
            )}
          </div>
        </div>
        {current?.status === "ready" &&
        current.presentation.origin === "teacher-actions" &&
        current.presentation.choices.every(
          (item) => item.action.type === "discard",
        ) &&
        view.decision?.kind === "self" ? (
          <NextDrawPanel
            view={view}
            candidates={current.presentation.choices
              .slice(0, 2)
              .flatMap((item) =>
                item.action.type === "discard" ? [item.action.tile] : [],
              )}
          />
        ) : (
          !current &&
          !actions.length &&
          !openingChoices.length && (
            <NextDrawPanel
              view={view}
              candidates={advice.slice(0, 2).map((item) => item.tile)}
            />
          )
        )}
      </GameDialog>
    </aside>
  );
}
