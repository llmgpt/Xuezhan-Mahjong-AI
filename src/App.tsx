import { useMemo, useState } from "react";
import { recommendDiscards } from "./game/advice";
import { completeExchange, completeMissing } from "./game/demo";
import {
  countTiles,
  createGame,
  legalResponses,
  legalSelfActions,
  type Phase,
  type ResponseChoice,
} from "./game/game";
import {
  advanceToHuman,
  applyPlayerAction,
  type PlayerAction,
} from "./game/session";
import { labelOf, suitOf, type Suit } from "./game/tiles";
import { playerView } from "./game/view";
import "./style.css";

const suits: { key: Suit; label: string }[] = [
  { key: "wan", label: "万" },
  { key: "tiao", label: "条" },
  { key: "tong", label: "筒" },
];

const phaseLabels: Record<Phase, string> = {
  exchange: "换三张",
  "choose-missing": "定缺",
  discard: "你的回合",
  draw: "摸牌",
  respond: "响应弃牌",
  ended: "本局结束",
};

const responseLabels: Record<ResponseChoice, string> = {
  pass: "过",
  hu: "胡",
  pung: "碰",
  kong: "直杠",
};

function suitLabel(suit?: Suit): string {
  return suits.find((item) => item.key === suit)?.label ?? "未定";
}

