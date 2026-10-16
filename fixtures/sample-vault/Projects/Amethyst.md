---
created: 2026-03-20
tags: [project, software]
aliases: [Amethyst App]
---
# Amethyst

A notes app where the graph is the desktop.

## Pieces

- The layout is a [[Force-Directed Layout]] running in a worker.
- Nodes and links are drawn with [[Shaders]] on [[WebGL]].
- The file index and link resolver are written in [[Rust]].
- Clusters come from the [[Louvain Method]]; hub ranking from [[PageRank]].

Everything stays on this Mac. No accounts, no sync servers.
