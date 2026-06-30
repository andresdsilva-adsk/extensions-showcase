export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface Bbox {
  min: Point;
  max: Point;
}

export interface GridSpec {
  nx: number;
  ny: number;
  cellSize: number;
  bbox: Bbox;
}

export type SimulationMode = "flow" | "agent";

export interface MovementWeights {
  slope: number;
  roadDiscount: number;
  buildingBlock: boolean;
}

export interface AgentWeights {
  keepSpeed: number;
  pheromone: number;
  destination: number;
  road: number;
  building: number;
  random: number;
  agentSpeed: number;
}

export const DEFAULT_MOVEMENT_WEIGHTS: MovementWeights = {
  slope: 1,
  roadDiscount: 0.15,
  buildingBlock: true,
};

export const DEFAULT_AGENT_WEIGHTS: AgentWeights = {
  keepSpeed: 0.15,
  pheromone: 0.7,
  destination: 0.25,
  road: 0.1,
  building: 5,
  random: 0.3,
  agentSpeed: 2,
};

export const IMPASSABLE = 10_000;

export interface FlowStats {
  maxVisits: number;
  maxCompletedVisits: number;
  maxIncompleteVisits: number;
  totalWalks: number;
  completedWalks: number;
}

export interface TrailSimulationResult {
  heatmapCompleted: Float32Array;
  heatmapIncomplete: Float32Array;
  stats: FlowStats;
}
