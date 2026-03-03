import {Command} from '@oclif/core'
import chalk from 'chalk'
import {reloadCaddy, isCaddyRunning} from '../../utils/caddy'

export default class ProxyReload extends Command {
  static description = 'Reload Caddy config (regenerates master Caddyfile)'

  static examples = ['<%= config.bin %> proxy reload']

  async run(): Promise<void> {
    if (!(await isCaddyRunning())) {
      this.error('Caddy proxy is not running. Start it first with: devctl proxy start')
    }

    this.log('Reloading Caddy proxy...')
    await reloadCaddy()
    this.log(chalk.green('Caddy proxy reloaded.'))
  }
}
