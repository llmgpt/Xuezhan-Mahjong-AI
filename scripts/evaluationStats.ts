export interface PairedSummary {
  meanScoreDifference: number;
  standardError: number | null;
  betterSeedFraction: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pairedSummary(differences: readonly number[]): PairedSummary {
  if (differences.length === 0) throw new Error("至少需要一个配对种子");
  const average = mean(differences);
  const squaredDeviations = differences.reduce(
    (sum, value) => sum + (value - average) ** 2,
    0,
  );
  return {
    meanScoreDifference: average,
    standardError:
      differences.length > 1
        ? Math.sqrt(
            squaredDeviations / ((differences.length - 1) * differences.length),
          )
        : null,
    betterSeedFraction: mean(differences.map((value) => Number(value > 0))),
  };
}

// 同一种子的四个座位可能相关；先合成种子均值，再按种子估计标准误。
export function seatClusterSummary(
  differencesBySeed: readonly (readonly number[])[],
): PairedSummary {
  if (differencesBySeed.some((row) => row.length === 0))
    throw new Error("每个种子至少需要一个座位");
  return pairedSummary(differencesBySeed.map(mean));
}
