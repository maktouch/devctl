use std::fs;
use std::path::{Path, PathBuf};

use devctl::config::{Paths, Project};
use devctl::resolve_service::resolve_services;
use indexmap::IndexMap;
use serde_yaml::{Mapping, Value};

fn yaml(s: &str) -> Value {
    serde_yaml::from_str(s).unwrap()
}

struct Fixture {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

fn setup() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();

    fs::create_dir_all(root.join("services/api")).unwrap();
    fs::write(
        root.join("services/api/.devconfig.yaml"),
        "
compose:
  default:
    api:
      image: node:20
      environment:
        NODE_ENV: development
  staging:
    api:
      environment:
        NODE_ENV: staging
dotenv:
  default:
    PORT: 3000
",
    )
    .unwrap();

    // Service whose config entry has no path: the folder is the service name.
    fs::create_dir(root.join("db")).unwrap();
    fs::write(
        root.join("db/.devconfig.cjs"),
        "module.exports = {\n  compose: (current, project) => ({db: {image: 'mysql:8', env: current.environment}}),\n}\n",
    )
    .unwrap();

    // Service directory without any devconfig file
    fs::create_dir(root.join("bare")).unwrap();

    Fixture { _tmp: tmp, root }
}

fn project(root: &Path, services: &[&str], environment: &str) -> Project {
    let mut current = Mapping::new();
    current.insert(
        Value::String("services".into()),
        Value::Sequence(
            services
                .iter()
                .map(|s| Value::String(s.to_string()))
                .collect(),
        ),
    );
    current.insert(
        Value::String("environment".into()),
        Value::String(environment.to_string()),
    );

    let mut service_map = IndexMap::new();
    service_map.insert("api".to_string(), yaml("{name: api, path: services/api}"));
    service_map.insert("db".to_string(), yaml("{name: db}"));
    service_map.insert("bare".to_string(), yaml("{name: bare, path: bare}"));

    Project {
        raw: Mapping::new(),
        cwd: root.to_path_buf(),
        paths: Paths {
            project: root.join(".devctl.yaml"),
            compose: root.join(".devctl-docker-compose.yaml"),
            current: root.join(".devctl-current.yaml"),
            scripts: root.join(".devctl-scripts.yaml"),
        },
        services: service_map,
        environment: IndexMap::new(),
        commands: Vec::new(),
        current,
    }
}

#[test]
fn merges_the_default_and_environment_sections_of_a_yaml_devconfig() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &["api"], "staging")).unwrap();
    let api = &services[0];

    assert_eq!(api.path, fx.root.join("services/api"));
    assert_eq!(
        api.get("compose").unwrap(),
        &yaml("{api: {image: 'node:20', environment: {NODE_ENV: staging}}}")
    );
    // No staging section for dotenv: default alone applies
    assert_eq!(api.get("dotenv").unwrap(), &yaml("{PORT: 3000}"));
}

#[test]
fn uses_only_the_default_section_when_the_environment_has_no_overrides() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &["api"], "development")).unwrap();
    let api = &services[0];

    let node_env = api
        .get("compose")
        .and_then(|c| c.get("api"))
        .and_then(|a| a.get("environment"))
        .and_then(|e| e.get("NODE_ENV"))
        .and_then(Value::as_str);
    assert_eq!(node_env, Some("development"));
}

#[test]
fn invokes_function_style_devconfig_entries_with_current_and_project() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &["db"], "staging")).unwrap();
    let db = &services[0];

    assert_eq!(db.path, fx.root.join("db"));
    assert_eq!(
        db.get("compose").unwrap(),
        &yaml("{db: {image: 'mysql:8', env: staging}}")
    );
}

#[test]
fn keeps_a_service_without_a_devconfig_file_with_its_path_resolved() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &["bare"], "staging")).unwrap();
    let bare = &services[0];

    assert_eq!(bare.name, "bare");
    assert_eq!(bare.path, fx.root.join("bare"));
    assert!(bare.get("compose").is_none());
}

#[test]
fn skips_services_missing_from_the_project_config() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &["ghost", "api"], "staging")).unwrap();
    let names: Vec<&str> = services.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["api"]);
}

#[test]
fn returns_an_empty_list_when_nothing_is_selected() {
    let fx = setup();
    let services = resolve_services(&project(&fx.root, &[], "staging")).unwrap();
    assert!(services.is_empty());
}
