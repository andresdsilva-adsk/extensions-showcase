import type { GridSpec, Point } from "../movement/types";

export type FormaSdk = Awaited<
  typeof import("forma-embedded-view-sdk/auto")
>["Forma"];

const FLOW_TEXTURE = "people-movement-flow";
const MARKER_TEXTURE = "people-movement-markers";

const SOURCE_COLOR = "#0696d7";
const DESTINATION_COLOR = "#e07b00";

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

function markerRadiusPx(cellSize: number): number {
  // ~4 m world radius, at least 7 px on the overlay canvas
  return Math.max(7, (4 / cellSize) * 1.2);
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

  const radius = markerRadiusPx(grid.cellSize);

  const drawMarker = (
    point: Point,
    color: string,
    label: string,
    index: number,
  ) => {
    const { x, y } = toCanvas(point);

    // Soft halo so markers read on any background
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = color === SOURCE_COLOR ? "rgba(6, 150, 215, 0.25)" : "rgba(224, 123, 0, 0.25)";
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Fill
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Label (O1, D2, …)
    const text = `${label}${index + 1}`;
    ctx.font = `bold ${Math.max(9, radius)}px Artifakt Element, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x, y);

    // Crosshair for precise position
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.45, y);
    ctx.lineTo(x + radius * 0.45, y);
    ctx.moveTo(x, y - radius * 0.45);
    ctx.lineTo(x, y + radius * 0.45);
    ctx.stroke();
  };

  for (let i = 0; i < sources.length; i++) {
    drawMarker(sources[i], SOURCE_COLOR, "O", i);
  }
  for (let i = 0; i < destinations.length; i++) {
    drawMarker(destinations[i], DESTINATION_COLOR, "D", i);
  }

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

export function formatPoint(point: Point): string {
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)} m`;
}

export { SOURCE_COLOR, DESTINATION_COLOR };
