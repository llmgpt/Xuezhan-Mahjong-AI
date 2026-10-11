import type {
  DecisionAction,
  DecisionChoice,
  DecisionRecord,
} from "./game/decision";

export type SoundCue = "select" | "tile" | "meld" | "win" | "finish";

const numerals = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function cueForAction(action: DecisionAction, ended: boolean): SoundCue {
  if (
    action.type === "win" ||
    (action.type === "respond" && action.choice === "hu")
  )
    return "win";
  if (ended) return "finish";
  if (
    action.type === "kong" ||
    (action.type === "respond" && ["pung", "kong"].includes(action.choice))
  )
    return "meld";
  return action.type === "discard" ? "tile" : "select";
}

export function announcementsFromLogs(entries: readonly string[]): string[] {
  const announcements: string[] = [];
  for (const entry of entries) {
    const discard = entry.match(/^\d+ 号玩家打出 ([1-9])([万条筒])。$/);
    if (discard) {
      announcements.push(`${numerals[Number(discard[1])]}${discard[2]}`);
      continue;
    }
    const meld = entry.match(
      /^\d+ 号玩家(碰|直杠|暗杠|补杠) ([1-9])([万条筒])。$/,
    );
    if (meld) {
      announcements.push(
        `${meld[1] === "碰" ? "碰" : "杠"}${numerals[Number(meld[2])]}${meld[3]}`,
      );
      continue;
    }
    const win = entry.match(
      /^\d+ 号玩家(自摸|胡 \d+ 号玩家) ([1-9])([万条筒])，/,
    );
    if (win) {
      announcements.push(
        `${win[1] === "自摸" ? "自摸" : "胡牌"}${numerals[Number(win[2])]}${win[3]}`,
      );
      continue;
    }
    if (entry.endsWith("本局结束。")) announcements.push("本局结束");
  }
  return announcements;
}

export function announcementsForDecision(
  record: Pick<
    DecisionRecord,
    "actual" | "recommended" | "matchesRecommendation"
  >,
  entries: readonly string[],
): string[] {
  const publicActions = announcementsFromLogs(entries);
  const announcements =
    publicActions.length > 3
      ? [publicActions[0], ...publicActions.slice(-2)]
      : publicActions;
  if (record.matchesRecommendation)
    return [...announcements, `这步依据：${record.actual.reason}`];
  return [
    ...announcements,
    `你选择${record.actual.label}。这步依据：${record.actual.reason}`,
    `系统建议${record.recommended.label}。依据：${record.recommended.reason}`,
  ];
}

let audioContext: AudioContext | undefined;

function tap(context: AudioContext, at: number, volume: number, pitch: number) {
  const length = Math.ceil(context.sampleRate * 0.035);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1)
    samples[index] = (Math.random() * 2 - 1) * (1 - index / length);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(pitch, at);
  filter.Q.value = 1.1;
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(at);
  source.stop(at + 0.04);
}

function tone(
  context: AudioContext,
  at: number,
  frequency: number,
  duration: number,
) {
  const source = context.createOscillator();
  source.type = "sine";
  source.frequency.setValueAtTime(frequency, at);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.025, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(gain);
  gain.connect(context.destination);
  source.start(at);
  source.stop(at + duration + 0.01);
}

export function playCue(cue: SoundCue): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!audioContext || audioContext.state === "closed")
      audioContext = new window.AudioContext();
    if (audioContext.state === "suspended")
      void audioContext.resume().catch(() => {});
    const at = audioContext.currentTime;
    if (cue === "select") tap(audioContext, at, 0.018, 1500);
    if (cue === "tile") {
      tap(audioContext, at, 0.045, 1100);
      tone(audioContext, at, 260, 0.055);
    }
    if (cue === "meld") {
      tap(audioContext, at, 0.04, 1100);
      tap(audioContext, at + 0.09, 0.032, 850);
    }
    if (cue === "win")
      [523, 659, 784].forEach((frequency, index) =>
        tone(audioContext!, at + index * 0.1, frequency, 0.22),
      );
    if (cue === "finish") {
      tone(audioContext, at, 392, 0.22);
      tone(audioContext, at + 0.14, 330, 0.25);
    }
  } catch {
    // 浏览器不支持或拒绝音频时，牌局仍可正常操作。
  }
}

