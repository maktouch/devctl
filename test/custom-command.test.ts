import {test, expect} from 'vitest'
import {
  extractForceInWorktreeFlag,
  resolveCustomCommandLocation,
} from '../src/lib/custom-command'

const MAIN = '/repo/main'
const WT = '/repo/.worktrees/feature'

function resolverWith(existsIn: string[]) {
  const calls: string[] = []
  return {
    calls,
    resolveHandler: async (cwd: string) => {
      calls.push(cwd)
      return {path: `${cwd}/.devctl/commands/dev`, exists: existsIn.includes(cwd), isModule: true}
    },
  }
}

test('extractForceInWorktreeFlag strips the flag and reports it', () => {
  expect(extractForceInWorktreeFlag(['--worktree', '--force-in-worktree', '--port', '3000'])).toEqual({
    argv: ['--worktree', '--port', '3000'],
    forced: true,
  })
})

test('extractForceInWorktreeFlag leaves argv alone when absent', () => {
  expect(extractForceInWorktreeFlag(['--web'])).toEqual({argv: ['--web'], forced: false})
})

test('runs the handler from the invoking worktree when it defines it', async () => {
  const r = resolverWith([WT, MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  expect(loc.cwd).toBe(WT)
  expect(loc.handler.path).toBe(`${WT}/.devctl/commands/dev`)
  expect(loc.fellBackToShared).toBe(false)
  // must not touch the shared checkout when not needed
  expect(r.calls).toEqual([WT])
})

test('falls back to the main checkout handler and cwd when the worktree lacks it', async () => {
  const r = resolverWith([MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  expect(loc.cwd).toBe(MAIN)
  expect(loc.handler.path).toBe(`${MAIN}/.devctl/commands/dev`)
  expect(loc.fellBackToShared).toBe(true)
  expect(r.calls).toEqual([WT, MAIN])
})

test('reports a missing handler against the invoking checkout when neither has it', async () => {
  const r = resolverWith([])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  expect(loc.cwd).toBe(WT)
  expect(loc.handler.exists).toBe(false)
  expect(loc.fellBackToShared).toBe(false)
})

test('main checkout: invocation and shared are the same, resolved once', async () => {
  const r = resolverWith([MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: MAIN,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  expect(loc.cwd).toBe(MAIN)
  expect(loc.fellBackToShared).toBe(false)
  expect(r.calls).toEqual([MAIN])
})

test('uses the fallback cwd when no config was found anywhere', async () => {
  const r = resolverWith([])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: undefined,
    sharedCwd: undefined,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  expect(loc.cwd).toBe('/elsewhere')
  expect(r.calls).toEqual(['/elsewhere'])
})
