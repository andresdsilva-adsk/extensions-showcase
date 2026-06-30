// Pure terrain slope analysis math. No Forma SDK imports here so this module can
// be unit tested and reasoned about in isolation.
//
// The slope of an elevation surface is the magnitude of its gradient. Following
// the GIS "fit a plane to the 3x3 roving window" approach described in
// Berry's "Characterizing Micro-Terrain Features" (Topic 11), we use Horn's
// method: a Sobel-weighted central difference that fits a plane to the eight
// neighbours of each cell. This is the same estimator ArcGIS/QGIS use and is
// more stable than averaging the eight individual neighbour slopes.

export type SlopeUnit = "percent" | "degrees";

export interface ElevationGrid {
  /** Number of columns (west -> east). */
  nx: number;
  /** Number of rows (north -> south, i.e. row 0 is the northern edge). */
  ny: number;
  /** Horizontal distance between samples, in meters. */
  cellSize: number;
  /** Row-major elevations in meters. Length must equal nx * ny. */
  elevations: Float32Array;
}

export interface SlopeGrid {
  nx: number;
  ny: number;
  cellSize: number;
  unit: SlopeUnit;
  /** Row-major slope values in `unit`. Length nx * ny. */
  values: Float32Array;
  min: number;
  max: number;
  mean: number;
}

export interface SlopeClass {
  /** Inclusive lower bound in the slope unit. */
  min: number;
  /** Exclusive upper bound in the slope unit (Infinity for the last class). */
  max: number;
  /** Hex color, e.g. "#1a9850". */
  color: string;
  label: string;
}

// Clamp an index to the valid grid range so edge cells reuse their nearest
// in-bounds neighbour (standard border replication for focal operators).
function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}

/**
 * Compute a slope surface from an elevation grid using Horn's 3x3 estimator.
 */
export function computeSlope(grid: ElevationGrid, unit: SlopeUnit): SlopeGrid {
  const { nx, ny, cellSize, elevations } = grid;
  const values = new Float32Array(nx * ny);

  const at = (row: number, col: number): number =>
    elevations[clampIndex(row, ny) * nx + clampIndex(col, nx)];

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const z1 = at(r - 1, c - 1);
      const z2 = at(r - 1, c);
      const z3 = at(r - 1, c + 1);
      const z4 = at(r, c - 1);
      const z6 = at(r, c + 1);
      const z7 = at(r + 1, c - 1);
      const z8 = at(r + 1, c);
      const z9 = at(r + 1, c + 1);

      // Horn's gradient: weighted central differences over an 8*cellSize run.
      const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * cellSize);
      const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * cellSize);

      const riseOverRun = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      const value =
        unit === "degrees"
          ? (Math.atan(riseOverRun) * 180) / Math.PI
          : riseOverRun * 100;

      values[r * nx + c] = value;
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
    }
  }

  return {
    nx,
    ny,
    cellSize,
    unit,
    values,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    mean: values.length ? sum / values.length : 0,
  };
}

// Diverging green -> yellow -> red ramp used for the default slope classes.
const RAMP = ["#1a9850", "#91cf60", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"];

const DEFAULT_BREAKS: Record<SlopeUnit, number[]> = {
  // Percent breaks common in site-suitability work (buildable -> very steep).
  percent: [5, 10, 15, 20, 30],
  // Degree equivalents, rounded to friendly values.
  degrees: [3, 6, 9, 12, 17],
};

/**
 * Build slope classes from a list of break values. Produces breaks.length + 1
 * classes spanning [0, break0), [break0, break1), ... [lastBreak, Infinity).
 */
export function buildSlopeClasses(
  unit: SlopeUnit,
  breaks: number[] = DEFAULT_BREAKS[unit],
): SlopeClass[] {
  const sorted = [...breaks].sort((a, b) => a - b);
  const suffix = unit === "degrees" ? "\u00b0" : "%";
  const classes: SlopeClass[] = [];
  let lower = 0;
  for (let i = 0; i < sorted.length; i++) {
    const upper = sorted[i];
    classes.push({
      min: lower,
      max: upper,
      color: RAMP[Math.min(i, RAMP.length - 1)],
      label: `${lower}-${upper}${suffix}`,
    });
    lower = upper;
  }
  classes.push({
    min: lower,
    max: Infinity,
    color: RAMP[Math.min(sorted.length, RAMP.length - 1)],
    label: `>${lower}${suffix}`,
  });
  return classes;
}

export function defaultBreaks(unit: SlopeUnit): number[] {
  return [...DEFAULT_BREAKS[unit]];
}

function classIndexFor(value: number, classes: SlopeClass[]): number {
  for (let i = 0; i < classes.length; i++) {
    if (value < classes[i].max) return i;
  }
  return classes.length - 1;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

export interface SlopeStats {
  min: number;
  max: number;
  mean: number;
  /** Fraction (0-1) of cells falling in each class, aligned to `classes`. */
  classFractions: number[];
}

/**
 * Render the slope grid into an offscreen canvas (one pixel per cell), coloring
 * each cell by its slope class. Row 0 of the grid is the northern edge, so it is
 * drawn at the top of the canvas. Returns the canvas plus class distribution.
 */
export function renderSlopeCanvas(
  slope: SlopeGrid,
  classes: SlopeClass[],
  alpha = 200,
): { canvas: HTMLCanvasElement; stats: SlopeStats } {
  const { nx, ny, values } = slope;
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to acquire 2D canvas context for slope texture.");
  }

  const rgb = classes.map((cls) => hexToRgb(cls.color));
  const counts = new Array(classes.length).fill(0);
  const image = ctx.createImageData(nx, ny);
  const data = image.data;

  for (let i = 0; i < values.length; i++) {
    const ci = classIndexFor(values[i], classes);
    counts[ci]++;
    const [r, g, b] = rgb[ci];
    const p = i * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = alpha;
  }

  ctx.putImageData(image, 0, 0);

  const total = values.length || 1;
  return {
    canvas,
    stats: {
      min: slope.min,
      max: slope.max,
      mean: slope.mean,
      classFractions: counts.map((c) => c / total),
    },
  };
}
