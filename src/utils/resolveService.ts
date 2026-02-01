import {cosmiconfig} from 'cosmiconfig'
import {resolve} from 'path'
import get from 'lodash/get'
import deepmerge from 'deepmerge'
import type {DevctlConfig} from '../types/config'

// generate each services' docker compose config
export async function resolveService(project: DevctlConfig): Promise<any[]> {
  const serviceNames = project.current?.services || []
  const services: any[] = []

  for (const svcName of serviceNames) {
    let service = (project.services as any)[svcName]

    if (!service) {
      console.warn(`Service ${svcName} not found in config`)
      continue
    }

    // if there's no path, then it's the name of the folder
    if (!service.path) {
      service.path = svcName
    }

    service.path = resolve(project.cwd || '.', service.path)

    const search = await cosmiconfig('devconfig', {
      searchPlaces: [
        '.devconfig.yaml',
        '.devconfig.yml',
        '.devconfig.cjs',
        '.devconfig.js',
        '.devconfig.json',
      ],
    }).search(service.path)

    if (search === null) {
      console.log(`info: cannot find devconfig file for service ${svcName}, using empty default`)
      services.push(service)
      continue
    }

    // resolve each service
    for (const keyName of Object.keys(search.config)) {
      const config = search.config[keyName]

      // if it's a function, pass the whole project config
      if (typeof config === 'function') {
        service[keyName] = await config(project.current, project)
        continue
      }

      // if it reaches here, it's a YAML or JSON
      // we're going to merge stuff based on environments
      const defaultConfig = get(config, 'default', {})
      const envConfig = get(config, [project.current?.environment || 'default'], {})

      service[keyName] = deepmerge(defaultConfig, envConfig)
    }

    services.push(service)
  }

  return services
}
