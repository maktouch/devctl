import {Command} from '@oclif/core'
import chalk from 'chalk'
import Table from 'cli-table3'
import {isCaddyRunning, listSiteConfigs, MASTER_CADDYFILE} from '../../utils/caddy'

export default class Proxy extends Command {
  static description = 'Show status of the local Caddy reverse proxy'

  static examples = ['<%= config.bin %> proxy']

  async run(): Promise<void> {
    const running = await isCaddyRunning()

    this.log(`Caddy proxy: ${running ? chalk.green('running') : chalk.red('stopped')}`)
    this.log(`Config: ${chalk.gray(MASTER_CADDYFILE)}`)
    this.log('')

    const configs = await listSiteConfigs()

    if (configs.length === 0) {
      this.log('No sites registered. Use `devctl proxy add` to add one.')
      return
    }

    const table = new Table({
      head: ['Site', 'Hostnames'],
    })

    for (const config of configs) {
      table.push([config.name, config.hostnames.join(', ')])
    }

    this.log(table.toString())
  }
}
