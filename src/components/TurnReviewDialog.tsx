import { actionKey } from "../game/actionAdvice";
import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import { GameDialog } from "./GameDialog";
import { TileBreakdownPanel } from "./TileBreakdownPanel";
import {
  buildTileBreakdown,
  summarizeBreakdownHeadline,
} from "./tileBreakdown";

export interface TurnReview {
  view: PlayerView;
  phase: Phase;
  chosenAction: DecisionAction;
  chosenLabel: string;
  recommendedLabel?: string;
  recommendedAction?: DecisionAction;
  recommendationSummary?: string;
  recommendationReason?: string;
  recommendationLimit?: string;
}

function sameDecision(a?: DecisionAction, b?: DecisionAction): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "exchange" && b.type === "exchange") {
    const ka = [...a.tiles].sort((x, y) => x - y).join(",");
    const kb = [...b.tiles].sort((x, y) => x - y).join(",");
    return ka === kb;
  }
  if (a.type === "missing" && b.type === "missing") {
    return a.suit === b.suit;
  }
  if (
    a.type !== "exchange" &&
    a.type !== "missing" &&
    b.type !== "exchange" &&
    b.type !== "missing"
  ) {
    return actionKey(a) === actionKey(b);
  }
  return false;
}

export function TurnReviewDialog({
  review,
  onOpen,
}: {
  review: TurnReview | null;
  onOpen?: () => void;
}) {
  if (!review) return null;
  const matches = sameDecision(review.chosenAction, review.recommendedAction);
  const showBreakdown =
    review.phase !== "exchange" &&
    review.phase !== "choose-missing" &&
    Boolean(review.view.missing);
  const breakdownHeadline =
    showBreakdown &&
    review.recommendationSummary?.startsWith("公开信息策略本次选择")
      ? summarizeBreakdownHeadline(
          buildTileBreakdown(review.view, {
            recommendedAction: review.recommendedAction,
            chosenAction: review.chosenAction,
          }),
        )
      : undefined;
  const displaySummary = breakdownHeadline ?? review.recommendationSummary;

  return (
    <GameDialog
      title="刚这手复盘"
      trigger="刚这手复盘"
      triggerClassName="textButton reviewTrigger"
      onOpen={onOpen}
    >
      <div className="turnReviewSummary">
        <div className="reviewCompareRow">
          <div className="reviewChoiceCard chosen">
            <span className="reviewChoiceBadge">你的选择</span>
            <strong>{review.chosenLabel}</strong>
          </div>
          <div className="reviewChoiceCard recommended">
            <span className="reviewChoiceBadge">
              {review.recommendedLabel ? "策略推荐" : "策略状态"}
            </span>
            <strong>
              {review.recommendedLabel ?? "当时仍在后台计算（快速自决）"}
            </strong>
          </div>
        </div>

        <p className="reviewMatchLine">
          {review.recommendedLabel
            ? matches
              ? "你刚这手与当前策略推荐完全一致。"
              : "你刚这手与当前策略推荐不同，可结合下方客观算账对比取舍。"
            : "你未等待后台计算即自行决策；下方仍为你补算了当时的客观测算明细。"}
        </p>

        {review.recommendationReason && (
          <div className="reviewReasonBox">
            {displaySummary && <p className="choiceReason">{displaySummary}</p>}
            <p>{review.recommendationReason}</p>
            {review.recommendationLimit && (
              <small>{review.recommendationLimit}</small>
            )}
          </div>
        )}
      </div>

      {review.phase !== "exchange" &&
        review.phase !== "choose-missing" &&
        review.view.missing && (
          <TileBreakdownPanel
            view={review.view}
            chosenAction={review.chosenAction}
            recommendedAction={review.recommendedAction}
          />
        )}
    </GameDialog>
  );
}
