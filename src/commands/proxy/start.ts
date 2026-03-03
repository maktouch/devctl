import {Command} from '@oclif/core'
import chalk from 'chalk'
import {startCaddy, isCaddyRunning} from '../../utils/caddy'

export default class ProxyStart extends Command {
  static description = 'Start the Caddy reverse proxy daemon'

  static examples = ['<%= config.bin %> proxy start']

  async run(): Promise<void> {
    if (await isCaddyRunning()) {
      this.log(chalk.yellow('Caddy proxy is already running.'))
      return
    }

    this.log('Starting Caddy proxy...')
    await startCaddy()
    this.log(chalk.green('Caddy proxy started.'))
  }
}
