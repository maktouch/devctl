import {execFile} from 'child_process'
import {dirname, resolve} from 'path'
import {promisify} from 'util'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  /** Directory devctl was invoked from (the linked worktree) */
  worktree: string
  /** Root of the main checkout that owns the shared .git directory */
  mainCheckout: string
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {cwd})
  return stdout.trim()
}

/**
 * Detects whether `cwd` lives inside a linked git worktree (created with
 * `git worktree add`). Returns the main checkout path when it does, or null
 * when `cwd` is the main checkout, not a git repo, or git is unavailable.
 */
export async function detectLinkedWorktree(cwd: string): Promise<WorktreeInfo | null> {
  try {
    const [gitDir, commonDir, toplevel] = await Promise.all([
      git(cwd, 'rev-parse', '--git-dir'),
      git(cwd, 'rev-parse', '--git-common-dir'),
      git(cwd, 'rev-parse', '--show-toplevel'),
    ])

    const absGitDir = resolve(cwd, gitDir)
    const absCommonDir = resolve(cwd, commonDir)

    if (absGitDir === absCommonDir) {
      return null
    }

    // The common dir is `<main checkout>/.git`; its parent is the main checkout.
    return {worktree: toplevel, mainCheckout: dirname(absCommonDir)}
  } catch {
    return null
  }
}
