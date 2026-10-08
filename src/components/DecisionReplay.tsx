import { useState } from "react";
import { summarizeDecisions, type DecisionRecord } from "../game/decision";
import { labelOf } from "../game/tiles";
import { TilePiece } from "./MahjongTile";

export function DecisionExplanation({ record }: { record: DecisionRecord }) {
  return (
    <article className="decisionExplanation" aria-label="本步决策解析">
      <span className="decisionEyebrow">{record.seat} 号玩家 · 行动前信息</span>
      <h3>{record.actual.label}</h3>
      <p>
        本家定缺：
        {record.view.missing
          ? { wan: "万", tiao: "条", tong: "筒" }[record.view.missing]
          : "尚未选择"}
        {record.view.decision?.kind === "respond"
          ? `；响应 ${record.view.decision.from} 号的 ${labelOf(record.view.decision.tile)}（${record.view.decision.responseKind === "rob-kong" ? "抢杠" : "弃牌"}）`
          : ""}
      </p>
      <div className="snapshotHand" aria-label="行动前手牌">
        {[...record.view.hand]
          .sort((a, b) => a - b)
          .map((tile, index) => (
            <TilePiece tile={tile} key={index} className="tile-snapshot" />
          ))}
      </div>
      <p className="decisionSummary">{record.actual.summary}</p>
      <p>{record.actual.reason}</p>
      {!record.matchesRecommendation && (
        <p className="decisionDifference">
          本次选择与系统建议不同：建议{record.recommended.label}。
          {record.recommended.summary}{" "}
          差异仅代表启发式取舍，不能据此断定实际选择错误。
        </p>
      )}
      <small>{record.actual.limit}</small>
      <details>
        <summary>当时公开信息 · 余牌 {record.view.wallRemaining}</summary>
        <p>
          本家已打：{record.view.ownDiscards.map(labelOf).join("、") || "无"}
          ；本家面子：
          {record.view.melds
            .map(
              (meld) =>
                `${meld.type === "kong" ? "杠" : "碰"}${labelOf(meld.tile)}`,
            )
            .join("、") || "无"}
        </p>
        {record.view.opponents.map((other) => (
          <p key={other.seat}>
            {other.seat} 号：手牌 {other.handCount} 张，
            {other.won ? "已胡" : "未胡"}；弃牌{" "}
            {other.discards.map(labelOf).join("、") || "无"}；面子{" "}
            {other.melds
              .map(
                (meld) =>
                  `${meld.type === "kong" ? "杠" : "碰"}${labelOf(meld.tile)}`,
              )
              .join("、") || "无"}
            ；积分 {other.score}
          </p>
        ))}
      </details>
      <details>
        <summary>系统建议与备选</summary>
        {[record.recommended, ...record.alternatives].map((choice, index) => (
          <div className="decisionAlternative" key={index}>
            <strong>
              {index === 0 ? "推荐" : "备选"} · {choice.label}
            </strong>
            <p>{choice.summary}</p>
            <p>{choice.reason}</p>
            <small>{choice.limit}</small>
          </div>
        ))}
      </details>
      <div className="decisionOutcome">
        <strong>操作后的公开结果</strong>
        {record.events.length ? (
          record.events.map((event, index) => <p key={index}>{event}</p>)
        ) : (
          <p>选择已提交，等待其余玩家完成开局选择或响应。</p>
        )}
        {record.scoreChanges.some((points) => points !== 0) && (
          <p>
            本步积分变化：
            {record.scoreChanges
              .map(
                (points, seat) =>
                  `${seat} 号 ${points > 0 ? "+" : ""}${points}`,
              )
              .join(" / ")}
          </p>
        )}
      </div>
    </article>
  );
}

export function DecisionReplay({ records }: { records: DecisionRecord[] }) {
  const [index, setIndex] = useState(0);
  const summary = summarizeDecisions(records);
  const selected = Math.min(index, records.length - 1);
  if (!records.length)
    return (
      <p className="dialogIntro">
        完成一次换牌、定缺或打牌操作后，这里会保存当时的选择与建议。本局重新开局时清空记录。
      </p>
    );
  return (
    <div className="decisionReplay">
      <p className="dialogIntro">
        已记录 {summary.decisions} 次决策，与建议不同 {summary.deviations}{" "}
        次。依据来自行动当时的手牌与公开信息，不用后续摸牌解释旧选择。
      </p>
      <div className="replayNavigation">
        <button
          type="button"
          disabled={selected === 0}
          onClick={() => setIndex(selected - 1)}
        >
          上一步
        </button>
        <label>
          决策{" "}
          <select
            aria-label="选择复盘决策"
            value={selected}
            onChange={(event) => setIndex(Number(event.target.value))}
          >
            {records.map((record, item) => (
              <option key={item} value={item}>
                {item + 1}. {record.seat} 号 · {record.actual.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={selected === records.length - 1}
          onClick={() => setIndex(selected + 1)}
        >
          下一步
        </button>
      </div>
      {!!summary.keyIndices.length && (
        <div className="keyDecisions">
          <span>关键决策</span>
          {summary.keyIndices.map((item) => (
            <button type="button" key={item} onClick={() => setIndex(item)}>
              第 {item + 1} 步 · {records[item].actual.label}
            </button>
          ))}
        </div>
      )}
      <DecisionExplanation record={records[selected]} />
    </div>
  );
}
