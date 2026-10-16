import { useEffect, useRef, useState } from 'react';
import { openNode } from '../actions';
import { api } from '../api';
import { bus } from '../bus';
import { useGraphHover } from '../state/graphHover';
import { useGraphInfo } from '../state/graphInfo';
import { useSettings } from '../state/settings';
import { graphModel, useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { play } from '../ui/sounds';
import { GraphEngine } from './engine/GraphEngine';
import type { Dims } from './layoutProtocol';
import { buildView } from './model';

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

let current: GraphEngine | null = null;

/** The live engine, for HUD controls that need to ask it something (paths, time-lapse). */
export function getEngine() {
  return current;
}

interface LayoutCache {
  version: 1;
  '3d'?: Record<string, number[]>;
  '2d'?: Record<string, number[]>;
}

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export function GraphView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<LayoutCache>({ version: 1 });
  const loadedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hostRef.current || !webglAvailable()) {
      setFailed(true);
      return;
    }
    let engine: GraphEngine;
    try {
      engine = new GraphEngine(hostRef.current, { reducedMotion: reducedMotionQuery.matches });
    } catch {
      setFailed(true);
      return;
    }
    current = engine;
    const offs: (() => void)[] = [];
    const ws = useWorkspace.getState;
    const s = useSettings.getState;

    offs.push(
      engine.on('hover', (id, x, y) => {
        useGraphHover.getState().set(id, x, y);
        if (id) play('hover');
      }),
      engine.on('select', (id, mods) => {
        const w = ws();
        if (!id) {
          if (!w.hud.path) {
            w.select(null);
            w.setFocus(null);
          }
          return;
        }
        play('select');
        if (w.hud.path || mods.shift) {
          w.toggleHud('path', true);
          const { from, to } = w.path;
          if (!from || (from && to)) w.setPath({ from: id, to: null, result: null, searched: false });
          else w.setPath({ to: id });
          return;
        }
        w.select(id);
        w.setFocus(id);
        if (mods.meta) openNode(id, true);
      }),
      engine.on('open', (id) => {
        play('open');
        openNode(id);
      }),
      engine.on('clusters', (clusters, list) => {
        useGraphInfo.getState().set({
          clusters,
          clusterList: list.map((c) => ({ index: c.index, size: c.size, label: c.hubTitle, hubId: c.hubId, color: c.color })),
        });
      }),
      engine.on('colors', (colors) => useGraphInfo.getState().set({ colors })),
      engine.on('fps', (fps) => useGraphInfo.getState().set({ fps })),
      engine.on('timelapse', (t, playing) => useGraphInfo.getState().set({ timelapseT: t, timelapsePlaying: playing })),
      engine.on('settled', (positions, dims) => {
        const key = dims === 3 ? '3d' : '2d';
        cacheRef.current = { ...cacheRef.current, version: 1, [key]: Object.fromEntries(positions) };
        api.writeAppFile('layout', JSON.stringify(cacheRef.current)).catch(() => {});
        useGraphInfo.getState().set({ settled: true });
      }),
    );

    const settings = s();
    engine.setDimension(settings.dimension === '2d' ? 2 : 3);
    engine.setColorMode(settings.colorMode);
    engine.setBloom(settings.bloom);
    engine.setLinkFlow(settings.linkFlow);
    engine.setGroupClusters(settings.groupClusters);
    engine.setAmbient(ws().mode === 'write');

    const rebuild = (animate: boolean) => {
      const st = s();
      const view = buildView(graphModel, st, useVault.getState().ghostLinks);
      const last = useVault.getState().lastChange;
      const pulse = animate && last ? [...last.summary.changedNodes, ...last.summary.addedNodes] : [];
      let cached: Map<string, number[]> | undefined;
      if (!loadedRef.current) {
        const key = st.dimension === '2d' ? '2d' : '3d';
        const entries = cacheRef.current[key];
        if (entries) cached = new Map(Object.entries(entries));
      }
      engine.setGraph(view, { cached, pulse, animateNew: animate });
      loadedRef.current = true;
    };

    let pendingRebuild: ReturnType<typeof setTimeout> | undefined;
    api
      .readAppFile('layout')
      .then((raw) => {
        if (raw) cacheRef.current = JSON.parse(raw) as LayoutCache;
      })
      .catch(() => {})
      .finally(() => rebuild(false));

    offs.push(
      useVault.subscribe((v, prev) => {
        if (v.graphVersion === prev.graphVersion || !loadedRef.current) return;
        clearTimeout(pendingRebuild);
        pendingRebuild = setTimeout(() => rebuild(true), 60);
      }),
      useSettings.subscribe((v, prev) => {
        if (v.dimension !== prev.dimension) engine.setDimension(v.dimension === '2d' ? 2 : 3);
        if (v.colorMode !== prev.colorMode) engine.setColorMode(v.colorMode);
        if (v.bloom !== prev.bloom) engine.setBloom(v.bloom);
        if (v.linkFlow !== prev.linkFlow) engine.setLinkFlow(v.linkFlow);
        if (v.groupClusters !== prev.groupClusters) engine.setGroupClusters(v.groupClusters);
        if (v.focusDepth !== prev.focusDepth) engine.focus(ws().focusId, v.focusDepth, false);
        const filtersChanged =
          v.showTags !== prev.showTags ||
          v.showAttachments !== prev.showAttachments ||
          v.showUnresolved !== prev.showUnresolved ||
          v.showOrphans !== prev.showOrphans ||
          v.showGhostLinks !== prev.showGhostLinks;
        if (filtersChanged && loadedRef.current) rebuild(false);
        if (v.loaded && !prev.loaded) {
          engine.setDimension(v.dimension === '2d' ? 2 : 3);
          engine.setColorMode(v.colorMode);
        }
      }),
      useWorkspace.subscribe((v, prev) => {
        if (v.mode !== prev.mode) engine.setAmbient(v.mode === 'write');
        if (v.focusId !== prev.focusId) {
          engine.focus(v.focusId, s().focusDepth, true);
          if (v.focusId && v.mode === 'graph') play('focus');
        }
        if (v.highlight !== prev.highlight) engine.setHighlight(v.highlight?.ids ?? null);
        if (v.path.result !== prev.path.result) engine.showPath(v.path.result);
        if (v.hud.timelapse !== prev.hud.timelapse) engine.setTimelapse(v.hud.timelapse, { playing: v.hud.timelapse, t: v.hud.timelapse ? 0 : 1 });
      }),
      bus.on('graph:recenter', () => engine.recenter()),
    );

    const onMotion = () => engine.setReducedMotion(reducedMotionQuery.matches);
    reducedMotionQuery.addEventListener('change', onMotion);
    const initialFocus = ws().focusId;
    if (initialFocus) setTimeout(() => engine.focus(initialFocus, s().focusDepth, false), 0);

    return () => {
      clearTimeout(pendingRebuild);
      reducedMotionQuery.removeEventListener('change', onMotion);
      offs.forEach((off) => off());
      engine.dispose();
      current = null;
    };
  }, []);

  if (failed) {
    return (
      <div className="graph-layer graph-fallback" role="status">
        <p className="error-title">The graph needs WebGL</p>
        <p>This Mac can’t start the galaxy view. Writing and reading notes still work.</p>
      </div>
    );
  }

  return <div className="graph-layer" ref={hostRef} />;
}

export type { Dims };
