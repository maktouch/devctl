//! Re-prompt services/environment without recomputing the docker host,
//! then recompile (hidden command).

use std::fs;

use anyhow::Result;
use serde_yaml::{Mapping, Value};

use crate::commands::{compile, switch_current};
use crate::config::Project;

pub fn run(project: &Project) -> Result<()> {
    let (services, environment) = switch_current::prompt_selection(project)?;

    let mut current = Mapping::new();
    current.insert(
        Value::String("services".into()),
        Value::Sequence(services.into_iter().map(Value::String).collect()),
    );
    current.insert(
        Value::String("environment".into()),
        Value::String(environment),
    );
    current.insert(
        Value::String("dockerhost".into()),
        Value::String(String::new()),
    );

    fs::write(&project.paths.current, serde_yaml::to_string(&current)?)?;

    // Re-read the project so compile sees the current file we just wrote.
    let reloaded = crate::config::get_project_config(
        &project.cwd,
        &crate::config::LoadOptions {
            force_in_worktree: None,
            quiet: true,
        },
    )?
    .ok_or_else(|| anyhow::anyhow!("Could not reload project configuration"))?;

    compile::run(&reloaded)
}
