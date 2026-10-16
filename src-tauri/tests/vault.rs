use std::fs;
use std::path::{Path, PathBuf};

use amethyst_lib::vault::index::{GraphSnapshot, UNRESOLVED_PREFIX};
use amethyst_lib::vault::Vault;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-vault")
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".amethyst" || name == ".trash" {
            continue;
        }
        let dest = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).unwrap();
        }
    }
}

fn temp_vault() -> (tempfile::TempDir, Vault) {
    let dir = tempfile::tempdir().unwrap();
    copy_dir(&fixture(), dir.path());
    let vault = Vault::open(dir.path()).unwrap();
    (dir, vault)
}

fn edge_targets(snap: &GraphSnapshot, source: &str) -> Vec<String> {
    let mut t: Vec<String> = snap.edges.iter().filter(|e| e.source == source).map(|e| e.target.clone()).collect();
    t.sort();
    t
}

#[test]
fn opens_and_counts() {
    let (_d, vault) = temp_vault();
    let info = vault.info();
    assert_eq!(info.note_count, 39);
    assert_eq!(info.file_count, 41);
    let files = vault.index.list_files();
    assert!(!files.iter().any(|f| f.path.starts_with(".obsidian")));
}

#[test]
fn atomic_notes_edge_cases_resolve() {
    let (_d, vault) = temp_vault();
    let snap = vault.index.snapshot();
    assert_eq!(
        edge_targets(&snap, "Thinking/Atomic Notes.md"),
        vec![
            "Computing/Force-Directed Layout.md".to_string(),
            "Thinking/Evergreen Notes.md".to_string(),
            "Thinking/Zettelkasten.md".to_string(),
        ]
    );
    let alias_edge = snap
        .edges
        .iter()
        .find(|e| e.source == "Thinking/Atomic Notes.md" && e.target == "Thinking/Evergreen Notes.md")
        .unwrap();
    assert_eq!(alias_edge.count, 2, "direct link and alias link both count");
    assert!(!snap.nodes.iter().any(|n| n.title.contains("Not A Link")));
    let atomic = snap.nodes.iter().find(|n| n.id == "Thinking/Atomic Notes.md").unwrap();
    assert_eq!(atomic.tags, vec!["method", "method/zettelkasten"]);
}

#[test]
fn duplicate_index_notes_resolve_by_folder() {
    let (_d, vault) = temp_vault();
    let snap = vault.index.snapshot();
    assert!(edge_targets(&snap, "Computing/Graph Theory.md").contains(&"Computing/Index.md".to_string()));
    assert!(edge_targets(&snap, "Astronomy/Nebulae.md").contains(&"Astronomy/Index.md".to_string()));
}

#[test]
fn embeds_unresolved_and_orphans() {
    let (_d, vault) = temp_vault();
    let snap = vault.index.snapshot();
    let embed = snap
        .edges
        .iter()
        .find(|e| e.source == "Astronomy/Nebulae.md" && e.target == "attachments/crab-nebula.svg")
        .unwrap();
    assert_eq!(embed.kind, "embed");
    for name in ["quantum notes", "lucid dreaming", "signal garden", "general relativity", "hawking radiation"] {
        let id = format!("{UNRESOLVED_PREFIX}{name}");
        let node = snap.nodes.iter().find(|n| n.id == id).unwrap_or_else(|| panic!("missing {id}"));
        assert_eq!(node.kind, "unresolved");
    }
    let degree = |id: &str| snap.edges.iter().filter(|e| e.source == id || e.target == id).count();
    assert_eq!(degree("Thinking/Inbox.md"), 0);
    assert_eq!(degree("Astronomy/Pulsars.md"), 0);
    let created = snap.nodes.iter().find(|n| n.id == "Welcome.md").unwrap().created;
    assert_eq!(created, 1_756_684_800_000);
}

