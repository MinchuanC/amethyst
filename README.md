# Amethyst

A more flashy version of Obsidian.

Amethyst is a graph-first, Obsidian-compatible notes app for macOS. It keeps the familiar local-first note-taking workflow of Obsidian, while reimagining the experience around a live knowledge graph that feels more like a desktop operating environment than a document editor.

Built with Tauri, React, TypeScript, and Rust, Amethyst is designed to work entirely on-device: no AI backend, no telemetry, and no cloud sync required.

## Why Amethyst?

Most note apps are built around folders and documents. Amethyst starts from the graph:

- Notes are connected by links and backlinks
- The graph stays visible as the primary interface
- Notes open in floating glass panels above the graph
- Vaults work with existing Obsidian files without conversion
- The app remains local and private by default

## Highlights

- Obsidian-compatible vault support
- Graph-first note navigation
- 3D graph view with a 2D mode toggle
- Markdown editing with CodeMirror
- Wikilink parsing for standard Obsidian patterns
- Backlinks, outgoing links, and note metadata
- Native local file parsing and indexing in Rust
- Fast development loop with a Vite + React frontend
- Tauri desktop app with a fully local backend

## Stack

- Frontend: React, TypeScript, Vite
- Desktop shell: Tauri 2
- Backend: Rust
- Graph rendering: Three.js, graphology, WebGL
- Editor: CodeMirror 6
- Styling: CSS with glassmorphism-inspired UI tokens

## Project status

This project is under active development and is intended as a polished local-first knowledge graph app for personal note-taking and exploration.

## Features in scope

### Core experience
- Open an existing Obsidian vault as-is
- Scan markdown files, links, tags, headings, and frontmatter
- Resolve note references using Obsidian-like rules
- Render a living graph from vault relationships
- Open notes in layered, floating note panels
- Support graph mode and writing mode with keyboard-driven workflows

### Graph engine direction
- 3D graph view by default
- 2D mode for a more conventional spatial layout
- Clustering and graph analysis
- Focused note navigation and path tracing
- Lightweight, animated node and link rendering
- Optional time-lapse view over note evolution

### Editing and vault intelligence
- Markdown editing with live previews
- Autocomplete for wikilinks and tags
- Search, backlinks, and related note discovery
- Metadata-driven note organization
- Local, vault-root constrained file operations

## Architecture

Amethyst intentionally separates the system into a Rust-first indexing layer and a browser-like frontend UI.

- Rust handles vault scanning, parsing, indexing, and file watching
- The frontend mirrors the graph state and renders the user experience
- Tauri exposes the backend as commands for the UI layer
- Graph analysis and layout logic run in the frontend for responsiveness

## Repository structure

```text
amethyst/
├── docs/
│   └── design.md
├── fixtures/
│   └── sample-vault/
├── scripts/
│   └── gen-vault.ts
├── src/
│   ├── api/
│   ├── editor/
│   ├── graph/
│   ├── state/
│   ├── styles/
│   ├── ui/
│   ├── App.tsx
│   ├── main.tsx
│   └── ...
├── src-tauri/
│   ├── src/
│   ├── tests/
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
└── README.md
```

## Getting started

### Prerequisites

- Node.js and npm
- Rust toolchain
- Tauri dependencies for macOS
- Xcode Command Line Tools on macOS

### Install

```bash
git clone https://github.com/MinchuanC/amethyst.git
cd amethyst
npm install
```

### Run the app in development mode

```bash
npm run app:dev
```

### Run the web frontend only

```bash
npm run dev
```

### Build the app

```bash
npm run app:build
```

### Run tests

```bash
npm test
```

### Typecheck

```bash
npm run typecheck
```

## Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite frontend |
| `npm run build` | Build the frontend bundle |
| `npm run app:dev` | Run the Tauri desktop app in dev mode |
| `npm run app:build` | Produce a Tauri desktop build |
| `npm test` | Run the project test suite |
| `npm run typecheck` | TypeScript validation |
| `npm run gen-vault` | Generate a sample vault for testing and demos |
| `npm run icons` | Regenerate app icons |

## Design direction

The project is intentionally opinionated:

- The graph is the main desktop surface
- Notes float above it in glass-like panels
- Visuals lean into a dark, nebula-inspired palette
- The app is designed to feel atmospheric but readable
- Local-first and privacy-preserving by default

The repository includes a design document at `docs/design.md` that captures architecture and product direction in more detail.

## Roadmap

### Phase 1: Foundation
- Vault scanning and indexing
- Obsidian-compatible file parsing
- Note editing and file operations
- Search and backlinks

### Phase 2: Graph engine
- 3D graph rendering
- Focus navigation
- Graph mode and write mode transitions
- Layout tuning and performance optimization

### Phase 3: Signature features
- Clustering and pathfinding
- Time-lapse views
- Radar and metadata summaries
- Rich graph interactions

### Phase 4: Polish
- Command palette and quick navigation
- Live preview and refined editing experience
- Packaging, performance improvement, and release polish

## Contributing

Contributions are welcome. The project is built around modular components and a design-first workflow, so if you are interested in the app architecture, UI, graph systems, parsing, or vault tooling, there is a lot of ground to contribute.

Before opening a PR, it is recommended to:

1. Review the project design notes in `docs/design.md`
2. Run the test suite locally
3. Keep changes aligned with the app's graph-first philosophy

## Notes

- The project is designed to work with existing Obsidian folders without forcing a migration process
- It is intentionally local-first and does not rely on cloud services for core functionality
- The repository includes a sample vault for development and testing

## Repository

- GitHub: https://github.com/MinchuanC/amethyst
- Description: A more flashy version of Obsidian

## License

License information has not been specified in the repository metadata at this time.

