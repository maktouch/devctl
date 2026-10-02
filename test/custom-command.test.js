const test = require('node:test')
const assert = require('node:assert/strict')
const {
  extractForceInWorktreeFlag,
  resolveCustomCommandLocation,
} = require('../dist/lib/custom-command')

const MAIN = '/repo/main'
const WT = '/repo/.worktrees/feature'

function resolverWith(existsIn) {
  const calls = []
  return {
    calls,
    resolveHandler: async cwd => {
      calls.push(cwd)
      return {path: `${cwd}/.devctl/commands/dev`, exists: existsIn.includes(cwd), isModule: true}
    },
  }
}

test('extractForceInWorktreeFlag strips the flag and reports it', () => {
  assert.deepEqual(extractForceInWorktreeFlag(['--worktree', '--force-in-worktree', '--port', '3000']), {
    argv: ['--worktree', '--port', '3000'],
    forced: true,
  })
})

test('extractForceInWorktreeFlag leaves argv alone when absent', () => {
  assert.deepEqual(extractForceInWorktreeFlag(['--web']), {argv: ['--web'], forced: false})
})

test('runs the handler from the invoking worktree when it defines it', async () => {
  const r = resolverWith([WT, MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  assert.equal(loc.cwd, WT)
  assert.equal(loc.handler.path, `${WT}/.devctl/commands/dev`)
  assert.equal(loc.fellBackToShared, false)
  assert.deepEqual(r.calls, [WT], 'must not touch the shared checkout when not needed')
})

test('falls back to the main checkout handler and cwd when the worktree lacks it', async () => {
  const r = resolverWith([MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  assert.equal(loc.cwd, MAIN)
  assert.equal(loc.handler.path, `${MAIN}/.devctl/commands/dev`)
  assert.equal(loc.fellBackToShared, true)
  assert.deepEqual(r.calls, [WT, MAIN])
})

test('reports a missing handler against the invoking checkout when neither has it', async () => {
  const r = resolverWith([])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: WT,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  assert.equal(loc.cwd, WT)
  assert.equal(loc.handler.exists, false)
  assert.equal(loc.fellBackToShared, false)
})

test('main checkout: invocation and shared are the same, resolved once', async () => {
  const r = resolverWith([MAIN])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: MAIN,
    sharedCwd: MAIN,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  assert.equal(loc.cwd, MAIN)
  assert.equal(loc.fellBackToShared, false)
  assert.deepEqual(r.calls, [MAIN])
})

test('uses the fallback cwd when no config was found anywhere', async () => {
  const r = resolverWith([])
  const loc = await resolveCustomCommandLocation({
    invocationCwd: undefined,
    sharedCwd: undefined,
    fallbackCwd: '/elsewhere',
    resolveHandler: r.resolveHandler,
  })
  assert.equal(loc.cwd, '/elsewhere')
  assert.deepEqual(r.calls, ['/elsewhere'])
})
