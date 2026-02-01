import {Args, Flags} from '@oclif/core'
import get from 'lodash/get'
import {BaseCommand} from '../base-command'
import {createDockerComposeCommand, getLastComposeFile} from '../utils/dockerCompose'

export default class Down extends BaseCommand {
  static description = 'Stops containers and removes containers, networks, volumes, and images created by "up"'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Down)

    // Shut down previous instances
    const lastCompose = await getLastComposeFile()
    if (lastCompose) {
      const exec = createDockerComposeCommand(lastCompose)

      await exec({
        msg: 'Shutting down previous instances',
        cmd: 'down --remove-orphans',
      })
    }

    // Shut down current instances
    const compose = get(this.projectConfig, 'paths.compose')

    if (compose) {
      const exec = createDockerComposeCommand(compose)

      await exec({
        msg: 'Removing orphans container',
        cmd: 'down --remove-orphans',
      })
    }
  }
}
