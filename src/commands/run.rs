//! Run a one-off command on a service.

use anyhow::{bail, Result};

use crate::config::Project;
use crate::state::compose_interactive;

pub struct RunOptions {
    pub detach: bool,
    pub name: Option<String>,
    pub entrypoint: Option<String>,
    pub env: Vec<String>,
    pub label: Vec<String>,
    pub user: Option<String>,
    pub no_deps: bool,
    pub rm: bool,
    pub publish: Vec<String>,
    pub service_ports: bool,
    pub use_aliases: bool,
    pub volume: Vec<String>,
    pub no_tty: bool,
    pub workdir: Option<String>,
    /// service name, command, and any extra args
    pub rest: Vec<String>,
}

pub fn run(project: &Project, options: RunOptions) -> Result<()> {
    if options.rest.is_empty() {
        bail!("Usage: devctl run [flags] <service> [command...]");
    }

    let compose = project.paths.compose.display().to_string();
    if !project.paths.compose.exists() {
        bail!("No docker-compose file found. Run compile or switch first.");
    }

    let mut cmd = vec!["run".to_string()];

    if options.detach {
        cmd.push("-d".into());
    }
    if let Some(name) = &options.name {
        cmd.push("--name".into());
        cmd.push(name.clone());
    }
    if let Some(entrypoint) = &options.entrypoint {
        cmd.push("--entrypoint".into());
        cmd.push(entrypoint.clone());
    }
    if let Some(user) = &options.user {
        cmd.push("-u".into());
        cmd.push(user.clone());
    }
    if options.no_deps {
        cmd.push("--no-deps".into());
    }
    if options.rm {
        cmd.push("--rm".into());
    }
    if options.service_ports {
        cmd.push("--service-ports".into());
    }
    if options.use_aliases {
        cmd.push("--use-aliases".into());
    }
    if options.no_tty {
        cmd.push("-T".into());
    }
    if let Some(workdir) = &options.workdir {
        cmd.push("-w".into());
        cmd.push(workdir.clone());
    }
    for env in &options.env {
        cmd.push("-e".into());
        cmd.push(env.clone());
    }
    for label in &options.label {
        cmd.push("-l".into());
        cmd.push(label.clone());
    }
    for publish in &options.publish {
        cmd.push("-p".into());
        cmd.push(publish.clone());
    }
    for volume in &options.volume {
        cmd.push("-v".into());
        cmd.push(volume.clone());
    }

    cmd.extend(options.rest.iter().cloned());

    compose_interactive(&compose, &cmd)
}
