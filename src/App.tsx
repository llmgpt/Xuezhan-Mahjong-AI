import { useMemo, useState, type ReactNode } from "react";
import { AdviceCoach } from "./components/AdviceCoach";
import { GameDialog } from "./components/GameDialog";
import { MahjongFace, TileBack, TilePiece } from "./components/MahjongTile";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { recommendDiscards } from "./game/advice";
import { actionKey, recommendActions } from "./game/actionAdvice";
import { completeExchange, completeMissing } from "./game/demo";
import {
  countTiles,
  createGame,
  legalResponses,
  legalSelfActions,
  type Phase,
  type PlayerState,
  type ResponseChoice,
} from "./game/game";
import {
  advanceToHuman,
  applyPlayerAction,
  type PlayerAction,
} from "./game/session";
import { labelOf, suitOf, type Suit, type Tile } from "./game/tiles";
import { playerView } from "./game/view";
import "./style.css";

const suits: { key: Suit; label: string; tile: Tile }[] = [
  { key: "wan", label: "万", tile: 0 },
  { key: "tiao", label: "条", tile: 9 },
  { key: "tong", label: "筒", tile: 18 },
];
const phaseLabels: Record<Phase, string> = {
  exchange: "换三张",
  "choose-missing": "选择定缺",
  discard: "轮到你出牌",
  draw: "摸牌",
  respond: "轮到你响应",
  ended: "本局结束",
};
const responseLabels: Record<ResponseChoice, string> = {
  pass: "过",
  hu: "胡",
  pung: "碰",
  kong: "杠",
};
const names = ["你", "阿川", "小满", "老茶客"];

function ActionButton({
  action,
  label,
  recommended,
  onAct,
  children,
}: {
  action: PlayerAction;
  label: string;
  recommended: boolean;
  onAct: (action: PlayerAction) => void;
  children?: ReactNode;
}) {
  const secondary = action.type === "respond" && action.choice === "pass";
  return (
    <button
      className={`gameButton ${secondary ? "secondary" : "primary"} ${action.type === "respond" ? "responseAction" : ""} ${recommended ? "suggestedAction" : ""}`}
      type="button"
      aria-label={`${label}${recommended ? "，推荐" : ""}`}
      onClick={() => onAct(action)}
    >
      {children ?? label}
      {recommended && (
        <span className="actionRecommendMark" aria-hidden="true">
          荐
        </span>
      )}
    </button>
  );
}

function suitLabel(suit?: Suit) {
  return suits.find((item) => item.key === suit)?.label ?? "未定";
}
function Score({ value }: { value: number }) {
  return (
    <b className={value >= 0 ? "positive" : "negative"}>
      {value > 0 ? "+" : ""}
      {value}
    </b>
  );
}
function Melds({ player }: { player: PlayerState }) {
  return (
    <div className="melds">
      {player.melds.map((meld, index) => (
        <div
          className="meldGroup"
          key={index}
          aria-label={`${meld.type === "kong" ? "杠" : "碰"}${labelOf(meld.tile)}`}
        >
          <span className="meldLabel">
            {meld.type === "kong" ? "杠" : "碰"}
          </span>
          {Array.from({ length: meld.type === "kong" ? 4 : 3 }, (_, copy) => (
            <TilePiece tile={meld.tile} className="tile-meld" key={copy} />
          ))}
        </div>
      ))}
    </div>
  );
}
function Opponent({
  seat,
  player,
  active,
}: {
  seat: number;
  player: PlayerState;
  active: boolean;
}) {
  return (
    <div
      className={`opponent seat-${seat} ${player.won ? "winner" : ""} ${active ? "active" : ""}`}
    >
      <div className="opponentIdentity">
        <div className="avatarFrame">
          <PlayerAvatar seat={seat} />
          {player.won && <span className="wonBadge">胡</span>}
        </div>
        <div className="opponentInfo">
          <strong>
            {names[seat]} <small>电脑</small>
          </strong>
          <span className="scoreLine">
            <i className="coinIcon">◆</i>
            <Score value={player.score} />
          </span>
          <span
            className={`missingBadge ${player.missing ? "determined" : ""}`}
          >
            缺{suitLabel(player.missing)}
          </span>
        </div>
      </div>
      <div
        className="opponentHand"
        aria-label={`手牌 ${player.hand.length} 张`}
      >
        {Array.from(
          { length: Math.min(player.hand.length, 14) },
          (_, index) => (
            <TileBack key={index} />
          ),
        )}
        <span className="handCount">{player.hand.length}</span>
      </div>
      <Melds player={player} />
    </div>
  );
}

