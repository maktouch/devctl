//! Execute a command in a running container.

use anyhow::{bail, Result};

use crate::config::Project;
use crate::state::compose_interactive;

pub struct ExecOptions {
    pub detach: bool,
    pub privileged: bool,
    pub user: Option<String>,
    pub index: Option<u32>,
    pub env: Vec<String>,
    pub workdir: Option<String>,
    pub no_tty: bool,
    /// service name, command, and any extra args
    pub rest: Vec<String>,
}

pub fn run(project: &Project, options: ExecOptions) -> Result<()> {
    if options.rest.len() < 2 {
        bail!("Usage: devctl exec [flags] <service> <command> [args...]");
    }

    let compose = project.paths.compose.display().to_string();
    if !project.paths.compose.exists() {
        bail!("No docker-compose file found. Run compile or switch first.");
    }

    let mut cmd = vec!["exec".to_string()];

    if options.detach {
        cmd.push("-d".into());
    }
    if options.privileged {
        cmd.push("--privileged".into());
    }
    if let Some(user) = &options.user {
        cmd.push("-u".into());
        cmd.push(user.clone());
    }
    if let Some(index) = options.index {
        cmd.push(format!("--index={index}"));
    }
    if options.no_tty {
        cmd.push("-T".into());
    }
    for env in &options.env {
        cmd.push("-e".into());
        cmd.push(env.clone());
    }
    if let Some(workdir) = &options.workdir {
        cmd.push("-w".into());
        cmd.push(workdir.clone());
    }

    cmd.extend(options.rest.iter().cloned());

    compose_interactive(&compose, &cmd)
}
