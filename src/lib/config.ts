import {cosmiconfig} from 'cosmiconfig'
import {resolve, dirname} from 'path'
import keyBy from 'lodash/keyBy'
import chalk from 'chalk'
import {readYaml} from '../utils/yaml'
import {detectLinkedWorktree} from './worktree'
import type {DevctlConfig} from '../types/config'

export const FORCE_IN_WORKTREE_ENV = 'DEVCTL_FORCE_IN_WORKTREE'

const SEARCH_PLACES = [
  '.devctl.json',
  '.devctl.yaml',
  '.devctl.yml',
  '.devctlrc.json',
  '.devctlrc.yaml',
  '.devctlrc.yml',
  'package.json',
]

function searchConfig(from?: string) {
  return cosmiconfig('devctl', {searchPlaces: SEARCH_PLACES}).search(from)
}

export interface GetProjectConfigOptions {
  /** Run against the current worktree even when it is not the main checkout */
  forceInWorktree?: boolean
}

export async function getProjectConfig(options: GetProjectConfigOptions = {}): Promise<DevctlConfig | null> {
  let search = await searchConfig()

  if (!search) {
    return null
  }

  const forceInWorktree = options.forceInWorktree ?? process.env[FORCE_IN_WORKTREE_ENV] === '1'

  if (!forceInWorktree) {
    const info = await detectLinkedWorktree(dirname(search.filepath))
    if (info) {
      const mainSearch = await searchConfig(info.mainCheckout)
      if (mainSearch) {
        process.stderr.write(
          chalk.yellow(
            `devctl: in worktree ${info.worktree}, using main checkout ${info.mainCheckout} ` +
              `(pass --force-in-worktree to stay here)\n`,
          ),
        )
        search = mainSearch
      } else {
        process.stderr.write(
          chalk.yellow(
            `devctl: in worktree ${info.worktree} but no devctl config found in main checkout ` +
              `${info.mainCheckout}; running here\n`,
          ),
        )
      }
    }
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
