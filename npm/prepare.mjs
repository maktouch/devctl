#!/usr/bin/env node
/**
 * Assembles the npm packages for a release from prebuilt binaries.
 *
 * Usage:
 *   node devctl-rs/npm/prepare.mjs --version 9.0.0 --artifacts ./artifacts --out ./npm-dist
 *
 * Expects binaries at <artifacts>/devctl-<target>/devctl (the layout produced
 * by actions/download-artifact) and writes publishable package directories to
 * <out>/. Artifact zips drop the executable bit, so it is restored here.
 */
import {chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync} from 'fs'
import {dirname, join} from 'path'
import {fileURLToPath} from 'url'

const TARGETS = [
  {target: 'aarch64-apple-darwin', pkg: 'devctl-darwin-arm64', os: 'darwin', cpu: 'arm64'},
  {target: 'x86_64-apple-darwin', pkg: 'devctl-darwin-x64', os: 'darwin', cpu: 'x64'},
  {target: 'aarch64-unknown-linux-musl', pkg: 'devctl-linux-arm64', os: 'linux', cpu: 'arm64'},
  {target: 'x86_64-unknown-linux-musl', pkg: 'devctl-linux-x64', os: 'linux', cpu: 'x64'},
]

const SHARED = {
  description: 'Easily start developing in monorepos with docker-compose',
  repository: {type: 'git', url: 'git+https://github.com/maktouch/devctl.git'},
  bugs: {url: 'https://github.com/maktouch/devctl/issues'},
  license: 'MIT',
}

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error(`Missing required argument --${name}`)
    process.exit(1)
  }
  return process.argv[idx + 1]
}

const version = arg('version')
const artifacts = arg('artifacts')
const out = arg('out')
const here = dirname(fileURLToPath(import.meta.url))

// Platform packages: just the native binary plus metadata.
for (const {target, pkg, os, cpu} of TARGETS) {
  const binary = join(artifacts, `devctl-${target}`, 'devctl')
  if (!existsSync(binary)) {
    console.error(`Missing binary for ${target}: ${binary}`)
    process.exit(1)
  }

  const dir = join(out, pkg)
  mkdirSync(join(dir, 'bin'), {recursive: true})
  copyFileSync(binary, join(dir, 'bin', 'devctl'))
  chmodSync(join(dir, 'bin', 'devctl'), 0o755)

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `@maktouch/${pkg}`,
        version,
        ...SHARED,
        description: `${SHARED.description} (${os}-${cpu} binary)`,
        os: [os],
        cpu: [cpu],
        files: ['bin'],
      },
      null,
      2
    ) + '\n'
  )
  console.log(`prepared @maktouch/${pkg}@${version}`)
}

// Main package: the Node launcher with the platform packages as
// optionalDependencies pinned to the exact same version.
const mainDir = join(out, 'devctl')
cpSync(join(here, 'devctl'), mainDir, {recursive: true})
chmodSync(join(mainDir, 'bin', 'devctl'), 0o755)

writeFileSync(
  join(mainDir, 'package.json'),
  JSON.stringify(
    {
      name: '@maktouch/devctl',
      version,
      ...SHARED,
      bin: {devctl: 'bin/devctl'},
      files: ['bin', 'README.md'],
      engines: {node: '>=18'},
      optionalDependencies: Object.fromEntries(
        TARGETS.map(({pkg}) => [`@maktouch/${pkg}`, version])
      ),
    },
    null,
    2
  ) + '\n'
)
console.log(`prepared @maktouch/devctl@${version}`)
