use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use colored::Colorize;

use devctl::commands;
use devctl::config::{get_project_config, LoadOptions, Project, FORCE_IN_WORKTREE_ENV};
use devctl::custom_command::run_custom_command;

#[derive(Parser)]
#[command(
    name = "devctl",
    version,
    about = "Easily start developing in monorepos with docker-compose",
    arg_required_else_help = true,
    allow_external_subcommands = true
)]
struct Cli {
    /// Run against this git worktree instead of redirecting to the main checkout
    #[arg(long = "force-in-worktree", global = true)]
    force_in_worktree: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Args)]
struct MergeFlags {
    /// Keep other running devctl projects alive (default)
    #[arg(long, conflicts_with = "no_merge")]
    merge: bool,

    /// Tear down other running devctl projects first
    #[arg(long = "no-merge")]
    no_merge: bool,
}

impl MergeFlags {
    fn merge(&self) -> bool {
        !self.no_merge
    }
}

#[derive(Args)]
struct ExecCli {
    /// Detached mode: Run command in the background
    #[arg(short = 'd', long)]
    detach: bool,

    /// Give extended privileges to the process
    #[arg(long)]
    privileged: bool,

    /// Run the command as this user
    #[arg(short = 'u', long)]
    user: Option<String>,

    /// Index of the container if there are multiple instances
    #[arg(long)]
    index: Option<u32>,

    /// Set environment variables
    #[arg(short = 'e', long = "env")]
    env: Vec<String>,

    /// Path to workdir directory for this command
    #[arg(short = 'w', long)]
    workdir: Option<String>,

    /// Disable pseudo-tty allocation
    #[arg(short = 'T', long = "no-TTY")]
    no_tty: bool,

    /// Service name, command to execute, and its arguments
    #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
    rest: Vec<String>,
}

#[derive(Args)]
struct LogsCli {
    /// Follow log output
    #[arg(short = 'f', long)]
    follow: bool,

    /// Show timestamps
    #[arg(short = 't', long)]
    timestamps: bool,

    /// Number of lines to show from the end of the logs
    #[arg(long)]
    tail: Option<String>,

    /// Produce monochrome output
    #[arg(long = "no-color")]
    no_color: bool,

    /// Services to show logs for
    #[arg(trailing_var_arg = true)]
    rest: Vec<String>,
}

#[derive(Args)]
struct RunCli {
    /// Detached mode: Run container in the background
    #[arg(short = 'd', long)]
    detach: bool,

    /// Assign a name to the container
    #[arg(long)]
    name: Option<String>,

    /// Override the entrypoint of the image
    #[arg(long)]
    entrypoint: Option<String>,

    /// Set environment variable
    #[arg(short = 'e', long = "env")]
    env: Vec<String>,

    /// Add or override a label
    #[arg(short = 'l', long = "label")]
    label: Vec<String>,

    /// Run as specified username or uid
    #[arg(short = 'u', long)]
    user: Option<String>,

    /// Don't start linked services
    #[arg(long = "no-deps")]
    no_deps: bool,

    /// Remove container after run
    #[arg(long)]
    rm: bool,

    /// Publish a container's port(s)
    #[arg(short = 'p', long = "publish")]
    publish: Vec<String>,

    /// Run with the service's ports enabled
    #[arg(long = "service-ports")]
    service_ports: bool,

    /// Use the service's network aliases
    #[arg(long = "use-aliases")]
    use_aliases: bool,

    /// Bind mount a volume
    #[arg(short = 'v', long = "volume")]
    volume: Vec<String>,

    /// Disable pseudo-tty allocation
    #[arg(short = 'T', long = "no-TTY")]
    no_tty: bool,

    /// Working directory inside the container
    #[arg(short = 'w', long)]
    workdir: Option<String>,

    /// Service name, command to run, and its arguments
    #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
    rest: Vec<String>,
}

#[derive(Subcommand)]
enum ProxyCommand {
    /// Add a Caddyfile site configuration
    Add {
        /// Path to a Caddyfile snippet
        #[arg(short = 'f', long)]
        file: Option<String>,

        /// Override the derived config name
        #[arg(short = 'n', long)]
        name: Option<String>,

        /// Skip reloading Caddy after adding
        #[arg(long = "no-reload")]
        no_reload: bool,
    },
    /// Remove a site configuration by name
    Remove {
        /// The site config name (usually the primary hostname)
        name: String,

        /// Skip reloading Caddy after removing
        #[arg(long = "no-reload")]
        no_reload: bool,
    },
    /// Start the Caddy reverse proxy daemon
    Start,
    /// Stop the Caddy reverse proxy daemon
    Stop,
    /// Reload Caddy config (regenerates master Caddyfile)
    Reload,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize projects and services for devctl
    Init,

    /// Compile docker-compose.yaml and .env files from service configurations
    #[command(hide = true)]
    Compile,

    /// Switch services and/or environment
    Switch {
        #[command(flatten)]
        merge: MergeFlags,
    },

    /// Interactively pick services and environment (used by switch)
    #[command(name = "switch-current", hide = true)]
    SwitchCurrent,

    /// Re-pick services/environment and recompile
    #[command(name = "switch-env", hide = true)]
    SwitchEnv,

