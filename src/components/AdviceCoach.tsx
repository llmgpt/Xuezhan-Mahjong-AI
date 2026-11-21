import type { DiscardAdvice } from "../game/advice";
import { actionKey, type ActionAdvice } from "../game/actionAdvice";
import type { DecisionAction, DecisionChoice } from "../game/decision";
import { labelOf, type Tile } from "../game/tiles";
import type { PlayerView } from "../game/view";
import { TilePiece } from "./MahjongTile";
import { NextDrawPanel } from "./NextDrawPanel";
import { TileBreakdownPanel } from "./TileBreakdownPanel";
import {
  buildTileBreakdown,
  summarizeBreakdownHeadline,
} from "./tileBreakdown";
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
  hidden = false,
  onReveal,
}: {
  advice: DiscardAdvice[];
  view: PlayerView;
  actions?: ActionAdvice[];
  openingChoices?: DecisionChoice[];
  onOpen?: () => void;
  onSpeak?: (choice: { label: string; reason: string }) => void;
  current?: ProductionAdviceState;
  hidden?: boolean;
  onReveal?: () => void;
}) {
  if (current?.status === "idle") return null;
  if (current?.status === "error") {
    return (
      <aside className="inlineAdvice" aria-label="当前策略状态" role="alert">
        <div className="coachSummary">
          <div>
            <strong>当前建议不可用</strong>
            <p>{current.error}</p>
          </div>
        </div>
      </aside>
    );
  }
  const hasAnyDecision =
    current !== undefined ||
    openingChoices.length > 0 ||
    actions.length > 0 ||
    advice.length > 0;
  if (hidden && hasAnyDecision) {
    return (
      <aside className="inlineAdvice thinkFirstPrompt" aria-label="先想一想">
        <div className="coachSummary">
          <div>
            <strong>先自己想一想</strong>
            <p>
              {current?.status === "loading"
                ? "建议在后台准备中；你可先自己判断再揭晓，或直接出牌并在复盘对照。"
                : "先自行判断这手怎么选，再点击揭晓推荐，或直接出牌后看“刚这手复盘”。"}
            </p>
          </div>
        </div>
        <button className="revealAdviceButton" type="button" onClick={onReveal}>
          揭晓本步建议
        </button>
      </aside>
    );
  }
  if (current && current.status !== "ready") {
    return (
      <aside className="inlineAdvice" aria-label="当前策略状态" role="status">
        <div className="coachSummary">
          <div>
            <strong>正在计算当前建议</strong>
            <p>计算完成后显示本步建议；你仍可手动操作。</p>
          </div>
        </div>
      </aside>
    );
  }
  const recommendedAction: DecisionAction | undefined =
    current?.status === "ready"
      ? current.presentation.action
      : openingChoices.length
        ? openingChoices[0].action
        : actions.length
          ? actions[0].action
          : advice.length
            ? { type: "discard", tile: advice[0].tile }
            : undefined;
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
  const isAdvancedSingle =
    current?.status === "ready" &&
    current.presentation.origin === "advanced-public";
  const showBreakdown = !openingChoices.length && Boolean(view.missing);
  const breakdownHeadline =
    showBreakdown && first.summary.startsWith("公开信息策略本次选择")
      ? summarizeBreakdownHeadline(
          buildTileBreakdown(view, { recommendedAction }),
        )
      : undefined;
  const headerSummary = breakdownHeadline ?? first.summary;
  const showTwoDraw =
    (current?.status === "ready" &&
      current.presentation.origin === "teacher-actions" &&
      current.presentation.choices.every(
        (item) => item.action.type === "discard",
      ) &&
      view.decision?.kind === "self") ||
    (!current && !actions.length && !openingChoices.length);
  const twoDrawCandidates =
    current?.status === "ready"
      ? current.presentation.choices
          .slice(0, 2)
          .flatMap((item) =>
            item.action.type === "discard" ? [item.action.tile] : [],
          )
      : advice.slice(0, 2).map((item) => item.tile);

  return (
    <aside
      className="inlineAdvice inlineAdviceExpanded"
      aria-label="推荐与依据"
    >
      <div className="coachHeaderBar">
        <div className="coachSummary">
          {first.tile !== undefined ? (
            <TilePiece tile={first.tile} className="tile-coach" />
          ) : (
            <span className="actionCoachIcon">{first.symbol ?? "胡"}</span>
          )}
          <div>
            <strong>建议{first.label}</strong>
            <p>{headerSummary}</p>
          </div>
        </div>
        {onSpeak && (
          <button
            className="speakInlineButton"
            type="button"
            onClick={() => {
              onOpen?.();
              onSpeak(first);
            }}
          >
            朗读
          </button>
        )}
      </div>

      <div className="coachDetailsInline">
        {showBreakdown && (
          <TileBreakdownPanel
            variant="inline"
            view={view}
            recommendedAction={recommendedAction}
          />
        )}

        {isAdvancedSingle ? (
          <div className="coachProvenanceFooter">
            <p>
              {first.reason}
              {choices.length === 1 && (
                <>
                  {" "}
                  {current?.status === "ready" &&
                  current.presentation.legalActionCount === 1
                    ? "当前只有这一种合法选择。"
                    : "这里仅展示当前策略首选，你仍可自行选择其他合法方案。"}
                </>
              )}
            </p>
            <small>{first.limit}</small>
          </div>
        ) : (
          <div className="coachChoicesInline">
            {choices.map((item, index) => (
              <div
                className={`coachChoiceLine ${index === 0 ? "is-primary" : ""}`}
                key={item.key}
              >
                <div className="coachChoiceLineTitle">
                  <span className="coachChoiceBadge">
                    {index === 0 ? "推荐" : "备选"} · {item.label}
                  </span>
                  {index > 0 && (
                    <span className="coachChoiceSubSummary">
                      {item.summary}
                    </span>
                  )}
                </div>
                <p>{item.reason}</p>
                <small>{item.limit}</small>
              </div>
            ))}
            {choices.length === 1 && (
              <p className="coachSingleNote">
                {current?.status === "ready" &&
                current.presentation.legalActionCount === 1
                  ? "当前只有这一种合法选择。"
                  : "这里仅展示当前策略首选，你仍可自行选择其他合法方案。"}
              </p>
            )}
          </div>
        )}

        {showTwoDraw && twoDrawCandidates.length > 0 && (
          <details className="coachTwoDrawDetails">
            <summary>展开简化两摸比较（可选对照）</summary>
            <NextDrawPanel view={view} candidates={twoDrawCandidates} />
          </details>
        )}
      </div>
    </aside>
  );
}
