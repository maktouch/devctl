import {Command} from '@oclif/core'
import chalk from 'chalk'
import {startCaddy, isCaddyRunning, checkPortInUse} from '../../utils/caddy'

export default class ProxyStart extends Command {
  static description = 'Start the Caddy reverse proxy daemon'

  static examples = ['<%= config.bin %> proxy start']

  async run(): Promise<void> {
    if (await isCaddyRunning()) {
      this.log(chalk.yellow('Caddy proxy is already running.'))
      return
    }

    this.log('Starting Caddy proxy...')
    try {
      await startCaddy()
      this.log(chalk.green('Caddy proxy started.'))
    } catch {
      const conflicts: string[] = []
      for (const port of [80, 443]) {
        const proc = await checkPortInUse(port)
        if (proc) conflicts.push(`  Port ${port}: ${proc}`)
      }

      if (conflicts.length > 0) {
        this.error(
          `Caddy failed to start. The following ports are already in use:\n${conflicts.join('\n')}`,
        )
      } else {
        this.error('Caddy failed to start. Check the Caddy logs for details.')
      }
    }
  }
}
