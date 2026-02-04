import {Errors, Hook} from '@oclif/core'
import {buildSync} from 'esbuild'
import {spawn} from 'child_process'
import {constants} from 'fs'
import {access, stat} from 'fs/promises'
import {extname, isAbsolute, join, resolve} from 'path'
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

async function resolveHandlerFile(
  handler: string,
  cwd: string,
  commandName: string
): Promise<{path: string; exists: boolean; isModule: boolean}> {
  const resolved = isAbsolute(handler) ? handler : resolve(cwd, handler)
  if (!(await fileExists(resolved))) {
    return {path: resolved, exists: false, isModule: false}
  }

  const info = await stat(resolved)
  if (info.isDirectory()) {
    const candidates = ['index.js', 'index.cjs', 'index.mjs', 'index.ts', 'index.cts', 'index.mts']
    for (const candidate of candidates) {
      const path = join(resolved, candidate)
      if (await fileExists(path)) {
        return {path, exists: true, isModule: true}
      }
    }

    throw new Errors.CLIError(
      `Custom command "${commandName}" handler directory missing index file`
    )
  }

  const isModule = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'].includes(extname(resolved))
  return {path: resolved, exists: true, isModule}
}

function isTypescriptFile(handlerPath: string): boolean {
  return ['.ts', '.cts', '.mts'].includes(extname(handlerPath))
}

function compileTypescript(handlerPath: string): string {
  const result = buildSync({
    entryPoints: [handlerPath],
    bundle: false,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    loader: {'.ts': 'ts', '.cts': 'ts', '.mts': 'ts'},
  })

  return result.outputFiles[0].text
}

async function loadModuleHandler(
  handlerPath: string,
  commandName: string,
): Promise<(payload: Record<string, unknown>) => Promise<void>> {
  let loaded: unknown

  if (isTypescriptFile(handlerPath)) {
    const code = compileTypescript(handlerPath)
    const module = {exports: {} as Record<string, unknown>}
    const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', code)
    fn(require, module, module.exports, handlerPath, resolve(handlerPath, '..'))
    loaded = module.exports
  } else {
    try {
      loaded = require(handlerPath)
    } catch (error: any) {
      if (error?.code !== 'ERR_REQUIRE_ESM') {
        throw error
      }

      const {pathToFileURL} = await import('url')
      loaded = await import(pathToFileURL(handlerPath).href)
    }
  }

  const handler = (loaded as {default?: unknown}).default ?? loaded

  if (typeof handler !== 'function') {
    throw new Errors.CLIError(
      `Custom command "${commandName}" handler must export a function`
    )
  }

  return handler as (payload: Record<string, unknown>) => Promise<void>
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

  const resolvedHandler = await resolveHandlerFile(entry.handler, cwd, id)

  if (!resolvedHandler.exists) {
    if (entry.handler.includes('/') || entry.handler.startsWith('.')) {
      throw new Errors.CLIError(
        `Custom command "${id}" handler not found at ${resolvedHandler.path}`
      )
    }

    await runProcess(entry.handler, args, cwd, id)
    return
  }

  if (await isExecutable(resolvedHandler.path)) {
    await runProcess(resolvedHandler.path, args, cwd, id)
    return
  }

  if (resolvedHandler.isModule) {
    const handler = await loadModuleHandler(resolvedHandler.path, id)
    await handler({
      args,
      argv: rawArgs,
      command: id,
      cwd,
      config: project,
      project,
    })
    return
  }

  await runProcess('sh', [resolvedHandler.path, ...args], cwd, id)
}

export default hook
