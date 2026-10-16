//! Resolves link targets to vault files using Obsidian's rules: exact path,
//! then unique basename (case-insensitive), then aliases, with ties broken
//! by the source note's folder and then the shortest path.

use std::collections::HashMap;

use super::paths::{file_name, join_normalize, note_stem, parent_dir};

#[derive(Debug, Default)]
pub struct Resolver {
    files: Vec<String>,
    exact: HashMap<String, usize>,
    by_name: HashMap<String, Vec<usize>>,
    by_alias: HashMap<String, Vec<usize>>,
}

impl Resolver {
    pub fn new<'a>(entries: impl IntoIterator<Item = (&'a str, &'a [String])>) -> Self {
        let mut r = Resolver::default();
        for (path, aliases) in entries {
            let idx = r.files.len();
            r.files.push(path.to_string());
            let lower = path.to_lowercase();
            r.exact.insert(lower.clone(), idx);
            if let Some(stem) = note_stem(&lower) {
                r.exact.entry(stem.to_string()).or_insert(idx);
                r.by_name.entry(file_name(stem).to_string()).or_default().push(idx);
            }
            r.by_name.entry(file_name(&lower).to_string()).or_default().push(idx);
            for alias in aliases {
                r.by_alias.entry(alias.to_lowercase()).or_default().push(idx);
            }
        }
        r
    }

    /// `relative_first` is used for markdown links, which Obsidian writes
    /// relative to the linking note.
    pub fn resolve(&self, target: &str, from: &str, relative_first: bool) -> Option<&str> {
        let t = target.trim();
        if t.is_empty() {
            return None;
        }
        let from_dir = parent_dir(from);
        if relative_first || t.starts_with("./") || t.starts_with("../") {
            if let Some(i) = join_normalize(from_dir, t).and_then(|j| self.lookup_exact(&j)) {
                return Some(&self.files[i]);
            }
        }
        let t = t.trim_start_matches('/');
        let tl = t.to_lowercase();
        if let Some(&i) = self.exact.get(&tl) {
            return Some(&self.files[i]);
        }
        if tl.contains('/') {
            let suffix = format!("/{tl}");
            let suffix_md = format!("/{tl}.md");
            let best = self
                .files
                .iter()
                .filter(|p| {
                    let pl = p.to_lowercase();
                    pl.ends_with(&suffix) || pl.ends_with(&suffix_md)
                })
                .min_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
            if let Some(p) = best {
                return Some(p);
            }
        } else if let Some(c) = self.by_name.get(&tl) {
            return Some(self.pick(c, from_dir));
        }
        if let Some(c) = self.by_alias.get(&tl) {
            return Some(self.pick(c, from_dir));
        }
        None
    }

    fn lookup_exact(&self, path: &str) -> Option<usize> {
        self.exact.get(&path.to_lowercase()).copied()
    }

    fn pick(&self, cands: &[usize], from_dir: &str) -> &str {
        if cands.len() == 1 {
            return &self.files[cands[0]];
        }
        if let Some(&i) = cands
            .iter()
            .find(|&&i| parent_dir(&self.files[i]).eq_ignore_ascii_case(from_dir))
        {
            return &self.files[i];
        }
        cands
            .iter()
            .map(|&i| self.files[i].as_str())
            .min_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)))
            .unwrap()
    }

    /// The shortest wikilink text that unambiguously points at `path`.
    pub fn link_text_for(&self, path: &str) -> String {
        let stem = note_stem(path).unwrap_or(path);
        let name = file_name(stem);
        let unique = self
            .by_name
            .get(&name.to_lowercase())
            .map(|v| v.len() == 1)
            .unwrap_or(true);
        if unique {
            name.to_string()
        } else {
            stem.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolver(files: &[(&str, &[&str])]) -> Resolver {
        let owned: Vec<(String, Vec<String>)> = files
            .iter()
            .map(|(p, a)| (p.to_string(), a.iter().map(|s| s.to_string()).collect()))
            .collect();
        Resolver::new(owned.iter().map(|(p, a)| (p.as_str(), a.as_slice())))
    }

    const NONE: &[&str] = &[];

    #[test]
    fn exact_and_basename() {
        let r = resolver(&[
            ("Welcome.md", NONE),
            ("Astronomy/Nebulae.md", NONE),
            ("attachments/crab.svg", NONE),
        ]);
        assert_eq!(r.resolve("Welcome", "x.md", false), Some("Welcome.md"));
        assert_eq!(r.resolve("nebulae", "x.md", false), Some("Astronomy/Nebulae.md"));
        assert_eq!(r.resolve("Nebulae.md", "x.md", false), Some("Astronomy/Nebulae.md"));
        assert_eq!(r.resolve("Astronomy/Nebulae", "x.md", false), Some("Astronomy/Nebulae.md"));
        assert_eq!(r.resolve("crab.svg", "x.md", false), Some("attachments/crab.svg"));
        assert_eq!(r.resolve("Missing", "x.md", false), None);
    }

    #[test]
    fn duplicate_basenames_prefer_same_folder_then_shortest() {
        let r = resolver(&[
            ("Astronomy/Index.md", NONE),
            ("Computing/Index.md", NONE),
            ("Deep/Nested/Index.md", NONE),
        ]);
        assert_eq!(r.resolve("Index", "Computing/Graph Theory.md", false), Some("Computing/Index.md"));
        assert_eq!(r.resolve("Index", "Astronomy/Galaxies.md", false), Some("Astronomy/Index.md"));
        assert_eq!(r.resolve("Index", "Welcome.md", false), Some("Astronomy/Index.md"));
        assert_eq!(r.resolve("Nested/Index", "Welcome.md", false), Some("Deep/Nested/Index.md"));
        assert_eq!(r.link_text_for("Computing/Index.md"), "Computing/Index");
    }

    #[test]
    fn aliases_resolve_last() {
        let r = resolver(&[
            ("Thinking/Evergreen Notes.md", &["Permanent Notes"]),
            ("Permanent.md", NONE),
        ]);
        assert_eq!(r.resolve("permanent notes", "x.md", false), Some("Thinking/Evergreen Notes.md"));
        assert_eq!(r.resolve("Permanent", "x.md", false), Some("Permanent.md"));
    }

    #[test]
    fn relative_markdown_paths() {
        let r = resolver(&[("Computing/Force-Directed Layout.md", NONE), ("Thinking/Atomic Notes.md", NONE)]);
        assert_eq!(
            r.resolve("../Computing/Force-Directed Layout.md", "Thinking/Atomic Notes.md", true),
            Some("Computing/Force-Directed Layout.md")
        );
        assert_eq!(r.resolve("Atomic Notes.md", "Thinking/Other.md", true), Some("Thinking/Atomic Notes.md"));
    }

    #[test]
    fn unique_link_text() {
        let r = resolver(&[("A/Solo.md", NONE), ("pic.png", NONE)]);
        assert_eq!(r.link_text_for("A/Solo.md"), "Solo");
        assert_eq!(r.link_text_for("pic.png"), "pic.png");
    }

    #[test]
    fn empty_and_unknown_targets_are_none() {
        let r = resolver(&[("Welcome.md", NONE)]);
        assert_eq!(r.resolve("", "Welcome.md", false), None);
        assert_eq!(r.resolve("   ", "Welcome.md", false), None);
        assert_eq!(r.resolve("No Such Note", "Welcome.md", false), None);
    }

    #[test]
    fn leading_slash_is_treated_as_a_vault_path() {
        let r = resolver(&[("Astronomy/Nebulae.md", NONE)]);
        assert_eq!(r.resolve("/Astronomy/Nebulae", "Welcome.md", false), Some("Astronomy/Nebulae.md"));
    }
}
