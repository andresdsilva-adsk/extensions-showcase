# Terrain Slope Analysis — Forma Site Design extension

An Autodesk Forma Site Design embedded-view extension that reads the project
terrain and produces a **slope analysis** surface, drawn directly over the
ground with a classified color legend and an interactive colorbar.

The slope estimator follows the GIS "fit a plane to the 3×3 roving window"
approach described in Joseph Berry's _Characterizing Micro-Terrain Features_
([Topic 11](http://www.innovativegis.com/basis/Senarios/Materials/MC_learner/MA_book/Topic11/Topic11.htm)).

## What it does

1. Reads the terrain bounding box with `Forma.terrain.getBbox()`.
2. Samples elevations on a regular grid with `Forma.terrain.getElevationAt()`
   (bounded concurrency, automatically capped for large sites).
3. Computes slope per cell with **Horn's method** — a Sobel-weighted central
   difference that fits a plane to each cell's eight neighbours. This is the same
   estimator ArcGIS/QGIS use and is more stable than averaging the eight
   individual neighbour slopes.
4. Classifies slope into buildability classes (flat → very steep) and paints a
   ground texture over the terrain with `Forma.terrain.groundTexture.add()`.
5. Adds a legend colorbar via `Forma.colorbar.add()`.

Slope can be reported in **percent** (rise/run × 100) or **degrees**
(`atan(rise/run)`).

## How slope is computed

For each grid cell, given elevations `z1..z9` in the 3×3 window and cell size `d`
(meters):

```
dz/dx = (z3 + 2·z6 + z9 − (z1 + 2·z4 + z7)) / (8·d)
dz/dy = (z7 + 2·z8 + z9 − (z1 + 2·z2 + z3)) / (8·d)
slope% = sqrt((dz/dx)² + (dz/dy)²) · 100
slope° = atan(sqrt((dz/dx)² + (dz/dy)²)) · 180/π
```

Edge cells replicate their nearest in-bounds neighbour. The core math lives in
`src/slope/compute.ts` and has no SDK dependency, so it can be unit tested in
isolation.

## Project layout

```
src/
  slope/compute.ts   Pure slope math + classification + canvas rendering
  forma/client.ts    Preview-safe SDK loading, terrain sampling, overlays
  ui/weave.tsx       Weave web-component React wrappers (CDN)
  App.tsx            Panel UI and analysis orchestration
```

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:5173/. Outside the Forma host the panel renders in
**preview mode** (the SDK is only imported when Forma host query parameters are
present), so the UI is testable in a normal browser tab. Host-only actions stay
disabled until the SDK loads.

## Verify the slope math

The Horn estimator is checked against analytically-known surfaces (flat plane,
single-axis 20% plane, diagonal 50% plane, and the degrees conversion) with no
dependencies required:

```bash
node scripts/verify-slope.mjs
```

## Build

```bash
npm run build
```

Outputs a static bundle to `dist/`. The Vite `base` is relative so assets
resolve from any host path.

## Hosting & registration

This extension is deployed via the showcase repo's GitHub Actions workflow to:

```
https://andresdsilva-adsk.github.io/extensions-showcase/slope-analysis/
```

Register it in Forma (left panel → **Extensions** → developer/test entry) by
pointing the embedded-view URL at that address, with placement
**`RIGHT_MENU_ANALYSIS_PANEL`**. Forma issues an extension ID you can share with
other users. See the
[sharing extensions guide](https://aps.autodesk.com/en/docs/forma/v1/overview/sharing-extensions/).

For local-in-Forma testing, install Forma's
[local testing extension](https://aps.autodesk.com/en/docs/forma/v1/embedded-views/getting-started/#local-testing-extension)
and point it at `http://localhost:5173/`.

## Notes

- Ground textures and the colorbar are **transient render output**, not durable
  element-system content, which is the correct choice for an analysis overlay.
- All SDK geometry/elevation values are in meters regardless of the UI's
  presentation unit system.
- The Weave UI uses the public web-component CDN track so the build does not
  depend on the Autodesk internal npm registry. If `@weave-mui/*` packages are
  available in your environment you can migrate to the React MUI Kit track.
```
