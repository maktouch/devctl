//! Bridges to Node.js for the JavaScript extension points devctl has always
//! supported: function-style `.devconfig.cjs/.js` files and module custom
//! command handlers. The shim runs `node -e` with a tiny loader; the payload
//! travels through an environment variable and results come back as JSON.

use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{anyhow, bail, Context, Result};

const HANDLER_SHIM: &str = r#"
const path = process.argv[1];
const payload = JSON.parse(process.env.DEVCTL_PAYLOAD || '{}');
(async () => {
  let loaded;
  try {
    loaded = require(path);
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') {
      loaded = await import(require('url').pathToFileURL(path).href);
    } else {
      throw err;
    }
  }
  const handler = (loaded && loaded.default !== undefined) ? loaded.default : loaded;
  if (typeof handler !== 'function') {
    console.error('Custom command "' + payload.command + '" handler must export a function');
    process.exit(1);
  }
  await handler(payload);
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
"#;

const DEVCONFIG_SHIM: &str = r#"
const path = process.argv[1];
const input = JSON.parse(process.env.DEVCTL_RESOLVE || '{}');
(async () => {
  let loaded;
  try {
    loaded = require(path);
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') {
      loaded = await import(require('url').pathToFileURL(path).href);
    } else {
      throw err;
    }
  }
  const config = (loaded && loaded.default !== undefined) ? loaded.default : loaded;
  const out = {values: {}, functions: []};
  for (const key of Object.keys(config)) {
    const value = config[key];
    if (typeof value === 'function') {
      out.functions.push(key);
      out.values[key] = await value(input.current, input.project);
    } else {
      out.values[key] = value;
    }
  }
  process.stdout.write(JSON.stringify(out));
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
"#;

fn node_missing_hint(what: &str) -> String {
    format!("{what} requires Node.js, but `node` was not found on PATH")
}

/// Run a JS/TS module custom-command handler, passing the payload the same
/// shape devctl 7/8 passed to in-process handlers.
pub fn run_module_handler(
    handler_path: &Path,
    payload: &serde_json::Value,
    cwd: &Path,
    command_name: &str,
) -> Result<()> {
    let status = Command::new("node")
        .arg("-e")
        .arg(HANDLER_SHIM)
        .arg(handler_path)
        .env("DEVCTL_PAYLOAD", serde_json::to_string(payload)?)
        .current_dir(cwd)
        .status()
        .map_err(|_| {
            anyhow!(node_missing_hint(&format!(
                "Custom command \"{command_name}\""
            )))
        })?;

    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }

    Ok(())
}

pub struct DevconfigResult {
    /// Every key of the devconfig, with function keys already evaluated.
    pub values: serde_json::Map<String, serde_json::Value>,
    /// Keys that were functions (their values skip default/env merging).
    pub functions: Vec<String>,
}

/// Evaluate a `.devconfig.cjs`/`.js` file: plain keys come back as data,
/// function keys are invoked with `(current, project)`.
pub fn eval_js_devconfig(
    config_path: &Path,
    current: &serde_json::Value,
    project: &serde_json::Value,
) -> Result<DevconfigResult> {
    let input = serde_json::json!({ "current": current, "project": project });

    let output = Command::new("node")
        .arg("-e")
        .arg(DEVCONFIG_SHIM)
        .arg(config_path)
        .env("DEVCTL_RESOLVE", serde_json::to_string(&input)?)
        .current_dir(config_path.parent().unwrap_or(Path::new(".")))
        .stdout(Stdio::piped())
        .output()
        .map_err(|_| {
            anyhow!(node_missing_hint(&format!(
                "Evaluating {}",
                config_path.display()
            )))
        })?;

    if !output.status.success() {
        bail!(
            "Failed to evaluate {}:\n{}",
            config_path.display(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .with_context(|| format!("parsing devconfig output of {}", config_path.display()))?;

    let values = parsed
        .get("values")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let functions = parsed
        .get("functions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    Ok(DevconfigResult { values, functions })
}
