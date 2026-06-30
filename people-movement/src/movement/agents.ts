import {
  bresenhamLine,
  gridIndex,
  gridToWorld,
  inBounds,
  worldToGrid,
} from "./grid";
import type { AgentWeights, GridSpec, Point } from "./types";
import { IMPASSABLE } from "./types";

export interface Agent {
  pos: Point;
  prevPos: Point;
  velocity: Point;
  targetType: "origin" | "destination";
  targetIndex: number;
  pheromoneLevel: number;
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(max: number): number {
  if (max <= 0) return 0;
  return Math.floor(Math.random() * max);
}

function normalize(vec: Point): Point {
  const dist = Math.hypot(vec.x, vec.y);
  if (dist < 1e-10) return { x: 0, y: 0 };
  return { x: vec.x / dist, y: vec.y / dist };
}

function multiply(vec: Point, factor: number): Point {
  return { x: vec.x * factor, y: vec.y * factor };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: b.y + b.y };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: b.y - b.y };
}

function length(vec: Point): number {
  return Math.hypot(vec.x, vec.y);
}

function setLength(vec: Point, target: number): Point {
  const dist = length(vec);
  if (dist < 1e-10) return { x: 0, y: 0 };
  return multiply(vec, target / dist);
}

function randomVelocity(speed: number): Point {
  const angle = random(0, Math.PI * 2);
  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

function samplePheromone(
  pheromone: Float32Array,
  grid: GridSpec,
  pos: Point,
  radiusCells = 2,
): number {
  const { col, row } = worldToGrid(pos, grid);
  let sum = 0;
  let count = 0;
  for (let dr = -radiusCells; dr <= radiusCells; dr++) {
    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr, grid)) continue;
      sum += pheromone[gridIndex(nc, nr, grid.nx)];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function pheromoneDirection(
  pheromone: Float32Array,
  grid: GridSpec,
  pos: Point,
  velocity: Point,
): Point {
  const probe = Math.max(grid.cellSize * 2, 3);
  const heading =
    length(velocity) > 1e-6 ? normalize(velocity) : randomVelocity(1);
  const angle = Math.atan2(heading.y, heading.x);
  const angleDiff = Math.PI / 6;
  const frontDir = heading;
  const leftDir = {
    x: Math.cos(angle + angleDiff),
    y: Math.sin(angle + angleDiff),
  };
  const rightDir = {
    x: Math.cos(angle - angleDiff),
    y: Math.sin(angle - angleDiff),
  };

  const front = samplePheromone(pheromone, grid, add(pos, multiply(frontDir, probe)));
  const left = samplePheromone(pheromone, grid, add(pos, multiply(leftDir, probe)));
  const right = samplePheromone(pheromone, grid, add(pos, multiply(rightDir, probe)));

  if (left > front && left > right) return normalize(multiply(leftDir, left));
  if (right > left && right > front) return normalize(multiply(rightDir, right));
  return normalize(multiply(frontDir, Math.max(front, 1e-6)));
}

function maskDirection(
  mask: Uint8Array,
  grid: GridSpec,
  pos: Point,
  velocity: Point,
  preferHigh: boolean,
): Point {
  const probe = Math.max(grid.cellSize * 1.5, 2);
  const heading =
    length(velocity) > 1e-6 ? normalize(velocity) : randomVelocity(1);
  const angle = Math.atan2(heading.y, heading.x);
  const angleDiff = Math.PI / 3;
  const frontDir = heading;
  const leftDir = {
    x: Math.cos(angle + angleDiff),
    y: Math.sin(angle + angleDiff),
  };
  const rightDir = {
    x: Math.cos(angle - angleDiff),
    y: Math.sin(angle - angleDiff),
  };

  const sample = (dir: Point): number => {
    const { col, row } = worldToGrid(add(pos, multiply(dir, probe)), grid);
    if (!inBounds(col, row, grid)) return preferHigh ? 0 : 1;
    return mask[gridIndex(col, row, grid.nx)];
  };

  const front = sample(frontDir);
  const left = sample(leftDir);
  const right = sample(rightDir);

  if (preferHigh) {
    if (left > front && left > right) return normalize(multiply(leftDir, left));
    if (right > left && right > front) return normalize(multiply(rightDir, right));
    return normalize(multiply(frontDir, Math.max(front, 1e-6)));
  }

  if (left < 1e-3 && right < 1e-3) return { x: 0, y: 0 };
  return left > right
    ? normalize(multiply(rightDir, 1 - right))
    : normalize(multiply(leftDir, 1 - left));
}

function pointDirection(agent: Agent, sources: Point[], destinations: Point[]): Point {
  const target =
    agent.targetType === "destination"
      ? destinations[agent.targetIndex]
      : sources[agent.targetIndex];
  if (!target) return { x: 0, y: 0 };
  return normalize(sub(target, agent.pos));
}

function costFieldDirection(
  costField: number[][],
  grid: GridSpec,
  pos: Point,
): Point {
  const { col, row } = worldToGrid(pos, grid);
  if (!inBounds(col, row, grid)) return { x: 0, y: 0 };

  const current = costField[col][row];
  if (current < 0 || current >= IMPASSABLE) return { x: 0, y: 0 };

  let bestCost = current;
  let bestWorld = pos;

  const offsets: Array<[number, number]> = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  for (const [dc, dr] of offsets) {
    const nc = col + dc;
    const nr = row + dr;
    if (!inBounds(nc, nr, grid)) continue;
    const nCost = costField[nc][nr];
    if (nCost < 0 || nCost >= IMPASSABLE) continue;
    if (nCost < bestCost) {
      bestCost = nCost;
      bestWorld = gridToWorld(nc, nr, grid);
    }
  }

  if (bestCost >= current) return { x: 0, y: 0 };
  return normalize(sub(bestWorld, pos));
}

function isImpassable(
  costField: number[][],
  grid: GridSpec,
  pos: Point,
): boolean {
  const { col, row } = worldToGrid(pos, grid);
  if (!inBounds(col, row, grid)) return true;
  return costField[col][row] >= IMPASSABLE;
}

function depositSegment(
  pheromone: Float32Array,
  grid: GridSpec,
  from: Point,
  to: Point,
  amount: number,
): void {
  const start = worldToGrid(from, grid);
  const end = worldToGrid(to, grid);
  const cells = bresenhamLine(start.col, start.row, end.col, end.row);

  for (const [col, row] of cells) {
    if (!inBounds(col, row, grid)) continue;
    const idx = gridIndex(col, row, grid.nx);
    pheromone[idx] += amount;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = col + dc;
        const nr = row + dr;
        if (!inBounds(nc, nr, grid)) continue;
        pheromone[gridIndex(nc, nr, grid.nx)] += amount * 0.35;
      }
    }
  }
}

