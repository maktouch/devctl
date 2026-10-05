//! Lifecycle scripts recorded by `compile` into `.devctl-scripts.yaml`
//! (beforeSwitch / afterSwitch / start) — the port of `utils/runScripts.ts`.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{bail, Result};
use colored::{Color, Colorize};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptEntry {
    pub name: String,
    #[serde(default)]
    pub scripts: Vec<String>,
}

pub type AllScripts = IndexMap<String, Vec<ScriptEntry>>;

pub fn read_scripts(path: &Path) -> AllScripts {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_yaml::from_str(&raw).ok())
        .unwrap_or_default()
}

fn exec_command(cmd: &str, msg: Option<&str>) -> Result<()> {
    if let Some(msg) = msg {
        println!("{msg}");
    }

    let output = Command::new("sh").args(["-c", cmd]).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("{}", stderr.trim());
        bail!("script failed: {cmd}");
    }
    Ok(())
}

const PREFIX_COLORS: [Color; 6] = [
    Color::Cyan,
    Color::Magenta,
    Color::Green,
    Color::Yellow,
    Color::Blue,
    Color::Red,
];

/// Run the first script of each entry concurrently with prefixed output,
/// like the `concurrently` npm package.
fn run_concurrently(entries: &[ScriptEntry], key: &str) -> Result<()> {
    let runnable: Vec<(&str, &str)> = entries
        .iter()
        .filter_map(|entry| {
            entry
                .scripts
                .first()
                .map(|cmd| (entry.name.as_str(), cmd.as_str()))
        })
        .collect();

    if runnable.is_empty() {
        return Ok(());
    }

    println!("Running {} scripts", key.yellow());

    let mut handles = Vec::new();
    for (idx, (name, cmd)) in runnable.into_iter().enumerate() {
        let color = PREFIX_COLORS[idx % PREFIX_COLORS.len()];
        let name = name.to_string();
        let cmd = cmd.to_string();

        handles.push(std::thread::spawn(move || -> Result<()> {
            let mut child = Command::new("sh")
                .args(["-c", &cmd])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;

            let prefix = format!("[{name}]").color(color).to_string();

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            let out_prefix = prefix.clone();
            let out_thread = stdout.map(|out| {
                std::thread::spawn(move || {
                    for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                        println!("{out_prefix} {line}");
                    }
                })
            });
            let err_prefix = prefix.clone();
            let err_thread = stderr.map(|err| {
                std::thread::spawn(move || {
                    for line in BufReader::new(err).lines().map_while(|l| l.ok()) {
                        eprintln!("{err_prefix} {line}");
                    }
                })
            });

            let status = child.wait()?;
            if let Some(t) = out_thread {
                let _ = t.join();
            }
            if let Some(t) = err_thread {
                let _ = t.join();
            }

            if !status.success() {
                bail!("{name} exited with code {}", status.code().unwrap_or(1));
            }
            Ok(())
        }));
    }

    let mut first_error = None;
    for handle in handles {
        match handle.join() {
            Ok(Ok(())) => {}
            Ok(Err(err)) => first_error = first_error.or(Some(err)),
            Err(_) => first_error = first_error.or(Some(anyhow::anyhow!("script thread panicked"))),
        }
    }

    match first_error {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

pub fn run_scripts(all_scripts: &AllScripts, key: &str, concurrent: bool) -> Result<()> {
    let scripts = all_scripts.get(key).cloned().unwrap_or_default();

    if concurrent {
        return run_concurrently(&scripts, key);
    }

    for entry in &scripts {
        println!("Running {} scripts", key.yellow());
        for cmd in &entry.scripts {
            exec_command(cmd, Some(&format!(" {} {}", entry.name.cyan(), cmd)))?;
        }
    }

    Ok(())
}
