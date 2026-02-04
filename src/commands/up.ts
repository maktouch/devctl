import {Args, Flags} from '@oclif/core'
import get from 'lodash/get'
import chalk from 'chalk'
import {BaseCommand} from '../base-command'
import {
  createDockerComposeCommand,
  writeComposeFileToHomeDir,
} from '../utils/dockerCompose'
import {readScripts, runScripts} from '../utils/runScripts'

export default class Up extends BaseCommand {
  static description = 'Builds, creates, starts, and attaches to containers for a service'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Up)

    const compose = get(this.projectConfig, 'paths.compose')
    const scriptsPath = get(this.projectConfig, 'paths.scripts')
    const allScripts = await readScripts(scriptsPath)

    await runScripts(allScripts, 'beforeSwitch', false)

    if (!compose) {
      // If no compose file, run switch to generate one
      await this.runCommand('switch', [])
      return
    }

    await runScripts(allScripts, 'afterSwitch', false)

    // Shut down first
    await this.runCommand('down', [])

    // Write compose file path to home directory for tracking
    await writeComposeFileToHomeDir(compose)

    const exec = createDockerComposeCommand(compose)

    // Start containers
    await exec({
      msg: `Starting docker containers ${chalk.gray('(This might take a while the first time)')}`,
      cmd: 'up -d',
    })

    // Show status
    await this.runCommand('status', [])

    await runScripts(allScripts, 'start', true)
  }
}
