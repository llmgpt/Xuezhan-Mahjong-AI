import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AdviceCoach } from "./components/AdviceCoach";
import { GameDialog } from "./components/GameDialog";
import { MahjongFace, TileBack, TilePiece } from "./components/MahjongTile";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { buildSettlementDetails } from "./components/settlementDetails";
import {
  TurnReviewDialog,
  type TurnReview,
} from "./components/TurnReviewDialog";
import { actionKey } from "./game/actionAdvice";
import { completeExchange, completeMissing } from "./game/demo";
import {
  countTiles,
  createGame,
  legalResponses,
  legalSelfActions,
  type GameState,
  type Phase,
  type PlayerState,
  type ResponseChoice,
} from "./game/game";
import { advanceToHuman, type PlayerAction } from "./game/session";
import { applyDecisionAction, type DecisionAction } from "./game/decision";
import { labelOf, suitOf, type Suit, type Tile } from "./game/tiles";
import { playerView, type PlayerView } from "./game/view";
import {
  announceAdvice,
  announceAutoplayStart,
  announceGameDecision,
  announceSoundEnabled,
  availableChineseVoices,
  cueForAction,
  playCue,
  previewVoice,
  setPreferredVoice,
  stopAnnouncements,
} from "./sound";
import { newGameSeed } from "./newGameSeed";
import type { AdvancedAssets, Position } from "./strategy/advancedProtocol";
import { explainProductionAction } from "./strategy/productionAdvice";
import {
  useProductionAdvice,
  type ProductionStrategyMode,
} from "./strategy/useProductionAdvice";
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
function voiceLabel(voice: SpeechSynthesisVoice) {
  const familiar = voice.name.match(/Microsoft (Huihui|Kangkang|Yaoyao)/i)?.[1];
  const names: Record<string, string> = {
    huihui: "慧慧",
    kangkang: "康康",
    yaoyao: "瑶瑶",
  };
  const display = familiar ? names[familiar.toLowerCase()] : voice.name;
  return `${display}（${voice.localService ? "本机" : "在线"}）`;
}
function Score({ value }: { value: number }) {
  return (
    <b className={value >= 0 ? "positive" : "negative"}>
      {value > 0 ? "+" : ""}
      {value}
    </b>
  );
}
export interface DisplayTile {
  tile: Tile;
  index: number;
  drawn: boolean;
  received?: boolean;
}

export function orderHandForDisplay(
  hand: readonly Tile[],
  phase: Phase,
  turn: number,
  lastDraw?: { seat: number; tile: Tile },
  receivedTiles?: readonly Tile[],
): DisplayTile[] {
  const hasDrawn =
    phase === "discard" &&
    turn === 0 &&
    lastDraw?.seat === 0 &&
    hand.length > 0 &&
    hand[hand.length - 1] === lastDraw.tile;
  const bodyCount = hasDrawn ? hand.length - 1 : hand.length;
  const body: DisplayTile[] = hand
    .slice(0, bodyCount)
    .map((tile, index) => ({ tile, index, drawn: false }))
    .sort((a, b) => a.tile - b.tile || a.index - b.index);
  if (!hasDrawn && phase !== "exchange" && receivedTiles?.length) {
    const remaining = new Map<Tile, number>();
    for (const tile of receivedTiles) {
      remaining.set(tile, (remaining.get(tile) ?? 0) + 1);
    }
    for (let index = body.length - 1; index >= 0; index -= 1) {
      const count = remaining.get(body[index].tile) ?? 0;
      if (count > 0) {
        body[index].received = true;
        remaining.set(body[index].tile, count - 1);
      }
    }
  }
  if (!hasDrawn) return body;
  return [
    ...body,
    {
      tile: hand[hand.length - 1],
      index: hand.length - 1,
      drawn: true,
    },
  ];
}

export function activeTableDiscard(
  game: GameState,
): { seat: number; tile: Tile } | undefined {
  if (game.pending) return { seat: game.pending.from, tile: game.pending.tile };
  if (!game.lastDiscard) return undefined;
  for (let index = game.publicActions.length - 1; index >= 0; index -= 1) {
    const action = game.publicActions[index];
    if (action.kind === "draw") continue;
    return action.kind === "discard" ? game.lastDiscard : undefined;
  }
  return game.lastDiscard;
}

