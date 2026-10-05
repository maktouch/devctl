use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use devctl::worktree::detect_linked_worktree;

fn git(cwd: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed in {}", cwd.display());
}

struct Fixture {
    _root: tempfile::TempDir,
    root: PathBuf,
    main: PathBuf,
    worktree: PathBuf,
}

/// canonicalize because macOS tmpdir is a symlink (/tmp -> /private/tmp) and
/// git reports resolved paths.
fn setup() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let main = root.join("main");
    let worktree = root.join("wt");

    fs::create_dir(&main).unwrap();
    git(&main, &["init"]);
    git(&main, &["config", "user.email", "test@test.dev"]);
    git(&main, &["config", "user.name", "test"]);
    fs::write(main.join("file.txt"), "hi").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["commit", "-m", "init"]);
    git(&main, &["worktree", "add", worktree.to_str().unwrap()]);

    Fixture {
        _root: tmp,
        root,
        main,
        worktree,
    }
}

#[test]
fn detects_a_linked_worktree_and_reports_the_main_checkout() {
    let fx = setup();
    let info = detect_linked_worktree(&fx.worktree).expect("worktree detected");
    assert_eq!(info.worktree, fx.worktree);
    assert_eq!(info.main_checkout, fx.main);
}

#[test]
fn detects_from_a_subdirectory_of_the_worktree() {
    let fx = setup();
    let sub = fx.worktree.join("nested").join("deep");
    fs::create_dir_all(&sub).unwrap();
    let info = detect_linked_worktree(&sub).expect("worktree detected");
    assert_eq!(info.worktree, fx.worktree);
    assert_eq!(info.main_checkout, fx.main);
}

#[test]
fn returns_none_in_the_main_checkout() {
    let fx = setup();
    assert!(detect_linked_worktree(&fx.main).is_none());
}

#[test]
fn returns_none_outside_any_git_repository() {
    let fx = setup();
    let plain = fx.root.join("plain");
    fs::create_dir(&plain).unwrap();
    assert!(detect_linked_worktree(&plain).is_none());
}

#[test]
fn returns_none_for_a_nonexistent_directory() {
    let fx = setup();
    assert!(detect_linked_worktree(&fx.root.join("does-not-exist")).is_none());
}
