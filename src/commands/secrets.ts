import {Args, Flags} from '@oclif/core'
import {writeFile} from 'fs/promises'
import {BaseCommand} from '../base-command'
import type {SecretsProviderEntry} from '../types/config'

export default class Secrets extends BaseCommand {
  static description = 'Populate secrets'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Secrets)

    console.log('Running pull-secrets')
    const {initSecretsProvider} = await import('../lib/secrets')
    const config = this.projectConfig
    const {secrets, current} = config

    if (!current || !current.environment) {
      // if current isn't set, run switch, then rerun pull secrets
      console.log(".devctl-current.yaml doesn't exist, creating...")
      await this.config.runCommand('switch-current', [])
      return this.config.runCommand('pull-secrets', [])
    }

    const {environment} = current

    // Check if secrets is configured.
    if (!secrets) {
      console.log('No `secrets` configured.')
      return
    }

    const populatedSecrets: any = {}

    for (const secret of secrets) {
      const {prefix} = secret
      console.log(`Processing prefix \`${prefix}\`...`)
      const secretsProvider = await initSecretsProvider(secret, config)
      console.log(`Authenticating prefix \`${prefix}\`...`)
      await secretsProvider.authenticate()

      populatedSecrets[prefix] = await secretsProvider.fetch(environment)

      console.log(`Generating secrets for prefix \`${prefix}\`...`)
      await secretsProvider.generate(environment)
    }

    await writeFile(config.paths!.secrets, JSON.stringify(populatedSecrets, null, 2))
  }
}