export function formatLogEntry(entry: string): string {
  return entry.replace(
    /([0-3])\s*号玩家/g,
    (_, seatIndex: string) => names[Number(seatIndex)] ?? `${seatIndex} 号玩家`,
  );
}

export function Melds({ player }: { player: PlayerState }) {
  return (
    <div className="melds">
      {player.melds.map((meld, index) => {
        const isConcealed =
          meld.type === "kong" && meld.kongKind === "concealed";
        const kindText = isConcealed
          ? "暗杠"
          : meld.type === "kong"
            ? "杠"
            : "碰";
        return (
          <div
            className={`meldGroup ${isConcealed ? "is-concealed" : ""}`}
            key={index}
            aria-label={`${kindText}${labelOf(meld.tile)}`}
          >
            <span className="meldLabel">{kindText}</span>
            {Array.from({ length: meld.type === "kong" ? 4 : 3 }, (_, copy) =>
              isConcealed && (copy === 0 || copy === 3) ? (
                <span
                  className="mahjongTile tile-meld meldTileBack"
                  key={copy}
                  aria-hidden="true"
                >
                  <i />
                </span>
              ) : (
                <TilePiece tile={meld.tile} className="tile-meld" key={copy} />
              ),
            )}
          </div>
        );
      })}
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
      <div className="opponentTiles">
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
    </div>
  );
}

function formatChosenLabel(action: DecisionAction, view: PlayerView): string {
  switch (action.type) {
    case "exchange":
      return `换出 ${action.tiles.map(labelOf).join("、")}`;
    case "missing":
      return `定缺 ${suitLabel(action.suit)}`;
    case "discard":
      return `打出 ${labelOf(action.tile)}`;
    case "win":
      return "自摸胡";
    case "kong":
      return `${action.kind === "concealed" ? "暗杠" : "补杠"} ${labelOf(action.tile)}`;
    case "respond": {
      if (
        action.choice === "hu" &&
        view.decision?.kind === "respond" &&
        view.decision.responseKind === "rob-kong"
      ) {
        return `抢杠胡 ${labelOf(view.decision.tile)}`;
      }
      const verb = { pass: "过", pung: "碰", kong: "直杠", hu: "点胡" }[
        action.choice
      ];
      return action.choice === "pass" || view.decision?.kind !== "respond"
        ? verb
        : `${verb} ${labelOf(view.decision.tile)}`;
    }
  }
}

