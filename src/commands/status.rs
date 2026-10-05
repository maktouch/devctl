//! Output information about the current settings.

use anyhow::Result;
use colored::Colorize;
use comfy_table::{presets::UTF8_FULL, ContentArrangement, Table};
use serde_yaml::Value;

use crate::config::Project;

pub fn run(project: &Project) -> Result<()> {
    println!("devctl v{}\n", env!("CARGO_PKG_VERSION"));

    let services = project.current_services();

    if services.is_empty() {
        println!("No services configured");
        return Ok(());
    }

    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec!["Service", "Notes"]);

    for svc in services {
        let Some(service) = project.services.get(&svc) else {
            continue;
        };

        let name = service
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(&svc)
            .to_string();

        let note = service
            .get("notes")
            .and_then(Value::as_str)
            .unwrap_or("")
            .split('\n')
            .map(|line| {
                if line.starts_with("    ") {
                    line.cyan().to_string()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        table.add_row(vec![name, note]);
    }

    println!("{table}");
    Ok(())
}
