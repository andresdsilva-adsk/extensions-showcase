import type { Point } from "../movement/types";
import { DESTINATION_COLOR, SOURCE_COLOR, type FormaSdk } from "./client";

type ColumnGeometry = {
  position: Float32Array;
  color?: Uint8Array;
  index?: number[];
};

const COLUMN_WIDTH = 1.2;
const COLUMN_HEIGHT = 4;
const COLUMN_IDS: string[] = [];

function parseHexColor(hex: string): [number, number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Simple box column mesh with per-vertex color. */
function createColumnGeometry(color: [number, number, number, number]): ColumnGeometry {
  const hw = COLUMN_WIDTH / 2;
  const h = COLUMN_HEIGHT;
  const positions = new Float32Array([
    -hw, -hw, 0, hw, -hw, 0, hw, hw, 0, -hw, hw, 0,
    -hw, -hw, h, hw, -hw, h, hw, hw, h, -hw, hw, h,
  ]);
  const colors = new Uint8Array(32);
  for (let v = 0; v < 8; v++) {
    colors[v * 4 + 0] = color[0];
    colors[v * 4 + 1] = color[1];
    colors[v * 4 + 2] = color[2];
    colors[v * 4 + 3] = color[3];
  }
  const index = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  return { position: positions, color: colors, index };
}

function columnTransform(x: number, y: number, z: number) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ] as const;
}

async function resolveElevation(
  Forma: FormaSdk,
  point: Point,
): Promise<number> {
  if (point.z !== undefined && Number.isFinite(point.z)) return point.z;
  return Forma.terrain.getElevationAt({ x: point.x, y: point.y });
}

export async function clearPointColumns(Forma: FormaSdk): Promise<void> {
  await Promise.all(
    COLUMN_IDS.splice(0, COLUMN_IDS.length).map((id) =>
      Forma.render.remove({ id }).catch(() => undefined),
    ),
  );
}

export async function updatePointColumns(
  Forma: FormaSdk,
  sources: Point[],
  destinations: Point[],
): Promise<void> {
  await clearPointColumns(Forma);

  const sourceGeom = createColumnGeometry(parseHexColor(SOURCE_COLOR));
  const destGeom = createColumnGeometry(parseHexColor(DESTINATION_COLOR));

  for (const point of sources) {
    const z = await resolveElevation(Forma, point);
    const { id } = await Forma.render.addMesh({
      geometryData: sourceGeom,
      transform: [...columnTransform(point.x, point.y, z)],
    });
    COLUMN_IDS.push(id);
  }

  for (const point of destinations) {
    const z = await resolveElevation(Forma, point);
    const { id } = await Forma.render.addMesh({
      geometryData: destGeom,
      transform: [...columnTransform(point.x, point.y, z)],
    });
    COLUMN_IDS.push(id);
  }
}
