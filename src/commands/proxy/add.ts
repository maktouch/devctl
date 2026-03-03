import {Command, Flags} from '@oclif/core'
import {readFile} from 'fs/promises'
import chalk from 'chalk'
import {addSiteConfig, isCaddyRunning, reloadCaddy} from '../../utils/caddy'

export default class ProxyAdd extends Command {
  static description = 'Add a Caddyfile site configuration'

  static examples = [
    '<%= config.bin %> proxy add --file mysite.caddy',
    'echo "app.local { reverse_proxy localhost:3000 }" | <%= config.bin %> proxy add',
  ]

  static flags = {
    file: Flags.string({
      description: 'Path to a Caddyfile snippet',
      char: 'f',
    }),
    name: Flags.string({
      description: 'Override the derived config name',
      char: 'n',
    }),
    reload: Flags.boolean({
      description: 'Automatically reload Caddy if it is running',
      default: true,
      allowNo: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProxyAdd)

    let content: string

    if (flags.file) {
      content = await readFile(flags.file, 'utf-8')
    } else if (!process.stdin.isTTY) {
      content = await this.readStdin()
    } else {
      this.error('Provide a Caddyfile via --file or pipe content via stdin.')
    }

    const name = await addSiteConfig(content.trim(), flags.name)
    this.log(`Added site config: ${chalk.cyan(name)}`)

    if (flags.reload && (await isCaddyRunning())) {
      this.log('Reloading Caddy...')
      await reloadCaddy()
      this.log(chalk.green('Caddy reloaded.'))
    }
  }

  private readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => {
        data += chunk
      })
      process.stdin.on('end', () => resolve(data))
      process.stdin.on('error', reject)
    })
  }
}