let completeCurrentSpeech: (() => void) | undefined;
let activeUtterances: SpeechSynthesisUtterance[] = [];
let preferredVoiceName = "";

type VoiceChoice = Pick<
  SpeechSynthesisVoice,
  "name" | "lang" | "localService" | "default"
>;

export function selectChineseVoice<T extends VoiceChoice>(
  voices: readonly T[],
  preferredName = "",
): T | undefined {
  const chinese = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("zh"),
  );
  const chosen = chinese.find((voice) => voice.name === preferredName);
  if (chosen) return chosen;
  const mandarin = chinese.filter((voice) =>
    voice.lang.toLowerCase().startsWith("zh-cn"),
  );
  const available = mandarin.length ? mandarin : chinese;
  return (
    available.find(
      (voice) => voice.localService && /natural|neural|自然/i.test(voice.name),
    ) ??
    available.find((voice) => voice.localService && voice.default) ??
    available.find((voice) => voice.localService) ??
    available.find((voice) => voice.default) ??
    available[0]
  );
}

export function availableChineseVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  try {
    return window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
  } catch {
    return [];
  }
}

export function setPreferredVoice(name: string): void {
  preferredVoiceName = name;
}

function speak(phrases: readonly string[]): Promise<void> {
  stopAnnouncements();
  if (
    phrases.length === 0 ||
    typeof window === "undefined" ||
    !window.speechSynthesis ||
    typeof SpeechSynthesisUtterance === "undefined"
  )
    return Promise.resolve();
  return new Promise((resolve) => {
    const synthesis = window.speechSynthesis;
    let timeout: number | undefined;
    const finish = () => {
      if (completeCurrentSpeech !== finish) return;
      completeCurrentSpeech = undefined;
      activeUtterances = [];
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve();
    };
    completeCurrentSpeech = finish;
    try {
      const voice = selectChineseVoice(
        synthesis.getVoices(),
        preferredVoiceName,
      );
      const queued = phrases.slice(-5);
      for (const [index, phrase] of queued.entries()) {
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = "zh-CN";
        utterance.rate = 1;
        utterance.volume = 0.8;
        if (voice) utterance.voice = voice;
        utterance.onerror = () => {
          if (completeCurrentSpeech === finish) stopAnnouncements();
        };
        if (index === queued.length - 1) utterance.onend = finish;
        activeUtterances.push(utterance);
        synthesis.speak(utterance);
      }
      // 有些浏览器不触发结束事件；超时后托管仍可继续。
      if (completeCurrentSpeech === finish)
        timeout = window.setTimeout(() => {
          stopAnnouncements();
        }, 60000);
    } catch {
      stopAnnouncements();
    }
  });
}

export function announceGameDecision(
  record: DecisionRecord,
  entries: readonly string[],
): Promise<void> {
  return speak(announcementsForDecision(record, entries));
}

export function announceAdvice(
  choice: Pick<DecisionChoice, "label" | "reason">,
): void {
  void speak([`建议${choice.label}。依据：${choice.reason}`]);
}

export function announceAutoplayStart(): Promise<void> {
  return speak(["开始托管"]);
}

export function announceSoundEnabled(): void {
  void speak(["报牌已开启"]);
}

export function previewVoice(): void {
  void speak(["三万。现在先打缺门牌，保留其他两门的搭子。"]);
}

export function stopAnnouncements(): void {
  completeCurrentSpeech?.();
  if (typeof window !== "undefined") {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // 浏览器禁用语音时仍允许暂停或重新开始牌局。
    }
  }
}
