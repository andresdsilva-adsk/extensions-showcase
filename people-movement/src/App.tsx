import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAllVisuals,
  getTerrainGridSpec,
  isFormaHost,
  loadForma,
  pickPoint,
  showFlowColorbar,
  showFlowOverlay,
  updatePointMarkers,
  type FormaSdk,
} from "./forma/client";
import { runAgentSimulation } from "./movement/agents";
import { worldToGrid } from "./movement/grid";
import { dijkstraFromGoals } from "./movement/pathfinding";
import { buildSceneLayers } from "./movement/sceneData";
import { heatmapToCanvas, simulateTrails } from "./movement/trails";
import type {
  AgentWeights,
  FlowStats,
  MovementWeights,
  Point,
  SimulationMode,
} from "./movement/types";
import {
  DEFAULT_AGENT_WEIGHTS,
  DEFAULT_MOVEMENT_WEIGHTS,
} from "./movement/types";
import {
  WeaveBanner,
  WeaveButton,
  WeaveSelect,
  ensureWeave,
} from "./ui/weave";

interface ResolutionPreset {
  value: string;
  label: string;
  cellSize: number;
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { value: "fast", label: "Fast (10 m)", cellSize: 10 },
  { value: "balanced", label: "Balanced (5 m)", cellSize: 5 },
  { value: "detailed", label: "Detailed (2.5 m)", cellSize: 2.5 },
];

type StatusKind = "info" | "success" | "warning" | "error";

interface Status {
  kind: StatusKind;
  message: string;
}

