import {Flags} from '@oclif/core'
import {BaseCommand} from '../base-command'

export default class Switch extends BaseCommand {
  static description = 'Switch services and/or environment'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {
    merge: Flags.boolean({
      allowNo: true,
      description: 'Keep other running devctl projects alive',
      default: true,
    }),
  }

  static args = {}

  public async run(): Promise<void> {
    const {flags} = await this.parse(Switch)

    await this.runCommand('switch-current', [])
    await this.runCommand('compile', [])

    const upArgs = flags.merge ? [] : ['--no-merge']
    await this.runCommand('up', upArgs)
  }
}