#[test]
fn backlinks_and_outgoing() {
    let (_d, vault) = temp_vault();
    let links = vault.index.note_links("Astronomy/Black Holes.md");
    let sources: Vec<&str> = links.backlinks.iter().map(|b| b.source.as_str()).collect();
    for s in ["Astronomy/Star Formation.md", "Astronomy/Event Horizon.md", "Astronomy/Galaxies.md", "Journal/2026-06-09.md", "Astronomy/Index.md"] {
        assert!(sources.contains(&s), "missing backlink from {s}");
    }
    assert!(links.backlinks.iter().all(|b| !b.snippets.is_empty()));
    let unresolved = links.outgoing.iter().find(|o| !o.resolved).unwrap();
    assert_eq!(unresolved.title, "General Relativity");

    let ghost = vault.index.note_links("unresolved:general relativity");
    assert_eq!(ghost.backlinks.len(), 1);
}

#[test]
fn search_and_mentions() {
    let (_d, vault) = temp_vault();
    let hits = vault.index.search("nebula", 10);
    assert_eq!(hits[0].path, "Astronomy/Nebulae.md");
    let mentions = vault.index.unlinked_mentions("Astronomy/Telescopes.md");
    assert!(mentions.iter().any(|m| m.source == "Journal/2025-09-14.md"));
    assert!(!mentions.iter().any(|m| m.source == "Journal/2025-11-03.md"));
}

#[test]
fn write_produces_delta() {
    let (_d, mut vault) = temp_vault();
    let mut text = vault.read_note("Thinking/Inbox.md").unwrap();
    text.push_str("\nRelated: [[Pulsars]] and [[Brand New Idea]]\n");
    let cs = vault.write_note("Thinking/Inbox.md", &text).unwrap();
    assert_eq!(cs.changed, vec!["Thinking/Inbox.md"]);
    let ids: Vec<&str> = cs.delta.upsert_edges.iter().map(|e| e.target.as_str()).collect();
    assert!(ids.contains(&"Astronomy/Pulsars.md"));
    assert!(ids.contains(&"unresolved:brand new idea"));
    assert!(cs.delta.upsert_nodes.iter().any(|n| n.id == "unresolved:brand new idea"));
}

#[test]
fn creating_a_note_resolves_a_dangling_link() {
    let (_d, mut vault) = temp_vault();
    let (path, cs) = vault.create_note("Physics/General Relativity", "# General Relativity\n").unwrap();
    assert_eq!(path, "Physics/General Relativity.md");
    assert!(cs.delta.remove_nodes.contains(&"unresolved:general relativity".to_string()));
    assert!(cs
        .delta
        .upsert_edges
        .iter()
        .any(|e| e.source == "Astronomy/Black Holes.md" && e.target == "Physics/General Relativity.md"));
    let (again, _) = vault.create_note("Physics/General Relativity.md", "").unwrap();
    assert_eq!(again, "Physics/General Relativity 1.md");
}

#[test]
fn rename_updates_links() {
    let (_d, mut vault) = temp_vault();
    let (result, cs) = vault.rename("Thinking/Evergreen Notes.md", "Thinking/Evergreen Ideas.md").unwrap();
    assert_eq!(result.new_path, "Thinking/Evergreen Ideas.md");
    let atomic = vault.read_note("Thinking/Atomic Notes.md").unwrap();
    assert!(atomic.contains("[[Evergreen Ideas|evergreen]]"));
    assert!(atomic.contains("[[Permanent Notes]]"), "alias links keep working without edits");
    let zettel = vault.read_note("Thinking/Zettelkasten.md").unwrap();
    assert!(zettel.contains("[[Evergreen Ideas]]"));
    assert!(cs.delta.remove_nodes.contains(&"Thinking/Evergreen Notes.md".to_string()));

    vault.rename("Computing/Force-Directed Layout.md", "Computing/Layouts/Force Layout.md").unwrap();
    let atomic = vault.read_note("Thinking/Atomic Notes.md").unwrap();
    assert!(atomic.contains("(../Computing/Layouts/Force%20Layout.md)"), "{atomic}");
    let webgl = vault.read_note("Computing/WebGL.md").unwrap();
    assert!(webgl.contains("[[Force Layout]]"));
    let snap = vault.index.snapshot();
    assert!(!snap.nodes.iter().any(|n| n.kind == "unresolved" && n.title.contains("Force")));
}

