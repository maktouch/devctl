//! Expand the selected services by reading each service's `.devconfig.*`
//! file — the port of `utils/resolveService.ts`.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_yaml::{Mapping, Value};

use crate::config::Project;
use crate::merge::deep_merge;
use crate::node_shim;

const DEVCONFIG_PLACES: [&str; 5] = [
    ".devconfig.yaml",
    ".devconfig.yml",
    ".devconfig.cjs",
    ".devconfig.js",
    ".devconfig.json",
];

#[derive(Debug, Clone)]
pub struct ResolvedService {
    pub name: String,
    pub path: PathBuf,
    /// The service entry from the project config, augmented with the
    /// resolved devconfig keys (compose, dotenv, afterSwitch, start, ...).
    pub config: Mapping,
}

impl ResolvedService {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.config.get(key)
    }
}

/// Walk up from `from` looking for a devconfig file (cosmiconfig-style,
/// stopping after the home directory).
fn search_devconfig(from: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir();
    let mut dir = Some(from.to_path_buf());

    while let Some(current) = dir {
        for place in DEVCONFIG_PLACES {
            let candidate = current.join(place);
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        if home.as_deref() == Some(current.as_path()) {
            return None;
        }
        dir = current.parent().map(|p| p.to_path_buf());
    }

    None
}

pub fn yaml_to_json(value: &Value) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

pub fn json_to_yaml(value: &serde_json::Value) -> Value {
    serde_yaml::to_value(value).unwrap_or(Value::Null)
}

/// Merge the `default` section of a devconfig key with the section for the
/// active environment.
fn merge_default_and_env(config: &Value, environment: &str) -> Value {
    let empty = Value::Mapping(Mapping::new());
    let default_config = config.get("default").unwrap_or(&empty);
    let env_config = config.get(environment).unwrap_or(&empty);
    deep_merge(default_config, env_config)
}

/// Generate each selected service's resolved configuration.
pub fn resolve_services(project: &Project) -> Result<Vec<ResolvedService>> {
    let service_names = project.current_services();
    let environment = project
        .current_environment()
        .unwrap_or_else(|| "default".to_string());

    let mut services = Vec::new();

    for svc_name in service_names {
        let Some(entry) = project.services.get(&svc_name) else {
            eprintln!("Service {svc_name} not found in config");
            continue;
        };

        let mut config = match entry {
            Value::Mapping(map) => map.clone(),
            _ => Mapping::new(),
        };

        // if there's no path, then it's the name of the folder
        let rel_path = config
            .get("path")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| svc_name.clone());
        let path = crate::pathutil::lexical_resolve(&project.cwd, Path::new(&rel_path));
        config.insert(
            Value::String("path".into()),
            Value::String(path.display().to_string()),
        );

        let Some(devconfig_path) = search_devconfig(&path) else {
            println!(
                "info: cannot find devconfig file for service {svc_name}, using empty default"
            );
            services.push(ResolvedService {
                name: svc_name,
                path,
                config,
            });
            continue;
        };

        let ext = devconfig_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default();

        if ext == "cjs" || ext == "js" {
            // Function-style configs run in Node; functions receive
            // (current, project) and their results are used verbatim.
            let current_json = serde_json::to_value(&project.current)?;
            let project_json = project.to_json();
            let result =
                node_shim::eval_js_devconfig(&devconfig_path, &current_json, &project_json)?;

            for (key, json_value) in &result.values {
                let value = json_to_yaml(json_value);
                let resolved = if result.functions.iter().any(|f| f == key) {
                    value
                } else {
                    merge_default_and_env(&value, &environment)
                };
                config.insert(Value::String(key.clone()), resolved);
            }
        } else {
            let raw = std::fs::read_to_string(&devconfig_path)?;
            let parsed: Value = if ext == "json" {
                let json: serde_json::Value = serde_json::from_str(&raw)?;
                json_to_yaml(&json)
            } else {
                serde_yaml::from_str(&raw)?
            };

            if let Value::Mapping(map) = parsed {
                for (key, key_config) in &map {
                    config.insert(key.clone(), merge_default_and_env(key_config, &environment));
                }
            }
        }

        services.push(ResolvedService {
            name: svc_name,
            path,
            config,
        });
    }

    Ok(services)
}
