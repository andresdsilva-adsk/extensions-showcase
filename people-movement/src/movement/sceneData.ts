import type { FormaSdk } from "../forma/client";
import {
  bresenhamLine,
  buildGridSpec,
  createGrid,
  gridIndex,
  worldToGrid,
} from "./grid";
import type { Bbox, GridSpec, MovementWeights, Point } from "./types";
import { IMPASSABLE } from "./types";

export interface SceneLayers {
  grid: GridSpec;
  costGrid: number[][];
  slopeGrid: Float32Array;
  roadMask: Uint8Array;
  buildingMask: Uint8Array;
}

interface BuildingTriangle {
  a: Point;
  b: Point;
  c: Point;
}

async function mapWithConcurrency<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  let done = 0;

  async function runner(): Promise<void> {
    while (next < count) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = next++;
      results[index] = await worker(index);
      done += 1;
      if (onProgress && done % 128 === 0) onProgress(done, count);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, () => runner()),
  );
  onProgress?.(count, count);
  return results;
}

function computeSlopeGrid(elevations: Float32Array, nx: number, ny: number): Float32Array {
  const slopes = new Float32Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const z = elevations[gridIndex(col, row, nx)];
      if (!Number.isFinite(z)) {
        slopes[gridIndex(col, row, nx)] = 0;
        continue;
      }
      const zW = col > 0 ? elevations[gridIndex(col - 1, row, nx)] : z;
      const zE = col < nx - 1 ? elevations[gridIndex(col + 1, row, nx)] : z;
      const zN = row > 0 ? elevations[gridIndex(col, row - 1, nx)] : z;
      const zS = row < ny - 1 ? elevations[gridIndex(col, row + 1, nx)] : z;
      const dzdx = (zE - zW) / 2;
      const dzdy = (zN - zS) / 2;
      slopes[gridIndex(col, row, nx)] = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
    }
  }
  return slopes;
}

async function sampleElevations(
  Forma: FormaSdk,
  grid: GridSpec,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const total = grid.nx * grid.ny;
  const elevations = new Float32Array(total);

  await mapWithConcurrency(
    total,
    64,
    async (index) => {
      const col = index % grid.nx;
      const row = Math.floor(index / grid.nx);
      const x = grid.bbox.min.x + col * grid.cellSize;
      const y = grid.bbox.max.y - row * grid.cellSize;
      const z = await Forma.terrain.getElevationAt({ x, y });
      elevations[index] = z;
      return z;
    },
    onProgress,
    signal,
  );

  return elevations;
}

async function fetchBuildingTriangles(Forma: FormaSdk): Promise<BuildingTriangle[]> {
  const paths = await Forma.geometry.getPathsByCategory({ category: "building" });
  const triangleArrays = await Promise.all(
    paths.map((path: string) => Forma.geometry.getTriangles({ path })),
  );

  const triangles: BuildingTriangle[] = [];
  for (const flat of triangleArrays) {
    if (!flat) continue;
    for (let i = 0; i < flat.length; i += 9) {
      triangles.push({
        a: { x: flat[i], y: flat[i + 1] },
        b: { x: flat[i + 3], y: flat[i + 4] },
        c: { x: flat[i + 6], y: flat[i + 7] },
      });
    }
  }
  return triangles;
}

async function fetchRoadPolylines(Forma: FormaSdk): Promise<Point[][]> {
  const paths = await Forma.geometry.getPathsByCategory({ category: "road" });
  const roads: Point[][] = [];

  for (const path of paths) {
    const footprint = await Forma.geometry.getFootprint({ path });
    if (!footprint || footprint.type !== "LineString") continue;
    roads.push(
      footprint.coordinates.map((coord: number[]) => ({
        x: coord[0],
        y: coord[1],
      })),
    );
  }
  return roads;
}

