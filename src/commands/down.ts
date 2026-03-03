import {Flags} from '@oclif/core'
import get from 'lodash/get'
import inquirer from 'inquirer'
import {BaseCommand} from '../base-command'
import {
  createDockerComposeCommand,
  getAllStates,
  composeFileExists,
  forceRemoveContainers,
  clearCurrentState,
  removeStateByComposePath,
} from '../utils/dockerCompose'

export default class Down extends BaseCommand {
  static description = 'Stops containers and removes containers, networks, volumes, and images created by "up"'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {
    this: Flags.boolean({
      description: 'Only tear down containers belonging to the current project',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Skip confirmation prompts and destroy stale containers automatically',
      default: false,
    }),
  }

  static args = {}

  public async run(): Promise<void> {
    const {flags} = await this.parse(Down)
    const currentCompose = get(this.projectConfig, 'paths.compose') as string | undefined

    const states = await getAllStates()

    if (states.length > 0) {
      for (const state of states) {
        const isSameProject = currentCompose && state.composePath === currentCompose
        const shouldSkip = flags.this && !isSameProject

        if (shouldSkip) continue

        const exists = await composeFileExists(state.composePath)

        if (exists) {
          const exec = createDockerComposeCommand(state.composePath)
          await exec({
            msg: `Shutting down ${state.composePath}`,
            cmd: 'down --remove-orphans',
          })
        } else if (state.containers.length > 0) {
          let shouldDestroy = flags.force

          if (!shouldDestroy) {
            const {confirm} = await inquirer.prompt<{confirm: boolean}>([
              {
                type: 'confirm',
                name: 'confirm',
                message: `The project at ${state.composePath} no longer exists. Destroy its docker containers?`,
                default: true,
              },
            ])
            shouldDestroy = confirm
          }

          if (shouldDestroy) {
            console.log('Removing orphaned containers...')
            await forceRemoveContainers(state.containers)
          }
        }

        await removeStateByComposePath(state.composePath)
      }
    }

    // Shut down current project instances (if not already handled above)
    if (currentCompose) {
      const alreadyHandled = states.some(s => s.composePath === currentCompose)
      if (!alreadyHandled) {
        const exists = await composeFileExists(currentCompose)
        if (exists) {
          const exec = createDockerComposeCommand(currentCompose)
          await exec({
            msg: 'Removing orphans container',
            cmd: 'down --remove-orphans',
          })
        }
      }
    }
  }
}
