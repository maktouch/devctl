use std::path::{Path, PathBuf};
use std::process::Command;

use crate::pathutil::lexical_resolve;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    /// Directory devctl was invoked from (the linked worktree)
    pub worktree: PathBuf,
    /// Root of the main checkout that owns the shared .git directory
    pub main_checkout: PathBuf,
}

fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Detects whether `cwd` lives inside a linked git worktree (created with
/// `git worktree add`). Returns the main checkout path when it does, or None
/// when `cwd` is the main checkout, not a git repo, or git is unavailable.
pub fn detect_linked_worktree(cwd: &Path) -> Option<WorktreeInfo> {
    if !cwd.is_dir() {
        return None;
    }

    let git_dir = git(cwd, &["rev-parse", "--git-dir"])?;
    let common_dir = git(cwd, &["rev-parse", "--git-common-dir"])?;
    let toplevel = git(cwd, &["rev-parse", "--show-toplevel"])?;

    let abs_git_dir = lexical_resolve(cwd, Path::new(&git_dir));
    let abs_common_dir = lexical_resolve(cwd, Path::new(&common_dir));

    if abs_git_dir == abs_common_dir {
        return None;
    }

    // The common dir is `<main checkout>/.git`; its parent is the main checkout.
    Some(WorktreeInfo {
        worktree: PathBuf::from(toplevel),
        main_checkout: abs_common_dir.parent()?.to_path_buf(),
    })
}
