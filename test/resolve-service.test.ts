import {test, expect, beforeAll, afterAll, vi} from 'vitest'
import {mkdtemp, rm, mkdir, writeFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join, resolve} from 'path'
import {realpathSync} from 'fs'
import {resolveService} from '../src/utils/resolveService'
import type {DevctlConfig} from '../src/types/config'

let root: string

beforeAll(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'devctl-resolve-')))

  await mkdir(join(root, 'services', 'api'), {recursive: true})
  await writeFile(
    join(root, 'services', 'api', '.devconfig.yaml'),
    `
compose:
  default:
    api:
      image: node:20
      environment:
        NODE_ENV: development
  staging:
    api:
      environment:
        NODE_ENV: staging
dotenv:
  default:
    PORT: 3000
`,
  )

  // Service whose config entry has no path: the folder is the service name.
  await mkdir(join(root, 'db'))
  await writeFile(
    join(root, 'db', '.devconfig.cjs'),
    `module.exports = {
  compose: (current, project) => ({db: {image: 'mysql:8', env: current.environment}}),
}
`,
  )

  // Service directory without any devconfig file
  await mkdir(join(root, 'bare'))
})

afterAll(async () => {
  await rm(root, {recursive: true, force: true})
})

function project(services: string[], environment = 'staging'): DevctlConfig {
  return {
    cwd: root,
    current: {services, environment},
    services: {
      api: {name: 'api', path: 'services/api'},
      db: {name: 'db'},
      bare: {name: 'bare', path: 'bare'},
    } as any,
  }
}

test('merges the default and environment sections of a YAML devconfig', async () => {
  const [api] = await resolveService(project(['api']))
  expect(api.path).toBe(resolve(root, 'services/api'))
  expect(api.compose).toEqual({
    api: {image: 'node:20', environment: {NODE_ENV: 'staging'}},
  })
  // No staging section for dotenv: default alone applies
  expect(api.dotenv).toEqual({PORT: 3000})
})

test('uses only the default section when the environment has no overrides', async () => {
  const [api] = await resolveService(project(['api'], 'development'))
  expect(api.compose.api.environment.NODE_ENV).toBe('development')
})

test('invokes function-style devconfig entries with current and project', async () => {
  const config = project(['db'])
  const [db] = await resolveService(config)
  expect(db.path).toBe(resolve(root, 'db'))
  expect(db.compose).toEqual({db: {image: 'mysql:8', env: 'staging'}})
})

test('keeps a service without a devconfig file, with its path resolved', async () => {
  const [bare] = await resolveService(project(['bare']))
  expect(bare).toMatchObject({name: 'bare', path: resolve(root, 'bare')})
  expect(bare.compose).toBeUndefined()
})

test('warns and skips services missing from the project config', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const services = await resolveService(project(['ghost', 'api']))
    expect(services.map(s => s.name)).toEqual(['api'])
    expect(warn).toHaveBeenCalledWith('Service ghost not found in config')
  } finally {
    warn.mockRestore()
  }
})

test('returns an empty list when nothing is selected', async () => {
  expect(await resolveService({cwd: root, current: {}, services: {} as any})).toEqual([])
})