export interface AppProps {
  strategyMode?: ProductionStrategyMode;
  strategyAssets?: AdvancedAssets;
  initialSeed?: number;
  thinkFirst?: boolean;
}
function readThinkFirstPreference(): boolean {
  try {
    return window.localStorage.getItem("xuezhan.thinkFirst") !== "false";
  } catch {
    return true;
  }
}
function App({
  strategyMode = "teacher",
  strategyAssets,
  initialSeed,
  thinkFirst: initialThinkFirst,
}: AppProps = {}) {
  const [startingSeed] = useState(() => initialSeed ?? newGameSeed());
  const [seedText, setSeedText] = useState(String(startingSeed));
  const [game, setGame] = useState(() => createGame(startingSeed));
  const [selected, setSelected] = useState<number[]>([]);
  const [exchangeSummary, setExchangeSummary] = useState<{
    out: Tile[];
    in: Tile[];
  } | null>(null);
  const [notice, setNotice] = useState(
    "选择同一花色的三张牌，传给下家（逆时针交换）。",
  );
  const [autoPlay, setAutoPlay] = useState(false);
  const autoEnabled = useRef(false);
  const [thinkFirst, setThinkFirst] = useState(
    () => initialThinkFirst ?? readThinkFirstPreference(),
  );
  const [revealed, setRevealed] = useState(false);
  const [lastReview, setLastReview] = useState<TurnReview | null>(null);
  const [position, setPosition] = useState<Position>({
    session: 0,
    revision: 0,
  });
  const livePosition = useRef(position);
  livePosition.current = position;
  const liveGame = useRef(game);
  liveGame.current = game;
  const pauseAuto = useCallback(() => {
    autoEnabled.current = false;
    setAutoPlay(false);
  }, []);
  const [autoDelay, setAutoDelay] = useState(3000);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("xuezhan.soundEnabled") !== "false";
    } catch {
      return true;
    }
  });
  const [voiceName, setVoiceName] = useState(() => {
    try {
      return window.localStorage.getItem("xuezhan.voiceName") ?? "";
    } catch {
      return "";
    }
  });
  const [voiceOptions, setVoiceOptions] = useState(availableChineseVoices);
  const narration = useRef<Promise<void>>(Promise.resolve());
  const hand = game.players[0].hand;
  const sortedHand = orderHandForDisplay(
    hand,
    game.phase,
    game.turn,
    game.lastDraw,
    exchangeSummary?.in,
  );
  const view = useMemo(() => playerView(game, 0), [game]);
  const strategy = useProductionAdvice(
    view,
    game.phase,
    strategyMode,
    strategyAssets,
    position,
  );
  const legal = useMemo(() => new Set(view.legalDiscards), [view]);
  const selfActions = legalSelfActions(game, 0);
  const recommendation =
    strategy.current.status === "ready"
      ? strategy.current.presentation
      : undefined;
  const showRecommendation = !(thinkFirst && !autoPlay) || revealed;
  const suggestedAction = showRecommendation
    ? recommendation?.action
    : undefined;
  const suggestedKey =
    suggestedAction &&
    suggestedAction.type !== "exchange" &&
    suggestedAction.type !== "missing"
      ? actionKey(suggestedAction)
      : undefined;
  const suggestedDiscard =
    suggestedAction?.type === "discard" ? suggestedAction.tile : undefined;
  const responses = legalResponses(game, 0);
  const exchangeTiles = selected.map((index) => hand[index]);
  const validExchange =
    exchangeTiles.length === 3 &&
    exchangeTiles.every((item) => suitOf(item) === suitOf(exchangeTiles[0]));
  const currentLabel =
    game.pending?.kind === "rob-kong" ? "抢杠响应" : phaseLabels[game.phase];
  const displayedTile = activeTableDiscard(game);
  const settlement = useMemo(
    () =>
      game.phase === "ended" || game.transfers.length > 0
        ? buildSettlementDetails(game, names)
        : null,
    [game],
  );

  const commitHuman = useCallback(
    (action: DecisionAction, expectedKey?: string) => {
      if (
        liveGame.current !== game ||
        (expectedKey !== undefined &&
          (!autoEnabled.current || !strategy.isCurrent(expectedKey)))
      )
        return;
      try {
        const immediate = applyDecisionAction(game, 0, action);
        const currentRecommendation = strategy.isCurrent(strategy.current.key)
          ? recommendation
          : undefined;
        const topChoice = currentRecommendation?.choices[0];
        const explanation = soundEnabled
          ? explainProductionAction(view, action, currentRecommendation)
          : undefined;
        const next =
          action.type === "exchange"
            ? completeExchange(game, action.tiles)
            : action.type === "missing"
              ? advanceToHuman(completeMissing(game, action.suit))
              : advanceToHuman(immediate);
        const nextPosition = {
          ...livePosition.current,
          revision: livePosition.current.revision + 1,
        };
        strategy.advance(nextPosition);
        livePosition.current = nextPosition;
        liveGame.current = next;
        setPosition(nextPosition);
        setGame(next);
        setSelected([]);
        setRevealed(false);
        const receivedExchange =
          action.type === "exchange"
            ? next.players[0].hand.slice(-3)
            : undefined;
        if (action.type === "exchange") {
          setExchangeSummary({
            out: [...action.tiles],
            in: receivedExchange!,
          });
        } else if (action.type !== "missing") {
          setExchangeSummary(null);
        }
        setLastReview({
          view,
          phase: game.phase,
          chosenAction: action,
          chosenLabel: formatChosenLabel(action, view),
          recommendedLabel: topChoice?.label,
          recommendedAction: currentRecommendation?.action,
          recommendationSummary: topChoice?.summary,
          recommendationReason: topChoice?.reason,
          recommendationLimit: topChoice?.limit,
        });
        if (next.phase === "ended") pauseAuto();
        if (soundEnabled) {
          playCue(cueForAction(action, next.phase === "ended"));
          narration.current = announceGameDecision(
            explanation!,
            next.log.slice(game.log.length),
          );
        } else narration.current = Promise.resolve();
        setNotice(
          next.phase === "ended"
            ? "本局已结算，可查看得分与胡牌记录。"
            : next.phase === "choose-missing"
              ? `${receivedExchange ? `已换出 ${action.type === "exchange" ? action.tiles.map(labelOf).join("、") : ""}，换入 ${receivedExchange.map(labelOf).join("、")}。` : ""}选择本局不要的花色，之后先打完这门牌。`
              : next.phase === "respond"
                ? "选择胡、碰、杠，或点击过。"
                : "点选亮起的手牌直接出牌。",
        );
      } catch (error) {
        setNotice((error as Error).message);
        pauseAuto();
      }
    },
    [game, soundEnabled, view, strategy, recommendation, pauseAuto],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem("xuezhan.soundEnabled", String(soundEnabled));
    } catch {
      // 本地存储不可用时，本页开关仍可使用。
    }
  }, [soundEnabled]);

  useEffect(() => {
    setPreferredVoice(voiceName);
    try {
      window.localStorage.setItem("xuezhan.voiceName", voiceName);
    } catch {
      // 本地存储不可用时，本页仍可选择声音。
    }
  }, [voiceName]);

  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return;
    const refresh = () => setVoiceOptions(availableChineseVoices());
    refresh();
    synthesis.addEventListener("voiceschanged", refresh);
    return () => synthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    if (
      voiceName &&
      voiceOptions.length > 0 &&
      !voiceOptions.some((voice) => voice.name === voiceName)
    )
      setVoiceName("");
  }, [voiceName, voiceOptions]);

  useEffect(() => {
    if (strategy.current.status === "error") {
      pauseAuto();
      setNotice(strategy.current.error);
    }
  }, [strategy.current, pauseAuto]);

  useEffect(() => {
    pauseAuto();
    stopAnnouncements();
  }, [
    strategyMode,
    strategyAssets?.runtimeModuleUrl,
    strategyAssets?.runtimeIndexUrl,
    strategyAssets?.payloadUrl,
    pauseAuto,
  ]);

  useEffect(() => {
    if (
      !autoPlay ||
      game.phase === "ended" ||
      strategy.current.status !== "ready"
    )
      return;
    const snapshotKey = strategy.current.key;
    const action = strategy.current.presentation.action;
    let active = true;
    let timer: number | undefined;
    void narration.current.then(() => {
      if (!active || !autoEnabled.current || !strategy.isCurrent(snapshotKey))
        return;
      timer = window.setTimeout(() => {
        try {
          if (active && autoEnabled.current && strategy.isCurrent(snapshotKey))
            commitHuman(action, snapshotKey);
        } catch (error) {
          setNotice((error as Error).message);
          pauseAuto();
        }
      }, autoDelay);
    });
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [autoPlay, autoDelay, game, commitHuman, strategy, pauseAuto]);

  function startGame(seed: number) {
    const next = createGame(seed),
      nextPosition = { session: livePosition.current.session + 1, revision: 0 };
    strategy.advance(nextPosition);
    livePosition.current = nextPosition;
    liveGame.current = next;
    setPosition(nextPosition);
    setGame(next);
    setSeedText(String(seed));
    setSelected([]);
    setExchangeSummary(null);
    setRevealed(false);
    setLastReview(null);
    pauseAuto();
    stopAnnouncements();
    setNotice("选择同一花色的三张牌，传给下家（逆时针交换）。");
  }
  function restartWithSeed() {
    const seed = Number(seedText);
    if (!seedText.trim() || !Number.isSafeInteger(seed)) {
      setNotice("种子须为安全整数。");
      return false;
    }
    startGame(seed);
    return true;
  }
  function startRandomGame() {
    startGame(newGameSeed(game.seed));
  }
  function toggle(index: number) {
    if (game.phase !== "exchange") return;
    pauseAuto();
    if (soundEnabled) playCue("select");
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
    pauseAuto();
    commitHuman({ type: "exchange", tiles: exchangeTiles });
  }
  function selectMissing(missing: Suit) {
    pauseAuto();
    commitHuman({ type: "missing", suit: missing });
  }
  function act(action: PlayerAction) {
    pauseAuto();
    commitHuman(action);
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
          <GameDialog
            title="牌局设置"
            triggerClassName="settingsButton"
            onOpen={() => {
              pauseAuto();
              stopAnnouncements();
            }}
          >
            <div className="settingsPopover">
              <label htmlFor="seed">固定种子</label>
              <input
                id="seed"
                value={seedText}
                inputMode="numeric"
                onChange={(event) => setSeedText(event.target.value)}
              />
              <p>
                本局种子：{game.seed}
                。输入相同种子与选择可以重现同一局；随机开局会生成新种子。
              </p>
              <label htmlFor="auto-delay">托管节奏</label>
              <select
                id="auto-delay"
                value={autoDelay}
                onChange={(event) => setAutoDelay(Number(event.target.value))}
              >
                <option value={3000}>舒适 · 本家每次选择前 3 秒</option>
                <option value={5000}>慢速 · 本家每次选择前 5 秒</option>
                <option value={1000}>快速 · 本家每次选择前 1 秒</option>
              </select>
              <p>
                只托管你的操作；三名对手照常行牌。打开设置、复盘或朗读时会暂停托管。
              </p>
              <button
                className="soundToggle"
                type="button"
                aria-pressed={soundEnabled}
                onClick={() => {
                  if (soundEnabled) stopAnnouncements();
                  else {
                    playCue("select");
                    announceSoundEnabled();
                  }
                  setSoundEnabled(!soundEnabled);
                }}
              >
                声效与中文报牌：{soundEnabled ? "开" : "关"}
              </button>
              <p>
                换三张、定缺和清缺门只报结果；其他选择播报简短结论。详细依据可在展开建议后点击“朗读”。碰、杠、胡与结算也有语音或提示音。
              </p>
              <label htmlFor="voice-choice">中文朗读声音</label>
              <select
                id="voice-choice"
                value={voiceName}
                onChange={(event) => {
                  setVoiceName(event.target.value);
                  setPreferredVoice(event.target.value);
                }}
              >
                <option value="">自动选择</option>
                {voiceOptions.map((voice) => (
                  <option
                    key={`${voice.lang}:${voice.name}`}
                    value={voice.name}
                  >
                    {voiceLabel(voice)}
                  </option>
                ))}
              </select>
              <button
                className="voicePreview"
                type="button"
                disabled={!soundEnabled}
                onClick={previewVoice}
              >
                试听当前声音
              </button>
              <p>
                声音由浏览器提供。在线声音可能通过浏览器的远程语音服务朗读文字；本机声音不需要该服务。
              </p>
              <small>本局牌数：{countTiles(game)} / 108</small>
              <button
                type="button"
                onClick={(event) => {
                  if (restartWithSeed())
                    event.currentTarget.closest("dialog")?.close();
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
          <button
            className="newGameButton"
            type="button"
            onClick={startRandomGame}
          >
            <span>↻</span> 随机开局
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
          <AdviceCoach
            advice={[]}
            view={view}
            current={strategy.current}
            hidden={!showRecommendation}
            onReveal={() => setRevealed(true)}
            onSpeak={soundEnabled ? announceAdvice : undefined}
            onOpen={() => {
              pauseAuto();
              stopAnnouncements();
            }}
          />
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
                {sortedHand.map(({ tile, index, drawn, received }) => {
                  const canPlay =
                    game.phase === "discard" &&
                    game.turn === 0 &&
                    legal.has(tile);
                  const recommended = suggestedDiscard === tile && canPlay;
                  return (
                    <button
                      className={`tile mahjongTile ${selected.includes(index) ? "selected" : ""} ${canPlay ? "playable" : ""} ${recommended ? "recommended" : ""} ${drawn ? "tile-drawn" : ""} ${received && !drawn ? "tile-received" : ""} ${game.phase === "discard" && !canPlay ? "unavailable" : ""}`}
                      key={index}
                      type="button"
                      disabled={game.phase !== "exchange" && !canPlay}
                      aria-label={`${labelOf(tile)}${drawn ? "，新摸" : received ? "，刚换入" : ""}${recommended ? "，推荐" : ""}`}
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
                      {drawn && <span className="drawnMark">摸</span>}
                      {!drawn && received && (
                        <span className="receivedMark">入</span>
                      )}
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
                {settlement?.winLines.length ? (
                  settlement.winLines.map((win) => (
                    <p key={win.key}>
                      <span>{win.headline}</span>
                      <b>
                        {win.patterns} · +{win.netPoints} 分
                      </b>
                    </p>
                  ))
                ) : (
                  <p>本局无人胡牌</p>
                )}
                {settlement?.kongLines.map((line) => (
                  <p className="settlementSubLine" key={line}>
                    <span>{line}</span>
                  </p>
                ))}
                {game.endReason === "wall" && settlement && (
                  <div className="settlementFlowBox">
                    <div className="settlementStatusRow">
                      {settlement.playerStatuses.map((item) => (
                        <span
                          className={`statusPill status-${item.status}`}
                          key={item.seat}
                        >
                          {item.name}：{item.status}
                          {item.detail ? `（${item.detail}）` : ""}
                        </span>
                      ))}
                    </div>
                    {settlement.flowLines.length > 0 ? (
                      settlement.flowLines.map((line, index) => (
                        <p className="settlementSubLine" key={index}>
                          <span>{line}</span>
                        </p>
                      ))
                    ) : (
                      <p className="settlementSubLine">
                        <span>未胡各家无需赔付花猪或查叫。</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="resultLearningActions">
                <button
                  className="gameButton primary"
                  type="button"
                  onClick={startRandomGame}
                >
                  再来一局
                </button>
              </div>
            </section>
          </div>
        )}
      </section>

      <footer className="tableToolbar">
        <div className="learningTools">
          <button
            className="textButton"
            type="button"
            disabled={
              game.phase === "ended" || strategy.current.status === "error"
            }
            onClick={() => {
              if (autoPlay) stopAnnouncements();
              else if (soundEnabled) {
                playCue("select");
                narration.current = announceAutoplayStart();
              }
              autoEnabled.current = !autoPlay;
              setAutoPlay(!autoPlay);
            }}
          >
            {autoPlay ? "暂停托管" : "自动托管"}
          </button>
          <button
            className={`textButton thinkToggle ${thinkFirst ? "active" : ""}`}
            type="button"
            aria-pressed={thinkFirst}
            onClick={() => {
              const next = !thinkFirst;
              setThinkFirst(next);
              setRevealed(false);
              try {
                window.localStorage.setItem("xuezhan.thinkFirst", String(next));
              } catch {
                // 忽略本地存储不可用
              }
            }}
          >
            {thinkFirst ? "先想后看：开" : "先想后看：关"}
          </button>
          <TurnReviewDialog
            review={lastReview}
            onOpen={() => {
              pauseAuto();
              stopAnnouncements();
            }}
          />
        </div>
        <div>
          <GameDialog title="玩法提示">
            <ol className="rulesHelp">
              <li>
                <strong>换三张</strong>
                选择同一花色的三张牌，逆时针传给下家（你 → 阿川 → 小满 →
                老茶客）。
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
            <div className="rulesScoringBox">
              <h3>番型与算分速查（V1 默认规则）</h3>
              <ul>
                <li>
                  基础番型：平胡 0 番（1 分）、对对胡 +1 番、清一色 +2 番、七对
                  +2 番、每个根 +1 番。
                </li>
                <li>
                  加番与封顶：杠上花 / 杠后炮 / 抢杠胡 / 海底胡各 +1
                  番；累计封顶 3 番（8 分）。
                </li>
                <li>
                  自摸与杠钱：点胡由放铳者独付；自摸由当时每位未胡对手各付「牌型分
                  + 1」。直杠收放杠者 2 分，暗杠收未胡各家 2 分，补杠收未胡各家
                  1 分。
                </li>
                <li>
                  流局结算：未清缺为花猪，向其余未胡非花猪各赔 8
                  分；非花猪未听牌者向听牌者按其最高理论分查叫。
                </li>
              </ul>
            </div>
            <p className="dialogIntro">
              本桌采用项目 V1
              规则。出牌建议只用你的手牌与公开信息，详细依据会说明估算的局限。
            </p>
          </GameDialog>
          <GameDialog title="对局记录">
            <p className="dialogIntro">
              共 {game.log.length} 条公开动作（按时间顺序）
            </p>
            <ol className="historyList">
              {game.log.map((entry, index) => (
                <li key={`${index}-${entry}`}>{formatLogEntry(entry)}</li>
              ))}
            </ol>
            {settlement && settlement.transferLines.length > 0 && (
              <div className="ledgerSection">
                <h3>收支流水（共 {settlement.transferLines.length} 笔）</h3>
                <ol className="historyList">
                  {settlement.transferLines.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ol>
              </div>
            )}
          </GameDialog>
        </div>
      </footer>
    </main>
  );
}
export default App;
