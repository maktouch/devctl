//! Interactive selection of services and environment (hidden command).

use std::fs;

use anyhow::Result;
use dialoguer::{MultiSelect, Select};
use serde_yaml::{Mapping, Value};

use crate::config::Project;

struct Choice {
    name: String,
    always: bool,
}

fn service_choices(project: &Project) -> Vec<Choice> {
    let mut choices: Vec<Choice> = project
        .services
        .values()
        .filter_map(|service| {
            let name = service.get("name").and_then(Value::as_str)?.to_string();
            let always = service.get("category").and_then(Value::as_str) == Some("always");
            Some(Choice { name, always })
        })
        .collect();

    choices.sort_by_key(|c| c.name.to_lowercase());
    choices
}

/// Prompt for services + environment. Returns (services, environment).
pub fn prompt_selection(project: &Project) -> Result<(Vec<String>, String)> {
    let all_choices = service_choices(project);

    let selectable: Vec<&Choice> = all_choices.iter().filter(|c| !c.always).collect();
    let always: Vec<String> = all_choices
        .iter()
        .filter(|c| c.always)
        .map(|c| c.name.clone())
        .collect();

    let current = project.current_services();

    let items: Vec<String> = selectable.iter().map(|c| c.name.clone()).collect();
    let defaults: Vec<bool> = selectable
        .iter()
        .map(|c| current.contains(&c.name))
        .collect();

    let selected_indices = if items.is_empty() {
        Vec::new()
    } else {
        MultiSelect::new()
            .with_prompt("Which services do you want to work on?")
            .items(&items)
            .defaults(&defaults)
            .interact()?
    };

    let mut services: Vec<String> = selected_indices
        .into_iter()
        .map(|i| selectable[i].name.clone())
        .collect();
    services.extend(always);

    // Ask which environment
    let environments: Vec<&Value> = project.environment.values().collect();

    let environment = if environments.len() == 1 {
        environments[0]
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    } else {
        let names: Vec<String> = environments
            .iter()
            .map(|env| {
                env.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
        let labels: Vec<String> = environments
            .iter()
            .map(|env| {
                let name = env.get("name").and_then(Value::as_str).unwrap_or_default();
                match env.get("description").and_then(Value::as_str) {
                    Some(desc) if !desc.is_empty() => format!("{name} - {desc}"),
                    _ => name.to_string(),
                }
            })
            .collect();

        let default_index = project
            .current_environment()
            .and_then(|current| names.iter().position(|n| *n == current))
            .unwrap_or(0);

        let selection = Select::new()
            .with_prompt("Which environment do you want to use?")
            .items(&labels)
            .default(default_index)
            .interact()?;

        names[selection].clone()
    };

    Ok((services, environment))
}

/// Get the Docker host address for containers to reach the host machine.
/// Modern Docker Desktop supports host.docker.internal which automatically
/// resolves to the host machine's IP address.
pub fn get_docker_host() -> Mapping {
    let mut dockerhost = Mapping::new();
    dockerhost.insert(
        Value::String("address".into()),
        Value::String("host.docker.internal".into()),
    );
    dockerhost.insert(
        Value::String("interfaceName".into()),
        Value::String("docker0".into()),
    );
    dockerhost
}

pub fn run(project: &Project) -> Result<()> {
    println!("Running switch-current");

    let (services, environment) = prompt_selection(project)?;

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
        Value::Mapping(get_docker_host()),
    );

    fs::write(&project.paths.current, serde_yaml::to_string(&current)?)?;
    Ok(())
}
