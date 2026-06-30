import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAllVisuals,
  clearFlowOverlay,
  DESTINATION_COLOR,
  getTerrainGridSpec,
  isFormaHost,
  loadForma,
  pickPoint,
  showFlowColorbar,
  showFlowOverlay,
  SOURCE_COLOR,
  updatePointMarkers,
  type FormaSdk,
} from "./forma/client";
import { PlacementBanner, PointList } from "./components/PointPlacement";
import { runAgentSimulation } from "./movement/agents";
import { worldToGrid } from "./movement/grid";
import { dijkstraFromGoals } from "./movement/pathfinding";
import { buildSceneLayers } from "./movement/sceneData";
import {
  compositeFlowCanvas,
  heatmapToCanvas,
  simulateTrails,
} from "./movement/trails";
import type { GridSpec } from "./movement/types";
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
  WeaveToggle,
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
  const [showCompletedWalks, setShowCompletedWalks] = useState(true);
  const [showIncompleteWalks, setShowIncompleteWalks] = useState(true);
  const [flowResult, setFlowResult] = useState<{
    grid: GridSpec;
    heatmapCompleted: Float32Array;
    heatmapIncomplete: Float32Array;
  } | null>(null);
  const [progress, setProgress] = useState({ phase: "", done: 0, total: 0 });
  const [status, setStatus] = useState<Status>({ kind: "info", message: "Loading…" });
  const [stats, setStats] = useState<FlowStats | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [movementWeights, setMovementWeights] = useState<MovementWeights>(
    DEFAULT_MOVEMENT_WEIGHTS,
  );
  const [agentWeights] = useState<AgentWeights>(DEFAULT_AGENT_WEIGHTS);
  const abortRef = useRef<AbortController | null>(null);
  const stopPickingRef = useRef(false);
  const pickSessionRef = useRef(0);
  const sourcesRef = useRef<Point[]>([]);
  const destinationsRef = useRef<Point[]>([]);
  const pickingRef = useRef<"source" | "destination" | null>(null);

  sourcesRef.current = sources;
  destinationsRef.current = destinations;
  pickingRef.current = picking;

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

  const refreshMarkers = useCallback(
    async (nextSources: Point[], nextDestinations: Point[]) => {
      if (!sdk) return;
      const grid = await getTerrainGridSpec(sdk, cellSize);
      await updatePointMarkers(sdk, nextSources, nextDestinations, grid);
    },
    [sdk, cellSize],
  );

  const finishPicking = useCallback(() => {
    pickSessionRef.current += 1;
    stopPickingRef.current = true;
    setPicking(null);
    setStatus({
      kind: "info",
      message: "Placement finished. Run the simulation when ready.",
    });
  }, []);

  const requestNextPoint = useCallback(
    async (kind: "source" | "destination", session: number) => {
      if (!sdk || session !== pickSessionRef.current || stopPickingRef.current) {
        return;
      }

      const point = await pickPoint(sdk);
      if (session !== pickSessionRef.current) return;

      if (!point || stopPickingRef.current) {
        setPicking(null);
        stopPickingRef.current = false;
        setStatus({
          kind: "info",
          message: "Placement finished. Run the simulation when ready.",
        });
        return;
      }

      let nextSources = sourcesRef.current;
      let nextDestinations = destinationsRef.current;

      if (kind === "source") {
        nextSources = [...sourcesRef.current, point];
        setSources(nextSources);
        sourcesRef.current = nextSources;
      } else {
        nextDestinations = [...destinationsRef.current, point];
        setDestinations(nextDestinations);
        destinationsRef.current = nextDestinations;
      }

      await refreshMarkers(nextSources, nextDestinations);

      if (
        session === pickSessionRef.current &&
        pickingRef.current === kind &&
        !stopPickingRef.current
      ) {
        void requestNextPoint(kind, session);
      }
    },
    [sdk, refreshMarkers],
  );

  const startPicking = useCallback(
    (kind: "source" | "destination") => {
      if (!sdk || pickingRef.current) return;

      stopPickingRef.current = false;
      const session = pickSessionRef.current;
      setPicking(kind);
      setStatus({
        kind: "info",
        message:
          kind === "source"
            ? "Click in the 3D scene to place origins. Blue columns mark each point."
            : "Click in the 3D scene to place destinations. Orange columns mark each point.",
      });
      void requestNextPoint(kind, session);
    },
    [sdk, requestNextPoint],
  );

  const removeSource = useCallback(
    (index: number) => {
      const next = sources.filter((_, i) => i !== index);
      setSources(next);
      void refreshMarkers(next, destinations);
    },
    [sources, destinations, refreshMarkers],
  );

  const removeDestination = useCallback(
    (index: number) => {
      const next = destinations.filter((_, i) => i !== index);
      setDestinations(next);
      void refreshMarkers(sources, next);
    },
    [sources, destinations, refreshMarkers],
  );

  useEffect(() => {
    if (!sdk || !flowResult || mode !== "flow") return;
    if (!showCompletedWalks && !showIncompleteWalks) {
      void clearFlowOverlay(sdk);
      return;
    }
    const canvas = compositeFlowCanvas(
      flowResult.heatmapCompleted,
      flowResult.heatmapIncomplete,
      flowResult.grid,
      { completed: showCompletedWalks, incomplete: showIncompleteWalks },
    );
    void showFlowOverlay(sdk, canvas, flowResult.grid);
  }, [sdk, flowResult, mode, showCompletedWalks, showIncompleteWalks]);

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
    setFlowResult(null);
    setProgress({ phase: "Preparing", done: 0, total: 1 });

    try {
      const scene = await buildSceneLayers(sdk, {
        cellSize,
        weights: movementWeights,
        signal: controller.signal,
        onProgress: (phase, done, total) => setProgress({ phase, done, total }),
      });

      if (controller.signal.aborted) return;

      let flowStats: FlowStats;

      if (mode === "flow") {
        setProgress({ phase: "Computing cost field", done: 0, total: 1 });
        const goals = destinations.map((point) => worldToGrid(point, scene.grid));
        const costField = dijkstraFromGoals(scene.costGrid, goals);
        setProgress({ phase: "Simulating pedestrian trails", done: 0, total: 1 });
        const trails = simulateTrails(costField, sources, scene.grid, {
          walksPerSource: 100,
        });
        flowStats = trails.stats;
        setFlowResult({
          grid: scene.grid,
          heatmapCompleted: trails.heatmapCompleted,
          heatmapIncomplete: trails.heatmapIncomplete,
        });
        const canvas = compositeFlowCanvas(
          trails.heatmapCompleted,
          trails.heatmapIncomplete,
          scene.grid,
          { completed: showCompletedWalks, incomplete: showIncompleteWalks },
        );
        await showFlowOverlay(sdk, canvas, scene.grid);
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
        const heatmap = agentResult.pheromone;
        let maxVisits = 0;
        for (let i = 0; i < heatmap.length; i++) {
          maxVisits = Math.max(maxVisits, heatmap[i]);
        }
        flowStats = {
          maxVisits,
          maxCompletedVisits: maxVisits,
          maxIncompleteVisits: 0,
          totalWalks: 350,
          completedWalks: 0,
        };
        const canvas = heatmapToCanvas(heatmap, scene.grid);
        await showFlowOverlay(sdk, canvas, scene.grid);
      }
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
  }, [
    sdk,
    sources,
    destinations,
    cellSize,
    mode,
    movementWeights,
    agentWeights,
    showCompletedWalks,
    showIncompleteWalks,
  ]);

  const clearAll = useCallback(async () => {
    if (!sdk) return;
    await clearAllVisuals(sdk);
    setSources([]);
    setDestinations([]);
    setStats(null);
    setFlowResult(null);
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
        <div className="legend-key">
          <span className="legend-key__item">
            <span className="legend-key__swatch" style={{ backgroundColor: SOURCE_COLOR }} />
            Origins — blue columns
          </span>
          <span className="legend-key__item">
            <span
              className="legend-key__swatch"
              style={{ backgroundColor: DESTINATION_COLOR }}
            />
            Destinations — orange columns
          </span>
        </div>
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

        {picking === "source" ? (
          <PlacementBanner
            kind="source"
            count={sources.length}
            onDone={finishPicking}
          />
        ) : (
          <div className="actions">
            <WeaveButton
              variant="outlined"
              onClick={() => startPicking("source")}
              disabled={!hostReady || running || picking !== null}
            >
              Place origins
            </WeaveButton>
            <WeaveButton
              variant="flat"
              onClick={() => setSources([])}
              disabled={sources.length === 0 || running}
            >
              Clear all
            </WeaveButton>
          </div>
        )}

        <PointList
          kind="source"
          points={sources}
          onRemove={removeSource}
          disabled={running || picking !== null}
        />
      </section>

      <section className="field">
        <label className="field__label">Destinations</label>
        <p className="field__hint">
          Points of interest — retail, transit, schools, amenities.
        </p>

        {picking === "destination" ? (
          <PlacementBanner
            kind="destination"
            count={destinations.length}
            onDone={finishPicking}
          />
        ) : (
          <div className="actions">
            <WeaveButton
              variant="outlined"
              onClick={() => startPicking("destination")}
              disabled={!hostReady || running || picking !== null}
            >
              Place destinations
            </WeaveButton>
            <WeaveButton
              variant="flat"
              onClick={() => setDestinations([])}
              disabled={destinations.length === 0 || running}
            >
              Clear all
            </WeaveButton>
          </div>
        )}

        <PointList
          kind="destination"
          points={destinations}
          onRemove={removeDestination}
          disabled={running || picking !== null}
        />
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

      {stats && mode === "flow" && (
        <section className="field">
          <label className="field__label">Walk layers</label>
          <div className="field__inline">
            <span className={showCompletedWalks ? "muted-strong" : "muted"}>
              Completed
            </span>
            <WeaveToggle
              checked={showCompletedWalks}
              onChange={setShowCompletedWalks}
              disabled={running}
            />
          </div>
          <div className="field__inline">
            <span className={showIncompleteWalks ? "muted-strong" : "muted"}>
              Incomplete
            </span>
            <WeaveToggle
              checked={showIncompleteWalks}
              onChange={setShowIncompleteWalks}
              disabled={running}
            />
          </div>
          <p className="field__hint">
            Completed walks reached a destination (orange). Incomplete walks
            stopped early (blue). Toggle layers to compare successful routes
            against dead-end paths.
          </p>
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
              <dt>Incomplete</dt>
              <dd>{stats.totalWalks - stats.completedWalks}</dd>
            </div>
          </dl>
          {mode === "flow" && (
            <div className="legend-key">
              <span className="legend-key__item">
                <span
                  className="legend-key__swatch"
                  style={{ backgroundColor: "#ff5028" }}
                />
                Completed walks
              </span>
              <span className="legend-key__item">
                <span
                  className="legend-key__swatch"
                  style={{ backgroundColor: "#5a6ed4" }}
                />
                Incomplete walks
              </span>
            </div>
          )}
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
