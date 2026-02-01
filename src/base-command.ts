import {Command, Flags} from '@oclif/core'
import {getProjectConfig} from './lib/config'
import type {DevctlConfig} from './types/config'

export abstract class BaseCommand extends Command {
  protected projectConfig!: DevctlConfig

  async init(): Promise<void> {
    await super.init()

    // Load project configuration using the existing config loader
    const result = await getProjectConfig()
    if (!result) {
      this.error('Could not load project configuration. Make sure .devctl.yaml exists.')
    }
    this.projectConfig = result
  }

  // Helper to run another command (for backward compatibility with old pattern)
  async runCommand(commandName: string, args: string[] = []): Promise<void> {
    await this.config.runCommand(commandName, args)
  }
}
