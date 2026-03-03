import {Args, Flags} from '@oclif/core'
import get from 'lodash/get'
import inquirer from 'inquirer'
import {BaseCommand} from '../base-command'
import {getAllStates} from '../utils/dockerCompose'

export default class Switch extends BaseCommand {
  static description = 'Switch services and/or environment'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {
    merge: Flags.boolean({
      description: 'Keep other running devctl projects alive',
      default: false,
    }),
  }

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Switch)

    await this.runCommand('switch-current', [])
    await this.runCommand('compile', [])

    let merge = flags.merge

    if (!merge) {
      const currentCompose = get(this.projectConfig, 'paths.compose') as string | undefined
      const states = await getAllStates()
      const otherProjects = states.filter(s => s.composePath !== currentCompose)

      if (otherProjects.length > 0) {
        const paths = otherProjects.map(s => s.composePath).join(', ')
        const {action} = await inquirer.prompt<{action: string}>([
          {
            type: 'list',
            name: 'action',
            message: `Another devctl project is running (${paths}). What would you like to do?`,
            choices: [
              {name: 'Stop it and start this project', value: 'stop'},
              {name: 'Keep it running (merge)', value: 'merge'},
            ],
            default: 'stop',
          },
        ])
        merge = action === 'merge'
      }
    }

    const upArgs = merge ? ['--merge'] : []
    await this.runCommand('up', upArgs)
  }
}
