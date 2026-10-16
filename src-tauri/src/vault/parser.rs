//! Extracts links, tags, aliases, headings and dates from a markdown note
//! using Obsidian's conventions. Text inside code (fenced, indented, inline)
//! and math is ignored.

use std::sync::LazyLock;

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use yaml_rust2::{Yaml, YamlLoader};

use super::paths::percent_decode;

static WIKILINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(!?)\[\[([^\[\]\n]+?)\]\]").unwrap());
static MDLINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(!?)\[([^\[\]\n]*)\]\(([^()\n]+)\)").unwrap());
static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)(?:^|\s)#([\p{L}\p{N}\p{M}_/\-]+)").unwrap());
static SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:").unwrap());

#[derive(Debug, Clone, PartialEq)]
pub struct RawLink {
    /// Link target without `#subpath` or `|display`, e.g. `Folder/Note`.
    pub target: String,
    pub subpath: Option<String>,
    pub display: Option<String>,
    pub embed: bool,
    /// `[text](path.md)` style rather than `[[wikilink]]`.
    pub markdown: bool,
    pub start: usize,
    pub end: usize,
    /// Byte range of the target as written in the source (possibly URL-encoded).
    pub target_start: usize,
    pub target_end: usize,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub offset: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedNote {
    pub links: Vec<RawLink>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub headings: Vec<Heading>,
    /// Creation date from frontmatter (`created`, `date`, `created_at`), in ms.
    pub created: Option<i64>,
    pub body_start: usize,
}

pub fn parse(text: &str) -> ParsedNote {
    let mut out = ParsedNote::default();
    let (frontmatter, body_start) = match split_frontmatter(text) {
        Some((yaml, start)) => (Some(yaml), start),
        None => (None, 0),
    };
    out.body_start = body_start;
    if let Some(yaml) = frontmatter {
        apply_frontmatter(yaml, &mut out);
    }

    let body = &text[body_start..];
    let line_starts = line_starts(text);
    let mut excluded: Vec<(usize, usize)> = Vec::new();

    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH;
    let mut heading: Option<(u8, String, usize)> = None;
    for (event, range) in Parser::new_ext(body, opts).into_offset_iter() {
        let abs = (range.start + body_start, range.end + body_start);
        match event {
            Event::Start(Tag::CodeBlock(_)) => excluded.push(abs),
            Event::Code(_) | Event::InlineMath(_) | Event::DisplayMath(_) => excluded.push(abs),
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((level as u8, String::new(), abs.0));
            }
            Event::Text(t) => {
                if let Some((_, s, _)) = heading.as_mut() {
                    s.push_str(&t);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, s, offset)) = heading.take() {
                    out.headings.push(Heading {
                        level,
                        text: s.trim().to_string(),
                        offset,
                    });
                }
            }
            _ => {}
        }
    }
    let in_code = |pos: usize| excluded.iter().any(|&(s, e)| pos >= s && pos < e);

    let mut link_ranges: Vec<(usize, usize)> = Vec::new();
    for cap in WIKILINK.captures_iter(body) {
        let m = cap.get(0).unwrap();
        let (start, end) = (m.start() + body_start, m.end() + body_start);
        if in_code(start) {
            continue;
        }
        link_ranges.push((start, end));
        let inner = cap.get(2).unwrap();
        let inner_str = inner.as_str();
        let (path_part, display) = match inner_str.find('|') {
            Some(i) => (&inner_str[..i], Some(inner_str[i + 1..].trim().to_string())),
            None => (inner_str, None),
        };
        let path_part = path_part.trim_end_matches('\\');
        let (target, subpath) = match path_part.find('#') {
            Some(i) => (&path_part[..i], Some(path_part[i + 1..].trim().to_string())),
            None => (path_part, None),
        };
        let trimmed = target.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lead = target.len() - target.trim_start().len();
        let target_start = inner.start() + body_start + lead;
        out.links.push(RawLink {
            target: trimmed.to_string(),
            subpath,
            display,
            embed: &cap[1] == "!",
            markdown: false,
            start,
            end,
            target_start,
            target_end: target_start + trimmed.len(),
            line: line_of(&line_starts, start),
        });
    }

    for cap in MDLINK.captures_iter(body) {
        let m = cap.get(0).unwrap();
        let (start, end) = (m.start() + body_start, m.end() + body_start);
        if in_code(start) || link_ranges.iter().any(|&(s, e)| start < e && end > s) {
            continue;
        }
        link_ranges.push((start, end));
        let raw = cap.get(3).unwrap();
        let raw_str = raw.as_str();
        let mut url = raw_str.trim_start();
        let mut offset = raw.start() + (raw_str.len() - url.len());
        if let Some(i) = url.find(" \"").or_else(|| url.find(" '")) {
            url = &url[..i];
        }
        url = url.trim_end();
        if url.len() >= 2 && url.starts_with('<') && url.ends_with('>') {
            url = &url[1..url.len() - 1];
            offset += 1;
        }
        if url.is_empty() || url.starts_with('#') || SCHEME.is_match(url) {
            continue;
        }
        let (path_raw, subpath) = match url.find('#') {
            Some(i) => (&url[..i], Some(percent_decode(&url[i + 1..]))),
            None => (url, None),
        };
        let decoded = percent_decode(path_raw);
        if decoded.trim().is_empty() {
            continue;
        }
        let target_start = offset + body_start;
        out.links.push(RawLink {
            target: decoded.trim().to_string(),
            subpath,
            display: Some(cap[2].to_string()),
            embed: &cap[1] == "!",
            markdown: true,
            start,
            end,
            target_start,
            target_end: target_start + path_raw.len(),
            line: line_of(&line_starts, start),
        });
    }
    out.links.sort_by_key(|l| l.start);

    for cap in TAG.captures_iter(body) {
        let g = cap.get(1).unwrap();
        let hash = g.start() - 1 + body_start;
        if in_code(hash) || link_ranges.iter().any(|&(s, e)| hash >= s && hash < e) {
            continue;
        }
        let tag = g.as_str().trim_end_matches('/');
        if tag.is_empty() || tag.chars().all(|c| c.is_numeric() || c == '/' || c == '-' || c == '_') {
            continue;
        }
        push_tag(&mut out.tags, tag);
    }
    out
}

