import {Args, Flags} from '@oclif/core'
import {BaseCommand} from '../base-command'
import {createDockerComposeCommand} from '../utils/dockerCompose'

export default class Exec extends BaseCommand {
  static description = 'Execute a command in a running container'

  static examples = [
    '<%= config.bin %> <%= command.id %> service-name sh',
    '<%= config.bin %> <%= command.id %> -u root service-name bash',
  ]

  static flags = {
    detach: Flags.boolean({char: 'd', description: 'Detached mode: Run command in the background'}),
    privileged: Flags.boolean({description: 'Give extended privileges to the process'}),
    user: Flags.string({char: 'u', description: 'Run the command as this user'}),
    index: Flags.integer({description: 'Index of the container if there are multiple instances'}),
    env: Flags.string({char: 'e', description: 'Set environment variables', multiple: true}),
    workdir: Flags.string({char: 'w', description: 'Path to workdir directory for this command'}),
    'no-TTY': Flags.boolean({char: 'T', description: 'Disable pseudo-tty allocation'}),
  }

  static args = {
    service: Args.string({description: 'Service name', required: true}),
    command: Args.string({description: 'Command to execute', required: true}),
  }

  static strict = false // Allow passing through extra args

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Exec)

    const compose = this.projectConfig.paths?.compose

    if (!compose) {
      this.error('No docker-compose file found. Run compile or switch first.')
    }

    // Build the command from flags and remaining args
    const cmdParts = ['exec']

    if (flags.detach) cmdParts.push('-d')
    if (flags.privileged) cmdParts.push('--privileged')
    if (flags.user) cmdParts.push(`-u ${flags.user}`)
    if (flags.index) cmdParts.push(`--index=${flags.index}`)
    if (flags['no-TTY']) cmdParts.push('-T')
    if (flags.env) {
      flags.env.forEach(e => cmdParts.push(`-e ${e}`))
    }
    if (flags.workdir) cmdParts.push(`-w ${flags.workdir}`)

    // Add the service and command
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
