use std::fs;
use std::path::{Path, PathBuf};

use devctl::commands::compile;
use devctl::config::{get_project_config, LoadOptions};
use devctl::dotenv::parse_env;
use serde_json::json;
use serde_yaml::Value;

struct Fixture {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

fn write_project(proxy: bool) -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();

    let proxy_block = if proxy {
        "proxy:\n  enabled: true\n"
    } else {
        ""
    };
    let api_proxy = if proxy {
        "    proxy:\n      - port: 3000\n        paths:\n          - app.localhost\n"
    } else {
        ""
    };

    fs::write(
        root.join(".devctl.yaml"),
        format!(
            "{proxy_block}services:\n  - name: api\n    path: services/api\n{api_proxy}  - name: db\n    path: services/db\nenvironment:\n  - name: development\n    description: local dev\n"
        ),
    )
    .unwrap();

    fs::write(
        root.join(".devctl-current.yaml"),
        "services:\n  - api\n  - db\nenvironment: development\ndockerhost:\n  address: 192.168.65.2\n  interfaceName: en0\n",
    )
    .unwrap();

    fs::create_dir_all(root.join("services/api")).unwrap();
    fs::write(
        root.join("services/api/.devconfig.yaml"),
        "compose:\n  default:\n    api:\n      image: node:20\n      ports:\n        - \"3000:3000\"\ndotenv:\n  default:\n    PORT: 3000\nafterSwitch:\n  default:\n    install: pnpm install\n",
    )
    .unwrap();

    fs::create_dir_all(root.join("services/db")).unwrap();
    fs::write(
        root.join("services/db/.devconfig.yaml"),
        "compose:\n  default:\n    db:\n      image: mysql:8\nstart:\n  default:\n    wait: ./wait-for-db.sh\n",
    )
    .unwrap();

    Fixture { _tmp: tmp, root }
}

fn run_compile(root: &Path) {
    let project = get_project_config(
        root,
        &LoadOptions {
            force_in_worktree: None,
            quiet: true,
        },
    )
    .unwrap()
    .expect("project config");
    compile::run(&project).unwrap();
}

fn read_output(root: &Path, name: &str) -> Value {
    serde_yaml::from_str(&fs::read_to_string(root.join(name)).unwrap()).unwrap()
}

fn yaml(s: &str) -> Value {
    serde_yaml::from_str(s).unwrap()
}

#[test]
fn merges_every_selected_service_into_one_docker_compose_file() {
    let fx = write_project(false);
    run_compile(&fx.root);

    let compose = read_output(&fx.root, ".devctl-docker-compose.yaml");
    assert_eq!(
        compose,
        yaml("{services: {api: {image: 'node:20', ports: ['3000:3000']}, db: {image: 'mysql:8'}}}")
    );
}

#[test]
fn writes_dotenv_files_for_services_that_define_one() {
    let fx = write_project(false);
    run_compile(&fx.root);

    let env = parse_env(&fs::read_to_string(fx.root.join("services/api/.env")).unwrap());
    assert_eq!(env.len(), 1);
    assert_eq!(env["PORT"], json!(3000));

    // db has no dotenv section: no file written
    assert!(!fx.root.join("services/db/.env").exists());
}

#[test]
fn merges_into_an_existing_env_keeping_unmanaged_keys() {
    let fx = write_project(false);
    fs::write(
        fx.root.join("services/api/.env"),
        "SECRET=\"keep-me\"\nPORT=9999\n",
    )
    .unwrap();
    run_compile(&fx.root);

    let env = parse_env(&fs::read_to_string(fx.root.join("services/api/.env")).unwrap());
    assert_eq!(env.len(), 2);
    assert_eq!(env["SECRET"], json!("keep-me"));
    assert_eq!(env["PORT"], json!(3000));
}

#[test]
fn collects_after_switch_and_start_scripts_per_service() {
    let fx = write_project(false);
    run_compile(&fx.root);

    let scripts = read_output(&fx.root, ".devctl-scripts.yaml");
    assert_eq!(
        scripts,
        yaml("{afterSwitch: [{name: api, scripts: ['pnpm install']}], start: [{name: db, scripts: ['./wait-for-db.sh']}]}")
    );
}

#[test]
fn adds_the_devctl_proxy_service_with_routes_when_the_proxy_is_enabled() {
    let fx = write_project(true);
    run_compile(&fx.root);

    let compose = read_output(&fx.root, ".devctl-docker-compose.yaml");
    let proxy = compose
        .get("services")
        .and_then(|s| s.get("devctl-proxy"))
        .expect("devctl-proxy service");

    assert_eq!(
        proxy.get("image").and_then(Value::as_str),
        Some("maktouch/devctl-proxy:latest")
    );
    assert_eq!(proxy.get("restart").and_then(Value::as_str), Some("always"));
    assert_eq!(proxy.get("ports").unwrap(), &yaml("['80:80']"));

    let devctl_proxy_env = proxy
        .get("environment")
        .and_then(|e| e.get("DEVCTL_PROXY"))
        .and_then(Value::as_str)
        .expect("DEVCTL_PROXY env");
    let parsed: serde_json::Value = serde_json::from_str(devctl_proxy_env).unwrap();
    assert_eq!(
        parsed,
        json!({
            "routes": {"app.localhost": "http://192.168.65.2:3000"},
            "proxy": {"enabled": true},
        })
    );
}

#[test]
fn leaves_the_proxy_out_when_not_enabled() {
    let fx = write_project(false);
    run_compile(&fx.root);

    let compose = read_output(&fx.root, ".devctl-docker-compose.yaml");
    assert!(compose
        .get("services")
        .and_then(|s| s.get("devctl-proxy"))
        .is_none());
}