export default function App() {
  const [sdk, setSdk] = useState<FormaSdk | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [mode, setMode] = useState<SimulationMode>("flow");
  const [resolution, setResolution] = useState("balanced");
  const [sources, setSources] = useState<Point[]>([]);
  const [destinations, setDestinations] = useState<Point[]>([]);
  const [picking, setPicking] = useState<"source" | "destination" | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ phase: "", done: 0, total: 0 });
  const [status, setStatus] = useState<Status>({ kind: "info", message: "Loading…" });
  const [stats, setStats] = useState<FlowStats | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [movementWeights, setMovementWeights] = useState<MovementWeights>(
    DEFAULT_MOVEMENT_WEIGHTS,
  );
  const [agentWeights] = useState<AgentWeights>(DEFAULT_AGENT_WEIGHTS);
  const abortRef = useRef<AbortController | null>(null);

  const cellSize = useMemo(
    () => RESOLUTION_PRESETS.find((p) => p.value === resolution)?.cellSize ?? 5,
    [resolution],
  );

  useEffect(() => {
    ensureWeave();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isFormaHost()) {
      setStatus({
        kind: "warning",
        message:
          "Preview mode — open inside Autodesk Forma to place origins, destinations, and run people-movement analysis.",
      });
      return;
    }
    loadForma()
      .then((forma) => {
        if (cancelled) return;
        setSdk(forma);
        setHostReady(true);
        setStatus({
          kind: "info",
          message:
            "Place origin and destination points, then run the simulation to reveal pedestrian desire lines.",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: `Failed to connect to Forma: ${String(err)}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdk) return;
    void (async () => {
      const grid = await getTerrainGridSpec(sdk, cellSize);
      await updatePointMarkers(sdk, sources, destinations, grid);
    })();
  }, [sdk, sources, destinations, cellSize]);

  useEffect(() => {
    return () => {
      if (sdk) void clearAllVisuals(sdk);
    };
  }, [sdk]);

  const addPoints = useCallback(
    async (kind: "source" | "destination") => {
      if (!sdk) return;
      setPicking(kind);
      setStatus({
        kind: "info",
        message:
          kind === "source"
            ? "Click in the scene to add origin points (homes, transit stops). Press Escape when done."
            : "Click in the scene to add destinations (shops, amenities). Press Escape when done.",
      });

      while (true) {
        const point = await pickPoint(sdk);
        if (!point) break;
        if (kind === "source") {
          setSources((prev) => [...prev, point]);
        } else {
          setDestinations((prev) => [...prev, point]);
        }
      }

      setPicking(null);
      setStatus({
        kind: "info",
        message: "Points updated. Run the simulation when ready.",
      });
    },
    [sdk],
  );

  const runSimulation = useCallback(async () => {
    if (!sdk) return;
    if (sources.length === 0 || destinations.length === 0) {
      setStatus({
        kind: "warning",
        message: "Add at least one origin and one destination before running.",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setStats(null);
    setProgress({ phase: "Preparing", done: 0, total: 1 });

    try {
      const scene = await buildSceneLayers(sdk, {
        cellSize,
        weights: movementWeights,
        signal: controller.signal,
        onProgress: (phase, done, total) => setProgress({ phase, done, total }),
      });

      if (controller.signal.aborted) return;

      let heatmap: Float32Array;
      let flowStats: FlowStats;

      if (mode === "flow") {
        setProgress({ phase: "Computing cost field", done: 0, total: 1 });
        const goals = destinations.map((point) => worldToGrid(point, scene.grid));
        const costField = dijkstraFromGoals(scene.costGrid, goals);
        setProgress({ phase: "Simulating pedestrian trails", done: 0, total: 1 });
        const trails = simulateTrails(costField, sources, scene.grid, {
          walksPerSource: 100,
        });
        heatmap = trails.heatmap;
        flowStats = trails.stats;
      } else {
        setProgress({ phase: "Running agent simulation", done: 0, total: 1 });
        const agentResult = runAgentSimulation(
          scene.grid,
          sources,
          destinations,
          scene.roadMask,
          scene.buildingMask,
          {
            agentCount: 350,
            steps: 900,
            weights: agentWeights,
          },
        );
        heatmap = agentResult.pheromone;
        let maxVisits = 0;
        for (let i = 0; i < heatmap.length; i++) {
          maxVisits = Math.max(maxVisits, heatmap[i]);
        }
        flowStats = {
          maxVisits,
          totalWalks: 350,
          completedWalks: 0,
        };
      }

      const canvas = heatmapToCanvas(heatmap, scene.grid);
      await showFlowOverlay(sdk, canvas, scene.grid);
      await updatePointMarkers(sdk, sources, destinations, scene.grid);
      await showFlowColorbar(sdk);
      setStats(flowStats);

      const completionPct =
        flowStats.totalWalks > 0
          ? Math.round((flowStats.completedWalks / flowStats.totalWalks) * 100)
          : 0;

      setStatus({
        kind: "success",
        message:
          mode === "flow"
            ? `Flow analysis complete. ${flowStats.completedWalks} of ${flowStats.totalWalks} walks reached a destination (${completionPct}%).`
            : `Agent simulation complete. Pheromone trails drawn from ${flowStats.totalWalks} agents.`,
      });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      setStatus({
        kind: "error",
        message: `Simulation failed: ${String(err)}`,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }, [sdk, sources, destinations, cellSize, mode, movementWeights, agentWeights]);

  const clearAll = useCallback(async () => {
    if (!sdk) return;
    await clearAllVisuals(sdk);
    setSources([]);
    setDestinations([]);
    setStats(null);
    setStatus({ kind: "info", message: "Cleared points and overlays." });
  }, [sdk]);

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="panel">
      <header className="panel__header">
        <h1>People Movement</h1>
        <p className="panel__subtitle">
          Predict pedestrian desire lines from origins to destinations. Uses
          terrain slope, buildings, and roads to model how people are likely to
          move across your site — inspired by agent-based and map-based flow
          analysis.
        </p>
      </header>

      <section className="field">
        <label className="field__label">Analysis mode</label>
        <WeaveSelect
          value={mode}
          options={[
            {
              value: "flow",
              label: 'Flow map ("omniscient") — cost field + desire lines',
            },
            {
              value: "agent",
              label: 'Agent simulation ("ant mode") — pheromone trails',
            },
          ]}
          onChange={(value) => setMode(value as SimulationMode)}
        />
        <p className="field__hint">
          Flow map mode computes least-cost paths from destinations and simulates
          many walkers from origins. Agent mode lets virtual pedestrians explore
          and leave pheromone trails, revealing emergent shortcuts.
        </p>
      </section>

      <section className="field">
        <label className="field__label">Origins</label>
        <p className="field__hint">
          Where people come from — residential entrances, transit stops, parking.
        </p>
        <div className="actions">
          <WeaveButton
            variant="outlined"
            onClick={() => addPoints("source")}
            disabled={!hostReady || running || picking !== null}
          >
            {picking === "source" ? "Picking origins…" : "Add origins"}
          </WeaveButton>
          <WeaveButton
            variant="flat"
            onClick={() => setSources([])}
            disabled={sources.length === 0 || running}
          >
            Clear
          </WeaveButton>
        </div>
        {sources.length > 0 && (
          <p className="field__hint">{sources.length} origin(s) placed</p>
        )}
      </section>

      <section className="field">
        <label className="field__label">Destinations</label>
        <p className="field__hint">
          Points of interest — retail, transit, schools, amenities.
        </p>
        <div className="actions">
          <WeaveButton
            variant="outlined"
            onClick={() => addPoints("destination")}
            disabled={!hostReady || running || picking !== null}
          >
            {picking === "destination" ? "Picking destinations…" : "Add destinations"}
          </WeaveButton>
          <WeaveButton
            variant="flat"
            onClick={() => setDestinations([])}
            disabled={destinations.length === 0 || running}
          >
            Clear
          </WeaveButton>
        </div>
        {destinations.length > 0 && (
          <p className="field__hint">{destinations.length} destination(s) placed</p>
        )}
      </section>

      <section className="field">
        <label className="field__label">Grid resolution</label>
        <WeaveSelect
          value={resolution}
          options={RESOLUTION_PRESETS.map((p) => ({
            value: p.value,
            label: p.label,
          }))}
          onChange={setResolution}
        />
      </section>

      <section className="actions">
        <WeaveButton
          variant="solid"
          onClick={runSimulation}
          disabled={!hostReady || running || picking !== null}
        >
          {running ? "Running…" : "Run analysis"}
        </WeaveButton>
        <WeaveButton
          variant="outlined"
          onClick={clearAll}
          disabled={!hostReady || running}
        >
          Clear all
        </WeaveButton>
      </section>

      {running && progress.total > 0 && (
        <section className="progress">
          <div className="progress__bar">
            <div className="progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="field__hint">
            {progress.phase}… {progress.done.toLocaleString()} /{" "}
            {progress.total.toLocaleString()} ({pct}%)
          </span>
        </section>
      )}

      <section className="status">
        <WeaveBanner variant={status.kind}>{status.message}</WeaveBanner>
      </section>

      <section className="field">
        <WeaveButton variant="flat" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
        </WeaveButton>
      </section>

      {showAdvanced && (
        <section className="field advanced">
          <label className="field__label">Slope weight</label>
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={movementWeights.slope}
            onChange={(e) =>
              setMovementWeights((prev) => ({
                ...prev,
                slope: Number(e.target.value),
              }))
            }
          />
          <label className="field__label">Road preference</label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={movementWeights.roadDiscount}
            onChange={(e) =>
              setMovementWeights((prev) => ({
                ...prev,
                roadDiscount: Number(e.target.value),
              }))
            }
          />
          <label className="field__label">
            <input
              type="checkbox"
              checked={movementWeights.buildingBlock}
              onChange={(e) =>
                setMovementWeights((prev) => ({
                  ...prev,
                  buildingBlock: e.target.checked,
                }))
              }
            />{" "}
            Block building footprints
          </label>
        </section>
      )}

      {stats && (
        <section className="legend">
          <h2>Results</h2>
          <dl className="stats">
            <div>
              <dt>Peak flow</dt>
              <dd>{stats.maxVisits.toFixed(0)}</dd>
            </div>
            <div>
              <dt>Walks</dt>
              <dd>{stats.totalWalks}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{stats.completedWalks}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{mode === "flow" ? "Flow map" : "Agents"}</dd>
            </div>
          </dl>
          <p className="field__hint">
            Warmer overlay colors indicate stronger pedestrian desire lines. Use
            this to spot missing links, informal shortcuts, and route conflicts
            early in design — similar to people-movement studies used in master
            planning.
          </p>
        </section>
      )}
    </div>
  );
}
