//! Keyword-statistics similarity (TF-IDF with cosine scoring). No models,
//! no network: just word counts.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

const MAX_TERMS_PER_DOC: usize = 64;
const QUERY_TERMS_FOR_GRAPH: usize = 16;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarNote {
    pub path: String,
    pub title: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostLink {
    pub source: String,
    pub target: String,
    pub score: f32,
}

pub struct Model {
    paths: Vec<String>,
    titles: Vec<String>,
    lookup: HashMap<String, usize>,
    /// Per-document (term id, weight), sorted by weight descending, L2-normalized.
    vectors: Vec<Vec<(u32, f32)>>,
    postings: HashMap<u32, Vec<(u32, f32)>>,
}

impl Model {
    pub fn build<'a>(docs: impl IntoIterator<Item = (&'a str, String, &'a str)>) -> Model {
        let stop: HashSet<&str> = STOPWORDS.iter().copied().collect();
        let mut vocab: HashMap<String, u32> = HashMap::new();
        let mut paths = Vec::new();
        let mut titles = Vec::new();
        let mut counts: Vec<HashMap<u32, u32>> = Vec::new();
        let mut df: HashMap<u32, u32> = HashMap::new();

        for (path, title, text) in docs {
            let mut tf: HashMap<u32, u32> = HashMap::new();
            let mut add = |word: &str, times: u32, vocab: &mut HashMap<String, u32>| {
                let next = vocab.len() as u32;
                let id = *vocab.entry(word.to_string()).or_insert(next);
                *tf.entry(id).or_default() += times;
            };
            for w in tokens(&title, &stop) {
                add(&w, 3, &mut vocab);
            }
            for w in tokens(text, &stop) {
                add(&w, 1, &mut vocab);
            }
            for id in tf.keys() {
                *df.entry(*id).or_default() += 1;
            }
            paths.push(path.to_string());
            titles.push(title);
            counts.push(tf);
        }

        let n = paths.len() as f32;
        let mut vectors = Vec::with_capacity(counts.len());
        for tf in &counts {
            let mut v: Vec<(u32, f32)> = tf
                .iter()
                .map(|(&id, &c)| {
                    let idf = ((n + 1.0) / (df[&id] as f32 + 1.0)).ln() + 1.0;
                    (id, (1.0 + (c as f32).ln()) * idf)
                })
                .collect();
            v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            v.truncate(MAX_TERMS_PER_DOC);
            let norm = v.iter().map(|(_, w)| w * w).sum::<f32>().sqrt().max(1e-6);
            for e in v.iter_mut() {
                e.1 /= norm;
            }
            vectors.push(v);
        }

        let common_cutoff = ((n * 0.2) as u32).max(40);
        let mut postings: HashMap<u32, Vec<(u32, f32)>> = HashMap::new();
        for (doc, v) in vectors.iter().enumerate() {
            for &(term, w) in v {
                if df[&term] <= common_cutoff && df[&term] > 1 {
                    postings.entry(term).or_default().push((doc as u32, w));
                }
            }
        }
        let lookup = paths.iter().enumerate().map(|(i, p)| (p.clone(), i)).collect();
        Model { paths, titles, lookup, vectors, postings }
    }

    fn scores(&self, doc: usize, query_terms: usize) -> HashMap<u32, f32> {
        let mut acc: HashMap<u32, f32> = HashMap::new();
        for &(term, wq) in self.vectors[doc].iter().take(query_terms) {
            if let Some(list) = self.postings.get(&term) {
                for &(other, wd) in list {
                    if other as usize != doc {
                        *acc.entry(other).or_default() += wq * wd;
                    }
                }
            }
        }
        acc
    }

    pub fn similar(&self, path: &str, limit: usize) -> Vec<SimilarNote> {
        let Some(&doc) = self.lookup.get(path) else { return Vec::new() };
        let mut ranked: Vec<(u32, f32)> = self.scores(doc, MAX_TERMS_PER_DOC).into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked
            .into_iter()
            .filter(|(_, s)| *s > 0.04)
            .take(limit)
            .map(|(d, s)| SimilarNote {
                path: self.paths[d as usize].clone(),
                title: self.titles[d as usize].clone(),
                score: s,
            })
            .collect()
    }

    /// Strongest unlinked pairs across the whole vault.
    pub fn ghost_links(
        &self,
        threshold: f32,
        per_note: usize,
        linked: &HashSet<(String, String)>,
    ) -> Vec<GhostLink> {
        let mut seen: HashSet<(u32, u32)> = HashSet::new();
        let mut out = Vec::new();
        for doc in 0..self.paths.len() {
            let mut ranked: Vec<(u32, f32)> = self.scores(doc, QUERY_TERMS_FOR_GRAPH).into_iter().collect();
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            for (other, score) in ranked.into_iter().take(per_note) {
                if score < threshold {
                    break;
                }
                let key = if (doc as u32) < other { (doc as u32, other) } else { (other, doc as u32) };
                if !seen.insert(key) {
                    continue;
                }
                let (a, b) = (&self.paths[doc], &self.paths[other as usize]);
                if linked.contains(&(a.clone(), b.clone())) {
                    continue;
                }
                out.push(GhostLink { source: a.clone(), target: b.clone(), score });
            }
        }
        out
    }
}

fn tokens(text: &str, stop: &HashSet<&str>) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3 && !w.chars().all(|c| c.is_numeric()))
        .map(|w| w.to_lowercase())
        .filter(|w| !stop.contains(w.as_str()))
        .collect()
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
    "our", "out", "has", "have", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way",
    "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "that", "with", "this", "from",
    "they", "will", "would", "there", "their", "what", "about", "which", "when", "make", "like", "time",
    "just", "know", "take", "into", "year", "your", "good", "some", "could", "them", "than", "then",
    "look", "only", "come", "over", "think", "also", "back", "after", "work", "first", "well", "even",
    "want", "because", "these", "give", "most", "were", "been", "being", "more", "very", "here", "where",
    "each", "such", "much", "many", "those", "other", "does", "should", "while", "through", "between",
    "both", "same", "own", "why", "may", "might", "must", "shall", "upon", "yet", "via", "per", "etc",
    "http", "https", "www", "com", "md", "png", "jpg", "svg", "created", "tags", "aliases", "true", "false",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn related_documents_rank_higher() {
        let m = Model::build(vec![
            ("a.md", "Nebula".to_string(), "stellar nursery gas dust nebula hydrogen clouds collapse"),
            ("b.md", "Star Formation".to_string(), "hydrogen clouds collapse into protostars inside a nebula"),
            ("c.md", "Rust".to_string(), "ownership borrowing compiler lifetimes traits"),
            ("d.md", "Shaders".to_string(), "fragment vertex compiler pipeline gpu"),
        ]);
        let sim = m.similar("a.md", 3);
        assert_eq!(sim[0].path, "b.md");
        assert!(sim.iter().all(|s| s.path != "a.md"));
        let ghosts = m.ghost_links(0.05, 2, &HashSet::new());
        assert!(ghosts.iter().any(|g| (g.source == "a.md" && g.target == "b.md") || (g.source == "b.md" && g.target == "a.md")));
    }
}
