import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearColorbar,
  clearSlopeTexture,
  isFormaHost,
  loadForma,
  sampleElevationGrid,
  showColorbar,
  showSlopeTexture,
  type FormaSdk,
} from "./forma/client";
import {
  buildSlopeClasses,
  computeSlope,
  renderSlopeCanvas,
  type SlopeClass,
  type SlopeStats,
  type SlopeUnit,
} from "./slope/compute";
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
  { value: "fine", label: "Fine (1 m)", cellSize: 1 },
];

type StatusKind = "info" | "success" | "warning" | "error";

interface Status {
  kind: StatusKind;
  message: string;
}

interface Applied {
  classes: SlopeClass[];
  stats: SlopeStats;
  unit: SlopeUnit;
  cellSize: number;
  nx: number;
  ny: number;
}

export default function App() {
  const [sdk, setSdk] = useState<FormaSdk | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [unit, setUnit] = useState<SlopeUnit>("percent");
  const [resolution, setResolution] = useState("balanced");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [status, setStatus] = useState<Status>({
    kind: "info",
    message: "Loading…",
  });
  const [applied, setApplied] = useState<Applied | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    ensureWeave();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isFormaHost()) {
      setStatus({
        kind: "warning",
        message:
          "Preview mode — open this extension inside Autodesk Forma to read terrain and run slope analysis.",
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
          message: "Connected to Forma. Choose options and run the analysis.",
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

  // Clean up scene overlays when the panel unmounts.
  useEffect(() => {
    return () => {
      if (sdk) {
        void clearSlopeTexture(sdk);
        void clearColorbar(sdk);
      }
    };
  }, [sdk]);

  const cellSize = useMemo(
    () =>
      RESOLUTION_PRESETS.find((p) => p.value === resolution)?.cellSize ?? 5,
    [resolution],
  );

  const runAnalysis = useCallback(async () => {
    if (!sdk) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setProgress({ done: 0, total: 0 });
    setStatus({ kind: "info", message: "Sampling terrain elevation…" });

    try {
      const { grid, bbox, effectiveCellSize } = await sampleElevationGrid(sdk, {
        cellSize,
        maxCellsPerAxis: 220,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (controller.signal.aborted) return;
      setStatus({ kind: "info", message: "Computing slope surface…" });

      const slope = computeSlope(grid, unit);
      const classes = buildSlopeClasses(unit);
      const { canvas, stats } = renderSlopeCanvas(slope, classes);

      await showSlopeTexture(sdk, canvas, slope, bbox);
      await showColorbar(sdk, classes, unit === "degrees" ? "degrees" : "%");

      setApplied({
        classes,
        stats,
        unit,
        cellSize: effectiveCellSize,
        nx: slope.nx,
        ny: slope.ny,
      });

      const unitSuffix = unit === "degrees" ? "\u00b0" : "%";
      setStatus({
        kind: "success",
        message:
          `Slope overlay applied. Mean ${stats.mean.toFixed(1)}${unitSuffix}, ` +
          `max ${stats.max.toFixed(1)}${unitSuffix} at ${effectiveCellSize.toFixed(
            1,
          )} m resolution.`,
      });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      setStatus({
        kind: "error",
        message: `Analysis failed: ${String(err)}`,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }, [sdk, cellSize, unit]);

  const clearOverlay = useCallback(async () => {
    if (!sdk) return;
    await clearSlopeTexture(sdk);
    await clearColorbar(sdk);
    setApplied(null);
    setStatus({ kind: "info", message: "Overlay cleared." });
  }, [sdk]);

  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <div className="panel">
      <header className="panel__header">
        <h1>Terrain Slope Analysis</h1>
        <p className="panel__subtitle">
          Reads the project terrain and derives a slope surface using a 3×3
          fitted-plane (Horn) estimator, then draws it over the ground.
        </p>
      </header>

      <section className="field">
        <label className="field__label">Units</label>
        <div className="field__inline">
          <span className={unit === "percent" ? "muted-strong" : "muted"}>
            Percent
          </span>
          <WeaveToggle
            checked={unit === "degrees"}
            onChange={(checked) => setUnit(checked ? "degrees" : "percent")}
          />
          <span className={unit === "degrees" ? "muted-strong" : "muted"}>
            Degrees
          </span>
        </div>
      </section>

      <section className="field">
        <label className="field__label">Resolution</label>
        <WeaveSelect
          value={resolution}
          options={RESOLUTION_PRESETS.map((p) => ({
            value: p.value,
            label: p.label,
          }))}
          onChange={setResolution}
        />
        <p className="field__hint">
          Finer resolution samples more points and takes longer. Large sites are
          automatically capped to keep sampling responsive.
        </p>
      </section>

      <section className="actions">
        <WeaveButton
          variant="solid"
          onClick={runAnalysis}
          disabled={!hostReady || running}
        >
          {running ? "Analyzing…" : "Run slope analysis"}
        </WeaveButton>
        <WeaveButton
          variant="outlined"
          onClick={clearOverlay}
          disabled={!hostReady || running || !applied}
        >
          Clear
        </WeaveButton>
      </section>

      {running && progress.total > 0 && (
        <section className="progress">
          <div className="progress__bar">
            <div className="progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="field__hint">
            Sampling elevation… {progress.done.toLocaleString()} /{" "}
            {progress.total.toLocaleString()} ({pct}%)
          </span>
        </section>
      )}

      <section className="status">
        <WeaveBanner variant={status.kind}>{status.message}</WeaveBanner>
      </section>

      {applied && (
        <section className="legend">
          <h2>Legend</h2>
          <ul className="legend__list">
            {applied.classes.map((cls, i) => (
              <li key={cls.label} className="legend__row">
                <span
                  className="legend__swatch"
                  style={{ backgroundColor: cls.color }}
                />
                <span className="legend__label">{cls.label}</span>
                <span className="legend__value">
                  {(applied.stats.classFractions[i] * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
          <dl className="stats">
            <div>
              <dt>Min</dt>
              <dd>
                {applied.stats.min.toFixed(1)}
                {applied.unit === "degrees" ? "°" : "%"}
              </dd>
            </div>
            <div>
              <dt>Mean</dt>
              <dd>
                {applied.stats.mean.toFixed(1)}
                {applied.unit === "degrees" ? "°" : "%"}
              </dd>
            </div>
            <div>
              <dt>Max</dt>
              <dd>
                {applied.stats.max.toFixed(1)}
                {applied.unit === "degrees" ? "°" : "%"}
              </dd>
            </div>
            <div>
              <dt>Grid</dt>
              <dd>
                {applied.nx}×{applied.ny}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
