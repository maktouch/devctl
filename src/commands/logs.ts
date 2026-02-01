import {Args, Flags} from '@oclif/core'
import chalk from 'chalk'
import {BaseCommand} from '../base-command'
import {createDockerComposeCommand} from '../utils/dockerCompose'
import {readYaml} from '../utils/yaml'

export default class Logs extends BaseCommand {
  static description = 'View output from containers'

  static examples = [
    '<%= config.bin %> <%= command.id %> -f service-name',
    '<%= config.bin %> <%= command.id %> -f -t service-name',
  ]

  static flags = {
    follow: Flags.boolean({char: 'f', description: 'Follow log output'}),
    timestamps: Flags.boolean({char: 't', description: 'Show timestamps'}),
    tail: Flags.string({description: 'Number of lines to show from the end of the logs'}),
    'no-color': Flags.boolean({description: 'Produce monochrome output'}),
  }

  static args = {
    services: Args.string({description: 'Services to show logs for', required: false}),
  }

  static strict = false // Allow passing through extra args

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Logs)

    const compose = this.projectConfig.paths?.compose

    if (!compose) {
      this.error('No docker-compose file found. Run compile or switch first.')
    }

    // Build the command from flags and args
    const cmdParts = ['logs']

    if (flags.follow) cmdParts.push('-f')
    if (flags.timestamps) cmdParts.push('-t')
    if (flags.tail) cmdParts.push(`--tail=${flags.tail}`)
    if (flags['no-color']) cmdParts.push('--no-color')

    // Add any remaining arguments (service names, etc)
    cmdParts.push(...(argv as string[]))

    const exec = createDockerComposeCommand(compose, false)

    exec({
      cmd: cmdParts.join(' '),
      options: {
        stdio: 'inherit',
      },
    })
  }
}
