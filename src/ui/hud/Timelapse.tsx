import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useMemo } from 'react';
import { getEngine } from '../../graph/GraphView';
import { useGraphInfo } from '../../state/graphInfo';
import { graphModel, useVault } from '../../state/vault';
import { useWorkspace } from '../../state/workspace';
import { formatDate } from '../primitives';

const SPEEDS = [1, 2, 4];

export function Timelapse() {
  const t = useGraphInfo((s) => s.timelapseT);
  const playing = useGraphInfo((s) => s.timelapsePlaying);
  const speed = useWorkspace((s) => s.timelapse.speed);
  const version = useVault((s) => s.structureVersion);
  const ws = useWorkspace.getState();

  const dates = useMemo(
    () =>
      [...graphModel.nodes.values()]
        .filter((n) => n.kind === 'note' && n.created > 0)
        .map((n) => n.created)
        .sort((a, b) => a - b),
    [version],
  );
  const [min, max] = dates.length ? [dates[0], dates[dates.length - 1]] : [0, 0];
  const at = min + Math.min(1, t / 0.97) * (max - min);
  const count = dates.filter((d) => d <= at).length;
  const ended = t >= 1.02;

  const control = (opts: { playing?: boolean; t?: number; speed?: number }) => getEngine()?.setTimelapse(true, opts);

  return (
    <div className="hud-timelapse hud-surface" role="group" aria-label="Time-lapse">
      <button
        type="button"
        className="tl-play"
        aria-label={playing ? 'Pause' : ended ? 'Replay from the start' : 'Play'}
        onClick={() => (ended ? control({ t: 0, playing: true }) : control({ playing: !playing }))}
      >
        {playing ? <Pause size={16} /> : ended ? <RotateCcw size={16} /> : <Play size={16} />}
      </button>
      <div className="tl-readout">
        <b>{formatDate(at)}</b>
        <span className="num">
          {count} of {dates.length} notes
        </span>
      </div>
      <input
        className="tl-scrub"
        type="range"
        min={0}
        max={1.02}
        step={0.001}
        value={t}
        aria-label="Time-lapse position"
        aria-valuetext={formatDate(at)}
        onChange={(e) => control({ t: Number(e.target.value), playing: false })}
        style={{ ['--p' as string]: `${(t / 1.02) * 100}%` }}
      />
      <div className="segmented" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            onClick={() => {
              ws.setTimelapse({ speed: s });
              control({ speed: s });
            }}
          >
            {s}×
          </button>
        ))}
      </div>
      <button type="button" className="icon-button" aria-label="Close time-lapse" onClick={() => ws.toggleHud('timelapse', false)}>
        <X size={15} />
      </button>
    </div>
  );
}
