//! Compile docker-compose.yaml and .env files from service configurations.

use std::fs;

use anyhow::{Context, Result};
use serde_yaml::{Mapping, Value};

use crate::config::Project;
use crate::dotenv::{parse_env, stringify_to_env};
use crate::merge::deep_merge;
use crate::resolve_service::{resolve_services, yaml_to_json, ResolvedService};
use crate::scripts::ScriptEntry;

fn scalar_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// Collect `{name, scripts}` entries for a lifecycle key (afterSwitch/start).
fn collect_scripts(services: &[ResolvedService], key: &str) -> Vec<ScriptEntry> {
    services
        .iter()
        .filter_map(|service| {
            let scripts: Vec<String> = service
                .get(key)
                .and_then(Value::as_mapping)
                .map(|map| map.values().map(scalar_to_string).collect())
                .unwrap_or_default();

            if scripts.is_empty() {
                return None;
            }

            Some(ScriptEntry {
                name: service.name.clone(),
                scripts,
            })
        })
        .collect()
}

fn build_proxy_service(project: &Project) -> Result<Option<Value>> {
    let enabled = project
        .raw_get("proxy.enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return Ok(None);
    }

    let dockerhost = project
        .current
        .get("dockerhost")
        .and_then(|d| d.get("address"))
        .map(scalar_to_string)
        .unwrap_or_default();

    let mut routes = serde_json::Map::new();

    for svc in project.current_services() {
        let Some(proxies) = project
            .services
            .get(&svc)
            .and_then(|s| s.get("proxy"))
            .and_then(Value::as_sequence)
        else {
            continue;
        };

        for proxy in proxies {
            let port = proxy.get("port").map(scalar_to_string).unwrap_or_default();
            let protocol = proxy
                .get("protocol")
                .and_then(Value::as_str)
                .unwrap_or("http");
            let paths = proxy
                .get("paths")
                .and_then(Value::as_sequence)
                .cloned()
                .unwrap_or_default();

            for path in paths {
                let path = scalar_to_string(&path);
                routes.insert(
                    path,
                    serde_json::Value::String(format!("{protocol}://{dockerhost}:{port}")),
                );
            }
        }
    }

    let mut proxy_config = project
        .raw_get("proxy")
        .map(yaml_to_json)
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    // Inline the SSL key/cert file contents when configured
    for field in ["key", "cert"] {
        let Some(rel) = project
            .raw_get(&format!("proxy.ssl.{field}"))
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };

        let contents = fs::read_to_string(project.cwd.join(&rel))
            .with_context(|| format!("reading proxy.ssl.{field} at {rel}"))?;

        if proxy_config.get("ssl").map(|v| v.is_object()) != Some(true) {
            proxy_config["ssl"] = serde_json::json!({});
        }
        proxy_config["ssl"][field] = serde_json::Value::String(contents);
    }

    let http_port = project
        .raw_get("proxy.httpPort")
        .and_then(Value::as_u64)
        .unwrap_or(80);

    let devctl_proxy_env = serde_json::to_string_pretty(&serde_json::json!({
        "routes": routes,
        "proxy": proxy_config,
    }))?;

    let mut ports = vec![format!("{http_port}:{http_port}")];

    let has_cert = project.raw_get("proxy.ssl.cert").is_some();
    let has_key = project.raw_get("proxy.ssl.key").is_some();
    if has_cert && has_key {
        let https_port = project
            .raw_get("proxy.httpsPort")
            .and_then(Value::as_u64)
            .unwrap_or(443);
        ports.push(format!("{https_port}:{https_port}"));
    }

    let mut environment = Mapping::new();
    environment.insert(
        Value::String("DEVCTL_PROXY".into()),
        Value::String(devctl_proxy_env),
    );

    let mut service = Mapping::new();
    service.insert(
        Value::String("image".into()),
        Value::String("maktouch/devctl-proxy:latest".into()),
    );
    service.insert(
        Value::String("restart".into()),
        Value::String("always".into()),
    );
    service.insert(
        Value::String("ports".into()),
        Value::Sequence(ports.into_iter().map(Value::String).collect()),
    );
    service.insert(
        Value::String("environment".into()),
        Value::Mapping(environment),
    );

    Ok(Some(Value::Mapping(service)))
}

pub fn run(project: &Project) -> Result<()> {
    // expand services by reading each services' config
    let services = resolve_services(project)?;

    let mut final_compose = Value::Mapping(Mapping::new());

    // Process each service
    for service in &services {
        // compile the final docker-compose
        if let Some(compose) = service.get("compose") {
            if !compose.is_null() {
                final_compose = deep_merge(&final_compose, compose);
            }
        }

        let Some(dotenv) = service.get("dotenv").and_then(Value::as_mapping) else {
            continue;
        };

        let dotenv_path = service.path.join(".env");

        // Read existing .env if it exists
        let mut final_dotenv = fs::read_to_string(&dotenv_path)
            .map(|raw| parse_env(&raw))
            .unwrap_or_default();

        for (key, value) in dotenv {
            if let Value::String(key) = key {
                final_dotenv.insert(key.clone(), yaml_to_json(value));
            }
        }

        fs::write(&dotenv_path, stringify_to_env(&final_dotenv))
            .with_context(|| format!("writing {}", dotenv_path.display()))?;
    }

    // Collect scripts
    let mut scripts_doc = Mapping::new();
    scripts_doc.insert(
        Value::String("afterSwitch".into()),
        serde_yaml::to_value(collect_scripts(&services, "afterSwitch"))?,
    );
    scripts_doc.insert(
        Value::String("start".into()),
        serde_yaml::to_value(collect_scripts(&services, "start"))?,
    );
    fs::write(&project.paths.scripts, serde_yaml::to_string(&scripts_doc)?)?;

    // Handle proxy configuration
    if let Some(proxy_service) = build_proxy_service(project)? {
        if let Value::Mapping(map) = &mut final_compose {
            map.insert(Value::String("devctl-proxy".into()), proxy_service);
        }
    }

    // Check if we need to add a services key.
    let needs_wrap = !matches!(
        final_compose.get("services"),
        Some(v) if !v.is_null()
    );
    let compose_to_write = if needs_wrap {
        let mut wrapper = Mapping::new();
        wrapper.insert(Value::String("services".into()), final_compose);
        Value::Mapping(wrapper)
    } else {
        final_compose
    };

    // write the final docker-compose to a file in the cwd
    fs::write(
        &project.paths.compose,
        serde_yaml::to_string(&compose_to_write)?,
    )
    .with_context(|| format!("writing {}", project.paths.compose.display()))?;

    Ok(())
}
