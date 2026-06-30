import { gridIndex, inBounds, worldToGrid } from "./grid";
import type { AgentWeights, GridSpec, Point } from "./types";

export interface Agent {
  pos: Point;
  velocity: Point;
  targetIndex: number;
  pheromoneLevel: number;
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(max: number): number {
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
  const distance = grid.cellSize * 4;
  const angle = Math.atan2(velocity.y, velocity.x);
  const angleDiff = Math.PI / 6;
  const frontDir = normalize(velocity);
  const leftDir = {
    x: Math.cos(angle + angleDiff),
    y: Math.sin(angle + angleDiff),
  };
  const rightDir = {
    x: Math.cos(angle - angleDiff),
    y: Math.sin(angle - angleDiff),
  };

  const front = samplePheromone(pheromone, grid, add(pos, multiply(frontDir, distance)));
  const left = samplePheromone(pheromone, grid, add(pos, multiply(leftDir, distance)));
  const right = samplePheromone(pheromone, grid, add(pos, multiply(rightDir, distance)));

  if (left > front && left > right) return normalize(multiply(leftDir, left));
  if (right > left && right > front) return normalize(multiply(rightDir, right));
  return normalize(multiply(frontDir, front));
}

function maskDirection(
  mask: Uint8Array,
  grid: GridSpec,
  pos: Point,
  velocity: Point,
  preferHigh: boolean,
): Point {
  const distance = grid.cellSize * 3;
  const angle = Math.atan2(velocity.y, velocity.x);
  const angleDiff = Math.PI / 3;
  const frontDir = normalize(velocity);
  const leftDir = {
    x: Math.cos(angle + angleDiff),
    y: Math.sin(angle + angleDiff),
  };
  const rightDir = {
    x: Math.cos(angle - angleDiff),
    y: Math.sin(angle - angleDiff),
  };

  const sample = (dir: Point): number => {
    const { col, row } = worldToGrid(add(pos, multiply(dir, distance)), grid);
    if (!inBounds(col, row, grid)) return preferHigh ? 0 : 1;
    return mask[gridIndex(col, row, grid.nx)];
  };

  const front = sample(frontDir);
  const left = sample(leftDir);
  const right = sample(rightDir);

  if (preferHigh) {
    if (left > front && left > right) return normalize(multiply(leftDir, left));
    if (right > left && right > front) return normalize(multiply(rightDir, right));
    return normalize(multiply(frontDir, front));
  }

  if (left < 1e-3 && right < 1e-3) return { x: 0, y: 0 };
  return left > right
    ? normalize(multiply(rightDir, 1 - right))
    : normalize(multiply(leftDir, 1 - left));
}

export interface AgentSimulationOptions {
  agentCount: number;
  steps: number;
  weights: AgentWeights;
}

export interface AgentSimulationResult {
  pheromone: Float32Array;
  grid: GridSpec;
}

/**
 * Lightweight agent-based pedestrian simulation. Agents walk between origins
 * and destinations, depositing pheromones that influence later walkers — the
 * "ant mode" from Pathmaker.
 */
export function runAgentSimulation(
  grid: GridSpec,
  sources: Point[],
  destinations: Point[],
  roadMask: Uint8Array,
  buildingMask: Uint8Array,
  options: AgentSimulationOptions,
): AgentSimulationResult {
  const pheromone = new Float32Array(grid.nx * grid.ny);
  const agents: Agent[] = Array.from({ length: options.agentCount }, () => {
    const source = sources[randomInt(sources.length)] ?? sources[0];
    return {
      pos: { ...source },
      velocity: multiply(normalize({ x: random(-1, 1), y: random(-1, 1) }), options.weights.agentSpeed),
      targetIndex: randomInt(destinations.length),
      pheromoneLevel: 1,
    };
  });

  const bbox = grid.bbox;
  const reachedThreshold = grid.cellSize * 2;

  for (let step = 0; step < options.steps; step++) {
    for (const agent of agents) {
      const target = destinations[agent.targetIndex] ?? destinations[0];
      const toTarget = normalize(sub(target, agent.pos));
      const pheromoneEffect = pheromoneDirection(pheromone, grid, agent.pos, agent.velocity);
      const roadEffect = maskDirection(roadMask, grid, agent.pos, agent.velocity, true);
      const buildingEffect = maskDirection(buildingMask, grid, agent.pos, agent.velocity, false);

      const combined = setLength(
        add(
          add(
            add(
              multiply(normalize(agent.velocity), options.weights.keepSpeed),
              multiply(pheromoneEffect, options.weights.pheromone),
            ),
            multiply(toTarget, options.weights.destination),
          ),
          add(
            multiply(roadEffect, options.weights.road),
            add(
              multiply(buildingEffect, options.weights.building),
              multiply({ x: random(-1, 1), y: random(-1, 1) }, options.weights.random),
            ),
          ),
        ),
        options.weights.agentSpeed,
      );

      agent.velocity = combined;
      agent.pos = add(agent.pos, agent.velocity);

      if (
        agent.pos.x < bbox.min.x ||
        agent.pos.x > bbox.max.x ||
        agent.pos.y < bbox.min.y ||
        agent.pos.y > bbox.max.y
      ) {
        agent.velocity = multiply(agent.velocity, -1);
        agent.pos = add(agent.pos, agent.velocity);
      }

      const { col, row } = worldToGrid(agent.pos, grid);
      if (inBounds(col, row, grid)) {
        const idx = gridIndex(col, row, grid.nx);
        pheromone[idx] += agent.pheromoneLevel;
        pheromone[idx] *= 0.999;
      }

      agent.pheromoneLevel *= 0.995;

      if (length(sub(target, agent.pos)) < reachedThreshold) {
        agent.targetIndex = randomInt(destinations.length);
        agent.pheromoneLevel = 1;
        const source = sources[randomInt(sources.length)] ?? sources[0];
        agent.pos = { ...source };
        agent.velocity = { x: 0, y: 0 };
      }
    }

    for (let i = 0; i < pheromone.length; i++) {
      pheromone[i] *= 0.998;
    }
  }

  return { pheromone, grid };
}

export function pheromoneToHeatmap(pheromone: Float32Array): Float32Array {
  return pheromone;
}
