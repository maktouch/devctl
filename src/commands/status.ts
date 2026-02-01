import {Args, Flags} from '@oclif/core'
import get from 'lodash/get'
import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
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

    const services = get(this.projectConfig, 'current.services', [])

    if (services.length === 0) {
      this.log('No services configured')
      return
    }

    const table: string[][] = [
      ['Service', 'Notes'],
      ...services.map((svc: string) => {
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

        return [service.name, note]
      }),
    ]

    this.printTable(table)
  }

  private printTable(data: string[][]): void {
    // Calculate column widths by stripping ANSI codes
    const colWidths = data[0].map((_, colIndex) =>
      Math.max(...data.map(row => stripAnsi(row[colIndex] || '').length))
    )

    // Print each row with proper padding
    for (const row of data) {
      const formatted = row.map((cell, i) => {
        const stripped = stripAnsi(cell)
        const padding = colWidths[i] - stripped.length
        return cell + ' '.repeat(padding)
      })
      this.log(formatted.join('  '))
    }
  }
}
