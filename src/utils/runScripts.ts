import get from 'lodash/get'
import {exec} from 'child_process'
import {promisify} from 'util'
import concurrently from 'concurrently'
import chalk from 'chalk'
import {readYaml} from './yaml'

const execAsync = promisify(exec)

interface ScriptEntry {
  name: string
  scripts: string[]
}

interface AllScripts {
  [key: string]: ScriptEntry[]
}

async function execCommand({cmd, msg}: {cmd: string; msg?: string}): Promise<string> {
  if (msg) {
    console.log(msg)
  }

  try {
    const {stdout} = await execAsync(cmd)
    return stdout
  } catch (err: any) {
    console.error(err.stderr || err.message)
    throw err
  }
}

export async function readScripts(path: string): Promise<AllScripts> {
  try {
    return await readYaml(path)
  } catch (err) {
    return {}
  }
}

export async function runScripts(
  allScripts: AllScripts,
  key: string,
  concurrent: boolean
): Promise<void> {
  const scripts = get(allScripts, key, []) as ScriptEntry[]

  if (concurrent) {
    const concurrentScripts = scripts.map(({name, scripts}) => {
      const [command] = scripts
      return {command, name}
    })

    if (concurrentScripts.length === 0) {
      return
    }

    console.log(`Running ${chalk.yellow(key)} scripts`)
    await concurrently(concurrentScripts)
  } else {
    for (const {name, scripts: scriptList} of scripts) {
      console.log(`Running ${chalk.yellow(key)} scripts`)

      for (const cmd of scriptList) {
        await execCommand({
          cmd,
          msg: ` ${chalk.cyan(name)} ${cmd}`,
        })
      }
    }
  }
}
