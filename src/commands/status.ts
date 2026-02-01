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

    // Display version
    const packageJson = require('../../package.json')
    this.log(`devctl v${packageJson.version}\n`)

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
    // Calculate column widths by stripping ANSI codes for accurate measurements
    const colWidths = data[0].map((_, colIndex) =>
      Math.max(...data.map(row => {
        const cellLines = (row[colIndex] || '').split('\n')
        return Math.max(...cellLines.map(line => stripAnsi(line).length))
      }))
    )

    // Print each row with proper padding, handling multi-line cells
    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex]

      // Split each cell by newlines to handle multi-line content
      const cellLines = row.map(cell => (cell || '').split('\n'))
      const maxLines = Math.max(...cellLines.map(lines => lines.length))

      // Print each line of this row
      for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
        const formatted = cellLines.map((lines, colIndex) => {
          const line = lines[lineIndex] || ''
          const stripped = stripAnsi(line)
          const padding = colWidths[colIndex] - stripped.length
          return line + ' '.repeat(padding)
        })
        process.stdout.write(formatted.join('  ') + '\n')
      }
    }
  }
}
