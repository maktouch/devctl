//! Custom command resolution and execution (the port of oclif's
//! `command_not_found` hook plus its pure helpers).

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, bail, Result};
use colored::Colorize;

use crate::config::{get_project_config, LoadOptions, Project, FORCE_IN_WORKTREE_ENV};
use crate::node_shim;

pub const FORCE_IN_WORKTREE_FLAG: &str = "--force-in-worktree";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForceFlagResult {
    /// argv with every occurrence of the flag removed
    pub argv: Vec<String>,
    /// true when the flag was present at least once
    pub forced: bool,
}

/// Custom commands run before any flag parsing, so the flag has to be picked
/// out of the raw argv by hand and must not leak through to the handler.
pub fn extract_force_in_worktree_flag(argv: &[String]) -> ForceFlagResult {
    let filtered: Vec<String> = argv
        .iter()
        .filter(|arg| arg.as_str() != FORCE_IN_WORKTREE_FLAG)
        .cloned()
        .collect();
    let forced = filtered.len() != argv.len();
    ForceFlagResult {
        argv: filtered,
        forced,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedHandler {
    pub path: PathBuf,
    pub exists: bool,
    pub is_module: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedLocation {
    pub cwd: PathBuf,
    pub handler: ResolvedHandler,
    /// true when the invoking checkout lacked the handler and the shared one was used
    pub fell_back_to_shared: bool,
}

/// Picks where a custom command runs. Per-worktree commands (dev servers,
/// URLs) must execute in the checkout the user is standing in, so that wins
/// whenever it defines the handler. An older branch that lacks the handler
/// file falls back to the shared checkout's copy and cwd.
pub fn resolve_custom_command_location(
    invocation_cwd: Option<&Path>,
    shared_cwd: Option<&Path>,
    fallback_cwd: &Path,
    mut resolve_handler: impl FnMut(&Path) -> Result<ResolvedHandler>,
) -> Result<ResolvedLocation> {
    let primary = invocation_cwd.or(shared_cwd).unwrap_or(fallback_cwd);
    let handler = resolve_handler(primary)?;

    if handler.exists || shared_cwd.is_none() || shared_cwd == Some(primary) {
        return Ok(ResolvedLocation {
            cwd: primary.to_path_buf(),
            handler,
            fell_back_to_shared: false,
        });
    }

    let shared = shared_cwd.unwrap();
    let shared_handler = resolve_handler(shared)?;
    if shared_handler.exists {
        return Ok(ResolvedLocation {
            cwd: shared.to_path_buf(),
            handler: shared_handler,
            fell_back_to_shared: true,
        });
    }

    // Neither has it: report against the invoking checkout, which is what the
    // user is looking at.
    Ok(ResolvedLocation {
        cwd: primary.to_path_buf(),
        handler,
        fell_back_to_shared: false,
    })
}

const MODULE_EXTENSIONS: [&str; 6] = ["js", "cjs", "mjs", "ts", "cts", "mts"];
const INDEX_CANDIDATES: [&str; 6] = [
    "index.js",
    "index.cjs",
    "index.mjs",
    "index.ts",
    "index.cts",
    "index.mts",
];

fn resolve_handler_file(handler: &str, cwd: &Path, command_name: &str) -> Result<ResolvedHandler> {
    let handler_path = Path::new(handler);
    let resolved = if handler_path.is_absolute() {
        handler_path.to_path_buf()
    } else {
        cwd.join(handler_path)
    };

    if !resolved.exists() {
        return Ok(ResolvedHandler {
            path: resolved,
            exists: false,
            is_module: false,
        });
    }

    if resolved.is_dir() {
        for candidate in INDEX_CANDIDATES {
            let path = resolved.join(candidate);
            if path.is_file() {
                return Ok(ResolvedHandler {
                    path,
                    exists: true,
                    is_module: true,
                });
            }
        }

        bail!("Custom command \"{command_name}\" handler directory missing index file");
    }

    let is_module = resolved
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| MODULE_EXTENSIONS.contains(&ext))
        .unwrap_or(false);

    Ok(ResolvedHandler {
        path: resolved,
        exists: true,
        is_module,
    })
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    false
}

fn run_process(command: &str, args: &[String], cwd: &Path, display_name: &str) -> Result<()> {
    let status = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .status()
        .map_err(|err| anyhow!("Failed to run custom command \"{display_name}\": {err}"))?;

    if status.success() {
        return Ok(());
    }

    let code = status.code().unwrap_or(1);
    std::process::exit(code);
}

/// Entry point for any CLI invocation that doesn't match a built-in command.
pub fn run_custom_command(id: &str, argv: &[String]) -> Result<()> {
    if id.is_empty() {
        bail!("command not found");
    }

    // Honour --force-in-worktree for custom commands too. Built-in commands
    // get it from the global clap flag, but external args arrive raw.
    let ForceFlagResult {
        argv: raw_args,
        forced,
    } = extract_force_in_worktree_flag(argv);
    if forced {
        std::env::set_var(FORCE_IN_WORKTREE_ENV, "1");
    }

    let invoked_from = std::env::current_dir()?;

    // `invocation` is the checkout the user actually ran devctl from. Custom
    // commands are per-checkout (dev servers, URLs, secrets), so their handler
    // is loaded and executed there, and it is what handlers see as
    // `config`/`project`, exactly as in devctl 7.
    //
    // `shared` is the redirected project (the main checkout when run from a
    // linked worktree). It owns the Docker stack and is exposed to handlers as
    // `shared` for the few that need it. The two are the same when not in a
    // worktree or when --force-in-worktree is set.
    let invocation = get_project_config(
        &invoked_from,
        &LoadOptions {
            force_in_worktree: Some(true),
            quiet: false,
        },
    )?;
    let shared = get_project_config(
        &invoked_from,
        &LoadOptions {
            force_in_worktree: None,
            quiet: true,
        },
    )?;

    let commands = invocation
        .as_ref()
        .map(|p| p.commands.clone())
        .filter(|c| !c.is_empty())
        .or_else(|| shared.as_ref().map(|p| p.commands.clone()))
        .unwrap_or_default();

    let Some(entry) = commands.iter().find(|command| command.name == id) else {
        bail!("command {id} not found");
    };

    let handler_spec = entry.handler.clone();
    let command_name = id.to_string();

    let invocation_cwd = invocation.as_ref().map(|p| p.cwd.clone());
    let shared_cwd = shared.as_ref().map(|p| p.cwd.clone());

    let location = resolve_custom_command_location(
        invocation_cwd.as_deref(),
        shared_cwd.as_deref(),
        &invoked_from,
        |cwd| resolve_handler_file(&handler_spec, cwd, &command_name),
    )?;

    let cwd = location.cwd.clone();
    let resolved_handler = location.handler.clone();

    if location.fell_back_to_shared {
        eprintln!(
            "{}",
            format!(
                "devctl: \"{}\" is not defined in {}; running the main checkout's copy from {}",
                command_name,
                invocation_cwd
                    .as_deref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default(),
                cwd.display()
            )
            .yellow()
        );
    }

    // Handlers see the config of the checkout they run in.
    let project = if Some(&cwd) == shared_cwd.as_ref() {
        &shared
    } else {
        &invocation
    };

    if !resolved_handler.exists {
        if handler_spec.contains('/') || handler_spec.starts_with('.') {
            bail!(
                "Custom command \"{}\" handler not found at {}",
                command_name,
                resolved_handler.path.display()
            );
        }

        return run_process(&handler_spec, &raw_args, &cwd, &command_name);
    }

    if is_executable(&resolved_handler.path) {
        let path = resolved_handler.path.display().to_string();
        return run_process(&path, &raw_args, &cwd, &command_name);
    }

    if resolved_handler.is_module {
        let payload = build_payload(
            &raw_args,
            &command_name,
            &cwd,
            project.as_ref(),
            shared.as_ref(),
        );
        return node_shim::run_module_handler(
            &resolved_handler.path,
            &payload,
            &cwd,
            &command_name,
        );
    }

    let mut sh_args = vec![resolved_handler.path.display().to_string()];
    sh_args.extend(raw_args.iter().cloned());
    run_process("sh", &sh_args, &cwd, &command_name)
}

fn build_payload(
    args: &[String],
    command_name: &str,
    cwd: &Path,
    project: Option<&Project>,
    shared: Option<&Project>,
) -> serde_json::Value {
    let project_json = project
        .map(Project::to_json)
        .unwrap_or(serde_json::Value::Null);
    let shared_json = shared
        .map(Project::to_json)
        .unwrap_or(serde_json::Value::Null);

    let mut array = vec![serde_json::Value::String(command_name.to_string())];
    array.extend(args.iter().map(|a| serde_json::Value::String(a.clone())));

    serde_json::json!({
        "args": args,
        "argv": args,
        "command": command_name,
        "cwd": cwd.display().to_string(),
        "config": project_json,
        "project": project_json,
        "shared": shared_json,
        // Backwards compatibility with gluegun-based custom commands (v3.x)
        "parameters": {
            "first": args.first(),
            "second": args.get(1),
            "array": array,
        },
    })
}
