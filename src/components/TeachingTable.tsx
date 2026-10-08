import { useCallback, useEffect, useRef, useState } from "react";
import { countTiles, createGame, type GameState } from "../game/game";
import {
  summarizeDecisions,
  takeAutomaticStep,
  type AutomaticStep,
} from "../game/teaching";
import { labelOf } from "../game/tiles";
import { DecisionExplanation, DecisionReplay } from "./DecisionReplay";
import { GameDialog } from "./GameDialog";
import { TilePiece } from "./MahjongTile";

const names = ["庄家", "阿川", "小满", "老茶客"];
const suitNames = { wan: "万", tiao: "条", tong: "筒" };
const phaseNames = {
  exchange: "换三张",
  "choose-missing": "定缺",
  draw: "摸牌",
  discard: "摸打",
  respond: "响应",
  ended: "本局结束",
};

export function TeachingTable({ onBack }: { onBack: () => void }) {
  const [seedText, setSeedText] = useState("20260929");
  const [initial, setInitial] = useState(() => createGame(20260929));
  const [steps, setSteps] = useState<AutomaticStep[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const layoutRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLElement>(null);
  const game: GameState = cursor ? steps[cursor - 1].after : initial;
  const ended = game.phase === "ended";
  const record = cursor ? steps[cursor - 1].decision : undefined;
  const records = steps.map((step) => step.decision);
  const summary = summarizeDecisions(records);

  const advance = useCallback(
    (batch = 1) => {
      try {
        const nextSteps = [...steps];
        let nextCursor = cursor;
        let nextGame = game;
        for (
          let item = 0;
          item < batch && nextGame.phase !== "ended";
          item += 1
        ) {
          if (nextCursor === nextSteps.length) {
            if (nextSteps.length >= 1000)
              throw new Error("自动对局超过安全上限，请按种子重新开局。");
            nextSteps.push(takeAutomaticStep(nextGame)!);
          }
          nextGame = nextSteps[nextCursor].after;
          nextCursor += 1;
        }
        setSteps(nextSteps);
        setCursor(nextCursor);
        if (nextGame.phase === "ended") {
          setPlaying(false);
          setFinishing(false);
        }
      } catch (cause) {
        setError((cause as Error).message);
        setPlaying(false);
        setFinishing(false);
      }
    },
    [steps, cursor, game],
  );

  useEffect(() => {
    if (!playing || ended) return;
    const timer = window.setTimeout(
      () => advance(finishing ? 12 : 1),
      finishing ? 0 : 1200 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [playing, finishing, ended, speed, advance]);

  function restart() {
    if (!seedText.trim() || !Number.isSafeInteger(Number(seedText))) {
      setError("种子须为安全整数。");
      return;
    }
    setInitial(createGame(Number(seedText)));
    setSteps([]);
    setCursor(0);
    setPlaying(false);
    setFinishing(false);
    setError("");
  }
  function seek(next: number) {
    setPlaying(false);
    setFinishing(false);
    setCursor(next);
  }

  return (
    <main className="shell teachingShell">
      <header className="topbar teachingHeader">
        <div className="brand">
          <div>
            <h1>教学观战</h1>
            <span>四家自动对局 · 逐步解析</span>
          </div>
        </div>
        <div className="topbarTools">
          <button type="button" className="newGameButton" onClick={onBack}>
            回到玩家练习
          </button>
          <GameDialog title="观战设置">
            <div className="settingsPopover">
              <label htmlFor="teaching-seed">固定种子</label>
              <input
                id="teaching-seed"
                value={seedText}
                inputMode="numeric"
                onChange={(event) => setSeedText(event.target.value)}
              />
              <p>同种子重现相同策略与对局。重新开局会清空当前记录。</p>
              <button
                type="button"
                onClick={(event) => {
                  if (seedText.trim() && Number.isSafeInteger(Number(seedText)))
                    event.currentTarget.closest("dialog")?.close();
                  restart();
                }}
              >
                按种子重新开局
              </button>
              {(!seedText.trim() ||
                !Number.isSafeInteger(Number(seedText))) && (
                <p role="alert">种子须为安全整数。</p>
              )}
            </div>
          </GameDialog>
        </div>
      </header>
      <div className="teachingBanner">
        教学视角 ·
        展示四家手牌。电脑每次决策只使用本家手牌与公开信息，采用启发式策略。
      </div>
      <nav className="playbackControls" aria-label="观战播放控制">
        <button
          type="button"
          className="gameButton primary"
          disabled={ended}
          onClick={() => {
            setPlaying(!playing);
            setFinishing(false);
          }}
        >
          {playing ? "暂停" : "自动播放"}
        </button>
        <button
          type="button"
          disabled={cursor === 0}
          onClick={() => seek(cursor - 1)}
        >
          上一步
        </button>
        <button
          type="button"
          disabled={ended || playing}
          onClick={() => advance()}
        >
          下一步
        </button>
        <label>
          速度{" "}
          <select
            aria-label="播放速度"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value={1}>1 倍</option>
            <option value={2}>2 倍</option>
            <option value={4}>4 倍</option>
          </select>
        </label>
        <button
          type="button"
          disabled={ended}
          onClick={() => {
            setPlaying(true);
            setFinishing(true);
          }}
        >
          自动打完本局
        </button>
        <GameDialog
          title="本局复盘"
          trigger={ended ? "查看自动复盘" : "决策记录"}
          onOpen={() => {
            setPlaying(false);
            setFinishing(false);
          }}
        >
          <DecisionReplay records={records} />
        </GameDialog>
        <button
          className="mobileAnalysisButton"
          type="button"
          onClick={() => {
            if (layoutRef.current && analysisRef.current)
              layoutRef.current.scrollTo({
                top:
                  analysisRef.current.offsetTop - layoutRef.current.offsetTop,
                behavior: "smooth",
              });
          }}
        >
          本步解析
        </button>
        <button
          className="mobileAnalysisButton"
          type="button"
          onClick={() =>
            layoutRef.current?.scrollTo({ top: 0, behavior: "smooth" })
          }
        >
          查看牌桌
        </button>
        <span className="playbackStatus">
          第 {cursor} / {steps.length} 步 · {phaseNames[game.phase]} · 种子{" "}
          {initial.seed}
        </span>
      </nav>
      {error && (
        <p role="alert" className="teachingError">
          {error}
        </p>
      )}
      <div className="teachingLayout" ref={layoutRef}>
        <section className="teachingBoard" aria-label="四家教学牌桌">
          <div className="teachingTableInfo">
            牌数 {countTiles(game)} / 108 · 余牌 {game.wall.length} · 已胡{" "}
            {game.wins.length} 家
          </div>
          <div className="teachingPlayers">
            {game.players.map((player, seat) => (
              <article
                key={seat}
                className={`teachingPlayer ${record?.seat === seat ? "acting" : ""}`}
                aria-label={`${seat} 号玩家手牌`}
              >
                <header>
                  <strong>
                    {seat} 号 · {names[seat]}
                  </strong>
                  <span>
                    缺{player.missing ? suitNames[player.missing] : "未定"} ·{" "}
                    {player.won ? "已胡" : "未胡"} ·{" "}
                    {player.score > 0 ? "+" : ""}
                    {player.score} 分
                  </span>
                </header>
                <div className="teachingHand">
                  {[...player.hand]
                    .sort((a, b) => a - b)
                    .map((tile, index) => (
                      <TilePiece
                        key={index}
                        tile={tile}
                        className="tile-teaching"
                      />
                    ))}
                </div>
                <p className="teachingMelds">
                  {player.melds
                    .map(
                      (meld) =>
                        `${meld.type === "kong" ? "杠" : "碰"} ${labelOf(meld.tile)}`,
                    )
                    .join(" / ") || "尚无碰杠"}
                </p>
                <div className="teachingDiscards" aria-label={`${seat} 号弃牌`}>
                  {player.discards.map((tile, index) => (
                    <TilePiece
                      key={index}
                      tile={tile}
                      className="tile-discard"
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
          {game.pending && (
            <p className="teachingPending">
              {game.pending.from} 号
              {game.pending.kind === "rob-kong" ? "申请补杠" : "打出"}{" "}
              {labelOf(game.pending.tile)}；收集响应后按胡、杠、碰优先级处理。
            </p>
          )}
          {ended && (
            <section className="teachingResult" aria-label="自动对局结算">
              <h2>
                {game.endReason === "three-wins"
                  ? "三家胡牌，血战结束"
                  : "牌墙摸尽，流局结算"}
              </h2>
              <p>
                已自动解析 {summary.decisions} 次决策，标记{" "}
                {summary.keyIndices.length} 个关键步骤。
              </p>
              {game.wins.map((win) => (
                <p key={win.winner}>
                  {win.winner} 号{win.selfDraw ? "自摸" : `胡 ${win.payer} 号`}{" "}
                  · {win.evaluation.patterns.join("、")}
                </p>
              ))}
              <GameDialog
                title="自动复盘报告"
                trigger="查看复盘报告"
                onOpen={() => {
                  setPlaying(false);
                  setFinishing(false);
                }}
              >
                <DecisionReplay records={records} />
              </GameDialog>
              <button type="button" onClick={() => seek(0)}>
                从开局回看
              </button>
              <button type="button" onClick={restart}>
                同种子再来一局
              </button>
            </section>
          )}
        </section>
        <aside className="teachingAnalysis" ref={analysisRef}>
          {record ? (
            <DecisionExplanation record={record} />
          ) : (
            <div className="teachingWelcome">
              <h2>看四家怎么打</h2>
              <p>
                点击“自动播放”逐步观看，或“自动打完本局”直接生成完整对局与复盘。
              </p>
              <p>
                右侧解析保存每次行动前的手牌、建议、备选与局限；牌桌显示操作完成后的状态。
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
