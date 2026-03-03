import {homedir} from 'os'
import {resolve, dirname} from 'path'
import {readFile, writeFile, access, unlink, rename, mkdir} from 'fs/promises'
import {execSync} from 'child_process'
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)
const legacyPath = resolve(homedir(), '.devctl-current')
const configDir = resolve(homedir(), '.config', 'devctl')
const currentStatePath = resolve(configDir, 'current')

export interface DevctlCurrentState {
  composePath: string
  containers: string[]
}

/**
 * Migrate legacy ~/.devctl-current to ~/.config/devctl/current if it exists.
 */
async function migrateConfig(): Promise<void> {
  try {
    await access(legacyPath)
  } catch {
    return // No legacy file, nothing to migrate
  }

  try {
    await mkdir(configDir, {recursive: true})
    await rename(legacyPath, currentStatePath)
    console.log(`Migrated ~/.devctl-current → ~/.config/devctl/current`)
  } catch (err: any) {
    console.warn('Warning: could not migrate config:', err.message)
  }
}

/**
 * Parse the state file, handling all legacy formats:
 * - Plain text (old compose path)
 * - Single JSON object (previous format)
 * - JSON array (new multi-project format)
 */
async function readStateFile(): Promise<DevctlCurrentState[]> {
  await migrateConfig()

  try {
    await access(currentStatePath)
    const raw = (await readFile(currentStatePath, 'utf-8')).trim()
    if (!raw) return []

    try {
      const parsed = JSON.parse(raw)

      // New format: array
      if (Array.isArray(parsed)) {
        return parsed as DevctlCurrentState[]
      }

      // Previous format: single object
      if (parsed.composePath) {
        return [parsed as DevctlCurrentState]
      }
    } catch {
      // Not JSON — treat as legacy plain text (just a compose path)
    }

    // Legacy format: plain text compose path
    return [{composePath: raw, containers: []}]
  } catch {
    return []
  }
}

async function writeStateFile(states: DevctlCurrentState[]): Promise<void> {
  await mkdir(configDir, {recursive: true})
  await writeFile(currentStatePath, JSON.stringify(states, null, 2), 'utf-8')
}

export async function getAllStates(): Promise<DevctlCurrentState[]> {
  return readStateFile()
}

export async function getLastState(): Promise<DevctlCurrentState | null> {
  const states = await readStateFile()
  return states.length > 0 ? states[0] : null
}

/**
 * Replace all tracked state with a single project (non-merge behavior).
 */
export async function writeCurrentState(state: DevctlCurrentState): Promise<void> {
  await writeStateFile([state])
}

/**
 * Add a project to tracked state, deduping by composePath.
 */
export async function addCurrentState(state: DevctlCurrentState): Promise<void> {
  const states = await readStateFile()
  const filtered = states.filter(s => s.composePath !== state.composePath)
  filtered.push(state)
  await writeStateFile(filtered)
}

/**
 * Remove a specific project from tracked state by its composePath.
 */
export async function removeStateByComposePath(composePath: string): Promise<void> {
  const states = await readStateFile()
  const filtered = states.filter(s => s.composePath !== composePath)
  await writeStateFile(filtered)
}

export async function clearCurrentState(): Promise<void> {
  try {
    await unlink(currentStatePath)
  } catch {
    // File might not exist, that's fine
  }
}

export async function composeFileExists(composePath: string): Promise<boolean> {
  try {
    await access(composePath)
    return true
  } catch {
    return false
  }
}

export async function getComposeContainerIds(composePath: string): Promise<string[]> {
  try {
    const {stdout} = await execAsync(`docker compose -f "${composePath}" ps -q`)
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export async function forceRemoveContainers(containerIds: string[]): Promise<void> {
  if (containerIds.length === 0) return
  const ids = containerIds.join(' ')
  try {
    await execAsync(`docker rm -f ${ids}`)
  } catch (err: any) {
    // Some containers may already be gone; that's fine
    console.warn('Warning: some containers could not be removed:', err.message)
  }
}

interface DockerComposeOptions {
  cmd: string
  msg?: string
  options?: any
}

export function createDockerComposeCommand(compose: string, isAsync = true) {
  return async ({cmd, msg, options}: DockerComposeOptions): Promise<string | Buffer> => {
    const command = `docker compose -f "${compose}" ${cmd}`

    if (isAsync) {
      if (msg) {
        console.log(msg)
      }

      try {
        const {stdout} = await execAsync(command)
        return stdout
      } catch (err: any) {
        console.error(err.stderr || err.message)
        throw err
      }
    }

    return execSync(command, options)
  }
}
