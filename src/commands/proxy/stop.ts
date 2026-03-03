import {Command} from '@oclif/core'
import chalk from 'chalk'
import {stopCaddy, isCaddyRunning} from '../../utils/caddy'

export default class ProxyStop extends Command {
  static description = 'Stop the Caddy reverse proxy daemon'

  static examples = ['<%= config.bin %> proxy stop']

  async run(): Promise<void> {
    if (!(await isCaddyRunning())) {
      this.log(chalk.yellow('Caddy proxy is not running.'))
      return
    }

    await stopCaddy()
    this.log(chalk.green('Caddy proxy stopped.'))
  }
}