    /// Builds, creates, starts, and attaches to containers for a service
    Up {
        #[command(flatten)]
        merge: MergeFlags,
    },

    /// Stops containers and removes containers, networks, volumes, and images created by "up"
    Down {
        /// Tear down all tracked devctl projects
        #[arg(long)]
        all: bool,

        /// Skip confirmation prompts and destroy stale containers automatically
        #[arg(long)]
        force: bool,
    },

    /// Execute a command in a running container
    Exec(ExecCli),

    /// View output from containers
    Logs(LogsCli),

    /// Run a one-off command on a service
    Run(RunCli),

    /// Output information about the current settings
    Status,

    /// Manage the local Caddy reverse proxy
    Proxy {
        #[command(subcommand)]
        command: Option<ProxyCommand>,
    },

    #[command(external_subcommand)]
    External(Vec<String>),
}

fn load_project() -> anyhow::Result<Project> {
    let cwd = std::env::current_dir()?;
    get_project_config(&cwd, &LoadOptions::default())?.ok_or_else(|| {
        anyhow::anyhow!("Could not load project configuration. Make sure .devctl.yaml exists.")
    })
}

fn custom_commands_help() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    let project = get_project_config(
        &cwd,
        &LoadOptions {
            force_in_worktree: None,
            quiet: true,
        },
    )
    .ok()
    .flatten()?;

    if project.commands.is_empty() {
        return None;
    }

    let mut help = String::from("Custom commands:\n");
    for command in &project.commands {
        help.push_str(&format!(
            "  {:<18} {}\n",
            command.name,
            command.description.clone().unwrap_or_default()
        ));
    }
    Some(help.trim_end().to_string())
}

fn dispatch(cli: Cli) -> anyhow::Result<()> {
    if cli.force_in_worktree {
        // Nested invocations and custom command handlers inherit the choice.
        std::env::set_var(FORCE_IN_WORKTREE_ENV, "1");
    }

    match cli.command {
        Command::Init => commands::init::run(),
        Command::Compile => commands::compile::run(&load_project()?),
        Command::Switch { merge } => commands::switch::run(&load_project()?, merge.merge()),
        Command::SwitchCurrent => commands::switch_current::run(&load_project()?),
        Command::SwitchEnv => commands::switch_env::run(&load_project()?),
        Command::Up { merge } => commands::up::run(&load_project()?, merge.merge()),
        Command::Down { all, force } => commands::down::run(&load_project()?, all, force),
        Command::Exec(args) => commands::exec::run(
            &load_project()?,
            commands::exec::ExecOptions {
                detach: args.detach,
                privileged: args.privileged,
                user: args.user,
                index: args.index,
                env: args.env,
                workdir: args.workdir,
                no_tty: args.no_tty,
                rest: args.rest,
            },
        ),
        Command::Logs(args) => commands::logs::run(
            &load_project()?,
            commands::logs::LogsOptions {
                follow: args.follow,
                timestamps: args.timestamps,
                tail: args.tail,
                no_color: args.no_color,
                rest: args.rest,
            },
        ),
        Command::Run(args) => commands::run::run(
            &load_project()?,
            commands::run::RunOptions {
                detach: args.detach,
                name: args.name,
                entrypoint: args.entrypoint,
                env: args.env,
                label: args.label,
                user: args.user,
                no_deps: args.no_deps,
                rm: args.rm,
                publish: args.publish,
                service_ports: args.service_ports,
                use_aliases: args.use_aliases,
                volume: args.volume,
                no_tty: args.no_tty,
                workdir: args.workdir,
                rest: args.rest,
            },
        ),
        Command::Status => commands::status::run(&load_project()?),
        Command::Proxy { command } => match command {
            None => commands::proxy::status(),
            Some(ProxyCommand::Add {
                file,
                name,
                no_reload,
            }) => commands::proxy::add(file.as_deref(), name.as_deref(), !no_reload),
            Some(ProxyCommand::Remove { name, no_reload }) => {
                commands::proxy::remove(&name, !no_reload)
            }
            Some(ProxyCommand::Start) => commands::proxy::start(),
            Some(ProxyCommand::Stop) => commands::proxy::stop(),
            Some(ProxyCommand::Reload) => commands::proxy::reload(),
        },
        Command::External(args) => {
            let (id, rest) = args
                .split_first()
                .map(|(id, rest)| (id.clone(), rest.to_vec()))
                .unwrap_or_default();
            run_custom_command(&id, &rest)
        }
    }
}

fn main() {
    // Die quietly on a closed pipe (e.g. `devctl status | head`) instead of
    // panicking, matching normal CLI behavior.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }

    let raw_args: Vec<String> = std::env::args().collect();
    let wants_help = raw_args.len() <= 1
        || raw_args.iter().any(|a| a == "-h" || a == "--help")
        || raw_args.get(1).map(String::as_str) == Some("help");

    let mut command = Cli::command();
    if wants_help {
        if let Some(extra) = custom_commands_help() {
            command = command.after_help(extra);
        }
    }

    let matches = command.get_matches();
    let cli = match Cli::from_arg_matches(&matches) {
        Ok(cli) => cli,
        Err(err) => err.exit(),
    };

    if let Err(err) = dispatch(cli) {
        eprintln!("{} {}", "Error:".red(), err);
        std::process::exit(1);
    }
}
