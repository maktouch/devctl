//! Stops containers and removes containers, networks, volumes, and images
//! created by `up`.

use anyhow::Result;
use dialoguer::Confirm;

use crate::config::Project;
use crate::state::{
    compose_capture, compose_file_exists, force_remove_containers, get_all_states,
    remove_state_by_compose_path,
};

pub fn run(project: &Project, all: bool, force: bool) -> Result<()> {
    let current_compose = project.paths.compose.display().to_string();

    let states = get_all_states();

    for state in &states {
        let is_same_project = state.compose_path == current_compose;
        if !all && !is_same_project {
            continue;
        }

        if compose_file_exists(&state.compose_path) {
            compose_capture(
                &state.compose_path,
                &["down", "--remove-orphans"],
                Some(&format!("Shutting down {}", state.compose_path)),
            )?;
        } else if !state.containers.is_empty() {
            let should_destroy = force
                || Confirm::new()
                    .with_prompt(format!(
                        "The project at {} no longer exists. Destroy its docker containers?",
                        state.compose_path
                    ))
                    .default(true)
                    .interact()?;

            if should_destroy {
                println!("Removing orphaned containers...");
                force_remove_containers(&state.containers);
            }
        }

        remove_state_by_compose_path(&state.compose_path)?;
    }

    // Shut down current project instances (if not already handled above)
    let already_handled = states.iter().any(|s| s.compose_path == current_compose);
    if !already_handled && compose_file_exists(&current_compose) {
        compose_capture(
            &current_compose,
            &["down", "--remove-orphans"],
            Some("Removing orphans container"),
        )?;
    }

    Ok(())
}
