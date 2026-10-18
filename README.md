# Amethyst

**A knowledge graph you can work inside.**

A graph-first, local-first Markdown notes app for macOS.

[Website & Interactive Demo](https://amethyst-mauve.vercel.app/) · [GitHub Issues](https://github.com/MinchuanC/amethyst/issues)

Amethyst reimagines personal knowledge management around the connections between your notes. Instead of treating the graph as a small visualization beside a document editor, it makes the graph the environment you navigate: explore linked ideas in 3D, open notes in floating panels, and move between writing and graph exploration.

Amethyst is designed to work with existing **Obsidian-style Markdown vaults**. Your notes remain ordinary local files; there is no required cloud account or AI service.

> **Status: Early development.** Amethyst is not yet a full replacement for Obsidian. Compatibility with Obsidian plugins and every Obsidian feature is not guaranteed.

## Why Amethyst?

Most note-taking apps make you navigate a hierarchy of files and open documents one at a time. Amethyst starts with the relationships between those documents.

- **Graph-first navigation** — explore the structure of your vault instead of treating the graph as a secondary view.
- **A spatial writing environment** — open notes in floating, glass-like panels above the graph.
- **Your existing files** — open a Markdown vault without converting it to a proprietary format.
- **Local by design** — core functionality runs on your Mac; no cloud account, AI backend, telemetry, or sync service is required.
- **Built for exploration** — discover hubs, clusters, and paths between ideas.

## Features

The current project focuses on:

- Opening and indexing local Markdown vaults
- Parsing common Obsidian-style wikilinks, aliases, heading links, embeds, tags, and frontmatter metadata
- Resolving note links and tracking backlinks and outgoing links
- Interactive 3D knowledge graph with a 2D viewing mode
- Markdown editing powered by CodeMirror 6
- Floating note panels and a graph-centered desktop layout
- Local file watching and indexing through a Rust backend
- Vault operations constrained to the selected vault directory

Amethyst is under active development. Some advanced graph analysis, navigation, and editing ideas remain in progress. See the roadmap for the intended direction.

## See it in action

Visit the [Amethyst website](https://amethyst-mauve.vercel.app/) for the current product presentation and interactive demo.

The experience is best demonstrated by opening a vault, navigating the graph, opening a note, and following a link to another idea.

## Compatibility and data

Amethyst is built around local Markdown files and common Obsidian-style conventions.

- Existing Markdown notes are the source of truth.
- Amethyst stores its own state in a `.amethyst/` directory inside the selected vault.
- It does not write its own configuration into Obsidian's `.obsidian/` directory.
- Obsidian plugins and complete feature parity are **not** currently promised.
- Back up your vault before testing an early build on important notes.

## Technology

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 |
| Backend | Rust |
| Frontend | React, TypeScript, Vite |
| Graph rendering | Three.js, WebGL |
| Graph model and analysis | graphology |
| Graph layout | d3-force-3d |
| Markdown editor | CodeMirror 6 |
| State management | Zustand |

### Architecture

Amethyst separates vault indexing from the interface.

1. **Rust** scans and parses the vault, resolves links, indexes notes, and watches for file changes.
2. **Tauri** exposes vault data and file operations to the frontend.
3. **The frontend** maintains a graph model and renders the interactive experience.
4. **The graph engine** handles rendering, camera movement, layout, and visual effects.

This separation keeps file operations and link resolution independent of the visual interface.

## Run locally

Amethyst is currently set up for development from source. Check the [Releases](https://github.com/MinchuanC/amethyst/releases) page for any available prebuilt installers.

### Requirements

- macOS
- Node.js and npm
- Rust toolchain
- Xcode Command Line Tools
- Any additional Tauri prerequisites required by your system

### Setup

```bash
git clone https://github.com/MinchuanC/amethyst.git
cd amethyst
npm install
npm run app:dev
```

To run only the frontend in a browser:

```bash
npm run dev
```

The browser frontend uses the development/mock API where configured. Native vault access and file operations are intended to run through the Tauri application.

### Build and checks

```bash
npm run app:build
npm test
npm run typecheck
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite frontend |
| `npm run build` | Type-check and build the frontend |
| `npm run app:dev` | Run the Tauri desktop app in development |
| `npm run app:build` | Build the desktop app |
| `npm test` | Run the test suite |
| `npm run typecheck` | Run TypeScript validation |
| `npm run gen-vault` | Generate a synthetic vault for development and performance testing |
| `npm run icons` | Regenerate application icons |

## Roadmap

The project is evolving toward a more expressive way to navigate and understand personal knowledge.

### Graph exploration
- Focused navigation and neighborhood highlighting
- Paths between notes
- More flexible graph layouts and visual interactions

### Graph intelligence
- Automatic clustering and hub metrics
- Better discovery of relationships across a vault
- A vault overview highlighting orphan notes and broken links

### Knowledge over time
- Time-lapse exploration of how a vault grows
- Visual representations of how notes and connections evolve

### Writing and workflow
- Improved link and tag autocomplete
- Search and quick navigation
- More refined Markdown editing and reading experiences

### Release polish
- Performance optimization
- Accessibility and reduced-motion support
- Packaging, installation, and onboarding improvements

Roadmap items describe intended direction, not a guarantee that every feature is available in the current build.

## Contributing

Issues, bug reports, and thoughtful feedback are welcome.

1. Check [existing issues](https://github.com/MinchuanC/amethyst/issues) before opening a duplicate.
2. Include reproduction steps and your macOS version when reporting a bug.
3. For larger changes, open an issue first to discuss the design.
4. Keep contributions aligned with Amethyst's graph-first, local-first direction.

Useful starting points:

- `src/` — frontend, UI, state, editor, and graph engine
- `src-tauri/` — Rust backend and vault operations
- `fixtures/sample-vault/` — sample vault for development and tests
- `docs/design.md` — architecture and design direction

## License

A license has not yet been specified. Until a license is added to the repository, do not assume the code is licensed for reuse, redistribution, or modification.
