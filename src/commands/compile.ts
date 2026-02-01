import {Args, Flags} from '@oclif/core'
import * as YAML from 'js-yaml'
import {resolve} from 'path'
import {readFile, writeFile, access} from 'fs/promises'
import deepmerge from 'deepmerge'
import get from 'lodash/get'
import {BaseCommand} from '../base-command'
import {stringifyToEnv, parseEnv} from '../utils/dotenv'
import {resolveService} from '../utils/resolveService'

const flatten = (arr: any[]) => [].concat(...arr).filter(a => !!a)

export default class Compile extends BaseCommand {
  static description = 'Compile docker-compose.yaml and .env files from service configurations'

  static hidden = true

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Compile)

    // expand services by reading each services' config
    const services = await resolveService(this.projectConfig)

    let finalDockerCompose: any = {}

    // Process each service
    for (const service of services) {
      const {compose, dotenv, path} = service

      // compile the final docker-compose
      finalDockerCompose = deepmerge(finalDockerCompose, compose || {})

      if (!dotenv) {
        continue
      }

      const dotenvPath = resolve(path, '.env')

      let finalDotEnv: any = {}

      // Read existing .env if it exists
      try {
        await access(dotenvPath)
        const raw = await readFile(dotenvPath, 'utf-8')
        finalDotEnv = parseEnv(raw)
      } catch (err) {
        // File doesn't exist, use empty object
      }

      finalDotEnv = {
        ...finalDotEnv,
        ...dotenv,
      }

      await writeFile(dotenvPath, stringifyToEnv(finalDotEnv))
    }

    // Collect scripts
    const afterSwitch = services
      .map(service => {
        const {afterSwitch = {}, name} = service
        const scripts = Object.values(afterSwitch)
        if (scripts.length === 0) {
          return null
        }

        return {
          name,
          scripts,
        }
      })
      .filter(Boolean)

    const start = services
      .map(service => {
        const {start = {}, name} = service
        const scripts = Object.values(start)
        if (scripts.length === 0) {
          return null
        }

        return {
          name,
          scripts,
        }
      })
      .filter(Boolean)

    const scriptsPath = get(this.projectConfig, 'paths.scripts')
    await writeFile(
      scriptsPath,
      YAML.dump({
        afterSwitch: flatten(afterSwitch),
        start: flatten(start),
      })
    )

    // Handle proxy configuration
    if (get(this.projectConfig, 'proxy.enabled', false)) {
      const dockerhost = get(this.projectConfig, 'current.dockerhost.address')

      const routes: any = {}

      get(this.projectConfig, 'current.services', [])
        .map((svc: string) => {
          return get(this.projectConfig, ['services', svc, 'proxy'])
        })
        .filter((i: any) => !!i)
        .forEach((proxies: any) => {
          proxies.forEach((proxy: any) => {
            const {port, protocol = 'http', paths} = proxy

            paths.forEach((path: string) => {
              routes[path] = `${protocol}://${dockerhost}:${port}`
            })
          })
        })

      const proxy: any = get(this.projectConfig, 'proxy') || {}

      if (get(this.projectConfig, 'proxy.ssl.key')) {
        if (!proxy.ssl) proxy.ssl = {}
        proxy.ssl.key = await readFile(
          resolve(get(this.projectConfig, 'cwd') || '.', get(this.projectConfig, 'proxy.ssl.key')),
          'utf-8'
        )
      }

      if (get(this.projectConfig, 'proxy.ssl.cert')) {
        if (!proxy.ssl) proxy.ssl = {}
        proxy.ssl.cert = await readFile(
          resolve(get(this.projectConfig, 'cwd') || '.', get(this.projectConfig, 'proxy.ssl.cert')),
          'utf-8'
        )
      }

      const httpPort = get(this.projectConfig, 'proxy.httpPort', 80)

      const environment = {
        DEVCTL_PROXY: JSON.stringify(
          {
            routes,
            proxy,
          },
          null,
          2
        ),
      }

      const ports = [`${httpPort}:${httpPort}`]

      if (get(this.projectConfig, 'proxy.ssl.cert') && get(this.projectConfig, 'proxy.ssl.key')) {
        const httpsPort = get(this.projectConfig, 'proxy.httpsPort', 443)
        ports.push(`${httpsPort}:${httpsPort}`)
      }

      finalDockerCompose['devctl-proxy'] = {
        image: 'splitmedialabs/devctl-proxy:latest',
        restart: 'always',
        ports,
        environment,
      }
    }

    // Check if we need to add a services key.
    const dockerComposeToWrite = finalDockerCompose.services
      ? finalDockerCompose
      : {services: finalDockerCompose}

    // write the final docker-compose to a file in the cwd
    const composePath = get(this.projectConfig, 'paths.compose')
    await writeFile(composePath, YAML.dump(dockerComposeToWrite))
  }
}
