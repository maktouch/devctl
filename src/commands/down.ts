import {Flags} from '@oclif/core'
import get from 'lodash/get'
import inquirer from 'inquirer'
import {BaseCommand} from '../base-command'
import {
  createDockerComposeCommand,
  getLastState,
  composeFileExists,
  forceRemoveContainers,
  clearCurrentState,
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

    // Handle previous instances from ~/.devctl-current
    const lastState = await getLastState()

    if (lastState) {
      const isSameProject = currentCompose && lastState.composePath === currentCompose
      const shouldSkip = flags.this && !isSameProject

      if (!shouldSkip) {
        const exists = await composeFileExists(lastState.composePath)

        if (exists) {
          // Normal path: compose file exists, use docker compose down
          const exec = createDockerComposeCommand(lastState.composePath)
          await exec({
            msg: 'Shutting down previous instances',
            cmd: 'down --remove-orphans',
          })
        } else if (lastState.containers.length > 0) {
          // Stale path: compose file was deleted, but we have tracked container IDs
          let shouldDestroy = flags.force

          if (!shouldDestroy) {
            const {confirm} = await inquirer.prompt<{confirm: boolean}>([
              {
                type: 'confirm',
                name: 'confirm',
                message: `The project at ${lastState.composePath} no longer exists. Destroy its docker containers?`,
                default: true,
              },
            ])
            shouldDestroy = confirm
          }

          if (shouldDestroy) {
            console.log('Removing orphaned containers...')
            await forceRemoveContainers(lastState.containers)
          }
        }
      }

      await clearCurrentState()
    }

    // Shut down current project instances (if not already handled above)
    if (currentCompose) {
      const alreadyHandled = lastState?.composePath === currentCompose
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
