/**
 * Pure helpers for the command_not_found hook. Kept free of I/O so the
 * handler/cwd resolution rules can be unit tested without a git checkout.
 */

export const FORCE_IN_WORKTREE_FLAG = '--force-in-worktree'

export interface ForceFlagResult {
  /** argv with every occurrence of the flag removed */
  argv: string[]
  /** true when the flag was present at least once */
  forced: boolean
}

/**
 * Custom commands run before oclif parses any flags, so the flag has to be
 * picked out of the raw argv by hand and must not leak through to the handler.
 */
export function extractForceInWorktreeFlag(argv: readonly string[]): ForceFlagResult {
  const filtered = argv.filter(arg => arg !== FORCE_IN_WORKTREE_FLAG)
  return {argv: filtered, forced: filtered.length !== argv.length}
}

export interface ResolvedHandler {
  path: string
  exists: boolean
  isModule: boolean
}

export interface ResolveLocationOptions {
  /** Checkout devctl was invoked from. Preferred location for the handler. */
  invocationCwd: string | undefined
  /** Checkout owning the shared stack (main checkout when redirected). */
  sharedCwd: string | undefined
  /** Last-resort cwd when neither checkout has a config */
  fallbackCwd: string
  resolveHandler: (cwd: string) => Promise<ResolvedHandler>
}

export interface ResolvedLocation {
  cwd: string
  handler: ResolvedHandler
  /** true when the invoking checkout lacked the handler and the shared one was used */
  fellBackToShared: boolean
}

/**
 * Picks where a custom command runs. Per-worktree commands (dev servers,
 * URLs) must execute in the checkout the user is standing in, so that wins
 * whenever it defines the handler. An older branch that lacks the handler
 * file falls back to the shared checkout's copy and cwd.
 */
export async function resolveCustomCommandLocation(options: ResolveLocationOptions): Promise<ResolvedLocation> {
  const {invocationCwd, sharedCwd, fallbackCwd, resolveHandler} = options

  const primary = invocationCwd ?? sharedCwd ?? fallbackCwd
  const handler = await resolveHandler(primary)

  if (handler.exists || !sharedCwd || sharedCwd === primary) {
    return {cwd: primary, handler, fellBackToShared: false}
  }

  const sharedHandler = await resolveHandler(sharedCwd)
  if (sharedHandler.exists) {
    return {cwd: sharedCwd, handler: sharedHandler, fellBackToShared: true}
  }

  // Neither has it: report against the invoking checkout, which is what the
  // user is looking at.
  return {cwd: primary, handler, fellBackToShared: false}
}