function App() {
  const [seedText, setSeedText] = useState("20260929");
  const [game, setGame] = useState(() => createGame(20260929));
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState(
    "请选择同一门的三张牌，交换方向为顺时针。",
  );
  const hand = game.players[0].hand;
  const view = useMemo(() => playerView(game, 0), [game]);
  const legal = useMemo(() => new Set(view.legalDiscards), [view]);
  const advice = useMemo(
    () =>
      game.phase === "discard" && game.turn === 0
        ? recommendDiscards(view)
        : [],
    [game.phase, game.turn, view],
  );
  const selfActions = legalSelfActions(game, 0);
  const responses = legalResponses(game, 0);
  const exchangeTiles = selected.map((index) => hand[index]);
  const validExchange =
    exchangeTiles.length === 3 &&
    exchangeTiles.every((item) => suitOf(item) === suitOf(exchangeTiles[0]));

  function restart() {
    const seed = Number(seedText);
    if (!seedText.trim() || !Number.isSafeInteger(seed)) {
      setNotice("种子须为安全整数。");
      return;
    }
    setGame(createGame(seed));
    setSelected([]);
    setNotice("新牌局已发牌。请选同一门的三张牌。");
  }

  function toggle(index: number) {
    if (game.phase !== "exchange") return;
    setSelected((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : current.length < 3
          ? [...current, index]
          : current,
    );
  }

  function exchange() {
    if (!validExchange) return;
    try {
      setGame(completeExchange(game, exchangeTiles));
      setSelected([]);
      setNotice("换牌完成。请选择本局缺门。");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function selectMissing(missing: Suit) {
    try {
      setGame(advanceToHuman(completeMissing(game, missing)));
      setNotice("缺门已确定。打完缺门牌才能胡；点选手牌出牌。");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function act(action: PlayerAction) {
    try {
      const next = applyPlayerAction(game, action);
      setGame(next);
      setNotice(
        next.phase === "ended"
          ? "本局已结算。可用同一种子重新体验。"
          : next.phase === "respond"
            ? "这张牌可响应，请选择胡、碰、杠或过。"
            : "轮到你操作。推荐牌与备选列在牌桌下方。",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">四川血战到底 · 教学牌桌 V1</p>
          <h1>从一手牌开始</h1>
          <p className="intro">
            与三名电脑完成一局。系统按当前手牌和公开信息给出可解释的出牌建议。
          </p>
        </div>
        <div className="seedBox">
          <label htmlFor="seed">固定种子 · 重现同一局</label>
          <div className="seedRow">
            <input
              id="seed"
              value={seedText}
              inputMode="numeric"
              onChange={(event) => setSeedText(event.target.value)}
            />
            <button type="button" onClick={restart}>
              重新发牌
            </button>
          </div>
        </div>
      </header>

      <section className="table" aria-label="牌桌">
        <div className="opponents">
          {[1, 2, 3].map((seat) => {
            const opponent = game.players[seat];
            return (
              <div
                className={`opponent ${opponent.won ? "winner" : ""}`}
                key={seat}
              >
                <div className="avatar">{seat}</div>
                <div className="opponentInfo">
                  <strong>
                    电脑 {seat} {opponent.won ? "· 已胡" : ""}
                  </strong>
                  <span>
                    手牌 {opponent.hand.length} 张 · 缺
                    {suitLabel(opponent.missing)}
                  </span>
                  <b className={opponent.score >= 0 ? "positive" : "negative"}>
                    {opponent.score > 0 ? "+" : ""}
                    {opponent.score}
                  </b>
                </div>
                <div className="exposed">
                  {opponent.melds.map((meld, index) => (
                    <span key={index}>
                      {meld.type === "kong" ? "杠" : "碰"} {labelOf(meld.tile)}
                    </span>
                  ))}
                </div>
                <div className="discards">
                  {opponent.discards.map((item, index) => (
                    <span key={index}>{labelOf(item)}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="centerInfo">
          <span className="roundBadge">{phaseLabels[game.phase]}</span>
          <strong>{game.wall.length}</strong>
          <span>墙牌剩余</span>
          <small>
            已胡 {game.wins.length} 家 · 牌数 {countTiles(game)} / 108
          </small>
          {game.lastDiscard && (
            <small>
              最近打出：{game.lastDiscard.seat} 号{" "}
              {labelOf(game.lastDiscard.tile)}
            </small>
          )}
        </div>

        <div className="playerArea">
          <div className="playerHeading">
            <div>
              <span className="playerMark">庄</span>
              <strong>你的手牌</strong>
              <b
                className={game.players[0].score >= 0 ? "positive" : "negative"}
              >
                {game.players[0].score > 0 ? "+" : ""}
                {game.players[0].score}
              </b>
            </div>
            <span>
              缺门：{suitLabel(game.players[0].missing)}{" "}
              {game.players[0].won ? "· 已胡" : ""}
            </span>
          </div>
          <div className="hand" role="group" aria-label="你的手牌">
            {hand.map((item, index) => {
              const canPlay =
                game.phase === "discard" && game.turn === 0 && legal.has(item);
              return (
                <button
                  className={`tile ${selected.includes(index) ? "selected" : ""} ${canPlay ? "playable" : ""} ${advice[0]?.tile === item ? "recommended" : ""}`}
                  key={index}
                  type="button"
                  disabled={game.phase !== "exchange" && !canPlay}
                  aria-label={`${labelOf(item)}${advice[0]?.tile === item && canPlay ? "，推荐" : ""}`}
                  aria-pressed={
                    game.phase === "exchange"
                      ? selected.includes(index)
                      : undefined
                  }
                  onClick={() =>
                    game.phase === "exchange"
                      ? toggle(index)
                      : act({ type: "discard", tile: item })
                  }
                >
                  <span className="rank">{(item % 9) + 1}</span>
                  <span className="suit">{suitLabel(suitOf(item))}</span>
                </button>
              );
            })}
          </div>
          <div className="exposed ownMelds">
            {game.players[0].melds.map((meld, index) => (
              <span key={index}>
                {meld.type === "kong" ? "杠" : "碰"} {labelOf(meld.tile)}
              </span>
            ))}
          </div>
          <div className="ownDiscards">
            已打出：{game.players[0].discards.map(labelOf).join("、") || "暂无"}
          </div>
        </div>
      </section>

      <section className="actionPanel" aria-live="polite">
        <div>
          <p className="eyebrow">当前操作</p>
          <h2>{phaseLabels[game.phase]}</h2>
          <p>{notice}</p>
          {game.phase === "respond" && game.pending && (
            <p>
              来自 {game.pending.from} 号的 {labelOf(game.pending.tile)}
            </p>
          )}
        </div>
        {game.phase === "exchange" && (
          <button
            className="primary"
            type="button"
            disabled={!validExchange}
            onClick={exchange}
          >
            交换选中的三张
          </button>
        )}
        {game.phase === "choose-missing" && (
          <div className="actionChoices">
            {suits.map((suit) => (
              <button
                key={suit.key}
                type="button"
                onClick={() => selectMissing(suit.key)}
              >
                缺{suit.label}
              </button>
            ))}
          </div>
        )}
        {game.phase === "respond" && (
          <div className="actionChoices">
            {responses.map((choice) => (
              <button
                className={choice === "hu" ? "primary" : ""}
                key={choice}
                type="button"
                onClick={() => act({ type: "respond", choice })}
              >
                {responseLabels[choice]}
              </button>
            ))}
          </div>
        )}
        {game.phase === "discard" && game.turn === 0 && (
          <div className="actionChoices">
            {selfActions.canWin && (
              <button
                className="primary"
                type="button"
                onClick={() => act({ type: "win" })}
              >
                自摸胡
              </button>
            )}
            {selfActions.concealedKongs.map((item) => (
              <button
                key={`c${item}`}
                type="button"
                onClick={() =>
                  act({ type: "kong", kind: "concealed", tile: item })
                }
              >
                暗杠 {labelOf(item)}
              </button>
            ))}
            {selfActions.addedKongs.map((item) => (
              <button
                key={`a${item}`}
                type="button"
                onClick={() => act({ type: "kong", kind: "added", tile: item })}
              >
                补杠 {labelOf(item)}
              </button>
            ))}
            <span className="hint">点击亮起的手牌出牌</span>
          </div>
        )}
      </section>

      {game.phase === "discard" && game.turn === 0 && advice.length > 0 && (
        <section className="advicePanel" aria-label="出牌建议">
          <div className="adviceHeading">
            <div>
              <p className="eyebrow">可解释的启发式建议</p>
              <h2>这一手怎么打</h2>
            </div>
            <span>只使用你的手牌与公开信息</span>
          </div>
          <div className="adviceCards">
            {advice.slice(0, 2).map((item, index) => (
              <article className="adviceCard" key={item.tile}>
                <span className="adviceTag">
                  {index === 0 ? "推荐" : "备选"}
                </span>
                <strong>{labelOf(item.tile)}</strong>
                <p>{item.reason}</p>
                <small>{item.limit}</small>
              </article>
            ))}
            {advice.length === 1 && (
              <article className="adviceCard">
                <span className="adviceTag">备选</span>
                <p>当前只有这一种合法牌可打，暂无不同牌的备选。</p>
              </article>
            )}
          </div>
        </section>
      )}

      {game.phase === "ended" && (
        <section className="resultPanel" aria-label="本局结算">
          <p className="eyebrow">本局结算</p>
          <h2>
            {game.endReason === "three-wins"
              ? "三家胡牌，本局结束"
              : "牌墙摸尽，本局结束"}
          </h2>
          <div className="resultScores">
            {game.players.map((player, seat) => (
              <div key={seat}>
                <span>{seat === 0 ? "你" : `电脑 ${seat}`}</span>
                <strong className={player.score >= 0 ? "positive" : "negative"}>
                  {player.score > 0 ? "+" : ""}
                  {player.score}
                </strong>
              </div>
            ))}
          </div>
          <p>
            胡牌记录：
            {game.wins.length
              ? game.wins
                  .map(
                    (win) =>
                      `${win.winner === 0 ? "你" : `电脑 ${win.winner}`} ${win.selfDraw ? "自摸" : "点胡"}（${win.evaluation.patterns.join("、")}）`,
                  )
                  .join("；")
              : "本局无人胡牌"}
          </p>
          <button className="primary" type="button" onClick={restart}>
            同种子再打一局
          </button>
        </section>
      )}

      <section className="historyPanel" aria-label="公开事件">
        <h2>对局记录</h2>
        <ol>
          {game.log
            .slice(-8)
            .reverse()
            .map((entry, index) => (
              <li key={`${game.log.length}-${index}`}>{entry}</li>
            ))}
        </ol>
      </section>
      <footer>
        本版按项目 V1
        规则结算；建议为启发式估算，未训练模型。地区规则差异见仓库规则文档。
      </footer>
    </main>
  );
}

export default App;