function markTriangleOnMask(
  triangle: BuildingTriangle,
  grid: GridSpec,
  mask: Uint8Array,
): void {
  const points = [triangle.a, triangle.b, triangle.c];
  for (const point of points) {
    const { col, row } = worldToGrid(point, grid);
    mask[gridIndex(col, row, grid.nx)] = 1;
  }
  const centroid = {
    x: (triangle.a.x + triangle.b.x + triangle.c.x) / 3,
    y: (triangle.a.y + triangle.b.y + triangle.c.y) / 3,
  };
  const { col, row } = worldToGrid(centroid, grid);
  mask[gridIndex(col, row, grid.nx)] = 1;
}

function markRoadOnMask(polyline: Point[], grid: GridSpec, mask: Uint8Array): void {
  for (let i = 1; i < polyline.length; i++) {
    const start = worldToGrid(polyline[i - 1], grid);
    const end = worldToGrid(polyline[i], grid);
    const cells = bresenhamLine(start.col, start.row, end.col, end.row);
    for (const [col, row] of cells) {
      if (col < 0 || col >= grid.nx || row < 0 || row >= grid.ny) continue;
      mask[gridIndex(col, row, grid.nx)] = 1;
      for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= grid.nx || nr < 0 || nr >= grid.ny) continue;
        mask[gridIndex(nc, nr, grid.nx)] = 1;
      }
    }
  }
}

function buildCostGrid(
  grid: GridSpec,
  slopes: Float32Array,
  roadMask: Uint8Array,
  buildingMask: Uint8Array,
  weights: MovementWeights,
): number[][] {
  const costGrid = createGrid(grid.nx, grid.ny, 1);
  let maxSlope = 0;
  for (let i = 0; i < slopes.length; i++) {
    maxSlope = Math.max(maxSlope, slopes[i]);
  }
  const slopeScale = maxSlope > 1e-6 ? 1 / maxSlope : 1;

  for (let row = 0; row < grid.ny; row++) {
    for (let col = 0; col < grid.nx; col++) {
      const idx = gridIndex(col, row, grid.nx);
      if (weights.buildingBlock && buildingMask[idx] === 1) {
        costGrid[col][row] = IMPASSABLE;
        continue;
      }
      const normalizedSlope = slopes[idx] * slopeScale;
      let cost = 0.2 + normalizedSlope * weights.slope;
      if (roadMask[idx] === 1) {
        cost = Math.max(0.05, cost - weights.roadDiscount);
      }
      costGrid[col][row] = cost;
    }
  }
  return costGrid;
}

export interface BuildSceneOptions {
  cellSize: number;
  weights: MovementWeights;
  onProgress?: (phase: string, done: number, total: number) => void;
  signal?: AbortSignal;
}

export async function buildSceneLayers(
  Forma: FormaSdk,
  options: BuildSceneOptions,
): Promise<SceneLayers> {
  const bbox = (await Forma.terrain.getBbox()) as Bbox;
  const grid = buildGridSpec(bbox, options.cellSize);

  options.onProgress?.("Sampling terrain", 0, grid.nx * grid.ny);
  const elevations = await sampleElevations(
    Forma,
    grid,
    (done, total) => options.onProgress?.("Sampling terrain", done, total),
    options.signal,
  );

  options.onProgress?.("Reading buildings and roads", 0, 1);
  const [buildings, roads] = await Promise.all([
    fetchBuildingTriangles(Forma),
    fetchRoadPolylines(Forma),
  ]);

  const slopeGrid = computeSlopeGrid(elevations, grid.nx, grid.ny);
  const roadMask = new Uint8Array(grid.nx * grid.ny);
  const buildingMask = new Uint8Array(grid.nx * grid.ny);

  for (const triangle of buildings) {
    markTriangleOnMask(triangle, grid, buildingMask);
  }
  for (const road of roads) {
    markRoadOnMask(road, grid, roadMask);
  }

  const costGrid = buildCostGrid(
    grid,
    slopeGrid,
    roadMask,
    buildingMask,
    options.weights,
  );

  options.onProgress?.("Ready", 1, 1);

  return { grid, costGrid, slopeGrid, roadMask, buildingMask };
}
