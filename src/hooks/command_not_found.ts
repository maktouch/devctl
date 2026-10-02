import {Errors, Hook} from '@oclif/core'
import {buildSync} from 'esbuild'
import {spawn} from 'child_process'
import {constants} from 'fs'
import {access, stat} from 'fs/promises'
import {extname, isAbsolute, join, resolve} from 'path'
import chalk from 'chalk'
import {getProjectConfig, FORCE_IN_WORKTREE_ENV} from '../lib/config'
import {extractForceInWorktreeFlag, resolveCustomCommandLocation} from '../lib/custom-command'

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

  // Honour --force-in-worktree for custom commands too. Built-in commands get
  // it from BaseCommand, but this hook runs before any oclif flag parsing.
  const {argv: rawArgs, forced} = extractForceInWorktreeFlag(opts.argv ?? [])
  if (forced) {
    process.env[FORCE_IN_WORKTREE_ENV] = '1'
  }

  // `invocation` is the checkout the user actually ran devctl from. Custom
  // commands are per-checkout (dev servers, URLs, secrets), so their handler
  // is loaded and executed there, and it is what handlers see as
  // `config`/`project`, exactly as in devctl 7.
  //
  // `shared` is the redirected project (the main checkout when run from a
  // linked worktree). It owns the Docker stack and is exposed to handlers as
  // `shared` for the few that need it. The two are the same object when not
  // in a worktree or when --force-in-worktree is set.
  const invocation = await getProjectConfig({forceInWorktree: true})
  const shared = await getProjectConfig({quiet: true})
  const commands = invocation?.commands ?? shared?.commands ?? []

  // oclif with topicSeparator=" " converts "secrets node-api" into "secrets:node-api".
  // Try exact match first, then fall back to matching just the first segment.
  let entry = commands.find(command => command.name === id)
  let commandName = id
  let extraArgs: string[] = []

  if (!entry && id.includes(':')) {
    const [first, ...rest] = id.split(':')
    entry = commands.find(command => command.name === first)
    if (entry) {
      commandName = first
      extraArgs = rest
    }
  }

  if (!entry) {
    throw new Errors.CLIError(`command ${id} not found`)
  }

  const args = [...extraArgs, ...rawArgs]
  const handlerSpec = entry.handler

  const location = await resolveCustomCommandLocation({
    invocationCwd: invocation?.cwd,
    sharedCwd: shared?.cwd,
    fallbackCwd: process.cwd(),
    resolveHandler: cwd => resolveHandlerFile(handlerSpec, cwd, commandName),
  })
  const {cwd, handler: resolvedHandler} = location

  if (location.fellBackToShared) {
    process.stderr.write(
      chalk.yellow(
        `devctl: "${commandName}" is not defined in ${invocation?.cwd}; running the main checkout's copy from ${cwd}\n`,
      ),
    )
  }

  // Handlers see the config of the checkout they run in.
  const project = cwd === shared?.cwd ? shared : invocation

  if (!resolvedHandler.exists) {
    if (handlerSpec.includes('/') || handlerSpec.startsWith('.')) {
      throw new Errors.CLIError(
        `Custom command "${commandName}" handler not found at ${resolvedHandler.path}`
      )
    }

    await runProcess(handlerSpec, args, cwd, commandName)
    return
  }

  if (await isExecutable(resolvedHandler.path)) {
    await runProcess(resolvedHandler.path, args, cwd, commandName)
    return
  }

  if (resolvedHandler.isModule) {
    const handler = await loadModuleHandler(resolvedHandler.path, commandName)
    await handler({
      args,
      argv: rawArgs,
      command: commandName,
      cwd,
      config: project,
      project,
      shared,
      // Backwards compatibility with gluegun-based custom commands (v3.x)
      parameters: {
        first: args[0],
        second: args[1],
        array: [commandName, ...args],
      },
    })
    return
  }

  await runProcess('sh', [resolvedHandler.path, ...args], cwd, commandName)
}

export default hook
