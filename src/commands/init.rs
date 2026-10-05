//! Initialize projects and services for devctl.

use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use anyhow::Result;
use colored::Colorize;
use dialoguer::{Input, MultiSelect, Select};

use crate::init_databases::{find, DATABASES};

struct GeneratedService {
    database: String,
    version: String,
    target: String,
    target_dir: String,
}

fn render_devconfig(
    database: &str,
    version: &str,
    port: u16,
    mount: &str,
    env: &[(String, String)],
) -> String {
    let mut out = String::new();
    writeln!(out, "compose:").unwrap();
    writeln!(out, "  default:").unwrap();
    writeln!(out, "    {database}:").unwrap();
    writeln!(out, "      image: \"{database}:{version}\"").unwrap();
    writeln!(out, "      ports:").unwrap();
    writeln!(out, "        - \"{port}:{port}\"").unwrap();
    if !mount.is_empty() {
        writeln!(out, "      volumes:").unwrap();
        writeln!(out, "        - ./.devctl/data/{database}:{mount}").unwrap();
    }
    writeln!(out, "      restart: always").unwrap();
    if env.is_empty() {
        writeln!(out, "      environment: {{}}").unwrap();
    } else {
        writeln!(out, "      environment:").unwrap();
        for (key, value) in env {
            writeln!(out, "        {key}: \"{value}\"").unwrap();
        }
    }
    out
}

fn render_devctl_yaml(services: &[GeneratedService]) -> String {
    let mut out = String::from("services:\n");
    for svc in services {
        writeln!(out, "  - name: \"{}\"", svc.database).unwrap();
        writeln!(out, "    path: \"{}\"", svc.target_dir).unwrap();
        writeln!(out, "    description: \"{}\"", svc.version).unwrap();
        writeln!(
            out,
            "    notes: \"Check {} for credentials and configuration\"",
            svc.target
        )
        .unwrap();
    }
    out.push_str(
        "\nsecrets:\n- name: vault\nprovider: vault\nconfig:\nendpoint:\n\nenvironment:\n  - name: dev\n    description: Run services locally\n",
    );
    out
}

pub fn run() -> Result<()> {
    println!("{}", "Welcome to DevCTL!".cyan());
    println!(
        "This command will help you setup a basic devctl project. Advanced users will need to deep dive into the YAML files generated, and/or generate new ones."
    );
    println!();

    let db_names: Vec<&str> = DATABASES.iter().map(|db| db.name).collect();

    let selected = loop {
        let selection = MultiSelect::new()
            .with_prompt(
                "Select which databases you need locally. If you need something different, just choose one and modify its file afterward.",
            )
            .items(&db_names)
            .interact()?;

        if !selection.is_empty() {
            break selection;
        }
        println!("Please select at least one database");
    };

    let mut generated = Vec::new();

    for idx in selected {
        let database = find(db_names[idx]).expect("known database");

        let version_idx = Select::new()
            .with_prompt(format!("Choose a version for {}", database.name.yellow()))
            .items(database.versions)
            .default(0)
            .interact()?;
        let version = database.versions[version_idx].to_string();

        let mut env = Vec::new();
        for field in database.env {
            let value: String = Input::new()
                .with_prompt(field.name)
                .default(field.initial.to_string())
                .interact_text()?;
            env.push((field.name.to_string(), value));
        }

        let target_dir = format!(".devctl/{}", database.name);
        let target = format!("{target_dir}/.devconfig.yaml");

        let rendered = render_devconfig(
            database.name,
            &version,
            database.default_port,
            database.default_mount,
            &env,
        );

        fs::create_dir_all(Path::new(&target_dir))?;
        fs::write(&target, rendered)?;

        println!("{} written.", target.cyan());

        generated.push(GeneratedService {
            database: database.name.to_string(),
            version,
            target,
            target_dir,
        });
    }

    fs::write(".devctl.yaml", render_devctl_yaml(&generated))?;
    println!("{} written.", ".devctl.yaml".cyan());

    fs::write(".gitignore", ".devctl-*.yaml")?;
    println!("{} written.", ".gitignore".cyan());

    println!();
    println!(
        "{}",
        "Your project has been successfully bootstrapped!".green()
    );
    println!("Please add these files in {}:", ".gitignore".cyan());
    println!(
        "  - .devctl-current.yaml {}",
        "(This is your current state)".bright_black()
    );
    println!(
        "  - .devctl-docker-compose.yaml {}",
        "(This is your generated docker-compose file)".bright_black()
    );
    println!(
        "  - .devctl/data {}",
        "(This is where your databases will save state)".bright_black()
    );
    println!();
    println!(
        "{}",
        format!("You can now run {} in this folder.", "devctl switch".cyan()).green()
    );

    Ok(())
}
