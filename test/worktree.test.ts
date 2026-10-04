import {test, expect, beforeAll, afterAll} from 'vitest'
import {execFileSync} from 'child_process'
import {mkdtemp, rm, mkdir, writeFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {realpathSync} from 'fs'
import {detectLinkedWorktree} from '../src/lib/worktree'

let root: string
let main: string
let worktree: string

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, {cwd, stdio: 'pipe'})
}

beforeAll(async () => {
  // realpath because macOS tmpdir is a symlink (/tmp -> /private/tmp) and
  // git reports resolved paths.
  root = realpathSync(await mkdtemp(join(tmpdir(), 'devctl-worktree-')))
  main = join(root, 'main')
  worktree = join(root, 'wt')

  await mkdir(main)
  git(main, 'init')
  git(main, 'config', 'user.email', 'test@test.dev')
  git(main, 'config', 'user.name', 'test')
  await writeFile(join(main, 'file.txt'), 'hi')
  git(main, 'add', '.')
  git(main, 'commit', '-m', 'init')
  git(main, 'worktree', 'add', worktree)
})

afterAll(async () => {
  await rm(root, {recursive: true, force: true})
})

test('detects a linked worktree and reports the main checkout', async () => {
  const info = await detectLinkedWorktree(worktree)
  expect(info).not.toBeNull()
  expect(info!.worktree).toBe(worktree)
  expect(info!.mainCheckout).toBe(main)
})

test('detects from a subdirectory of the worktree', async () => {
  const sub = join(worktree, 'nested', 'deep')
  await mkdir(sub, {recursive: true})
  const info = await detectLinkedWorktree(sub)
  expect(info).not.toBeNull()
  expect(info!.worktree).toBe(worktree)
  expect(info!.mainCheckout).toBe(main)
})

test('returns null in the main checkout', async () => {
  expect(await detectLinkedWorktree(main)).toBeNull()
})

test('returns null outside any git repository', async () => {
  const plain = join(root, 'plain')
  await mkdir(plain)
  expect(await detectLinkedWorktree(plain)).toBeNull()
})

test('returns null for a nonexistent directory', async () => {
  expect(await detectLinkedWorktree(join(root, 'does-not-exist'))).toBeNull()
})
