//! View output from containers.

use anyhow::{bail, Result};

use crate::config::Project;
use crate::state::compose_interactive;

pub struct LogsOptions {
    pub follow: bool,
    pub timestamps: bool,
    pub tail: Option<String>,
    pub no_color: bool,
    /// service names and any extra args
    pub rest: Vec<String>,
}

pub fn run(project: &Project, options: LogsOptions) -> Result<()> {
    let compose = project.paths.compose.display().to_string();
    if !project.paths.compose.exists() {
        bail!("No docker-compose file found. Run compile or switch first.");
    }

    let mut cmd = vec!["logs".to_string()];

    if options.follow {
        cmd.push("-f".into());
    }
    if options.timestamps {
        cmd.push("-t".into());
    }
    if let Some(tail) = &options.tail {
        cmd.push(format!("--tail={tail}"));
    }
    if options.no_color {
        cmd.push("--no-color".into());
    }

    cmd.extend(options.rest.iter().cloned());

    compose_interactive(&compose, &cmd)
}
