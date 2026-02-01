import {Args, Flags} from '@oclif/core'
import {BaseCommand} from '../base-command'
import {createDockerComposeCommand} from '../utils/dockerCompose'

export default class Run extends BaseCommand {
  static description = 'Run a one-off command on a service'

  static examples = [
    '<%= config.bin %> <%= command.id %> service-name printenv',
    '<%= config.bin %> <%= command.id %> --rm service-name npm test',
  ]

  static flags = {
    detach: Flags.boolean({char: 'd', description: 'Detached mode: Run container in the background'}),
    name: Flags.string({description: 'Assign a name to the container'}),
    entrypoint: Flags.string({description: 'Override the entrypoint of the image'}),
    env: Flags.string({char: 'e', description: 'Set environment variable', multiple: true}),
    label: Flags.string({char: 'l', description: 'Add or override a label', multiple: true}),
    user: Flags.string({char: 'u', description: 'Run as specified username or uid'}),
    'no-deps': Flags.boolean({description: "Don't start linked services"}),
    rm: Flags.boolean({description: 'Remove container after run'}),
    publish: Flags.string({char: 'p', description: "Publish a container's port(s)", multiple: true}),
    'service-ports': Flags.boolean({description: "Run with the service's ports enabled"}),
    'use-aliases': Flags.boolean({description: "Use the service's network aliases"}),
    volume: Flags.string({char: 'v', description: 'Bind mount a volume', multiple: true}),
    'no-TTY': Flags.boolean({char: 'T', description: 'Disable pseudo-tty allocation'}),
    workdir: Flags.string({char: 'w', description: 'Working directory inside the container'}),
  }

  static args = {
    service: Args.string({description: 'Service name', required: true}),
    command: Args.string({description: 'Command to run', required: false}),
  }

  static strict = false // Allow passing through extra args

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Run)

    const compose = this.projectConfig.paths?.compose

    if (!compose) {
      this.error('No docker-compose file found. Run compile or switch first.')
    }

    // Build the command
    const cmdParts = ['run']

    if (flags.detach) cmdParts.push('-d')
    if (flags.name) cmdParts.push(`--name ${flags.name}`)
    if (flags.entrypoint) cmdParts.push(`--entrypoint ${flags.entrypoint}`)
    if (flags.user) cmdParts.push(`-u ${flags.user}`)
    if (flags['no-deps']) cmdParts.push('--no-deps')
    if (flags.rm) cmdParts.push('--rm')
    if (flags['service-ports']) cmdParts.push('--service-ports')
    if (flags['use-aliases']) cmdParts.push('--use-aliases')
    if (flags['no-TTY']) cmdParts.push('-T')
    if (flags.workdir) cmdParts.push(`-w ${flags.workdir}`)

    if (flags.env) {
      flags.env.forEach(e => cmdParts.push(`-e ${e}`))
    }
    if (flags.label) {
      flags.label.forEach(l => cmdParts.push(`-l ${l}`))
    }
    if (flags.publish) {
      flags.publish.forEach(p => cmdParts.push(`-p ${p}`))
    }
    if (flags.volume) {
      flags.volume.forEach(v => cmdParts.push(`-v ${v}`))
    }

    // Add service and remaining args
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