function App() {
  const [seedText, setSeedText] = useState("20260929");
  const [game, setGame] = useState(() => createGame(20260929));
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState("选择同一花色的三张牌，顺时针交换。");
  const hand = game.players[0].hand;
  const sortedHand = hand
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => a.tile - b.tile || a.index - b.index);
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
  const actionAdvice = useMemo(() => recommendActions(view), [view]);
  const suggestedAction = actionAdvice[0]?.action;
  const suggestedKey = suggestedAction && actionKey(suggestedAction);
  const suggestedDiscard = actionAdvice.length
    ? suggestedAction?.type === "discard"
      ? suggestedAction.tile
      : undefined
    : advice[0]?.tile;
  const responses = legalResponses(game, 0);
  const exchangeTiles = selected.map((index) => hand[index]);
  const validExchange =
    exchangeTiles.length === 3 &&
    exchangeTiles.every((item) => suitOf(item) === suitOf(exchangeTiles[0]));
  const currentLabel =
    game.pending?.kind === "rob-kong" ? "抢杠响应" : phaseLabels[game.phase];
  const displayedTile = game.pending
    ? { seat: game.pending.from, tile: game.pending.tile }
    : game.lastDiscard;

  function restart() {
    const seed = Number(seedText);
    if (!seedText.trim() || !Number.isSafeInteger(seed)) {
      setNotice("种子须为安全整数。");
      return false;
    }
    setGame(createGame(seed));
    setSelected([]);
    setNotice("选择同一花色的三张牌，顺时针交换。");
    return true;
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
      setNotice("选择本局不要的花色，之后先打完这门牌。");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function selectMissing(missing: Suit) {
    try {
      setGame(advanceToHuman(completeMissing(game, missing)));
      setNotice("点选亮起的手牌直接出牌，先打完缺门牌。");
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
          ? "本局已结算，来看看大家的战绩。"
          : next.phase === "respond"
            ? "选择胡、碰、杠，或点击过。"
            : "点选亮起的手牌直接出牌。",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandTile">
            <MahjongFace tile={0} />
          </span>
          <div>
            <h1>血战到底</h1>
            <span>成都茶馆 · 新手练习</span>
          </div>
        </div>
        <div className="topbarTools">
          <span className="roomTag">
            <i />
            单人练习
          </span>
          <GameDialog title="牌局设置" triggerClassName="settingsButton">
            <div className="settingsPopover">
              <label htmlFor="seed">固定种子</label>
              <input
                id="seed"
                value={seedText}
                inputMode="numeric"
                onChange={(event) => setSeedText(event.target.value)}
              />
              <p>相同种子与选择可以重现同一局。</p>
              <small>本局牌数：{countTiles(game)} / 108</small>
              <button
                type="button"
                onClick={(event) => {
                  if (restart()) event.currentTarget.closest("dialog")?.close();
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
          <button className="newGameButton" type="button" onClick={restart}>
            <span>↻</span> 重新开局
          </button>
        </div>
      </header>

      <section className="gameStage" aria-label="牌桌">
        <div className="scenery" aria-hidden="true">
          <div className="lantern lantern-left" />
          <div className="lantern lantern-right" />
          <div className="mountain mountain-one" />
          <div className="mountain mountain-two" />
        </div>
        <div className="tableSurface" aria-hidden="true">
          <div className="tableInner" />
        </div>
        <div className="roomPlaque">
          四川麻将<span>108 张 · 三家胡牌结束</span>
        </div>

        {[1, 2, 3].map((seat) => (
          <Opponent
            seat={seat}
            player={game.players[seat]}
            active={
              game.turn === seat &&
              !game.players[seat].won &&
              game.phase !== "exchange" &&
              game.phase !== "choose-missing" &&
              game.phase !== "ended"
            }
            key={seat}
          />
        ))}

        <div className="publicArea">
          {[2, 3, 1, 0].map((seat) => (
            <div
              className={`discardZone discard-seat-${seat}`}
              key={seat}
              aria-label={`${names[seat]}的弃牌`}
            >
              <span className="discardName">
                {seat === 0 ? "你的弃牌" : `${names[seat]} · 弃牌`}
              </span>
              <div className="discardTiles">
                {game.players[seat].discards.map((tile, index) => (
                  <TilePiece tile={tile} className="tile-discard" key={index} />
                ))}
              </div>
            </div>
          ))}
          <div className="tableCenter">
            {displayedTile ? (
              <div className="latestDiscard" key={game.log.length}>
                <span>
                  {names[displayedTile.seat]}
                  {game.pending?.kind === "rob-kong" ? "正在补杠" : "刚打出"}
                </span>
                <TilePiece tile={displayedTile.tile} className="tile-latest" />
              </div>
            ) : (
              <div className="tableEmblem">
                <span>四川</span>
                <strong>血战到底</strong>
                <i>萬 · 条 · 筒</i>
              </div>
            )}
            <div className="wallCounter">
              余牌 <b>{game.wall.length}</b>
              <span>·</span>已胡 <b>{game.wins.length}</b> 家
            </div>
          </div>
        </div>

        <div className="playerArea">
          <div className="actionBar" aria-live="polite">
            <div className="actionMessage">
              <span className="roundBadge">{currentLabel}</span>
              <p>
                {game.phase === "exchange"
                  ? `${notice} 已选 ${selected.length}/3 张`
                  : notice}
              </p>
            </div>
            <div className="actionChoices">
              {game.phase === "exchange" && (
                <button
                  className="gameButton primary"
                  type="button"
                  disabled={!validExchange}
                  onClick={exchange}
                >
                  换三张 <small>{selected.length}/3</small>
                </button>
              )}
              {game.phase === "choose-missing" &&
                suits.map((suit) => (
                  <button
                    className="missingChoice"
                    key={suit.key}
                    type="button"
                    onClick={() => selectMissing(suit.key)}
                  >
                    <TilePiece tile={suit.tile} className="tile-choice" />
                    <span>缺{suit.label}</span>
                  </button>
                ))}
              {game.phase === "respond" &&
                responses.map((choice) => (
                  <ActionButton
                    key={choice}
                    action={{ type: "respond", choice }}
                    label={responseLabels[choice]}
                    recommended={suggestedKey === `respond:${choice}`}
                    onAct={act}
                  />
                ))}
              {game.phase === "discard" && game.turn === 0 && (
                <>
                  {selfActions.canWin && (
                    <ActionButton
                      action={{ type: "win" }}
                      label="自摸胡"
                      recommended={suggestedKey === "win"}
                      onAct={act}
                    />
                  )}
                  {selfActions.concealedKongs.map((tile) => (
                    <ActionButton
                      key={`c${tile}`}
                      action={{ type: "kong", kind: "concealed", tile }}
                      label={`暗杠 ${labelOf(tile)}`}
                      recommended={suggestedKey === `kong:concealed:${tile}`}
                      onAct={act}
                    >
                      暗杠 <TilePiece tile={tile} className="tile-button" />
                    </ActionButton>
                  ))}
                  {selfActions.addedKongs.map((tile) => (
                    <ActionButton
                      key={`a${tile}`}
                      action={{ type: "kong", kind: "added", tile }}
                      label={`补杠 ${labelOf(tile)}`}
                      recommended={suggestedKey === `kong:added:${tile}`}
                      onAct={act}
                    >
                      补杠 <TilePiece tile={tile} className="tile-button" />
                    </ActionButton>
                  ))}
                </>
              )}
            </div>
          </div>
          <AdviceCoach advice={advice} actions={actionAdvice} />
          <div className="handTray">
            <div className="playerIdentity">
              <div className="avatarFrame">
                <PlayerAvatar seat={0} />
                <span className="dealerBadge">庄</span>
              </div>
              <div>
                <strong>
                  你 <Score value={game.players[0].score} />
                </strong>
                <span className="missingBadge">
                  缺{suitLabel(game.players[0].missing)}
                  {game.players[0].won ? " · 已胡" : ""}
                </span>
              </div>
            </div>
            <div className="handContent">
              <Melds player={game.players[0]} />
              <div className="hand" role="group" aria-label="你的手牌">
                {sortedHand.map(({ tile, index }) => {
                  const canPlay =
                    game.phase === "discard" &&
                    game.turn === 0 &&
                    legal.has(tile);
                  const recommended = suggestedDiscard === tile && canPlay;
                  return (
                    <button
                      className={`tile mahjongTile ${selected.includes(index) ? "selected" : ""} ${canPlay ? "playable" : ""} ${recommended ? "recommended" : ""} ${game.phase === "discard" && !canPlay ? "unavailable" : ""}`}
                      key={index}
                      type="button"
                      disabled={game.phase !== "exchange" && !canPlay}
                      aria-label={`${labelOf(tile)}${recommended ? "，推荐" : ""}`}
                      aria-pressed={
                        game.phase === "exchange"
                          ? selected.includes(index)
                          : undefined
                      }
                      onClick={() =>
                        game.phase === "exchange"
                          ? toggle(index)
                          : act({ type: "discard", tile })
                      }
                    >
                      <MahjongFace tile={tile} />
                      {recommended && <span className="recommendMark">荐</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {game.phase === "ended" && (
          <div className="resultBackdrop">
            <section className="resultPanel" aria-label="本局结算">
              <span className="resultSeal">本局战绩</span>
              <h2>
                {game.endReason === "three-wins" ? "血战结束" : "牌墙摸尽"}
              </h2>
              <p className="resultSubtitle">
                {game.endReason === "three-wins"
                  ? "三家已胡，一局尽兴"
                  : "查花猪、查叫已结算"}
              </p>
              <div className="resultScores">
                {game.players.map((player, seat) => (
                  <div key={seat}>
                    <PlayerAvatar seat={seat} />
                    <span>{names[seat]}</span>
                    <Score value={player.score} />
                  </div>
                ))}
              </div>
              <div className="winRecords">
                {game.wins.length ? (
                  game.wins.map((win) => (
                    <p key={win.winner}>
                      <span>
                        {names[win.winner]} · {win.selfDraw ? "自摸" : "点胡"}
                      </span>
                      <b>{win.evaluation.patterns.join(" · ")}</b>
                    </p>
                  ))
                ) : (
                  <p>本局无人胡牌</p>
                )}
              </div>
              <button
                className="gameButton primary"
                type="button"
                onClick={restart}
              >
                再来一局
              </button>
            </section>
          </div>
        )}
      </section>

      <footer className="tableToolbar">
        <span>V1 规则 · 启发式建议</span>
        <div>
          <GameDialog title="玩法提示">
            <ol className="rulesHelp">
              <li>
                <strong>换三张</strong>选择同一花色的三张牌，与下家顺时针交换。
              </li>
              <li>
                <strong>定缺</strong>
                换牌后再选本局不要的花色；有缺门牌时必须先打完。
              </li>
              <li>
                <strong>摸打与响应</strong>
                点击亮起的手牌出牌；别人出牌后按提示选择碰、杠、胡或过。
              </li>
              <li>
                <strong>血战到底</strong>
                胡牌者退出，其余玩家继续，直到三家胡牌或牌墙摸尽。
              </li>
            </ol>
            <p className="dialogIntro">
              本桌采用项目 V1
              规则。出牌建议只用你的手牌与公开信息，详细依据会说明估算的局限。
            </p>
          </GameDialog>
          <GameDialog title="对局记录">
            <p className="dialogIntro">最近 30 条公开动作</p>
            <ol className="historyList">
              {game.log.slice(-30).map((entry, index) => (
                <li key={`${game.log.length}-${index}`}>{entry}</li>
              ))}
            </ol>
          </GameDialog>
        </div>
      </footer>
    </main>
  );
}
export default App;
