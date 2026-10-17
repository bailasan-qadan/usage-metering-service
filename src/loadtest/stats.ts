export type Latency = { p50: number; p95: number; p99: number; max: number };

export function latencyOf(samples: number[]): Latency {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (percent: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((percent / 100) * sorted.length))] ?? 0;
  return {
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function tally(labels: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) {
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}
