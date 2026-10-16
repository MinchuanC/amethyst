import type { ClusterInfo } from '../../state/graphInfo';

const SWEEP_SECONDS = 4;
const GOLDEN = 137.508;

/**
 * A live radar scope: each blip is a constellation, placed by rank (largest
 * nearest the centre) and lit as the sweep passes over it.
 */
export function RadarScope({ clusters, orphans, missing }: { clusters: ClusterInfo[]; orphans: number; missing: number }) {
  const max = Math.max(1, ...clusters.map((c) => c.size));
  const blips = clusters.slice(0, 12).map((c, i) => {
    const angle = (i * GOLDEN) % 360;
    const radius = 18 + (i / Math.max(1, Math.min(12, clusters.length) - 1 || 1)) * 30;
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      key: c.index,
      x: 50 + Math.cos(rad) * radius,
      y: 50 + Math.sin(rad) * radius,
      size: 4 + (c.size / max) * 6,
      color: c.color,
      delay: (angle / 360) * SWEEP_SECONDS,
      label: `${c.label}: ${c.size} notes`,
    };
  });
  return (
    <div className="radar-scope" role="img" aria-label={`${clusters.length} constellations, ${orphans} unlinked notes, ${missing} missing notes`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="48" className="scope-ring" />
        <circle cx="50" cy="50" r="32" className="scope-ring" />
        <circle cx="50" cy="50" r="16" className="scope-ring" />
        <line x1="50" y1="2" x2="50" y2="98" className="scope-axis" />
        <line x1="2" y1="50" x2="98" y2="50" className="scope-axis" />
      </svg>
      <div className="scope-sweep" aria-hidden />
      {blips.map((b) => (
        <span
          key={b.key}
          className="scope-blip"
          title={b.label}
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.size,
            height: b.size,
            background: b.color,
            color: b.color,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
      <span className="scope-core" aria-hidden />
    </div>
  );
}
