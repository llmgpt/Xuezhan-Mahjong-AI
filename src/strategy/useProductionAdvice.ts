import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import { BrowserAdvancedClient } from "./advancedClient";
import type { AdvancedAssets, Position } from "./advancedProtocol";
import {
  ProductionAdviceGate,
  presentBrowserDecision,
  teacherPresentation,
  type ProductionAdviceState,
} from "./productionAdvice";

export type ProductionStrategyMode = "teacher" | "E" | "D" | "V10";
export function useProductionAdvice(
  view: PlayerView,
  phase: Phase,
  mode: ProductionStrategyMode,
  assets: AdvancedAssets | undefined,
  position: Position,
) {
  const gate = useRef(new ProductionAdviceGate());
  const holder = useRef<
    { key: string; client: BrowserAdvancedClient } | undefined
  >(undefined);
  const [saved, setSaved] = useState<ProductionAdviceState>({ status: "idle" });
  const stableAssets = useMemo(
    () =>
      assets
        ? {
            runtimeModuleUrl: assets.runtimeModuleUrl,
            runtimeIndexUrl: assets.runtimeIndexUrl,
            payloadUrl: assets.payloadUrl,
          }
        : undefined,
    [assets?.runtimeModuleUrl, assets?.runtimeIndexUrl, assets?.payloadUrl],
  );
  const assetsKey = JSON.stringify(stableAssets),
    key = JSON.stringify({ view, phase, mode, assets: stableAssets, position });
  gate.current.expect(key);
  const teacher = useMemo(
    () => (mode === "teacher" ? teacherPresentation(view, phase) : undefined),
    [mode, phase, view],
  );
  useEffect(() => {
    if (mode === "teacher") {
      holder.current?.client.close();
      holder.current = undefined;
      return;
    }
    if (!stableAssets) {
      setSaved({
        status: "error",
        key,
        error: "高级策略缺少本地运行资源地址；仍可手动操作。",
      });
      return;
    }
    try {
      if (!holder.current || holder.current.key !== assetsKey) {
        holder.current?.client.close();
        holder.current = {
          key: assetsKey,
          client: new BrowserAdvancedClient(stableAssets),
        };
      }
      const client = holder.current.client;
      client.setPosition(position);
      void gate.current
        .run(key, async () => {
          const decision = await client.choose(view, phase, {
            ...position,
            policy: mode,
          });
          return decision ? presentBrowserDecision(view, decision) : undefined;
        })
        .then((result) => {
          if (!result || !gate.current.isCurrent(key)) return;
          setSaved(
            "error" in result
              ? { status: "error", key, error: result.error }
              : result.value
                ? { status: "ready", key, presentation: result.value }
                : { status: "idle", key },
          );
        });
    } catch (error) {
      if (gate.current.isCurrent(key))
        setSaved({
          status: "error",
          key,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }, [key, assetsKey, stableAssets, mode, phase, position, view]);
  useEffect(
    () => () => {
      gate.current.invalidate();
      holder.current?.client.close();
      holder.current = undefined;
    },
    [],
  );
  const advance = useCallback((next: Position) => {
    gate.current.invalidate();
    holder.current?.client.setPosition(next);
  }, []);
  const isCurrent = useCallback(
    (snapshotKey: string | undefined) => gate.current.isCurrent(snapshotKey),
    [],
  );
  const current: ProductionAdviceState = useMemo(
    () =>
      mode === "teacher"
        ? teacher
          ? { status: "ready", key, presentation: teacher }
          : { status: "idle", key }
        : !stableAssets
          ? {
              status: "error",
              key,
              error: "高级策略缺少本地运行资源地址；仍可手动操作。",
            }
          : saved.key === key
            ? saved
            : { status: "loading", key },
    [mode, teacher, stableAssets, saved, key],
  );
  return useMemo(
    () => ({ current, advance, isCurrent }),
    [current, advance, isCurrent],
  );
}