function getTargetPosition(
  agent: Agent,
  sources: Point[],
  destinations: Point[],
): Point | undefined {
  return agent.targetType === "destination"
    ? destinations[agent.targetIndex]
    : sources[agent.targetIndex];
}

function updateTarget(
  agent: Agent,
  sources: Point[],
  destinations: Point[],
  threshold: number,
): void {
  const target = getTargetPosition(agent, sources, destinations);
  if (!target) return;
  if (length(sub(target, agent.pos)) >= threshold) return;

  agent.targetType = agent.targetType === "destination" ? "origin" : "destination";
  agent.targetIndex =
    agent.targetType === "destination"
      ? randomInt(destinations.length)
      : randomInt(sources.length);
  agent.pheromoneLevel = 1;
  agent.velocity = randomVelocity(0.5);
}

export interface AgentSimulationOptions {
  agentCount: number;
  steps: number;
  weights: AgentWeights;
  /** Dijkstra cost field from destinations — steers agents along walkable paths. */
  costField?: number[][];
}

export interface AgentSimulationResult {
  pheromone: Float32Array;
  grid: GridSpec;
  activeCells: number;
}

/**
 * Agent-based pedestrian simulation adapted from Pathmaker. Agents alternate
 * between origins and destinations, deposit pheromone along walked segments,
 * and follow pheromone / road / building / cost-field cues.
 */
