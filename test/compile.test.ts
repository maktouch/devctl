import {test, expect, beforeEach, afterEach} from 'vitest'
import * as YAML from 'js-yaml'
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join, resolve} from 'path'
import {realpathSync} from 'fs'
import Compile from '../src/commands/compile'
import {parseEnv} from '../src/utils/dotenv'

const REPO_ROOT = resolve(__dirname, '..')

let root: string
const originalCwd = process.cwd()

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'devctl-compile-')))
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(root, {recursive: true, force: true})
})

async function writeProject(options: {proxy?: boolean} = {}) {
  const proxyBlock = options.proxy ? 'proxy:\n  enabled: true\n' : ''
  const apiProxy = options.proxy
    ? '    proxy:\n      - port: 3000\n        paths:\n          - app.localhost\n'
    : ''
  await writeFile(
    join(root, '.devctl.yaml'),
    `${proxyBlock}services:
  - name: api
    path: services/api
${apiProxy}  - name: db
    path: services/db
environment:
  - name: development
    description: local dev
`,
  )
  await writeFile(
    join(root, '.devctl-current.yaml'),
    `services:
  - api
  - db
environment: development
dockerhost:
  address: 192.168.65.2
  interfaceName: en0
`,
  )

  await mkdir(join(root, 'services', 'api'), {recursive: true})
  await writeFile(
    join(root, 'services', 'api', '.devconfig.yaml'),
    `compose:
  default:
    api:
      image: node:20
      ports:
        - "3000:3000"
dotenv:
  default:
    PORT: 3000
afterSwitch:
  default:
    install: pnpm install
`,
  )

  await mkdir(join(root, 'services', 'db'), {recursive: true})
  await writeFile(
    join(root, 'services', 'db', '.devconfig.yaml'),
    `compose:
  default:
    db:
      image: mysql:8
start:
  default:
    wait: ./wait-for-db.sh
`,
  )
}

async function runCompile() {
  process.chdir(root)
  await Compile.run([], REPO_ROOT)
}

async function readOutput(name: string): Promise<any> {
  return YAML.load(await readFile(join(root, name), 'utf-8'))
}

test('merges every selected service into one docker-compose file', async () => {
  await writeProject()
  await runCompile()

  const compose = await readOutput('.devctl-docker-compose.yaml')
  expect(compose).toEqual({
    services: {
      api: {image: 'node:20', ports: ['3000:3000']},
      db: {image: 'mysql:8'},
    },
  })
})

test('writes dotenv files for services that define one', async () => {
  await writeProject()
  await runCompile()

  const env = parseEnv(await readFile(join(root, 'services', 'api', '.env'), 'utf-8'))
  expect(env).toEqual({PORT: 3000})

  // db has no dotenv section: no file written
  await expect(readFile(join(root, 'services', 'db', '.env'))).rejects.toThrow()
})

test('merges into an existing .env, keeping unmanaged keys', async () => {
  await writeProject()
  await writeFile(join(root, 'services', 'api', '.env'), 'SECRET="keep-me"\nPORT=9999\n')
  await runCompile()

  const env = parseEnv(await readFile(join(root, 'services', 'api', '.env'), 'utf-8'))
  expect(env).toEqual({SECRET: 'keep-me', PORT: 3000})
})

test('collects afterSwitch and start scripts per service', async () => {
  await writeProject()
  await runCompile()

  const scripts = await readOutput('.devctl-scripts.yaml')
  expect(scripts).toEqual({
    afterSwitch: [{name: 'api', scripts: ['pnpm install']}],
    start: [{name: 'db', scripts: ['./wait-for-db.sh']}],
  })
})

test('adds the devctl-proxy service with routes when the proxy is enabled', async () => {
  await writeProject({proxy: true})
  await runCompile()

  const compose = await readOutput('.devctl-docker-compose.yaml')
  const proxy = compose.services['devctl-proxy']
  expect(proxy).toMatchObject({
    image: 'maktouch/devctl-proxy:latest',
    restart: 'always',
    ports: ['80:80'],
  })
  expect(JSON.parse(proxy.environment.DEVCTL_PROXY)).toEqual({
    routes: {'app.localhost': 'http://192.168.65.2:3000'},
    proxy: {enabled: true},
  })
})

test('leaves the proxy out when not enabled', async () => {
  await writeProject()
  await runCompile()

  const compose = await readOutput('.devctl-docker-compose.yaml')
  expect(compose.services['devctl-proxy']).toBeUndefined()
})
