//! Tracked `up` state (which compose files are running) plus docker compose
//! helpers — the port of `src/utils/dockerCompose.ts`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn legacy_path() -> PathBuf {
    home().join(".devctl-current")
}

fn config_dir() -> PathBuf {
    home().join(".config").join("devctl")
}

fn current_state_path() -> PathBuf {
    config_dir().join("current")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevctlCurrentState {
    pub compose_path: String,
    #[serde(default)]
    pub containers: Vec<String>,
}

/// Migrate legacy ~/.devctl-current to ~/.config/devctl/current if it exists.
fn migrate_config() {
    if !legacy_path().exists() {
        return;
    }

    let result = fs::create_dir_all(config_dir())
        .and_then(|_| fs::rename(legacy_path(), current_state_path()));
    match result {
        Ok(()) => println!("Migrated ~/.devctl-current → ~/.config/devctl/current"),
        Err(err) => eprintln!("Warning: could not migrate config: {err}"),
    }
}

/// Parse the state file, handling all legacy formats:
/// - Plain text (old compose path)
/// - Single JSON object (previous format)
/// - JSON array (new multi-project format)
fn read_state_file() -> Vec<DevctlCurrentState> {
    migrate_config();

    let Ok(raw) = fs::read_to_string(current_state_path()) else {
        return Vec::new();
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Vec::new();
    }

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) {
        // New format: array
        if parsed.is_array() {
            if let Ok(states) = serde_json::from_value(parsed.clone()) {
                return states;
            }
        }

        // Previous format: single object
        if parsed.get("composePath").is_some() {
            if let Ok(state) = serde_json::from_value::<DevctlCurrentState>(parsed) {
                return vec![state];
            }
        }
    }

    // Legacy format: plain text compose path
    vec![DevctlCurrentState {
        compose_path: raw.to_string(),
        containers: Vec::new(),
    }]
}

fn write_state_file(states: &[DevctlCurrentState]) -> Result<()> {
    fs::create_dir_all(config_dir())?;
    fs::write(current_state_path(), serde_json::to_string_pretty(states)?)?;
    Ok(())
}

pub fn get_all_states() -> Vec<DevctlCurrentState> {
    read_state_file()
}

pub fn get_last_state() -> Option<DevctlCurrentState> {
    read_state_file().into_iter().next()
}

/// Replace all tracked state with a single project (non-merge behavior).
pub fn write_current_state(state: DevctlCurrentState) -> Result<()> {
    write_state_file(&[state])
}

/// Add a project to tracked state, deduping by composePath.
pub fn add_current_state(state: DevctlCurrentState) -> Result<()> {
    let mut states: Vec<DevctlCurrentState> = read_state_file()
        .into_iter()
        .filter(|s| s.compose_path != state.compose_path)
        .collect();
    states.push(state);
    write_state_file(&states)
}

/// Remove a specific project from tracked state by its composePath.
pub fn remove_state_by_compose_path(compose_path: &str) -> Result<()> {
    let states: Vec<DevctlCurrentState> = read_state_file()
        .into_iter()
        .filter(|s| s.compose_path != compose_path)
        .collect();
    write_state_file(&states)
}

pub fn clear_current_state() {
    let _ = fs::remove_file(current_state_path());
}

pub fn compose_file_exists(compose_path: &str) -> bool {
    Path::new(compose_path).exists()
}

pub fn get_compose_container_ids(compose_path: &str) -> Vec<String> {
    let output = Command::new("docker")
        .args(["compose", "-f", compose_path, "ps", "-q"])
        .stderr(Stdio::null())
        .output();

    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .split('\n')
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

pub fn force_remove_containers(container_ids: &[String]) {
    if container_ids.is_empty() {
        return;
    }

    let output = Command::new("docker")
        .args(["rm", "-f"])
        .args(container_ids)
        .output();

    match output {
        Ok(out) if out.status.success() => {}
        Ok(out) => eprintln!(
            "Warning: some containers could not be removed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Err(err) => eprintln!("Warning: some containers could not be removed: {err}"),
    }
}

/// Run `docker compose -f <compose> <args>` capturing output; prints the
/// optional message first and surfaces stderr on failure.
pub fn compose_capture(compose_path: &str, args: &[&str], msg: Option<&str>) -> Result<String> {
    if let Some(msg) = msg {
        println!("{msg}");
    }

    let output = Command::new("docker")
        .args(["compose", "-f", compose_path])
        .args(args)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("{}", stderr.trim());
        bail!("docker compose {} failed", args.join(" "));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run `docker compose -f <compose> <args>` with inherited stdio (interactive)
/// and exit the process with the child's status code on failure.
pub fn compose_interactive(compose_path: &str, args: &[String]) -> Result<()> {
    let status = Command::new("docker")
        .args(["compose", "-f", compose_path])
        .args(args)
        .status()?;

    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }
    Ok(())
}
