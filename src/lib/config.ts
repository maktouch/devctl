import {cosmiconfig} from 'cosmiconfig'
import {resolve, dirname} from 'path'
import keyBy from 'lodash/keyBy'
import {readYaml} from '../utils/yaml'
import type {DevctlConfig} from '../types/config'

export async function getProjectConfig(): Promise<DevctlConfig | null> {
  const search = await cosmiconfig('devctl', {
    searchPlaces: [
      '.devctl.json',
      '.devctl.yaml',
      '.devctl.yml',
      '.devctlrc.json',
      '.devctlrc.yaml',
      '.devctlrc.yml',
      'package.json',
    ],
  }).search()

  if (!search) {
    return null
  }

  const cwd = dirname(search.filepath)
  const paths = {
    project: search.filepath,
    compose: resolve(cwd, '.devctl-docker-compose.yaml'),
    current: resolve(cwd, '.devctl-current.yaml'),
    scripts: resolve(cwd, '.devctl-scripts.yaml'),
  }

  const project = search.config as DevctlConfig
  project.cwd = cwd
  project.paths = paths
  project.services = keyBy(project.services, 'name') as any
  project.environment = keyBy(project.environment, 'name') as any

  try {
    project.current = await readYaml(paths.current)
  } catch (err) {
    project.current = {}
  }

  return project
}
