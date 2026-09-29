import { useState } from "react";
import { completeExchange, completeMissing, playDemoRound } from "./game/demo";
import { countTiles, createGame, legalDiscards } from "./game/game";
import { labelOf, suitOf, type Suit, type Tile } from "./game/tiles";
import "./style.css";

const suits: { key: Suit; label: string }[] = [
  { key: "wan", label: "万" },
  { key: "tiao", label: "条" },
  { key: "tong", label: "筒" },
];

const phaseLabels = {
  exchange: "换三张",
  "choose-missing": "定缺",
  discard: "出牌",
  draw: "摸牌",
  ended: "演示结束",
};

function App() {
  const [seedText, setSeedText] = useState("20260929");
  const [game, setGame] = useState(() => createGame(20260929));
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState(
    "请选择同一门的三张牌，交换方向为顺时针。",
  );
  const hand = game.players[0].hand;
  const options = new Set(legalDiscards(game, 0));

  function restart() {
    const seed = Number(seedText);
    if (!Number.isSafeInteger(seed)) {
      setMessage("种子须为安全整数。");
      return;
    }
    setGame(createGame(seed));
    setSelected([]);
    setMessage("新牌局已发牌，请选择同一门的三张牌。");
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
    const cards = selected.map((index) => hand[index]);
    if (
      cards.length !== 3 ||
      !cards.every((item) => suitOf(item) === suitOf(cards[0]))
    ) {
      setMessage("请选择同一门的三张牌。");
      return;
    }
    setGame(completeExchange(game, cards));
    setSelected([]);
    setMessage("换牌完成。请选择一门作为本局的缺门。");
  }

  function selectMissing(missing: Suit) {
    setGame(completeMissing(game, missing));
    setMessage("庄家先出牌。缺门牌未清前，只能打缺门牌。");
  }

  function play(chosen: Tile) {
    if (!options.has(chosen)) return;
    const next = playDemoRound(game, chosen);
    setGame(next);
    setMessage(
      next.phase === "ended"
        ? "牌墙已摸完。胡牌、碰杠与流局结算仍在开发中。"
        : "三名电脑已按固定策略完成一轮摸打，轮到你出牌。",
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">四川血战到底 · 开发中的规则切片</p>
          <h1>从一手牌开始</h1>
          <p className="intro">
            练习换三张、定缺和摸打顺序。当前尚不能碰、杠、胡或完成真实结算。
          </p>
        </div>
        <div className="seedBox">
          <label htmlFor="seed">固定种子</label>
          <div className="seedRow">
            <input
              id="seed"
              value={seedText}
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
          {[1, 2, 3].map((seat) => (
            <div className="opponent" key={seat}>
              <div className="avatar">{seat}</div>
              <div>
                <strong>电脑 {seat}</strong>
                <span>手牌 {game.players[seat].hand.length} 张</span>
              </div>
              <div className="discards">
                {game.players[seat].discards.slice(-5).map((item, index) => (
                  <span key={index}>{labelOf(item)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="centerInfo">
          <span className="roundBadge">阶段 {phaseLabels[game.phase]}</span>
          <strong>{game.wall.length}</strong>
          <span>墙牌剩余</span>
          <small>牌数核对 {countTiles(game)} / 108</small>
        </div>

        <div className="playerArea">
          <div className="playerHeading">
            <div>
              <span className="playerMark">庄</span>
              <strong>你的手牌</strong>
            </div>
            <span>
              缺门：
              {suits.find((item) => item.key === game.players[0].missing)
                ?.label ?? "未定"}
            </span>
          </div>
          <div className="hand" role="group" aria-label="你的手牌">
            {hand.map((item, index) => {
              const canPlay = game.phase === "discard" && options.has(item);
              return (
                <button
                  className={`tile ${selected.includes(index) ? "selected" : ""} ${canPlay ? "playable" : ""}`}
                  key={index}
                  type="button"
                  disabled={game.phase !== "exchange" && !canPlay}
                  aria-pressed={
                    game.phase === "exchange"
                      ? selected.includes(index)
                      : undefined
                  }
                  onClick={() =>
                    game.phase === "exchange" ? toggle(index) : play(item)
                  }
                >
                  <span className="rank">{(item % 9) + 1}</span>
                  <span className="suit">
                    {suits.find((suit) => suit.key === suitOf(item))?.label}
                  </span>
                </button>
              );
            })}
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
          <p>{message}</p>
        </div>
        {game.phase === "exchange" && (
          <button
            className="primary"
            type="button"
            disabled={selected.length !== 3}
            onClick={exchange}
          >
            交换选中的三张
          </button>
        )}
        {game.phase === "choose-missing" && (
          <div className="suitChoices">
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
        {game.phase === "discard" && (
          <p className="hint">点击上方亮起的牌出牌</p>
        )}
      </section>
      <footer>当前电脑仅按固定规则选牌；页面不提供出牌建议或完整对局。</footer>
    </main>
  );
}

export default App;
