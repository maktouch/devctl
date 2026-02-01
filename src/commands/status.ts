import {Args, Flags} from '@oclif/core'
import get from 'lodash/get'
import chalk from 'chalk'
import Table from 'cli-table3'
import {BaseCommand} from '../base-command'

export default class Status extends BaseCommand {
  static description = 'Output information about the current settings'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Status)

    // Display version
    const packageJson = require('../../package.json')
    this.log(`devctl v${packageJson.version}\n`)

    const services = get(this.projectConfig, 'current.services', [])

    if (services.length === 0) {
      this.log('No services configured')
      return
    }

    const table = new Table({
      head: ['Service', 'Notes'],
      wordWrap: true,
    })

    services.forEach((svc: string) => {
      const service = (this.projectConfig.services as any)[svc]

      const note = get(service, 'notes', '')
        .split('\n')
        .map((line: string) => {
          if (line.startsWith('    ')) {
            return chalk.cyan(line)
          } else {
            return line
          }
        })
        .join('\n')
        .trim()

      table.push([service.name, note])
    })

    this.log(table.toString())
  }
}
