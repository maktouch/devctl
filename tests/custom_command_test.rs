use std::cell::RefCell;
use std::path::{Path, PathBuf};

use devctl::custom_command::{
    extract_force_in_worktree_flag, resolve_custom_command_location, ResolvedHandler,
};

const MAIN: &str = "/repo/main";
const WT: &str = "/repo/.worktrees/feature";

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

struct Resolver {
    exists_in: Vec<PathBuf>,
    calls: RefCell<Vec<PathBuf>>,
}

impl Resolver {
    fn new(exists_in: &[&str]) -> Self {
        Self {
            exists_in: exists_in.iter().map(PathBuf::from).collect(),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn resolve(&self, cwd: &Path) -> anyhow::Result<ResolvedHandler> {
        self.calls.borrow_mut().push(cwd.to_path_buf());
        Ok(ResolvedHandler {
            path: cwd.join(".devctl/commands/dev"),
            exists: self.exists_in.iter().any(|p| p == cwd),
            is_module: true,
        })
    }

    fn calls(&self) -> Vec<PathBuf> {
        self.calls.borrow().clone()
    }
}

#[test]
fn extract_force_in_worktree_flag_strips_the_flag_and_reports_it() {
    let result = extract_force_in_worktree_flag(&strings(&[
        "--worktree",
        "--force-in-worktree",
        "--port",
        "3000",
    ]));
    assert_eq!(result.argv, strings(&["--worktree", "--port", "3000"]));
    assert!(result.forced);
}

#[test]
fn extract_force_in_worktree_flag_leaves_argv_alone_when_absent() {
    let result = extract_force_in_worktree_flag(&strings(&["--web"]));
    assert_eq!(result.argv, strings(&["--web"]));
    assert!(!result.forced);
}

#[test]
fn runs_the_handler_from_the_invoking_worktree_when_it_defines_it() {
    let resolver = Resolver::new(&[WT, MAIN]);
    let loc = resolve_custom_command_location(
        Some(Path::new(WT)),
        Some(Path::new(MAIN)),
        Path::new("/elsewhere"),
        |cwd| resolver.resolve(cwd),
    )
    .unwrap();

    assert_eq!(loc.cwd, PathBuf::from(WT));
    assert_eq!(
        loc.handler.path,
        PathBuf::from(WT).join(".devctl/commands/dev")
    );
    assert!(!loc.fell_back_to_shared);
    // must not touch the shared checkout when not needed
    assert_eq!(resolver.calls(), vec![PathBuf::from(WT)]);
}

#[test]
fn falls_back_to_the_main_checkout_handler_and_cwd_when_the_worktree_lacks_it() {
    let resolver = Resolver::new(&[MAIN]);
    let loc = resolve_custom_command_location(
        Some(Path::new(WT)),
        Some(Path::new(MAIN)),
        Path::new("/elsewhere"),
        |cwd| resolver.resolve(cwd),
    )
    .unwrap();

    assert_eq!(loc.cwd, PathBuf::from(MAIN));
    assert_eq!(
        loc.handler.path,
        PathBuf::from(MAIN).join(".devctl/commands/dev")
    );
    assert!(loc.fell_back_to_shared);
    assert_eq!(
        resolver.calls(),
        vec![PathBuf::from(WT), PathBuf::from(MAIN)]
    );
}

#[test]
fn reports_a_missing_handler_against_the_invoking_checkout_when_neither_has_it() {
    let resolver = Resolver::new(&[]);
    let loc = resolve_custom_command_location(
        Some(Path::new(WT)),
        Some(Path::new(MAIN)),
        Path::new("/elsewhere"),
        |cwd| resolver.resolve(cwd),
    )
    .unwrap();

    assert_eq!(loc.cwd, PathBuf::from(WT));
    assert!(!loc.handler.exists);
    assert!(!loc.fell_back_to_shared);
}

#[test]
fn main_checkout_invocation_and_shared_are_the_same_resolved_once() {
    let resolver = Resolver::new(&[MAIN]);
    let loc = resolve_custom_command_location(
        Some(Path::new(MAIN)),
        Some(Path::new(MAIN)),
        Path::new("/elsewhere"),
        |cwd| resolver.resolve(cwd),
    )
    .unwrap();

    assert_eq!(loc.cwd, PathBuf::from(MAIN));
    assert!(!loc.fell_back_to_shared);
    assert_eq!(resolver.calls(), vec![PathBuf::from(MAIN)]);
}

#[test]
fn uses_the_fallback_cwd_when_no_config_was_found_anywhere() {
    let resolver = Resolver::new(&[]);
    let loc = resolve_custom_command_location(None, None, Path::new("/elsewhere"), |cwd| {
        resolver.resolve(cwd)
    })
    .unwrap();

    assert_eq!(loc.cwd, PathBuf::from("/elsewhere"));
    assert_eq!(resolver.calls(), vec![PathBuf::from("/elsewhere")]);
}
