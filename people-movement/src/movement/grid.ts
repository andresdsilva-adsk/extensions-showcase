import type { Bbox, GridSpec, Point } from "./types";

export function worldToGrid(
  point: Point,
  grid: GridSpec,
): { col: number; row: number } {
  const col = Math.round((point.x - grid.bbox.min.x) / grid.cellSize);
  const row = Math.round((grid.bbox.max.y - point.y) / grid.cellSize);
  return {
    col: clamp(col, 0, grid.nx - 1),
    row: clamp(row, 0, grid.ny - 1),
  };
}

export function gridToWorld(
  col: number,
  row: number,
  grid: GridSpec,
): Point {
  return {
    x: grid.bbox.min.x + col * grid.cellSize,
    y: grid.bbox.max.y - row * grid.cellSize,
  };
}

export function gridIndex(col: number, row: number, nx: number): number {
  return row * nx + col;
}

export function inBounds(col: number, row: number, grid: GridSpec): boolean {
  return col >= 0 && col < grid.nx && row >= 0 && row < grid.ny;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildGridSpec(bbox: Bbox, cellSize: number, maxCellsPerAxis = 180): GridSpec {
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const longest = Math.max(width, height);
  const minCellForCap = longest / maxCellsPerAxis;
  const effectiveCellSize = Math.max(cellSize, minCellForCap);

  const nx = Math.max(2, Math.floor(width / effectiveCellSize) + 1);
  const ny = Math.max(2, Math.floor(height / effectiveCellSize) + 1);

  return { nx, ny, cellSize: effectiveCellSize, bbox };
}

export function createGrid<T>(nx: number, ny: number, initial: T): T[][] {
  return Array.from({ length: nx }, () => Array.from({ length: ny }, () => initial));
}

export const NEIGHBOR_OFFSETS: ReadonlyArray<[number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}
