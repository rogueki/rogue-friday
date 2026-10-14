/** Draw-size counters registered by the layers; surfaced by the perf overlay (what the scene asks the GPU to draw). */
export const sceneStats = { segments: 0, plates: 0, nodes: 0, points: 0 };

export function registerStat(key: keyof typeof sceneStats, amount: number): () => void {
  sceneStats[key] += amount;
  return () => {
    sceneStats[key] -= amount;
  };
}
