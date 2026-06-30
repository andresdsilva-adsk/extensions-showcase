# People Movement

Autodesk Forma embedded-view extension for **pedestrian flow analysis** — predict
where people are likely to walk from origins (homes, transit) to destinations
(shops, amenities).

Inspired by:

- [Pathmaker](https://github.com/spacemakerai/extendathon-pathmaker) — agent-based
  and map-based pedestrian pathway prediction in Forma
- People-movement analysis used in master planning (e.g.
  [Arup People Movement](https://www.arup.com/services/people-movement/))

## What it does

1. **Place origins and destinations** in the scene using the Forma point picker.
2. **Build a traversability grid** from terrain slope, building footprints, and roads.
3. **Run analysis** in one of two modes:
   - **Flow map** — multi-goal Dijkstra cost field + probabilistic trail simulation
     (desire lines / heatmap)
   - **Agent simulation** — virtual pedestrians deposit pheromones and reveal emergent
     shortcuts
4. **Visualize** results as a ground overlay with a flow colorbar.

## Local development

```bash
npm install
npm run dev    # http://localhost:5174/
npm run build
```

Use Forma's [local testing extension](https://aps.autodesk.com/en/docs/forma/v1/embedded-views/getting-started/#local-testing-extension)
to load the dev server inside a project.

## Register in Forma

1. Host the built `dist/` folder (or use the showcase GitHub Pages URL).
2. Add the extension in Forma → **Extensions** with placement
   `RIGHT_MENU_ANALYSIS_PANEL`.
3. Point at `index.html` (manifest is in `public/manifest.json`).

## Architecture

| Module | Role |
| --- | --- |
| `src/forma/client.ts` | Preview-safe SDK loading, overlays, markers |
| `src/movement/sceneData.ts` | Terrain sampling, building/road rasterization |
| `src/movement/pathfinding.ts` | Multi-goal Dijkstra cost field |
| `src/movement/trails.ts` | Probabilistic desire-line simulation |
| `src/movement/agents.ts` | Pheromone agent simulation |

Temporary scene output uses `Forma.terrain.groundTexture` and `Forma.render.geojson`
— nothing is written to the durable element/proposal tree.
