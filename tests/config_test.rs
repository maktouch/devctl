use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use devctl::config::{get_project_config, LoadOptions};
use serde_yaml::Value;

const DEVCTL_YAML: &str = "
services:
  - name: api
    path: services/api
  - name: web
    path: services/web
environment:
  - name: development
    description: local dev
  - name: staging
    description: staging env
";

fn git(cwd: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn quiet() -> LoadOptions {
    LoadOptions {
        force_in_worktree: None,
        quiet: true,
    }
}

fn make_root() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    (tmp, root)
}

fn make_project(root: &Path, name: &str, with_current: bool) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".devctl.yaml"), DEVCTL_YAML).unwrap();
    if with_current {
        fs::write(
            dir.join(".devctl-current.yaml"),
            "services:\n  - api\nenvironment: development\n",
        )
        .unwrap();
    }
    dir
}

#[test]
fn returns_none_when_no_config_exists_anywhere_up_the_tree() {
    let (_tmp, root) = make_root();
    let dir = root.join("empty");
    fs::create_dir(&dir).unwrap();
    assert!(get_project_config(&dir, &quiet()).unwrap().is_none());
}

#[test]
fn loads_the_project_keys_services_environment_by_name_and_reads_current() {
    let (_tmp, root) = make_root();
    let dir = make_project(&root, "basic", true);

    let config = get_project_config(&dir, &quiet())
        .unwrap()
        .expect("config found");
    assert_eq!(config.cwd, dir);
    assert_eq!(config.paths.project, dir.join(".devctl.yaml"));
    assert_eq!(
        config.paths.compose,
        dir.join(".devctl-docker-compose.yaml")
    );
    assert_eq!(config.paths.current, dir.join(".devctl-current.yaml"));
    assert_eq!(config.paths.scripts, dir.join(".devctl-scripts.yaml"));

    let api = config
        .services
        .get("api")
        .expect("api service keyed by name");
    assert_eq!(api.get("name").and_then(Value::as_str), Some("api"));
    assert_eq!(
        api.get("path").and_then(Value::as_str),
        Some("services/api")
    );

    let staging = config
        .environment
        .get("staging")
        .expect("staging env keyed by name");
    assert_eq!(staging.get("name").and_then(Value::as_str), Some("staging"));

    assert_eq!(config.current_services(), vec!["api".to_string()]);
    assert_eq!(
        config.current_environment(),
        Some("development".to_string())
    );
}

#[test]
fn defaults_current_to_an_empty_object_when_current_yaml_is_missing() {
    let (_tmp, root) = make_root();
    let dir = make_project(&root, "no-current", false);

    let config = get_project_config(&dir, &quiet())
        .unwrap()
        .expect("config found");
    assert!(config.current.is_empty());
}

#[test]
fn redirects_to_the_main_checkout_when_run_from_a_linked_worktree() {
    let (_tmp, root) = make_root();
    let main = make_project(&root, "wt-main", true);
    git(&main, &["init"]);
    git(&main, &["config", "user.email", "test@test.dev"]);
    git(&main, &["config", "user.name", "test"]);
    git(&main, &["add", "."]);
    git(&main, &["commit", "-m", "init"]);
    let worktree = root.join("wt-linked");
    git(&main, &["worktree", "add", worktree.to_str().unwrap()]);

    let config = get_project_config(&worktree, &quiet())
        .unwrap()
        .expect("config found");
    assert_eq!(config.cwd, main);

    let forced = get_project_config(
        &worktree,
        &LoadOptions {
            force_in_worktree: Some(true),
            quiet: true,
        },
    )
    .unwrap()
    .expect("config found");
    assert_eq!(forced.cwd, worktree);
}
