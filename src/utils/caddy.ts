import {homedir} from 'os'
import {resolve} from 'path'
import {readFile, writeFile, readdir, unlink, mkdir} from 'fs/promises'
import {exec, spawn} from 'child_process'
import {promisify} from 'util'
import * as http from 'http'

const execAsync = promisify(exec)

export const CONFIG_DIR = resolve(homedir(), '.config', 'devctl')
export const CADDY_DIR = resolve(CONFIG_DIR, 'caddy.d')
export const MASTER_CADDYFILE = resolve(CONFIG_DIR, 'Caddyfile')

export async function ensureDirectories(): Promise<void> {
  await mkdir(CADDY_DIR, {recursive: true})
}

/**
 * Extract the first site address from a Caddyfile snippet.
 * Looks for tokens before the first `{` at brace-depth 0.
 * Strips protocol, port, and path to return a clean hostname.
 */
export function deriveConfigName(content: string): string | null {
  const lines = content.split('\n')
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Skip snippet definitions like (snippet-name)
    if (braceDepth === 0 && trimmed.startsWith('(')) continue

    if (braceDepth === 0 && trimmed.includes('{')) {
      const addressPart = trimmed.replace(/\s*\{.*$/, '').trim()
      if (addressPart) {
        // Take first address (split on comma/space)
        const firstAddr = addressPart.split(/[\s,]+/).filter(Boolean)[0]
        if (firstAddr) {
          const hostname = firstAddr
            .replace(/^https?:\/\//, '')
            .replace(/:\d+$/, '')
            .replace(/\/.*$/, '')
          if (hostname && hostname !== '*' && !hostname.startsWith(':')) {
            return hostname
          }
        }
      }
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      if (ch === '}') braceDepth--
    }
  }

  return null
}

/**
 * Extract all hostnames from a Caddyfile snippet.
 */
export function extractHostnames(content: string): string[] {
  const lines = content.split('\n')
  const hostnames: string[] = []
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (braceDepth === 0 && trimmed.startsWith('(')) continue

    if (braceDepth === 0 && trimmed.includes('{')) {
      const addressPart = trimmed.replace(/\s*\{.*$/, '').trim()
      if (addressPart) {
        const addresses = addressPart.split(/[\s,]+/).filter(Boolean)
        for (const addr of addresses) {
          const hostname = addr
            .replace(/^https?:\/\//, '')
            .replace(/:\d+$/, '')
            .replace(/\/.*$/, '')
          if (hostname && hostname !== '*' && !hostname.startsWith(':')) {
            hostnames.push(hostname)
          }
        }
      }
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      if (ch === '}') braceDepth--
    }
  }

  return [...new Set(hostnames)]
}

export async function generateMasterCaddyfile(): Promise<void> {
  const content = `{
\t# Managed by devctl proxy
}

import ${CADDY_DIR}/*.caddy
`
  await mkdir(CONFIG_DIR, {recursive: true})
  await writeFile(MASTER_CADDYFILE, content, 'utf-8')
}

export async function isCaddyRunning(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get('http://localhost:2019/config/', res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

export async function checkCaddyInstalled(): Promise<void> {
  try {
    await execAsync('which caddy')
  } catch {
    throw new Error('caddy is not installed. Install it with: brew install caddy')
  }
}

export async function startCaddy(): Promise<void> {
  await checkCaddyInstalled()
  await ensureDirectories()
  await generateMasterCaddyfile()

  const child = spawn('caddy', ['start', '--config', MASTER_CADDYFILE], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  // Wait for Caddy to be ready (up to 5 seconds)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await isCaddyRunning()) return
    await new Promise(r => setTimeout(r, 250))
  }

  throw new Error('Caddy failed to start within 5 seconds.')
}

export async function checkPortInUse(port: number): Promise<string | null> {
  try {
    const {stdout} = await execAsync(`lsof -i :${port} -sTCP:LISTEN -P -n`)
    const lines = stdout.trim().split('\n')
    if (lines.length < 2) return null
    // Parse the process name and PID from lsof output (COMMAND PID ...)
    const parts = lines[1].split(/\s+/)
    return `${parts[0]} (pid ${parts[1]})`
  } catch {
    return null
  }
}

export async function stopCaddy(): Promise<void> {
  await execAsync('caddy stop')
}

export async function reloadCaddy(): Promise<void> {
  await generateMasterCaddyfile()
  await execAsync(`caddy reload --config ${MASTER_CADDYFILE}`)
}

export async function addSiteConfig(content: string, name?: string): Promise<string> {
  await ensureDirectories()

  const configName = name || deriveConfigName(content)
  if (!configName) {
    throw new Error(
      'Could not determine a name for this config. ' +
        'Ensure your Caddyfile snippet contains a site address, or provide --name.',
    )
  }

  const filePath = resolve(CADDY_DIR, `${configName}.caddy`)
  await writeFile(filePath, content, 'utf-8')
  return configName
}

export async function removeSiteConfig(name: string): Promise<boolean> {
  const filePath = resolve(CADDY_DIR, `${name}.caddy`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}

export async function listSiteConfigs(): Promise<Array<{name: string; hostnames: string[]}>> {
  await ensureDirectories()

  const files = await readdir(CADDY_DIR).catch(() => [])
  const configs: Array<{name: string; hostnames: string[]}> = []

  for (const file of files) {
    if (!file.endsWith('.caddy')) continue
    const name = file.replace(/\.caddy$/, '')
    const content = await readFile(resolve(CADDY_DIR, file), 'utf-8')
    const hostnames = extractHostnames(content)
    configs.push({name, hostnames})
  }

  return configs
}