/// Returns the frontmatter YAML and the byte offset where the body begins.
pub fn split_frontmatter(text: &str) -> Option<(&str, usize)> {
    let rest = text.strip_prefix("---")?;
    let open = if rest.starts_with("\r\n") {
        5
    } else if rest.starts_with('\n') {
        4
    } else {
        return None;
    };
    let mut pos = open;
    for line in text[open..].split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            return Some((&text[open..pos], pos + line.len()));
        }
        pos += line.len();
    }
    None
}

fn apply_frontmatter(yaml: &str, out: &mut ParsedNote) {
    let Ok(docs) = YamlLoader::load_from_str(yaml) else {
        return;
    };
    let Some(doc) = docs.first() else {
        return;
    };
    for key in ["tags", "tag"] {
        for tag in yaml_list(&doc[key], true) {
            let tag = tag.trim().trim_start_matches('#');
            if !tag.is_empty() {
                push_tag(&mut out.tags, tag);
            }
        }
    }
    for key in ["aliases", "alias"] {
        for alias in yaml_list(&doc[key], false) {
            let alias = alias.trim();
            if !alias.is_empty() && !out.aliases.iter().any(|a| a == alias) {
                out.aliases.push(alias.to_string());
            }
        }
    }
    for key in ["created", "date", "created_at"] {
        if let Some(ms) = yaml_scalar(&doc[key]).and_then(|s| parse_date(&s)) {
            out.created = Some(ms);
            break;
        }
    }
}

fn yaml_scalar(y: &Yaml) -> Option<String> {
    match y {
        Yaml::String(s) | Yaml::Real(s) => Some(s.clone()),
        Yaml::Integer(i) => Some(i.to_string()),
        _ => None,
    }
}

fn yaml_list(y: &Yaml, split_whitespace: bool) -> Vec<String> {
    match y {
        Yaml::Array(items) => items.iter().filter_map(yaml_scalar).collect(),
        Yaml::String(s) => s
            .split(|c: char| c == ',' || (split_whitespace && c.is_whitespace()))
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn push_tag(tags: &mut Vec<String>, tag: &str) {
    if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag) || t.to_lowercase() == tag.to_lowercase()) {
        tags.push(tag.to_string());
    }
}

/// Parses `YYYY-MM-DD` with an optional `THH:MM[:SS]` or ` HH:MM[:SS]` into
/// milliseconds since the Unix epoch (treated as UTC).
pub fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim().trim_matches('"').trim_matches('\'');
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse::<i64>().ok() };
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let mut secs = 0;
    if b.len() >= 16 && (b[10] == b'T' || b[10] == b' ') && b[13] == b':' {
        let (hh, mm) = (num(11..13)?, num(14..16)?);
        let ss = if b.len() >= 19 && b[16] == b':' { num(17..19).unwrap_or(0) } else { 0 };
        secs = hh * 3600 + mm * 60 + ss;
    }
    Some((days_from_civil(y, m, d) * 86_400 + secs) * 1000)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

pub fn line_of(starts: &[usize], pos: usize) -> usize {
    starts.partition_point(|&s| s <= pos).saturating_sub(1)
}

