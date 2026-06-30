import { gridIndex, inBounds, NEIGHBOR_OFFSETS, worldToGrid } from "./grid";
import type { FlowStats, GridSpec, Point } from "./types";
import { IMPASSABLE } from "./types";

export interface TrailOptions {
  walksPerSource: number;
  maxSteps: number;
  temperature: number;
}

const DEFAULT_TRAIL_OPTIONS: TrailOptions = {
  walksPerSource: 80,
  maxSteps: 2500,
  temperature: 2,
};

/**
 * Probabilistically walk from each source downhill on a cost field toward
 * destinations, accumulating a visit heatmap. Mirrors Pathmaker's map-based
 * trail simulation used for pedestrian desire-line analysis.
 */
export function simulateTrails(
  costField: number[][],
  sources: Point[],
  grid: GridSpec,
  options: Partial<TrailOptions> = {},
): { heatmap: Float32Array; stats: FlowStats } {
  const opts = { ...DEFAULT_TRAIL_OPTIONS, ...options };
  const heatmap = new Float32Array(grid.nx * grid.ny);
  let maxVisits = 0;
  let totalWalks = 0;
  let completedWalks = 0;

  for (const source of sources) {
    const start = worldToGrid(source, grid);

    for (let walk = 0; walk < opts.walksPerSource; walk++) {
      totalWalks += 1;
      let col = start.col;
      let row = start.row;
      let reachedGoal = false;

      for (let step = 0; step < opts.maxSteps; step++) {
        if (!inBounds(col, row, grid)) break;
        const currentCost = costField[col][row];
        if (currentCost === 0) {
          reachedGoal = true;
          break;
        }
        if (currentCost < 0 || currentCost >= IMPASSABLE) break;

        const idx = gridIndex(col, row, grid.nx);
        heatmap[idx] += 1;
        maxVisits = Math.max(maxVisits, heatmap[idx]);

        const neighbors: Array<[number, number, number]> = [];
        for (const [dc, dr] of NEIGHBOR_OFFSETS) {
          const nc = col + dc;
          const nr = row + dr;
          if (!inBounds(nc, nr, grid)) continue;
          const nCost = costField[nc][nr];
          if (nCost < 0 || nCost >= IMPASSABLE) continue;
          neighbors.push([nCost, nc, nr]);
        }
        if (neighbors.length === 0) break;

        const costs = neighbors.map(([c]) => c);
        const minCost = Math.min(...costs);
        const maxCost = Math.max(...costs);
        const range = maxCost - minCost || 1;

        const weights = neighbors.map(([c, nc, nr]) => {
          const preference = 1 - (c - minCost) / range + opts.temperature;
          return [preference, nc, nr] as const;
        });
        const sum = weights.reduce((acc, [w]) => acc + w, 0);
        const draw = Math.random() * sum;
        let cumulative = 0;
        let chosen = weights[0];
        for (const entry of weights) {
          cumulative += entry[0];
          if (draw <= cumulative) {
            chosen = entry;
            break;
          }
        }
        col = chosen[1];
        row = chosen[2];
      }

      if (reachedGoal) completedWalks += 1;
    }
  }

  return {
    heatmap,
    stats: { maxVisits, totalWalks, completedWalks },
  };
}

export function heatmapToCanvas(
  heatmap: Float32Array,
  grid: GridSpec,
  color: { r: number; g: number; b: number } = { r: 255, g: 80, b: 40 },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid.nx;
  canvas.height = grid.ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  let maxLog = 0;
  const logValues = new Float32Array(heatmap.length);
  for (let i = 0; i < heatmap.length; i++) {
    const logVal = Math.log(heatmap[i] + 1);
    logValues[i] = logVal;
    maxLog = Math.max(maxLog, logVal);
  }

  const image = ctx.createImageData(grid.nx, grid.ny);
  for (let i = 0; i < heatmap.length; i++) {
    const alpha = maxLog > 0 ? logValues[i] / maxLog : 0;
    image.data[i * 4 + 0] = color.r;
    image.data[i * 4 + 1] = color.g;
    image.data[i * 4 + 2] = color.b;
    image.data[i * 4 + 3] = Math.round(alpha * 220);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
