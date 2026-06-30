// Standalone sanity check for the Horn slope estimator used in src/slope/compute.ts.
// Mirrors the core math exactly and asserts against analytically-known surfaces.
// Run with: node scripts/verify-slope.mjs

function clampIndex(v, size) {
  if (v < 0) return 0;
  if (v >= size) return size - 1;
  return v;
}

function computeSlope({ nx, ny, cellSize, elevations }, unit) {
  const values = new Float32Array(nx * ny);
  const at = (r, c) =>
    elevations[clampIndex(r, ny) * nx + clampIndex(c, nx)];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const z1 = at(r - 1, c - 1), z2 = at(r - 1, c), z3 = at(r - 1, c + 1);
      const z4 = at(r, c - 1), z6 = at(r, c + 1);
      const z7 = at(r + 1, c - 1), z8 = at(r + 1, c), z9 = at(r + 1, c + 1);
      const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * cellSize);
      const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * cellSize);
      const ror = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      values[r * nx + c] =
        unit === "degrees" ? (Math.atan(ror) * 180) / Math.PI : ror * 100;
    }
  }
  return values;
}

function makeGrid(nx, ny, cellSize, zfn) {
  const elevations = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) elevations[r * nx + c] = zfn(c, r);
  return { nx, ny, cellSize, elevations };
}

function approx(a, b, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

// 1) Flat surface -> 0 slope everywhere.
{
  const g = makeGrid(10, 10, 5, () => 42);
  const v = computeSlope(g, "percent");
  check("flat -> 0% everywhere", v.every((x) => approx(x, 0)));
}

// 2) Constant 20% plane sloping in +x: z = 0.2 * x, x = col * cellSize.
{
  const d = 5;
  const g = makeGrid(12, 12, d, (c) => 0.2 * (c * d));
  const v = computeSlope(g, "percent");
  // Interior cells (avoid replicated borders) should read exactly 20%.
  let ok = true;
  for (let r = 1; r < 11; r++)
    for (let c = 1; c < 11; c++) ok = ok && approx(v[r * 12 + c], 20);
  check("20% plane in x -> 20% interior", ok, `sample=${v[6 * 12 + 6].toFixed(4)}`);
}

// 3) Same plane reported in degrees -> atan(0.2) = 11.3099°.
{
  const d = 5;
  const g = makeGrid(12, 12, d, (c) => 0.2 * (c * d));
  const v = computeSlope(g, "degrees");
  const expected = (Math.atan(0.2) * 180) / Math.PI;
  check(
    "20% plane -> degrees",
    approx(v[6 * 12 + 6], expected, 1e-3),
    `got=${v[6 * 12 + 6].toFixed(4)} expected=${expected.toFixed(4)}`,
  );
}

// 4) Diagonal plane z = 0.3x + 0.4y -> gradient magnitude 0.5 -> 50%.
{
  const d = 2;
  const g = makeGrid(15, 15, d, (c, r) => 0.3 * (c * d) + 0.4 * (r * d));
  const v = computeSlope(g, "percent");
  check(
    "diagonal plane -> 50%",
    approx(v[7 * 15 + 7], 50, 1e-3),
    `got=${v[7 * 15 + 7].toFixed(4)}`,
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
