//! Manage the local Caddy reverse proxy.

use std::io::{IsTerminal, Read};

use anyhow::{bail, Result};
use colored::Colorize;
use comfy_table::{presets::UTF8_FULL, Table};

use crate::caddy::{
    add_site_config, check_port_in_use, is_caddy_running, list_site_configs, master_caddyfile,
    reload_caddy, remove_site_config, start_caddy, stop_caddy,
};

/// `devctl proxy` — show status of the local Caddy reverse proxy.
pub fn status() -> Result<()> {
    let running = is_caddy_running();

    println!(
        "Caddy proxy: {}",
        if running {
            "running".green().to_string()
        } else {
            "stopped".red().to_string()
        }
    );
    println!(
        "Config: {}",
        master_caddyfile().display().to_string().bright_black()
    );
    println!();

    let configs = list_site_configs()?;

    if configs.is_empty() {
        println!("No sites registered. Use `devctl proxy add` to add one.");
        return Ok(());
    }

    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_header(vec!["Site", "Hostnames"]);
    for config in configs {
        table.add_row(vec![config.name, config.hostnames.join(", ")]);
    }

    println!("{table}");
    Ok(())
}

pub fn start() -> Result<()> {
    if is_caddy_running() {
        println!("{}", "Caddy proxy is already running.".yellow());
        return Ok(());
    }

    println!("Starting Caddy proxy...");
    match start_caddy() {
        Ok(()) => {
            println!("{}", "Caddy proxy started.".green());
            Ok(())
        }
        Err(_) => {
            let mut conflicts = Vec::new();
            for port in [80u16, 443] {
                if let Some(proc) = check_port_in_use(port) {
                    conflicts.push(format!("  Port {port}: {proc}"));
                }
            }

            if conflicts.is_empty() {
                bail!("Caddy failed to start. Check the Caddy logs for details.");
            }
            bail!(
                "Caddy failed to start. The following ports are already in use:\n{}",
                conflicts.join("\n")
            );
        }
    }
}

pub fn stop() -> Result<()> {
    if !is_caddy_running() {
        println!("{}", "Caddy proxy is not running.".yellow());
        return Ok(());
    }

    stop_caddy()?;
    println!("{}", "Caddy proxy stopped.".green());
    Ok(())
}

pub fn reload() -> Result<()> {
    if !is_caddy_running() {
        bail!("Caddy proxy is not running. Start it first with: devctl proxy start");
    }

    println!("Reloading Caddy proxy...");
    reload_caddy()?;
    println!("{}", "Caddy proxy reloaded.".green());
    Ok(())
}

pub fn add(file: Option<&str>, name: Option<&str>, auto_reload: bool) -> Result<()> {
    let content = if let Some(file) = file {
        std::fs::read_to_string(file)?
    } else if !std::io::stdin().is_terminal() {
        let mut data = String::new();
        std::io::stdin().read_to_string(&mut data)?;
        data
    } else {
        bail!("Provide a Caddyfile via --file or pipe content via stdin.");
    };

    let config_name = add_site_config(content.trim(), name)?;
    println!("Added site config: {}", config_name.cyan());

    if auto_reload && is_caddy_running() {
        println!("Reloading Caddy...");
        reload_caddy()?;
        println!("{}", "Caddy reloaded.".green());
    }

    Ok(())
}

pub fn remove(name: &str, auto_reload: bool) -> Result<()> {
    if !remove_site_config(name) {
        bail!("Site config \"{name}\" not found.");
    }

    println!("Removed site config: {}", name.cyan());

    if auto_reload && is_caddy_running() {
        println!("Reloading Caddy...");
        reload_caddy()?;
        println!("{}", "Caddy reloaded.".green());
    }

    Ok(())
}
