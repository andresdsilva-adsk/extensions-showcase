import type { Point } from "../movement/types";
import {
  DESTINATION_COLOR,
  SOURCE_COLOR,
  formatPoint,
} from "../forma/client";

interface PointListProps {
  kind: "source" | "destination";
  points: Point[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function PointList({ kind, points, onRemove, disabled }: PointListProps) {
  if (points.length === 0) return null;

  const isSource = kind === "source";
  const label = isSource ? "Origin" : "Destination";
  const prefix = isSource ? "O" : "D";
  const color = isSource ? SOURCE_COLOR : DESTINATION_COLOR;

  return (
    <ul className="point-list">
      {points.map((point, index) => (
        <li key={`${kind}-${index}-${point.x}-${point.y}`} className="point-list__row">
          <span
            className="point-list__badge"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          >
            {prefix}
            {index + 1}
          </span>
          <span className="point-list__coords">
            <span className="point-list__name">
              {label} {index + 1}
            </span>
            <span className="point-list__xy">{formatPoint(point)}</span>
          </span>
          <button
            type="button"
            className="point-list__remove"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Remove ${label} ${index + 1}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PlacementBannerProps {
  kind: "source" | "destination";
  count: number;
  onDone: () => void;
}

export function PlacementBanner({ kind, count, onDone }: PlacementBannerProps) {
  const isSource = kind === "source";
  const title = isSource ? "Placing origins" : "Placing destinations";
  const markerLabel = isSource ? "O1, O2…" : "D1, D2…";
  const color = isSource ? SOURCE_COLOR : DESTINATION_COLOR;
  const noun = isSource ? "origin" : "destination";

  return (
    <section
      className={`placement-banner placement-banner--${kind}`}
      style={{ borderColor: color }}
    >
      <div className="placement-banner__header">
        <span className="placement-banner__dot" style={{ backgroundColor: color }} />
        <h3 className="placement-banner__title">{title}</h3>
      </div>
      <p className="placement-banner__text">
        Click in the <strong>3D scene</strong> to drop {noun} points. Each point
        shows as a <strong>{isSource ? "blue" : "orange"} column</strong> and a
        ground marker <strong>{markerLabel}</strong>.
      </p>
      {count > 0 && (
        <p className="placement-banner__count">
          {count} {noun}
          {count === 1 ? "" : "s"} placed so far
        </p>
      )}
      <button type="button" className="placement-banner__done" onClick={onDone}>
        {isSource ? "Done placing origins" : "Done placing destinations"}
      </button>
    </section>
  );
}
