import {Command, Flags} from '@oclif/core'
import {getProjectConfig, FORCE_IN_WORKTREE_ENV} from './lib/config'
import type {DevctlConfig} from './types/config'

export abstract class BaseCommand extends Command {
  static baseFlags = {
    'force-in-worktree': Flags.boolean({
      description: 'Run against this git worktree instead of redirecting to the main checkout',
      default: false,
    }),
  }

  protected projectConfig!: DevctlConfig

  async init(): Promise<void> {
    await super.init()

    // Base flags are parsed here (before the command's own parse) so the
    // config loader knows about them. The env var lets nested runCommand()
    // invocations inherit the choice without re-threading argv.
    const {flags} = await this.parse({
      flags: {},
      baseFlags: (this.constructor as typeof BaseCommand).baseFlags,
      args: {},
      strict: false,
    })
    if (flags['force-in-worktree']) {
      process.env[FORCE_IN_WORKTREE_ENV] = '1'
    }

    // Load project configuration using the existing config loader
    const result = await getProjectConfig()
    if (!result) {
      this.error('Could not load project configuration. Make sure .devctl.yaml exists.')
    }
    this.projectConfig = result
  }

  // Helper to run another command (for backward compatibility with old pattern)
  async runCommand(commandName: string, args: string[] = []): Promise<void> {
    // Map command names to file names
    const commandMap: Record<string, string> = {
      'switch-current': 'switch-current',
      'compile': 'compile',
      'up': 'up',
      'down': 'down',
      'status': 'status',
    }

    const fileName = commandMap[commandName] || commandName

    // Use oclif's command execution by dynamically importing the command
    const {default: CommandClass} = await import(`./commands/${fileName}`)
    await CommandClass.run(args)
  }
}
