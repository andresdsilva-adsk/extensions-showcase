/**
 * Headless sanity checks for agent pheromone simulation.
 * Uses aggregate metrics (active cells, spatial spread) similar to Shanon analyze.py.
 */
import { runAgentSimulation, countActivePheromoneCells } from "../src/movement/agents";
import { gridIndex } from "../src/movement/grid";
import { dijkstraFromGoals } from "../src/movement/pathfinding";
import {
  DEFAULT_AGENT_WEIGHTS,
  IMPASSABLE,
  type GridSpec,
  type Point,
} from "../src/movement/types";

const THRESHOLD = 1e-4;

function makeFixture(): {
  grid: GridSpec;
  sources: Point[];
  destinations: Point[];
  costGrid: number[][];
  roadMask: Uint8Array;
  buildingMask: Uint8Array;
} {
  const nx = 80;
  const ny = 80;
  const cellSize = 2;
  const grid: GridSpec = {
    nx,
    ny,
    cellSize,
    bbox: { min: { x: 0, y: 0 }, max: { x: (nx - 1) * cellSize, y: (ny - 1) * cellSize } },
  };

  const costGrid: number[][] = Array.from({ length: nx }, () =>
    Array.from({ length: ny }, () => 1),
  );
  const roadMask = new Uint8Array(nx * ny);
  const buildingMask = new Uint8Array(nx * ny);

  // Block a central building blob — forces paths around it.
  for (let col = 32; col <= 48; col++) {
    for (let row = 32; row <= 48; row++) {
      costGrid[col][row] = IMPASSABLE;
      buildingMask[gridIndex(col, row, nx)] = 1;
    }
  }

  // Horizontal road band.
  for (let col = 0; col < nx; col++) {
    roadMask[gridIndex(col, 40, nx)] = 1;
    costGrid[col][40] = 0.2;
  }

  const sources: Point[] = [
    { x: 10, y: 140 },
    { x: 10, y: 70 },
    { x: 10, y: 20 },
  ];
  const destinations: Point[] = [
    { x: 150, y: 140 },
    { x: 150, y: 70 },
    { x: 150, y: 20 },
  ];

  return { grid, sources, destinations, costGrid, roadMask, buildingMask };
}

interface PheromoneMetrics {
  activeCells: number;
  bboxWidth: number;
  bboxHeight: number;
  thinAxis: number;
  fillRatio: number;
  topShare: number;
}

function measurePheromone(pheromone: Float32Array, nx: number, ny: number): PheromoneMetrics {
  let minCol = nx;
  let maxCol = 0;
  let minRow = ny;
  let maxRow = 0;
  let activeCells = 0;
  let total = 0;
  const values: number[] = [];

  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const v = pheromone[gridIndex(col, row, nx)];
      if (v <= THRESHOLD) continue;
      activeCells += 1;
      total += v;
      values.push(v);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }

  if (activeCells === 0) {
    return {
      activeCells: 0,
      bboxWidth: 0,
      bboxHeight: 0,
      thinAxis: 0,
      fillRatio: 0,
      topShare: 1,
    };
  }

  const bboxWidth = maxCol - minCol + 1;
  const bboxHeight = maxRow - minRow + 1;
  values.sort((a, b) => b - a);
  const topCount = Math.max(1, Math.floor(values.length * 0.01));
  const topSum = values.slice(0, topCount).reduce((a, b) => a + b, 0);

  return {
    activeCells,
    bboxWidth,
    bboxHeight,
    thinAxis: Math.min(bboxWidth, bboxHeight),
    fillRatio: activeCells / (bboxWidth * bboxHeight),
    topShare: topSum / total,
  };
}

function runOnce(seed: number) {
  const originalRandom = Math.random;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const { grid, sources, destinations, costGrid, roadMask, buildingMask } = makeFixture();
  const goals = destinations.map((p) => ({
    col: Math.round(p.x / grid.cellSize),
    row: Math.round((grid.bbox.max.y - p.y) / grid.cellSize),
  }));
  const costField = dijkstraFromGoals(costGrid, goals);
  const result = runAgentSimulation(
    grid,
    sources,
    destinations,
    roadMask,
    buildingMask,
    {
      agentCount: 300,
      steps: 800,
      weights: DEFAULT_AGENT_WEIGHTS,
      costField,
    },
  );

  Math.random = originalRandom;
  const metrics = measurePheromone(result.pheromone, grid.nx, grid.ny);
  const counted = countActivePheromoneCells(result.pheromone);
  return { metrics, counted, activeCells: result.activeCells };
}

function main(): void {
  const runs = [runOnce(42), runOnce(99), runOnce(1234)];
  const medActive = runs.map((r) => r.activeCells).sort((a, b) => a - b)[1];
  const medThin = runs.map((r) => r.metrics.thinAxis).sort((a, b) => a - b)[1];
  const medFill = runs.map((r) => r.metrics.fillRatio).sort((a, b) => a - b)[1];

  const failures: string[] = [];

  if (medActive < 40) {
    failures.push(`median activeCells=${medActive} (expected >= 40)`);
  }
  if (medThin < 8) {
    failures.push(`median thinAxis=${medThin} — looks like a single line (expected >= 8)`);
  }
  if (medFill < 0.02) {
    failures.push(`median fillRatio=${medFill.toFixed(4)} — trails too concentrated (expected >= 0.02)`);
  }

  for (const [i, run] of runs.entries()) {
    if (run.counted !== run.activeCells) {
      failures.push(`run ${i}: countActivePheromoneCells mismatch`);
    }
  }

  console.log("Agent simulation sanity check");
  console.log(`  runs: ${runs.length}`);
  console.log(`  median activeCells: ${medActive}`);
  console.log(`  median thinAxis: ${medThin}`);
  console.log(`  median fillRatio: ${medFill.toFixed(4)}`);
  console.log(`  sample topShare: ${runs[0].metrics.topShare.toFixed(3)}`);

  if (failures.length > 0) {
    console.error("FAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("PASS");
}

main();
