import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {removeSiteConfig, isCaddyRunning, reloadCaddy} from '../../utils/caddy'

export default class ProxyRemove extends Command {
  static description = 'Remove a site configuration by name'

  static examples = ['<%= config.bin %> proxy remove app.local']

  static args = {
    name: Args.string({
      description: 'The site config name (usually the primary hostname)',
      required: true,
    }),
  }

  static flags = {
    reload: Flags.boolean({
      description: 'Automatically reload Caddy if it is running',
      default: true,
      allowNo: true,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProxyRemove)

    const removed = await removeSiteConfig(args.name)

    if (!removed) {
      this.error(`Site config "${args.name}" not found.`)
    }

    this.log(`Removed site config: ${chalk.cyan(args.name)}`)

    if (flags.reload && (await isCaddyRunning())) {
      this.log('Reloading Caddy...')
      await reloadCaddy()
      this.log(chalk.green('Caddy reloaded.'))
    }
  }
}