#[test]
fn folder_rename_and_delete() {
    let (dir, mut vault) = temp_vault();
    let (result, _) = vault.rename("Thinking", "Mind").unwrap();
    assert_eq!(result.new_path, "Mind");
    assert!(vault.index.file("Mind/Atomic Notes.md").is_some());
    let snap = vault.index.snapshot();
    assert!(edge_targets(&snap, "Mind/Atomic Notes.md").contains(&"Computing/Force-Directed Layout.md".to_string()));

    vault.delete("Mind/Inbox.md").unwrap();
    assert!(vault.index.file("Mind/Inbox.md").is_none());
    assert!(dir.path().join(".trash/Inbox.md").exists());
}

#[test]
fn rejects_paths_outside_the_vault() {
    let (_d, mut vault) = temp_vault();
    assert!(vault.read_note("../secrets.md").is_err());
    assert!(vault.write_note("../escape.md", "x").is_err());
    assert!(vault.read_app_file("../x").is_err());
    vault.write_app_file("layout", "{}").unwrap();
    assert_eq!(vault.read_app_file("layout").unwrap().as_deref(), Some("{}"));
}

#[test]
fn link_mention_rewrites_text() {
    let (_d, mut vault) = temp_vault();
    let m = vault
        .index
        .unlinked_mentions("Astronomy/Telescopes.md")
        .into_iter()
        .find(|m| m.source == "Journal/2025-09-14.md")
        .unwrap();
    vault.link_mention(&m.source, m.offset, m.length, "Astronomy/Telescopes.md").unwrap();
    let text = vault.read_note("Journal/2025-09-14.md").unwrap();
    assert!(text.contains("[[Telescopes|telescopes]]"), "{text}");
}

#[test]
fn attachments_get_safe_unique_names_in_the_attachments_folder() {
    let (dir, mut vault) = temp_vault();
    let (a, cs) = vault.save_attachment("crab-nebula.svg", b"<svg/>", Some("Astronomy/Nebulae.md")).unwrap();
    assert_eq!(a, "attachments/crab-nebula 1.svg");
    assert!(cs.added.contains(&a));
    let (b, _) = vault.save_attachment("../evil/name.png", b"x", None).unwrap();
    assert_eq!(b, "attachments/-evil-name.png");
    assert!(dir.path().join(&b).exists());
}

#[test]
fn similar_notes_find_neighbors() {
    let (_d, mut vault) = temp_vault();
    let sim = vault.index.similarity().similar("Astronomy/Dark Matter.md", 5);
    assert!(!sim.is_empty());
    assert!(sim.iter().any(|s| s.path.starts_with("Astronomy/")));
}

#[test]
fn empty_search_and_missing_note_are_safe() {
    let (_d, vault) = temp_vault();
    assert!(vault.index.search("   ", 10).is_empty());
    assert!(vault.index.search("zzzz-no-such-term", 10).is_empty());
    let links = vault.index.note_links("Does/Not/Exist.md");
    assert!(links.backlinks.is_empty());
    assert!(links.outgoing.is_empty());
}

#[test]
fn create_folder_and_note_then_move() {
    let (_d, mut vault) = temp_vault();
    vault.create_folder("Projects").unwrap();
    let (path, _) = vault.create_note("Projects/Spark", "# Spark\n").unwrap();
    assert_eq!(path, "Projects/Spark.md");
    let (moved, _) = vault.rename("Projects/Spark.md", "Thinking/Spark.md").unwrap();
    assert_eq!(moved.new_path, "Thinking/Spark.md");
    assert!(vault.read_note("Thinking/Spark.md").unwrap().contains("# Spark"));
}

#[test]
fn write_app_file_round_trips_and_rejects_traversal() {
    let (_d, vault) = temp_vault();
    vault.write_app_file("settings", "{\"bloom\":1}").unwrap();
    assert_eq!(vault.read_app_file("settings").unwrap().as_deref(), Some("{\"bloom\":1}"));
    assert!(vault.write_app_file("../escape", "x").is_err());
}
