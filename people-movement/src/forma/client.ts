import type { GridSpec, Point } from "../movement/types";

export type FormaSdk = Awaited<
  typeof import("forma-embedded-view-sdk/auto")
>["Forma"];

const FLOW_TEXTURE = "people-movement-flow";
const MARKER_TEXTURE = "people-movement-markers";

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

export async function pickPoint(Forma: FormaSdk): Promise<Point | null> {
  const pos = await Forma.designTool.getPoint();
  if (!pos) return null;
  return { x: pos.x, y: pos.y };
}

function drawMarkerCanvas(
  sources: Point[],
  destinations: Point[],
  grid: GridSpec,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid.nx;
  canvas.height = grid.ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const toCanvas = (point: Point) => ({
    x: (point.x - grid.bbox.min.x) / grid.cellSize,
    y: (grid.bbox.max.y - point.y) / grid.cellSize,
  });

  const drawMarker = (point: Point, color: string) => {
    const { x, y } = toCanvas(point);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  };

  for (const point of sources) drawMarker(point, "#0696d7");
  for (const point of destinations) drawMarker(point, "#e07b00");

  return canvas;
}

export async function showFlowOverlay(
  Forma: FormaSdk,
  canvas: HTMLCanvasElement,
  grid: GridSpec,
): Promise<void> {
  const centerX = (grid.bbox.min.x + grid.bbox.max.x) / 2;
  const centerY = (grid.bbox.min.y + grid.bbox.max.y) / 2;

  try {
    await Forma.terrain.groundTexture.remove({ name: FLOW_TEXTURE });
  } catch {
    // No existing texture.
  }

  await Forma.terrain.groundTexture.add({
    name: FLOW_TEXTURE,
    canvas,
    position: { x: centerX, y: centerY, z: 60 },
    scale: { x: grid.cellSize, y: grid.cellSize },
  });
}

export async function updatePointMarkers(
  Forma: FormaSdk,
  sources: Point[],
  destinations: Point[],
  grid?: GridSpec,
): Promise<void> {
  if (!grid || (sources.length === 0 && destinations.length === 0)) {
    try {
      await Forma.terrain.groundTexture.remove({ name: MARKER_TEXTURE });
    } catch {
      // Nothing to remove.
    }
    return;
  }

  const canvas = drawMarkerCanvas(sources, destinations, grid);
  const centerX = (grid.bbox.min.x + grid.bbox.max.x) / 2;
  const centerY = (grid.bbox.min.y + grid.bbox.max.y) / 2;

  try {
    await Forma.terrain.groundTexture.updateTextureData({
      name: MARKER_TEXTURE,
      canvas,
    });
  } catch {
    await Forma.terrain.groundTexture.add({
      name: MARKER_TEXTURE,
      canvas,
      position: { x: centerX, y: centerY, z: 61 },
      scale: { x: grid.cellSize, y: grid.cellSize },
    });
  }
}

export async function clearFlowOverlay(Forma: FormaSdk): Promise<void> {
  try {
    await Forma.terrain.groundTexture.remove({ name: FLOW_TEXTURE });
  } catch {
    // Nothing to remove.
  }
}

export async function clearPointMarkers(Forma: FormaSdk): Promise<void> {
  try {
    await Forma.terrain.groundTexture.remove({ name: MARKER_TEXTURE });
  } catch {
    // Nothing to remove.
  }
}

export async function showFlowColorbar(Forma: FormaSdk): Promise<void> {
  await Forma.colorbar.add({
    colors: ["#ffffff", "#ffb347", "#ff5028", "#c4001d"],
    labels: ["Low", "", "", "High"],
    labelPosition: "center",
    unit: "flow",
  });
}

export async function clearFlowColorbar(Forma: FormaSdk): Promise<void> {
  try {
    await Forma.colorbar.remove();
  } catch {
    // Nothing to remove.
  }
}

export async function clearAllVisuals(Forma: FormaSdk): Promise<void> {
  await Promise.all([
    clearFlowOverlay(Forma),
    clearFlowColorbar(Forma),
    clearPointMarkers(Forma),
  ]);
}

export async function getTerrainGridSpec(Forma: FormaSdk, cellSize: number): Promise<GridSpec> {
  const bbox = (await Forma.terrain.getBbox()) as GridSpec["bbox"];
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const longest = Math.max(width, height);
  const maxCellsPerAxis = 180;
  const minCellForCap = longest / maxCellsPerAxis;
  const effectiveCellSize = Math.max(cellSize, minCellForCap);
  const nx = Math.max(2, Math.floor(width / effectiveCellSize) + 1);
  const ny = Math.max(2, Math.floor(height / effectiveCellSize) + 1);
  return { nx, ny, cellSize: effectiveCellSize, bbox };
}
