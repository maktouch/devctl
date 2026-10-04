import {test, expect, beforeAll, afterAll, afterEach} from 'vitest'
import {execFileSync} from 'child_process'
import {mkdtemp, rm, mkdir, writeFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join, resolve} from 'path'
import {realpathSync} from 'fs'
import {getProjectConfig} from '../src/lib/config'

let root: string
const originalCwd = process.cwd()

const DEVCTL_YAML = `
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
`

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, {cwd, stdio: 'pipe'})
}

beforeAll(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'devctl-config-')))
})

afterAll(async () => {
  await rm(root, {recursive: true, force: true})
})

afterEach(() => {
  process.chdir(originalCwd)
})

async function makeProject(name: string, withCurrent = true): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, '.devctl.yaml'), DEVCTL_YAML)
  if (withCurrent) {
    await writeFile(
      join(dir, '.devctl-current.yaml'),
      'services:\n  - api\nenvironment: development\n',
    )
  }
  return dir
}

test('returns null when no config exists anywhere up the tree', async () => {
  const dir = join(root, 'empty')
  await mkdir(dir)
  process.chdir(dir)
  expect(await getProjectConfig({quiet: true})).toBeNull()
})

test('loads the project, keys services/environment by name, and reads current', async () => {
  const dir = await makeProject('basic')
  process.chdir(dir)

  const config = await getProjectConfig({quiet: true})
  expect(config).not.toBeNull()
  expect(config!.cwd).toBe(dir)
  expect(config!.paths).toEqual({
    project: join(dir, '.devctl.yaml'),
    compose: resolve(dir, '.devctl-docker-compose.yaml'),
    current: resolve(dir, '.devctl-current.yaml'),
    scripts: resolve(dir, '.devctl-scripts.yaml'),
  })
  expect((config!.services as any).api).toMatchObject({name: 'api', path: 'services/api'})
  expect((config!.environment as any).staging).toMatchObject({name: 'staging'})
  expect(config!.current).toEqual({services: ['api'], environment: 'development'})
})

test('defaults current to an empty object when .devctl-current.yaml is missing', async () => {
  const dir = await makeProject('no-current', false)
  process.chdir(dir)

  const config = await getProjectConfig({quiet: true})
  expect(config!.current).toEqual({})
})

test('redirects to the main checkout when run from a linked worktree', async () => {
  const main = await makeProject('wt-main')
  git(main, 'init')
  git(main, 'config', 'user.email', 'test@test.dev')
  git(main, 'config', 'user.name', 'test')
  git(main, 'add', '.')
  git(main, 'commit', '-m', 'init')
  const worktree = join(root, 'wt-linked')
  git(main, 'worktree', 'add', worktree)

  process.chdir(worktree)
  const config = await getProjectConfig({quiet: true})
  expect(config!.cwd).toBe(main)

  const forced = await getProjectConfig({quiet: true, forceInWorktree: true})
  expect(forced!.cwd).toBe(worktree)
})
