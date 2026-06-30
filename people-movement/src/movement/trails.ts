import { gridIndex, inBounds, NEIGHBOR_OFFSETS, worldToGrid } from "./grid";
import type { FlowStats, GridSpec, Point, TrailSimulationResult } from "./types";
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
 * destinations, accumulating separate visit heatmaps for completed and
 * incomplete walks.
 */
export function simulateTrails(
  costField: number[][],
  sources: Point[],
  grid: GridSpec,
  options: Partial<TrailOptions> = {},
): TrailSimulationResult {
  const opts = { ...DEFAULT_TRAIL_OPTIONS, ...options };
  const heatmapCompleted = new Float32Array(grid.nx * grid.ny);
  const heatmapIncomplete = new Float32Array(grid.nx * grid.ny);
  let maxCompletedVisits = 0;
  let maxIncompleteVisits = 0;
  let totalWalks = 0;
  let completedWalks = 0;

  for (const source of sources) {
    const start = worldToGrid(source, grid);

    for (let walk = 0; walk < opts.walksPerSource; walk++) {
      totalWalks += 1;
      let col = start.col;
      let row = start.row;
      let reachedGoal = false;
      const trailCells: Array<[number, number]> = [];

      for (let step = 0; step < opts.maxSteps; step++) {
        if (!inBounds(col, row, grid)) break;
        const currentCost = costField[col][row];
        if (currentCost === 0) {
          reachedGoal = true;
          break;
        }
        if (currentCost < 0 || currentCost >= IMPASSABLE) break;

        trailCells.push([col, row]);

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

      const targetHeatmap = reachedGoal ? heatmapCompleted : heatmapIncomplete;
      if (reachedGoal) completedWalks += 1;

      for (const [c, r] of trailCells) {
        const idx = gridIndex(c, r, grid.nx);
        targetHeatmap[idx] += 1;
        if (reachedGoal) {
          maxCompletedVisits = Math.max(maxCompletedVisits, targetHeatmap[idx]);
        } else {
          maxIncompleteVisits = Math.max(maxIncompleteVisits, targetHeatmap[idx]);
        }
      }
    }
  }

  const stats: FlowStats = {
    maxVisits: Math.max(maxCompletedVisits, maxIncompleteVisits),
    maxCompletedVisits,
    maxIncompleteVisits,
    totalWalks,
    completedWalks,
  };

  return { heatmapCompleted, heatmapIncomplete, stats };
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

  const positives: number[] = [];
  for (let i = 0; i < heatmap.length; i++) {
    if (heatmap[i] > 0) positives.push(Math.log(heatmap[i] + 1));
  }
  positives.sort((a, b) => a - b);
  const maxLog =
    positives.length > 0
      ? positives[Math.min(positives.length - 1, Math.floor(positives.length * 0.98))]
      : 0;

  const image = ctx.createImageData(grid.nx, grid.ny);
  for (let i = 0; i < heatmap.length; i++) {
    const logVal = Math.log(heatmap[i] + 1);
    const alpha = maxLog > 0 ? Math.min(1, logVal / maxLog) : 0;
    image.data[i * 4 + 0] = color.r;
    image.data[i * 4 + 1] = color.g;
    image.data[i * 4 + 2] = color.b;
    image.data[i * 4 + 3] = Math.round(alpha * 220);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export interface FlowLayerVisibility {
  completed: boolean;
  incomplete: boolean;
}

export function compositeFlowCanvas(
  completed: Float32Array,
  incomplete: Float32Array,
  grid: GridSpec,
  visibility: FlowLayerVisibility,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid.nx;
  canvas.height = grid.ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (visibility.incomplete) {
    ctx.drawImage(
      heatmapToCanvas(incomplete, grid, { r: 90, g: 110, b: 210 }),
      0,
      0,
    );
  }
  if (visibility.completed) {
    ctx.drawImage(
      heatmapToCanvas(completed, grid, { r: 255, g: 80, b: 40 }),
      0,
      0,
    );
  }
  return canvas;
}
