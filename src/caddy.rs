use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};

pub fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("devctl")
}

pub fn caddy_dir() -> PathBuf {
    config_dir().join("caddy.d")
}

pub fn master_caddyfile() -> PathBuf {
    config_dir().join("Caddyfile")
}

pub fn ensure_directories() -> Result<()> {
    fs::create_dir_all(caddy_dir())?;
    Ok(())
}

fn clean_hostname(addr: &str) -> String {
    let mut host = addr;
    for prefix in ["http://", "https://"] {
        if let Some(stripped) = host.strip_prefix(prefix) {
            host = stripped;
            break;
        }
    }
    // Drop any path component
    let host = host.split('/').next().unwrap_or("");
    // Strip a trailing :port (digits only)
    match host.rfind(':') {
        Some(idx)
            if host[idx + 1..].chars().all(|c| c.is_ascii_digit()) && idx + 1 < host.len() =>
        {
            host[..idx].to_string()
        }
        _ => host.to_string(),
    }
}

fn site_addresses(content: &str) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut brace_depth: i32 = 0;

    for line in content.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Snippet definitions like (snippet-name) are not site addresses, but
        // their braces still have to be counted below to keep the depth balanced.
        let is_snippet = brace_depth == 0 && trimmed.starts_with('(');

        if brace_depth == 0 && !is_snippet && trimmed.contains('{') {
            let address_part = trimmed.split('{').next().unwrap_or("").trim();
            if !address_part.is_empty() {
                let addresses: Vec<String> = address_part
                    .split(|c: char| c.is_whitespace() || c == ',')
                    .filter(|s| !s.is_empty())
                    .map(clean_hostname)
                    .filter(|host| !host.is_empty() && host != "*" && !host.starts_with(':'))
                    .collect();
                if !addresses.is_empty() {
                    blocks.push(addresses);
                }
            }
        }

        for ch in trimmed.chars() {
            if ch == '{' {
                brace_depth += 1;
            }
            if ch == '}' {
                brace_depth -= 1;
            }
        }
    }

    blocks
}

/// Extract the first site address from a Caddyfile snippet.
/// Looks for tokens before the first `{` at brace-depth 0.
/// Strips protocol, port, and path to return a clean hostname.
pub fn derive_config_name(content: &str) -> Option<String> {
    site_addresses(content)
        .into_iter()
        .next()
        .and_then(|addresses| addresses.into_iter().next())
}

/// Extract all hostnames from a Caddyfile snippet, deduplicated.
pub fn extract_hostnames(content: &str) -> Vec<String> {
    let mut seen = Vec::new();
    for block in site_addresses(content) {
        for host in block {
            if !seen.contains(&host) {
                seen.push(host);
            }
        }
    }
    seen
}

pub fn generate_master_caddyfile() -> Result<()> {
    let content = format!(
        "{{\n\t# Managed by devctl proxy\n}}\n\nimport {}/*.caddy\n",
        caddy_dir().display()
    );
    fs::create_dir_all(config_dir())?;
    fs::write(master_caddyfile(), content)?;
    Ok(())
}

pub fn is_caddy_running() -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(1))
        .build();
    matches!(
        agent.get("http://localhost:2019/config/").call(),
        Ok(res) if res.status() == 200
    )
}

pub fn check_caddy_installed() -> Result<()> {
    let found = Command::new("which")
        .arg("caddy")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !found {
        bail!("caddy is not installed. Install it with: brew install caddy");
    }
    Ok(())
}

pub fn start_caddy() -> Result<()> {
    check_caddy_installed()?;
    ensure_directories()?;
    generate_master_caddyfile()?;

    Command::new("caddy")
        .args(["start", "--config"])
        .arg(master_caddyfile())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    // Wait for Caddy to be ready (up to 5 seconds)
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if is_caddy_running() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    bail!("Caddy failed to start within 5 seconds.")
}

pub fn check_port_in_use(port: u16) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-i", &format!(":{port}"), "-sTCP:LISTEN", "-P", "-n"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.trim().split('\n').collect();
    if lines.len() < 2 {
        return None;
    }
    // Parse the process name and PID from lsof output (COMMAND PID ...)
    let parts: Vec<&str> = lines[1].split_whitespace().collect();
    Some(format!(
        "{} (pid {})",
        parts.first().unwrap_or(&"?"),
        parts.get(1).unwrap_or(&"?")
    ))
}

pub fn stop_caddy() -> Result<()> {
    let status = Command::new("caddy").arg("stop").status()?;
    if !status.success() {
        bail!("caddy stop failed");
    }
    Ok(())
}

pub fn reload_caddy() -> Result<()> {
    generate_master_caddyfile()?;
    let status = Command::new("caddy")
        .args(["reload", "--config"])
        .arg(master_caddyfile())
        .status()?;
    if !status.success() {
        bail!("caddy reload failed");
    }
    Ok(())
}

pub fn add_site_config(content: &str, name: Option<&str>) -> Result<String> {
    ensure_directories()?;

    let config_name = name
        .map(str::to_string)
        .or_else(|| derive_config_name(content))
        .ok_or_else(|| {
            anyhow!(
                "Could not determine a name for this config. \
                 Ensure your Caddyfile snippet contains a site address, or provide --name."
            )
        })?;

    let file_path = caddy_dir().join(format!("{config_name}.caddy"));
    fs::write(&file_path, content)?;
    Ok(config_name)
}

pub fn remove_site_config(name: &str) -> bool {
    let file_path = caddy_dir().join(format!("{name}.caddy"));
    fs::remove_file(file_path).is_ok()
}

pub struct SiteConfig {
    pub name: String,
    pub hostnames: Vec<String>,
}

pub fn list_site_configs() -> Result<Vec<SiteConfig>> {
    ensure_directories()?;

    let mut configs = Vec::new();
    let entries = match fs::read_dir(caddy_dir()) {
        Ok(entries) => entries,
        Err(_) => return Ok(configs),
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("caddy"))
        .collect();
    files.sort();

    for file in files {
        let name = file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let content = fs::read_to_string(&file)?;
        configs.push(SiteConfig {
            name,
            hostnames: extract_hostnames(&content),
        });
    }

    Ok(configs)
}
