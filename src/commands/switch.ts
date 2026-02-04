import {Args, Flags} from '@oclif/core'
import {BaseCommand} from '../base-command'

export default class Switch extends BaseCommand {
  static description = 'Switch services and/or environment'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Switch)

    await this.runCommand('switch-current', [])
    await this.runCommand('compile', [])
    await this.runCommand('up', [])
  }
}
