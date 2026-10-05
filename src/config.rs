use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use colored::Colorize;
use indexmap::IndexMap;
use serde_yaml::{Mapping, Value};

use crate::worktree::detect_linked_worktree;

pub const FORCE_IN_WORKTREE_ENV: &str = "DEVCTL_FORCE_IN_WORKTREE";

const SEARCH_PLACES: [&str; 7] = [
    ".devctl.json",
    ".devctl.yaml",
    ".devctl.yml",
    ".devctlrc.json",
    ".devctlrc.yaml",
    ".devctlrc.yml",
    "package.json",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub project: PathBuf,
    pub compose: PathBuf,
    pub current: PathBuf,
    pub scripts: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CommandEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub handler: String,
}

#[derive(Debug, Clone)]
pub struct Project {
    /// The raw project config as found on disk (services/environment untouched).
    pub raw: Mapping,
    pub cwd: PathBuf,
    pub paths: Paths,
    /// Services keyed by name, like lodash `keyBy(services, 'name')`.
    pub services: IndexMap<String, Value>,
    /// Environments keyed by name.
    pub environment: IndexMap<String, Value>,
    pub commands: Vec<CommandEntry>,
    /// Contents of `.devctl-current.yaml` ({} when missing/unreadable).
    pub current: Mapping,
}

#[derive(Debug, Clone, Default)]
pub struct LoadOptions {
    /// Run against the current worktree even when it is not the main checkout.
    /// `None` falls back to the DEVCTL_FORCE_IN_WORKTREE env var.
    pub force_in_worktree: Option<bool>,
    /// Suppress the stderr notice printed when redirecting to the main checkout.
    pub quiet: bool,
}

struct SearchResult {
    filepath: PathBuf,
    config: Value,
}

fn load_config_file(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }

    if path.file_name().and_then(|n| n.to_str()) == Some("package.json") {
        let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
        let devctl = parsed.get("devctl")?;
        if devctl.is_null() {
            return None;
        }
        return serde_yaml::to_value(devctl).ok();
    }

    if path.extension().and_then(|e| e.to_str()) == Some("json") {
        let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
        return serde_yaml::to_value(&parsed).ok();
    }

    serde_yaml::from_str(&raw).ok()
}

/// Walk up from `from`, checking each search place in order, mirroring
/// cosmiconfig's search (stops after the home directory).
fn search_config(from: &Path) -> Option<SearchResult> {
    let home = dirs::home_dir();
    let mut dir = Some(from.to_path_buf());

    while let Some(current) = dir {
        for place in SEARCH_PLACES {
            let candidate = current.join(place);
            if candidate.is_file() {
                if let Some(config) = load_config_file(&candidate) {
                    return Some(SearchResult {
                        filepath: candidate,
                        config,
                    });
                }
            }
        }

        if home.as_deref() == Some(current.as_path()) {
            return None;
        }
        dir = current.parent().map(|p| p.to_path_buf());
    }

    None
}

/// lodash `keyBy(entries, 'name')`: accepts a sequence of mappings or an
/// already-keyed mapping, returns entries keyed by their `name` field.
fn key_by_name(value: Option<&Value>) -> IndexMap<String, Value> {
    let mut out = IndexMap::new();

    let items: Vec<Value> = match value {
        Some(Value::Sequence(seq)) => seq.clone(),
        Some(Value::Mapping(map)) => map.values().cloned().collect(),
        _ => Vec::new(),
    };

    for item in items {
        if let Some(name) = item.get("name").and_then(Value::as_str) {
            out.insert(name.to_string(), item.clone());
        }
    }

    out
}

pub fn read_yaml(path: &Path) -> Result<Value> {
    let raw = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    if raw.is_empty() {
        return Ok(Value::Null);
    }
    serde_yaml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
}