/// The full text of the line containing byte `pos`, trimmed and capped.
pub fn line_text(text: &str, pos: usize) -> String {
    let start = text[..pos.min(text.len())].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = text[start..].find('\n').map(|i| start + i).unwrap_or(text.len());
    let line = text[start..end].trim();
    if line.chars().count() > 240 {
        let cut: String = line.chars().take(240).collect();
        format!("{cut}…")
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(p: &ParsedNote) -> Vec<&str> {
        p.links.iter().map(|l| l.target.as_str()).collect()
    }

    #[test]
    fn wikilink_forms() {
        let p = parse("See [[Alpha]], [[Beta|the beta]], [[Gamma#Origins]] and ![[pic.png]].");
        assert_eq!(targets(&p), vec!["Alpha", "Beta", "Gamma", "pic.png"]);
        assert_eq!(p.links[1].display.as_deref(), Some("the beta"));
        assert_eq!(p.links[2].subpath.as_deref(), Some("Origins"));
        assert!(p.links[3].embed);
        assert!(!p.links[0].embed);
    }

    #[test]
    fn target_ranges_point_at_target_text() {
        let text = "x [[ Folder/Note |alias]] y";
        let p = parse(text);
        let l = &p.links[0];
        assert_eq!(&text[l.target_start..l.target_end], "Folder/Note");
        assert_eq!(&text[l.start..l.end], "[[ Folder/Note |alias]]");
    }

    #[test]
    fn self_heading_links_are_skipped() {
        let p = parse("Jump to [[#Section]].");
        assert!(p.links.is_empty());
    }

    #[test]
    fn code_is_ignored() {
        let text = "Real [[One]]\n\n```\n[[Fenced]] #fencedtag\n```\n\nInline `[[Inline]]` and $[[Math]]$ then [[Two]]\n\n    [[Indented]]\n";
        let p = parse(text);
        assert_eq!(targets(&p), vec!["One", "Two"]);
        assert!(p.tags.is_empty());
    }

    #[test]
    fn markdown_links() {
        let text = "[layout](../Computing/Force-Directed%20Layout.md) [web](https://example.com) [anchor](#top) ![img](<pics/a b.png>)";
        let p = parse(text);
        assert_eq!(targets(&p), vec!["../Computing/Force-Directed Layout.md", "pics/a b.png"]);
        assert!(p.links.iter().all(|l| l.markdown));
        assert!(p.links[1].embed);
        let l = &p.links[0];
        assert_eq!(&text[l.target_start..l.target_end], "../Computing/Force-Directed%20Layout.md");
    }

    #[test]
    fn tags_follow_obsidian_rules() {
        let p = parse("#start mid #method/zettelkasten end#not #123 #2024-review #Start\nurl http://x.com/#frag [[Note#Head]]");
        assert_eq!(p.tags, vec!["start", "method/zettelkasten", "2024-review"]);
    }

    #[test]
    fn frontmatter_fields() {
        let text = "---\ntags: [space, \"#physics\"]\naliases:\n  - Permanent Notes\n  - Evergreen\ncreated: 2025-11-03\n---\n# Title\nBody #inline\n";
        let p = parse(text);
        assert_eq!(p.tags, vec!["space", "physics", "inline"]);
        assert_eq!(p.aliases, vec!["Permanent Notes", "Evergreen"]);
        assert_eq!(p.created, Some(1_762_128_000_000));
        assert_eq!(p.headings.len(), 1);
        assert_eq!(p.headings[0].text, "Title");
        assert_eq!(&text[p.body_start..p.body_start + 7], "# Title");
    }

    #[test]
    fn frontmatter_string_lists() {
        let p = parse("---\ntags: a, b c\nalias: One, Two\n---\n");
        assert_eq!(p.tags, vec!["a", "b", "c"]);
        assert_eq!(p.aliases, vec!["One", "Two"]);
    }

    #[test]
    fn links_in_frontmatter_are_not_links() {
        let p = parse("---\nsource: \"[[Hidden]]\"\n---\n[[Visible]]");
        assert_eq!(targets(&p), vec!["Visible"]);
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("1970-01-01"), Some(0));
        assert_eq!(parse_date("1970-01-02T01:00"), Some(90_000_000));
        assert_eq!(parse_date("2024-02-29 12:30:15"), Some(1_709_209_815_000));
        assert_eq!(parse_date("yesterday"), None);
        assert_eq!(parse_date("2024-13-01"), None);
    }

    #[test]
    fn line_numbers() {
        let p = parse("a\nb [[X]]\n\nc [[Y]]");
        assert_eq!(p.links[0].line, 1);
        assert_eq!(p.links[1].line, 3);
        assert_eq!(line_text("a\n  b [[X]]  \nc", 6), "b [[X]]");
    }

    #[test]
    fn empty_and_heading_only_notes() {
        let empty = parse("");
        assert!(empty.links.is_empty());
        assert!(empty.tags.is_empty());
        assert!(empty.headings.is_empty());
        let heading = parse("## Crab Nebula\nbody");
        assert_eq!(heading.headings[0].level, 2);
        assert_eq!(heading.headings[0].text, "Crab Nebula");
    }

    #[test]
    fn alias_and_heading_together() {
        let p = parse("[[Nebulae#Crab|the crab]]");
        assert_eq!(p.links[0].target, "Nebulae");
        assert_eq!(p.links[0].subpath.as_deref(), Some("Crab"));
        assert_eq!(p.links[0].display.as_deref(), Some("the crab"));
    }

    #[test]
    fn block_comment_does_not_hide_links_outside_it() {
        let p = parse("before [[A]] %% hidden [[Nope]] #secret %% after [[B]]");
        // Comments are writer-only in the reading view; the indexer still
        // sees the raw file, so links inside %% %% remain unless the parser
        // strips them. Either way the surrounding links must survive.
        let t = targets(&p);
        assert!(t.contains(&"A"));
        assert!(t.contains(&"B"));
    }
}
