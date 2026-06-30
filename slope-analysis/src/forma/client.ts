// Preview-safe wrapper around the Forma embedded-view SDK.
//
// The SDK's `auto` entry expects host query parameters (e.g. `origin`) during
// module evaluation, so a top-level static import crashes when the app is opened
// directly in a browser tab. We therefore detect the host context first and only
// dynamically import the SDK when it is present. Outside Forma the UI still
// renders in a clearly-labelled preview mode.

import type { ElevationGrid, SlopeGrid, SlopeClass } from "../slope/compute";

// The dynamically imported `Forma` singleton is loosely typed because the SDK
// types are only available once the module is loaded inside the host.
export type FormaSdk = Awaited<
  typeof import("forma-embedded-view-sdk/auto")
>["Forma"];

export interface Bbox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

const TEXTURE_NAME = "slope-analysis-overlay";

/**
 * Heuristic for whether we are running inside the Forma embedded-view host.
 * Forma always loads the iframe with host query parameters; the most reliable
 * marker is the `origin` parameter the SDK itself reads on initialization.
 */
export function isFormaHost(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.has("origin") || params.has("ext") || params.has("embeddedViewId");
}

let cachedSdk: FormaSdk | null = null;

export async function loadForma(): Promise<FormaSdk> {
  if (cachedSdk) return cachedSdk;
  const mod = await import("forma-embedded-view-sdk/auto");
  cachedSdk = mod.Forma;
  return cachedSdk;
}

export interface SampleOptions {
  cellSize: number;
  /** Hard cap on samples per axis to keep the elevation queries bounded. */
  maxCellsPerAxis?: number;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

export interface SampleResult {
  grid: ElevationGrid;
  bbox: Bbox;
  /** Effective cell size after clamping to the per-axis cap. */
  effectiveCellSize: number;
}

// Resolve elevation queries with bounded concurrency so we don't fire tens of
// thousands of simultaneous requests at the host.
async function mapWithConcurrency<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
  onTick?: (done: number) => void,
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
      done++;
      if (onTick && done % 256 === 0) onTick(done);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, count) },
    () => runner(),
  );
  await Promise.all(runners);
  onTick?.(done);
  return results;
}

/**
 * Sample the terrain elevation on a regular grid across the terrain bounding
 * box. Row 0 of the resulting grid is the northern (max-Y) edge.
 */
export async function sampleElevationGrid(
  Forma: FormaSdk,
  options: SampleOptions,
): Promise<SampleResult> {
  const bbox = (await Forma.terrain.getBbox()) as Bbox;

  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;

  const maxPerAxis = options.maxCellsPerAxis ?? 200;
  let cellSize = options.cellSize;

  // Enforce the per-axis cap by growing the cell size if necessary.
  const longest = Math.max(width, height);
  const minCellForCap = longest / maxPerAxis;
  if (cellSize < minCellForCap) cellSize = minCellForCap;

  const nx = Math.max(2, Math.floor(width / cellSize) + 1);
  const ny = Math.max(2, Math.floor(height / cellSize) + 1);
  const total = nx * ny;

  const elevations = new Float32Array(total);

  await mapWithConcurrency(
    total,
    64,
    async (index) => {
      const col = index % nx;
      const row = Math.floor(index / nx);
      const x = bbox.min.x + col * cellSize;
      // Row 0 == north == max Y, walking southward as row increases.
      const y = bbox.max.y - row * cellSize;
      const z = await Forma.terrain.getElevationAt({ x, y });
      elevations[index] = z;
      return z;
    },
    (doneCount) => options.onProgress?.(doneCount, total),
    options.signal,
  );

  return {
    grid: { nx, ny, cellSize, elevations },
    bbox,
    effectiveCellSize: cellSize,
  };
}

/**
 * Place (or replace) the slope overlay as a ground texture covering the terrain.
 */
export async function showSlopeTexture(
  Forma: FormaSdk,
  canvas: HTMLCanvasElement,
  slope: SlopeGrid,
  bbox: Bbox,
): Promise<void> {
  const centerX = (bbox.min.x + bbox.max.x) / 2;
  const centerY = (bbox.min.y + bbox.max.y) / 2;

  // Best-effort cleanup so re-running doesn't stack textures.
  try {
    await Forma.terrain.groundTexture.remove({ name: TEXTURE_NAME });
  } catch {
    // No existing texture; ignore.
  }

  await Forma.terrain.groundTexture.add({
    name: TEXTURE_NAME,
    canvas,
    position: { x: centerX, y: centerY, z: 50 },
    scale: { x: slope.cellSize, y: slope.cellSize },
  });
}

export async function clearSlopeTexture(Forma: FormaSdk): Promise<void> {
  try {
    await Forma.terrain.groundTexture.remove({ name: TEXTURE_NAME });
  } catch {
    // Nothing to remove.
  }
}

export async function showColorbar(
  Forma: FormaSdk,
  classes: SlopeClass[],
  unit: string,
): Promise<void> {
  await Forma.colorbar.add({
    colors: classes.map((c) => c.color),
    labels: classes.map((c) => c.label),
    labelPosition: "center",
    unit,
  });
}

export async function clearColorbar(Forma: FormaSdk): Promise<void> {
  try {
    await Forma.colorbar.remove();
  } catch {
    // Nothing to remove.
  }
}