pub fn get_project_config(from: &Path, options: &LoadOptions) -> Result<Option<Project>> {
    let Some(mut search) = search_config(from) else {
        return Ok(None);
    };

    let force_in_worktree = options
        .force_in_worktree
        .unwrap_or_else(|| std::env::var(FORCE_IN_WORKTREE_ENV).as_deref() == Ok("1"));

    if !force_in_worktree {
        let config_dir = search
            .filepath
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf();
        if let Some(info) = detect_linked_worktree(&config_dir) {
            if let Some(main_search) = search_config(&info.main_checkout) {
                if !options.quiet {
                    eprintln!(
                        "{}",
                        format!(
                            "devctl: in worktree {}, using main checkout {} (pass --force-in-worktree to stay here)",
                            info.worktree.display(),
                            info.main_checkout.display()
                        )
                        .yellow()
                    );
                }
                search = main_search;
            } else if !options.quiet {
                eprintln!(
                    "{}",
                    format!(
                        "devctl: in worktree {} but no devctl config found in main checkout {}; running here",
                        info.worktree.display(),
                        info.main_checkout.display()
                    )
                    .yellow()
                );
            }
        }
    }

    let cwd = search
        .filepath
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();

    let paths = Paths {
        project: search.filepath.clone(),
        compose: cwd.join(".devctl-docker-compose.yaml"),
        current: cwd.join(".devctl-current.yaml"),
        scripts: cwd.join(".devctl-scripts.yaml"),
    };

    let raw = match &search.config {
        Value::Mapping(map) => map.clone(),
        _ => Mapping::new(),
    };

    let services = key_by_name(raw.get("services"));
    let environment = key_by_name(raw.get("environment"));

    let commands: Vec<CommandEntry> = raw
        .get("commands")
        .cloned()
        .and_then(|v| serde_yaml::from_value(v).ok())
        .unwrap_or_default();

    let current = match read_yaml(&paths.current) {
        Ok(Value::Mapping(map)) => map,
        _ => Mapping::new(),
    };

    Ok(Some(Project {
        raw,
        cwd,
        paths,
        services,
        environment,
        commands,
        current,
    }))
}

impl Project {
    /// Dotted-path lookup into the raw config, like lodash `get`.
    pub fn raw_get(&self, path: &str) -> Option<&Value> {
        let mut current: &Value = self.raw.get(path.split('.').next()?)?;
        for part in path.split('.').skip(1) {
            current = current.get(part)?;
        }
        Some(current)
    }

    /// Selected service names from `.devctl-current.yaml`.
    pub fn current_services(&self) -> Vec<String> {
        self.current
            .get("services")
            .and_then(Value::as_sequence)
            .map(|seq| {
                seq.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn current_environment(&self) -> Option<String> {
        self.current
            .get("environment")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// JSON representation matching the shape TS handlers received:
    /// the raw config plus cwd/paths/current, with services/environment
    /// keyed by name.
    pub fn to_json(&self) -> serde_json::Value {
        let mut obj = serde_json::Map::new();

        if let Ok(serde_json::Value::Object(raw)) = serde_json::to_value(&self.raw) {
            obj.extend(raw);
        }

        obj.insert(
            "services".into(),
            serde_json::to_value(&self.services).unwrap_or_default(),
        );
        obj.insert(
            "environment".into(),
            serde_json::to_value(&self.environment).unwrap_or_default(),
        );
        obj.insert(
            "commands".into(),
            serde_json::to_value(&self.commands).unwrap_or_default(),
        );
        obj.insert(
            "current".into(),
            serde_json::to_value(&self.current).unwrap_or_default(),
        );
        obj.insert(
            "cwd".into(),
            serde_json::Value::String(self.cwd.display().to_string()),
        );

        let mut paths = serde_json::Map::new();
        paths.insert(
            "project".into(),
            self.paths.project.display().to_string().into(),
        );
        paths.insert(
            "compose".into(),
            self.paths.compose.display().to_string().into(),
        );
        paths.insert(
            "current".into(),
            self.paths.current.display().to_string().into(),
        );
        paths.insert(
            "scripts".into(),
            self.paths.scripts.display().to_string().into(),
        );
        obj.insert("paths".into(), serde_json::Value::Object(paths));

        serde_json::Value::Object(obj)
    }
}
