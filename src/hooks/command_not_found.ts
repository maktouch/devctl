import {Errors, Hook} from '@oclif/core'
import {spawn} from 'child_process'
import {constants} from 'fs'
import {access} from 'fs/promises'
import {isAbsolute, resolve} from 'path'
import {getProjectConfig} from '../lib/config'

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  displayName: string
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    })

    child.on('error', err => {
      reject(err)
    })

    child.on('close', code => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(
        new Errors.CLIError(`Custom command "${displayName}" exited with code ${code ?? 'unknown'}`, {
          exit: code ?? 1,
        })
      )
    })
  })
}

const hook: Hook<'command_not_found'> = async opts => {
  const id = opts.id ?? ''
  if (!id) {
    throw new Errors.CLIError('command not found')
  }

  const project = await getProjectConfig()
  const commands = project?.commands ?? []
  const entry = commands.find(command => command.name === id)

  if (!entry) {
    throw new Errors.CLIError(`command ${id} not found`)
  }

  const cwd = project?.cwd ?? process.cwd()
  const rawArgs = opts.argv ?? []
  const args = rawArgs[0] === id ? rawArgs.slice(1) : rawArgs

  const resolvedHandler = isAbsolute(entry.handler) ? entry.handler : resolve(cwd, entry.handler)
  const handlerExists = await fileExists(resolvedHandler)

  if (!handlerExists) {
    if (entry.handler.includes('/') || entry.handler.startsWith('.')) {
      throw new Errors.CLIError(`Custom command "${id}" handler not found at ${resolvedHandler}`)
    }

    await runProcess(entry.handler, args, cwd, id)
    return
  }

  if (await isExecutable(resolvedHandler)) {
    await runProcess(resolvedHandler, args, cwd, id)
    return
  }

  await runProcess('sh', [resolvedHandler, ...args], cwd, id)
}

export default hook
