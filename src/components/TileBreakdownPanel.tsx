import { labelOf } from "../game/tiles";
import { TilePiece } from "./MahjongTile";
import {
  buildTileBreakdown,
  type ActionBreakdownRow,
  type TileBreakdownOptions,
} from "./tileBreakdown";
import type { PlayerView } from "../game/view";

function shantenLabel(shanten?: number): string | undefined {
  if (shanten === undefined) return undefined;
  if (shanten < 0) return "可和牌";
  if (shanten === 0) return "已听牌";
  return `${shanten} 向听`;
}

function RowTags({ row }: { row: ActionBreakdownRow }) {
  return (
    <span className="breakdownTags">
      {row.isChosen && <span className="breakdownTag chosen">你选</span>}
      {row.isRecommended && (
        <span className="breakdownTag recommended">策略推荐</span>
      )}
      {row.isTopEfficiency && (
        <span className="breakdownTag topEfficiency">纯牌效最优</span>
      )}
    </span>
  );
}

export function TileBreakdownPanel({
  view,
  recommendedAction,
  chosenAction,
  variant = "dialog",
}: {
  view: PlayerView;
  variant?: "dialog" | "inline";
} & TileBreakdownOptions) {
  const breakdown = buildTileBreakdown(view, {
    recommendedAction,
    chosenAction,
  });

  if (breakdown.kind === "empty" || breakdown.rows.length === 0) {
    return null;
  }

  return (
    <section
      className={`tileBreakdown ${variant === "inline" ? "variant-inline" : ""}`}
      aria-label={breakdown.title}
    >
      <div className="breakdownHeader">
        <h4>{breakdown.title}</h4>
        <p className="breakdownScope">
          按你手牌与全桌已见公开牌扣减余张算账，不含未摸牌墙与他人暗手。
        </p>
      </div>

      {breakdown.missingRemainingTiles && (
        <div className="breakdownMissingRow">
          <span className="breakdownMetricLabel">手牌余下定缺：</span>
          <div className="breakdownTileStrip">
            {breakdown.missingRemainingTiles.map((tileValue, index) => (
              <TilePiece
                tile={tileValue}
                className="tile-discard"
                key={`${tileValue}-${index}`}
              />
            ))}
          </div>
        </div>
      )}

      {breakdown.note && <p className="breakdownNote">{breakdown.note}</p>}

      {breakdown.divergesFromEfficiency &&
        (breakdown.divergenceNote || breakdown.topEfficiencyLabel) && (
          <p className="breakdownDivergeNote">
            {breakdown.divergenceNote ??
              `注：当前策略推荐未取纯牌效最高的“${breakdown.topEfficiencyLabel}”，请结合牌面自主判断。`}
          </p>
        )}

      <div className="breakdownRows">
        {breakdown.rows.map((row) => {
          const shantenText = shantenLabel(row.shanten);
          return (
            <article
              key={row.key}
              className={`breakdownRow ${row.isChosen ? "is-chosen" : ""} ${row.isRecommended ? "is-recommended" : ""}`}
            >
              <div className="breakdownRowHead">
                <div className="breakdownRowTitle">
                  <strong>{row.label}</strong>
                  <RowTags row={row} />
                </div>
                <div className="breakdownStats">
                  {shantenText && (
                    <span className="breakdownStatPill">{shantenText}</span>
                  )}
                  {row.shanten !== undefined && row.shanten >= 0 && (
                    <span className="breakdownStatPill">
                      {row.shanten === 0 ? "可胡" : "进张"}余{" "}
                      {row.effectiveTotal} 张
                    </span>
                  )}
                  {row.maxWinPoints !== undefined && (
                    <span className="breakdownStatPill">
                      最高底算 {row.maxWinPoints} 分
                    </span>
                  )}
                </div>
              </div>

              {row.waits.length > 0 && (
                <div className="breakdownWaits">
                  {row.waits.slice(0, 12).map((wait) => (
                    <span className="breakdownWaitChip" key={wait.tile}>
                      <TilePiece tile={wait.tile} className="tile-discard" />
                      <span>×{wait.remaining}</span>
                      {wait.winPoints !== undefined && (
                        <small>
                          {wait.winPatterns?.slice(0, 2).join("/")}{" "}
                          {wait.winPoints}分
                        </small>
                      )}
                    </span>
                  ))}
                  {row.waits.length > 12 && (
                    <span className="breakdownMore">
                      等共 {row.waits.length} 种
                    </span>
                  )}
                </div>
              )}

              {row.exhaustedWaits.length > 0 && (
                <p className="breakdownExhausted">
                  已见完（余 0 张）：
                  {row.exhaustedWaits.map((w) => labelOf(w.tile)).join("、")}
                </p>
              )}

              {row.note && <p className="breakdownRowNote">{row.note}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
