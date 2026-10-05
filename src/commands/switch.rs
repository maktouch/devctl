//! Switch services and/or environment: prompt, compile, then up.

use anyhow::{anyhow, Result};

use crate::commands::{compile, switch_current, up};
use crate::config::{get_project_config, LoadOptions, Project};

pub fn run(project: &Project, merge: bool) -> Result<()> {
    switch_current::run(project)?;

    // Re-read the project so compile/up see the current file we just wrote.
    let reloaded = get_project_config(
        &project.cwd,
        &LoadOptions {
            force_in_worktree: None,
            quiet: true,
        },
    )?
    .ok_or_else(|| anyhow!("Could not reload project configuration"))?;

    compile::run(&reloaded)?;
    up::run(&reloaded, merge)
}
