import {homedir} from 'os'
import {resolve} from 'path'
import {readFile, writeFile, access, unlink} from 'fs/promises'
import {execSync} from 'child_process'
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)
const lastDCPath = resolve(homedir(), '.devctl-current')

export interface DevctlCurrentState {
  composePath: string
  containers: string[]
}

export async function getLastState(): Promise<DevctlCurrentState | null> {
  try {
    await access(lastDCPath)
    const raw = (await readFile(lastDCPath, 'utf-8')).trim()
    if (!raw) return null

    // Try parsing as JSON (new format)
    try {
      const parsed = JSON.parse(raw)
      if (parsed.composePath) {
        return parsed as DevctlCurrentState
      }
    } catch {
      // Not JSON — treat as legacy plain text (just a compose path)
    }

    // Legacy format: plain text compose path
    return {
      composePath: raw,
      containers: [],
    }
  } catch {
    return null
  }
}

export async function writeCurrentState(state: DevctlCurrentState): Promise<void> {
  await writeFile(lastDCPath, JSON.stringify(state, null, 2), 'utf-8')
}

export async function clearCurrentState(): Promise<void> {
  try {
    await unlink(lastDCPath)
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
