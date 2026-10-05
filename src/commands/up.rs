//! Builds, creates, starts, and attaches to containers for a service.

use anyhow::Result;
use colored::Colorize;

use crate::commands::{down, status};
use crate::config::Project;
use crate::scripts::{read_scripts, run_scripts};
use crate::state::{
    add_current_state, compose_capture, get_compose_container_ids, write_current_state,
    DevctlCurrentState,
};

pub fn run(project: &Project, merge: bool) -> Result<()> {
    let compose = project.paths.compose.display().to_string();
    let all_scripts = read_scripts(&project.paths.scripts);

    run_scripts(&all_scripts, "beforeSwitch", false)?;
    run_scripts(&all_scripts, "afterSwitch", false)?;

    if !merge {
        // Shut down first (force to skip prompts during automated flow)
        down::run(project, true, true)?;
    }

    // Start containers
    compose_capture(
        &compose,
        &["up", "-d"],
        Some(&format!(
            "Starting docker containers {}",
            "(This might take a while the first time)".bright_black()
        )),
    )?;

    // Capture container IDs and write state for tracking
    let containers = get_compose_container_ids(&compose);

    let state = DevctlCurrentState {
        compose_path: compose,
        containers,
    };
    if merge {
        add_current_state(state)?;
    } else {
        write_current_state(state)?;
    }

    // Show status
    status::run(project)?;

    run_scripts(&all_scripts, "start", true)?;

    Ok(())
}
