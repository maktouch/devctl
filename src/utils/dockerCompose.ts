import {homedir} from 'os'
import {resolve} from 'path'
import {readFile, writeFile, access} from 'fs/promises'
import {execSync} from 'child_process'
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)
const lastDCPath = resolve(homedir(), '.devctl-current')

export async function getLastComposeFile(): Promise<string | null> {
  try {
    await access(lastDCPath)
    return await readFile(lastDCPath, 'utf-8')
  } catch (err) {
    return null
  }
}

export async function writeComposeFileToHomeDir(compose: string): Promise<void> {
  await writeFile(lastDCPath, compose, 'utf-8')
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