export function runAgentSimulation(
  grid: GridSpec,
  sources: Point[],
  destinations: Point[],
  roadMask: Uint8Array,
  buildingMask: Uint8Array,
  options: AgentSimulationOptions,
): AgentSimulationResult {
  if (sources.length === 0 || destinations.length === 0) {
    return { pheromone: new Float32Array(grid.nx * grid.ny), grid, activeCells: 0 };
  }

  const pheromone = new Float32Array(grid.nx * grid.ny);
  const agents: Agent[] = Array.from({ length: options.agentCount }, () => {
    const sourceIndex = randomInt(sources.length);
    const pos = { ...sources[sourceIndex] };
    return {
      pos,
      prevPos: { ...pos },
      velocity: randomVelocity(options.weights.agentSpeed),
      targetType: "destination" as const,
      targetIndex: randomInt(destinations.length),
      pheromoneLevel: 1,
    };
  });

  const bbox = grid.bbox;
  const reachedThreshold = Math.max(grid.cellSize * 2, 3);
  const decay = 0.996;

  for (let step = 0; step < options.steps; step++) {
    for (const agent of agents) {
      agent.prevPos = { ...agent.pos };

      const pointEffect = pointDirection(agent, sources, destinations);
      const costEffect =
        agent.targetType === "destination" && options.costField
          ? costFieldDirection(options.costField, grid, agent.pos)
          : { x: 0, y: 0 };
      const steerTarget =
        length(costEffect) > 1e-6 ? costEffect : pointEffect;

      const pheromoneEffect = pheromoneDirection(
        pheromone,
        grid,
        agent.pos,
        agent.velocity,
      );
      const roadEffect = maskDirection(roadMask, grid, agent.pos, agent.velocity, true);
      const buildingEffect = maskDirection(
        buildingMask,
        grid,
        agent.pos,
        agent.velocity,
        false,
      );

      const combined = setLength(
        add(
          add(
            add(
              multiply(normalize(agent.velocity), options.weights.keepSpeed),
              multiply(pheromoneEffect, options.weights.pheromone),
            ),
            multiply(steerTarget, options.weights.destination),
          ),
          add(
            multiply(roadEffect, options.weights.road),
            add(
              multiply(buildingEffect, options.weights.building),
              multiply(
                { x: random(-1, 1), y: random(-1, 1) },
                options.weights.random,
              ),
            ),
          ),
        ),
        options.weights.agentSpeed,
      );

      agent.velocity = combined;
      let nextPos = add(agent.pos, agent.velocity);

      if (
        nextPos.x < bbox.min.x ||
        nextPos.x > bbox.max.x ||
        nextPos.y < bbox.min.y ||
        nextPos.y > bbox.max.y
      ) {
        agent.velocity = multiply(agent.velocity, -1);
        nextPos = add(agent.pos, agent.velocity);
      }

      if (options.costField && isImpassable(options.costField, grid, nextPos)) {
        agent.velocity = multiply(randomVelocity(1), options.weights.agentSpeed);
        nextPos = add(agent.pos, agent.velocity);
      }

      agent.pos = nextPos;
      depositSegment(pheromone, grid, agent.prevPos, agent.pos, agent.pheromoneLevel);
      agent.pheromoneLevel *= 0.995;
      updateTarget(agent, sources, destinations, reachedThreshold);
    }

    for (let i = 0; i < pheromone.length; i++) {
      pheromone[i] *= decay;
    }
  }

  let activeCells = 0;
  for (let i = 0; i < pheromone.length; i++) {
    if (pheromone[i] > 1e-4) activeCells += 1;
  }

  return { pheromone, grid, activeCells };
}

export function pheromoneToHeatmap(pheromone: Float32Array): Float32Array {
  return pheromone;
}

/** Count non-zero cells for diagnostics (Shanon-style sanity checks). */
export function countActivePheromoneCells(
  pheromone: Float32Array,
  threshold = 1e-4,
): number {
  let count = 0;
  for (let i = 0; i < pheromone.length; i++) {
    if (pheromone[i] > threshold) count += 1;
  }
  return count;
}
