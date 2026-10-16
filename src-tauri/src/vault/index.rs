use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::Path;

use regex::Regex;
use serde::Serialize;

use super::parser::{self, line_text, ParsedNote};
use super::paths::{self, note_stem, parent_dir, title_of};
use super::resolver::Resolver;
use super::scanner::{self, FileKind, ScannedFile};
use super::similar;
use crate::error::AppResult;

pub const UNRESOLVED_PREFIX: &str = "unresolved:";

#[derive(Debug, Clone)]
pub struct FileRecord {
    pub path: String,
    pub kind: FileKind,
    pub modified: i64,
    pub created: i64,
    pub size: u64,
    pub text: String,
    pub text_lower: String,
    pub parsed: ParsedNote,
    /// Resolved target for each entry of `parsed.links`.
    pub resolved: Vec<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub kind: &'static str,
    pub folder: String,
    pub tags: Vec<String>,
    pub created: i64,
    pub modified: i64,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: &'static str,
    pub count: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GraphSnapshot {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDelta {
    pub upsert_nodes: Vec<GraphNode>,
    pub remove_nodes: Vec<String>,
    pub upsert_edges: Vec<GraphEdge>,
    pub remove_edges: Vec<String>,
}

impl GraphDelta {
    pub fn is_empty(&self) -> bool {
        self.upsert_nodes.is_empty()
            && self.remove_nodes.is_empty()
            && self.upsert_edges.is_empty()
            && self.remove_edges.is_empty()
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub delta: GraphDelta,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
    pub folders_changed: bool,
}

impl ChangeSet {
    pub fn is_empty(&self) -> bool {
        self.delta.is_empty()
            && self.added.is_empty()
            && self.removed.is_empty()
            && self.changed.is_empty()
            && !self.folders_changed
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: &'static str,
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source: String,
    pub title: String,
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLink {
    pub target: String,
    pub title: String,
    pub resolved: bool,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub backlinks: Vec<Backlink>,
    pub outgoing: Vec<OutgoingLink>,
    pub headings: Vec<HeadingInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingInfo {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub score: f32,
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub source: String,
    pub title: String,
    pub line: usize,
    pub text: String,
    pub offset: usize,
    pub length: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub path: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub headings: Vec<String>,
}

/// A link that must be rewritten because its target (or its source) moved.
#[derive(Debug, Clone)]
pub struct LinkEdit {
    pub source: String,
    pub target_start: usize,
    pub target_end: usize,
    pub original: String,
    pub raw_target: String,
    pub new_target: String,
    pub markdown: bool,
}

pub struct Index {
    files: BTreeMap<String, FileRecord>,
    folders: BTreeSet<String>,
    resolver: Resolver,
    nodes: HashMap<String, GraphNode>,
    edges: HashMap<String, GraphEdge>,
    similarity: Option<similar::Model>,
}

impl Index {
    pub fn build(root: &Path) -> AppResult<Index> {
        let scan = scanner::scan(root)?;
        let mut index = Index {
            files: BTreeMap::new(),
            folders: scan.folders,
            resolver: Resolver::default(),
            nodes: HashMap::new(),
            edges: HashMap::new(),
            similarity: None,
        };
        for s in scan.files {
            if let Some(rec) = load_record(root, s) {
                index.files.insert(rec.path.clone(), rec);
            }
        }
        index.recompute();
        Ok(index)
    }

    pub fn file(&self, path: &str) -> Option<&FileRecord> {
        self.files.get(path)
    }

    pub fn files(&self) -> impl Iterator<Item = &FileRecord> {
        self.files.values()
    }

    pub fn resolver(&self) -> &Resolver {
        &self.resolver
    }

    pub fn snapshot(&self) -> GraphSnapshot {
        let mut nodes: Vec<GraphNode> = self.nodes.values().cloned().collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let mut edges: Vec<GraphEdge> = self.edges.values().cloned().collect();
        edges.sort_by(|a, b| a.id.cmp(&b.id));
        GraphSnapshot { nodes, edges }
    }

    pub fn list_files(&self) -> Vec<FileEntry> {
        let mut out: Vec<FileEntry> = self
            .folders
            .iter()
            .map(|f| FileEntry { path: f.clone(), kind: "folder", modified: 0 })
            .collect();
        out.extend(self.files.values().map(|f| FileEntry {
            path: f.path.clone(),
            kind: if f.kind == FileKind::Note { "note" } else { "attachment" },
            modified: f.modified,
        }));
        out
    }

    /// Re-walks the vault and reloads files whose size or mtime changed.
    pub fn refresh(&mut self, root: &Path) -> AppResult<ChangeSet> {
        let scan = scanner::scan(root)?;
        let mut cs = ChangeSet::default();
        let mut seen = HashSet::new();
        for s in scan.files {
            seen.insert(s.path.clone());
            let status = match self.files.get(&s.path) {
                Some(f) if f.modified == s.modified && f.size == s.size => continue,
                Some(_) => &mut cs.changed,
                None => &mut cs.added,
            };
            let path = s.path.clone();
            if let Some(rec) = load_record(root, s) {
                status.push(path.clone());
                self.files.insert(path, rec);
            }
        }
        let removed: Vec<String> = self.files.keys().filter(|k| !seen.contains(*k)).cloned().collect();
        for r in removed {
            self.files.remove(&r);
            cs.removed.push(r);
        }
        cs.folders_changed = scan.folders != self.folders;
        self.folders = scan.folders;
        if !(cs.added.is_empty() && cs.removed.is_empty() && cs.changed.is_empty()) {
            cs.delta = self.recompute();
        }
        Ok(cs)
    }

    /// Fast path after the app itself wrote a single file.
    pub fn update_file(&mut self, root: &Path, rel: &str) -> AppResult<ChangeSet> {
        let full = paths::resolve_in_vault(root, rel)?;
        let meta = fs::metadata(&full)?;
        let s = scanner::scanned(rel.to_string(), &meta);
        let mut cs = ChangeSet::default();
        if self.files.contains_key(rel) {
            cs.changed.push(rel.to_string());
        } else {
            cs.added.push(rel.to_string());
        }
        if let Some(rec) = load_record(root, s) {
            self.files.insert(rel.to_string(), rec);
        }
        cs.delta = self.recompute();
        Ok(cs)
    }

    fn recompute(&mut self) -> GraphDelta {
        self.resolver = Resolver::new(self.files.values().map(|f| (f.path.as_str(), f.parsed.aliases.as_slice())));
        let mut nodes: HashMap<String, GraphNode> = HashMap::with_capacity(self.files.len());
        let mut edges: HashMap<String, GraphEdge> = HashMap::new();
        for f in self.files.values() {
            nodes.insert(f.path.clone(), node_for(f));
        }
        let mut all_resolved: Vec<(String, Vec<Option<String>>)> = Vec::with_capacity(self.files.len());
        for f in self.files.values() {
            if f.kind != FileKind::Note {
                continue;
            }
            let created = f.parsed.created.unwrap_or(f.created);
            let mut resolved = Vec::with_capacity(f.parsed.links.len());
            for link in &f.parsed.links {
                let r = self
                    .resolver
                    .resolve(&link.target, &f.path, link.markdown)
                    .map(str::to_string);
                let target_id = match &r {
                    Some(t) => t.clone(),
                    None => {
                        let id = format!("{UNRESOLVED_PREFIX}{}", link.target.to_lowercase());
                        nodes
                            .entry(id.clone())
                            .and_modify(|n| n.created = n.created.min(created))
                            .or_insert_with(|| GraphNode {
                                id,
                                title: link.target.clone(),
                                kind: "unresolved",
                                folder: String::new(),
                                tags: Vec::new(),
                                created,
                                modified: 0,
                                size: 0,
                            })
                            .id
                            .clone()
                    }
                };
                resolved.push(r);
                if target_id == f.path {
                    continue;
                }
                let id = edge_id(&f.path, &target_id);
                edges
                    .entry(id.clone())
                    .or_insert_with(|| GraphEdge {
                        id,
                        source: f.path.clone(),
                        target: target_id,
                        kind: if link.embed { "embed" } else { "link" },
                        count: 0,
                    })
                    .count += 1;
            }
            all_resolved.push((f.path.clone(), resolved));
        }
        for (path, resolved) in all_resolved {
            if let Some(f) = self.files.get_mut(&path) {
                f.resolved = resolved;
            }
        }
        let delta = diff(&self.nodes, &nodes, &self.edges, &edges);
        self.nodes = nodes;
        self.edges = edges;
        self.similarity = None;
        delta
    }

    pub fn graph_maps(&self) -> (HashMap<String, GraphNode>, HashMap<String, GraphEdge>) {
        (self.nodes.clone(), self.edges.clone())
    }

    pub fn diff_since(
        &self,
        old_nodes: &HashMap<String, GraphNode>,
        old_edges: &HashMap<String, GraphEdge>,
    ) -> GraphDelta {
        diff(old_nodes, &self.nodes, old_edges, &self.edges)
    }

    pub fn note_links(&self, id: &str) -> NoteLinks {
        let unresolved_key = id.strip_prefix(UNRESOLVED_PREFIX);
        let mut backlinks: Vec<Backlink> = Vec::new();
        for f in self.files.values() {
            if f.path == id {
                continue;
            }
            let mut snippets = Vec::new();
            for (link, r) in f.parsed.links.iter().zip(&f.resolved) {
                let hit = match (r, unresolved_key) {
                    (Some(t), None) => t == id,
                    (None, Some(key)) => link.target.to_lowercase() == key,
                    _ => false,
                };
                if hit && !snippets.iter().any(|s: &Snippet| s.line == link.line) {
                    snippets.push(Snippet { line: link.line, text: line_text(&f.text, link.start) });
                }
            }
            if !snippets.is_empty() {
                backlinks.push(Backlink { source: f.path.clone(), title: title_of(&f.path), snippets });
            }
        }
        backlinks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

        let mut outgoing: Vec<OutgoingLink> = Vec::new();
        let mut headings = Vec::new();
        if let Some(f) = self.files.get(id) {
            let mut seen = HashSet::new();
            for (link, r) in f.parsed.links.iter().zip(&f.resolved) {
                let target = r.clone().unwrap_or_else(|| format!("{UNRESOLVED_PREFIX}{}", link.target.to_lowercase()));
                if target == f.path || !seen.insert(target.clone()) {
                    continue;
                }
                outgoing.push(OutgoingLink {
                    title: match r {
                        Some(t) => title_of(t),
                        None => link.target.clone(),
                    },
                    target,
                    resolved: r.is_some(),
                    kind: if link.embed { "embed" } else { "link" },
                });
            }
            headings = f
                .parsed
                .headings
                .iter()
                .map(|h| HeadingInfo { level: h.level, text: h.text.clone() })
                .collect();
        }
        NoteLinks { backlinks, outgoing, headings }
    }

    pub fn link_targets(&self) -> Vec<LinkTarget> {
        self.files
            .values()
            .map(|f| LinkTarget {
                path: f.path.clone(),
                title: title_of(&f.path),
                aliases: f.parsed.aliases.clone(),
                headings: f.parsed.headings.iter().map(|h| h.text.clone()).collect(),
            })
            .collect()
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        if terms.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        for f in self.files.values() {
            if f.kind != FileKind::Note {
                continue;
            }
            let title_lower = title_of(&f.path).to_lowercase();
            let mut score = 0.0f32;
            let mut all = true;
            for t in &terms {
                let in_title = title_lower.contains(t.as_str());
                let count = f.text_lower.matches(t.as_str()).take(50).count();
                if !in_title && count == 0 {
                    all = false;
                    break;
                }
                score += count as f32 + if in_title { 12.0 } else { 0.0 };
            }
            if !all {
                continue;
            }
            let mut snippets = Vec::new();
            for (i, line) in f.text.lines().enumerate() {
                let ll = line.to_lowercase();
                if terms.iter().any(|t| ll.contains(t.as_str())) {
                    snippets.push(Snippet { line: i, text: line_text(line, 0) });
                    if snippets.len() >= 3 {
                        break;
                    }
                }
            }
            hits.push(SearchHit { path: f.path.clone(), title: title_of(&f.path), score, snippets });
        }
        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        hits
    }

    /// Plain-text mentions of a note's title or aliases in notes that don't
    /// already link to it.
    pub fn unlinked_mentions(&self, path: &str) -> Vec<Mention> {
        let Some(target) = self.files.get(path) else { return Vec::new() };
        let mut names: Vec<String> = vec![title_of(path)];
        names.extend(target.parsed.aliases.iter().cloned());
        names.retain(|n| n.chars().count() >= 3);
        if names.is_empty() {
            return Vec::new();
        }
        names.sort_by_key(|n| std::cmp::Reverse(n.len()));
        let pattern = names.iter().map(|n| regex::escape(n)).collect::<Vec<_>>().join("|");
        let Ok(re) = Regex::new(&format!(r"(?i)\b(?:{pattern})\b")) else { return Vec::new() };
        let mut out = Vec::new();
        for f in self.files.values() {
            if f.kind != FileKind::Note || f.path == path {
                continue;
            }
            if f.resolved.iter().any(|r| r.as_deref() == Some(path)) {
                continue;
            }
            let starts = parser::line_starts(&f.text);
            for m in re.find_iter(&f.text) {
                if m.start() < f.parsed.body_start {
                    continue;
                }
                if f.parsed.links.iter().any(|l| m.start() < l.end && m.end() > l.start) {
                    continue;
                }
                out.push(Mention {
                    source: f.path.clone(),
                    title: title_of(&f.path),
                    line: parser::line_of(&starts, m.start()),
                    text: line_text(&f.text, m.start()),
                    offset: m.start(),
                    length: m.end() - m.start(),
                });
                if out.len() >= 200 {
                    return out;
                }
            }
        }
        out
    }

    /// Links whose text must change when the files in `moves` (old -> new)
    /// are relocated. Computed before the move, applied after.
    pub fn plan_link_edits(&self, moves: &HashMap<String, String>) -> Vec<LinkEdit> {
        let mut edits = Vec::new();
        for f in self.files.values() {
            let new_source = moves.get(&f.path).cloned().unwrap_or_else(|| f.path.clone());
            let source_moved = new_source != f.path;
            for (link, r) in f.parsed.links.iter().zip(&f.resolved) {
                let Some(target) = r else { continue };
                let new_target = moves.get(target).cloned().unwrap_or_else(|| target.clone());
                let target_moved = new_target != *target;
                let relative_affected = link.markdown && source_moved;
                if !target_moved && !relative_affected {
                    continue;
                }
                edits.push(LinkEdit {
                    source: new_source.clone(),
                    target_start: link.target_start,
                    target_end: link.target_end,
                    original: f.text[link.target_start..link.target_end].to_string(),
                    raw_target: link.target.clone(),
                    new_target,
                    markdown: link.markdown,
                });
            }
        }
        edits
    }

    pub fn similarity(&mut self) -> &similar::Model {
        if self.similarity.is_none() {
            let model = similar::Model::build(
                self.files
                    .values()
                    .filter(|f| f.kind == FileKind::Note)
                    .map(|f| (f.path.as_str(), title_of(&f.path), f.text.as_str())),
            );
            self.similarity = Some(model);
        }
        self.similarity.as_ref().unwrap()
    }

    pub fn linked_pairs(&self) -> HashSet<(String, String)> {
        let mut set = HashSet::new();
        for e in self.edges.values() {
            set.insert((e.source.clone(), e.target.clone()));
            set.insert((e.target.clone(), e.source.clone()));
        }
        set
    }
}

fn edge_id(source: &str, target: &str) -> String {
    format!("{source}\u{1f}{target}")
}

fn node_for(f: &FileRecord) -> GraphNode {
    GraphNode {
        id: f.path.clone(),
        title: title_of(&f.path),
        kind: if f.kind == FileKind::Note { "note" } else { "attachment" },
        folder: parent_dir(&f.path).to_string(),
        tags: f.parsed.tags.clone(),
        created: f.parsed.created.unwrap_or(f.created),
        modified: f.modified,
        size: f.size,
    }
}

fn load_record(root: &Path, s: ScannedFile) -> Option<FileRecord> {
    let (text, parsed) = if s.kind == FileKind::Note {
        let full = root.join(&s.path);
        let bytes = fs::read(&full).ok()?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let parsed = parser::parse(&text);
        (text, parsed)
    } else {
        (String::new(), ParsedNote::default())
    };
    Some(FileRecord {
        text_lower: text.to_lowercase(),
        text,
        parsed,
        resolved: Vec::new(),
        path: s.path,
        kind: s.kind,
        modified: s.modified,
        created: s.created,
        size: s.size,
    })
}

fn diff(
    old_nodes: &HashMap<String, GraphNode>,
    new_nodes: &HashMap<String, GraphNode>,
    old_edges: &HashMap<String, GraphEdge>,
    new_edges: &HashMap<String, GraphEdge>,
) -> GraphDelta {
    let mut d = GraphDelta::default();
    for (id, n) in new_nodes {
        if old_nodes.get(id) != Some(n) {
            d.upsert_nodes.push(n.clone());
        }
    }
    for id in old_nodes.keys() {
        if !new_nodes.contains_key(id) {
            d.remove_nodes.push(id.clone());
        }
    }
    for (id, e) in new_edges {
        if old_edges.get(id) != Some(e) {
            d.upsert_edges.push(e.clone());
        }
    }
    for id in old_edges.keys() {
        if !new_edges.contains_key(id) {
            d.remove_edges.push(id.clone());
        }
    }
    d
}

/// The text a moved link should now contain.
pub fn rewritten_target(resolver: &Resolver, edit: &LinkEdit) -> Option<String> {
    if edit.markdown {
        if resolver.resolve(&edit.raw_target, &edit.source, true) == Some(edit.new_target.as_str()) {
            return None;
        }
        let rel = paths::relative_path(parent_dir(&edit.source), &edit.new_target);
        Some(paths::encode_md_path(&rel))
    } else {
        if resolver.resolve(&edit.raw_target, &edit.source, false) == Some(edit.new_target.as_str()) {
            return None;
        }
        let keep_ext = note_stem(&edit.raw_target).is_some();
        let text = resolver.link_text_for(&edit.new_target);
        Some(if keep_ext && paths::is_note(&edit.new_target) { format!("{text}.md") } else { text })
    }
}
