export type NodeKind = 'note' | 'attachment' | 'unresolved';
export type EdgeKind = 'link' | 'embed';

export interface GraphNode {
  id: string;
  title: string;
  kind: NodeKind;
  folder: string;
  tags: string[];
  created: number;
  modified: number;
  size: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  count: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphDelta {
  upsertNodes: GraphNode[];
  removeNodes: string[];
  upsertEdges: GraphEdge[];
  removeEdges: string[];
}

export interface VaultChange {
  origin: 'app' | 'external';
  delta: GraphDelta;
  added: string[];
  removed: string[];
  changed: string[];
  foldersChanged: boolean;
}

export interface VaultInfo {
  root: string;
  name: string;
  noteCount: number;
  fileCount: number;
}

export interface RecentVault {
  path: string;
  name: string;
  lastOpened: number;
}

export interface FileEntry {
  path: string;
  kind: 'note' | 'attachment' | 'folder';
  modified: number;
}

export interface Snippet {
  line: number;
  text: string;
}

export interface Backlink {
  source: string;
  title: string;
  snippets: Snippet[];
}

export interface OutgoingLink {
  target: string;
  title: string;
  resolved: boolean;
  kind: EdgeKind;
}

export interface NoteLinks {
  backlinks: Backlink[];
  outgoing: OutgoingLink[];
  headings: { level: number; text: string }[];
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippets: Snippet[];
}

export interface Mention {
  source: string;
  title: string;
  line: number;
  text: string;
  /** Byte offset in the source note, passed back unchanged to linkMention. */
  offset: number;
  length: number;
}

export interface LinkTarget {
  path: string;
  title: string;
  aliases: string[];
  headings: string[];
}

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
}

export interface GhostLink {
  source: string;
  target: string;
  score: number;
}

export interface RenameResult {
  newPath: string;
  updatedFiles: string[];
  updatedLinks: number;
}

export const UNRESOLVED_PREFIX = 'unresolved:';

export interface Backend {
  readonly isNative: boolean;
  pickVaultFolder(): Promise<string | null>;
  openVault(path: string): Promise<VaultInfo>;
  closeVault(): Promise<void>;
  currentVault(): Promise<VaultInfo | null>;
  listRecentVaults(): Promise<RecentVault[]>;
  removeRecentVault(path: string): Promise<void>;
  listFiles(): Promise<FileEntry[]>;
  graphSnapshot(): Promise<GraphSnapshot>;
  linkTargets(): Promise<LinkTarget[]>;
  readNote(path: string): Promise<string>;
  writeNote(path: string, contents: string): Promise<void>;
  createNote(path: string, contents?: string): Promise<string>;
  createFolder(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<RenameResult>;
  deletePath(path: string): Promise<void>;
  resolveLink(target: string, from: string): Promise<string | null>;
  noteLinks(path: string): Promise<NoteLinks>;
  unlinkedMentions(path: string): Promise<Mention[]>;
  linkMention(source: string, offset: number, length: number, target: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  similarNotes(path: string, limit?: number): Promise<SimilarNote[]>;
  ghostLinks(threshold?: number, perNote?: number): Promise<GhostLink[]>;
  readAppFile(name: string): Promise<string | null>;
  writeAppFile(name: string, contents: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;
  revealVault(): Promise<void>;
  openInDefaultApp(path: string): Promise<void>;
  /** Saves file bytes into the vault (attachments folder or beside `near`); returns the new path. */
  saveAttachment(name: string, bytes: Uint8Array, near?: string): Promise<string>;
  quitApp(): Promise<void>;
  /** URL usable in <img src> for a vault-relative attachment. */
  assetUrl(path: string): string;
  onVaultChanged(cb: (change: VaultChange) => void): Promise<() => void>;
  onMenu(cb: (id: string) => void): Promise<() => void>;
}
