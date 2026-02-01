import {Args, Flags} from '@oclif/core'
import * as YAML from 'js-yaml'
import {writeFile} from 'fs/promises'
import get from 'lodash/get'
import inquirer from 'inquirer'
import {BaseCommand} from '../base-command'

export default class SwitchEnv extends BaseCommand {
  static description = 'Switch services and/or environment'

  static hidden = true

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SwitchEnv)

    const project = this.projectConfig

    // Ask which services to work on
    const allChoices = Object.values(project.services as any)
      .map((service: any) => ({
        name: service.name,
        value: service.name,
        category: service.category,
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

    const choices = allChoices.filter(c => c.category !== 'always')
    const choicesArray = choices.map(c => c.value)
    const always = allChoices.filter(c => c.category === 'always').map(c => c.value)

    const initial = get(project, 'current.services', []).filter((c: string) =>
      choicesArray.includes(c)
    )

    const {services: selectedServices} = await inquirer.prompt<{services: string[]}>([
      {
        type: 'checkbox',
        name: 'services',
        message: 'Which services do you want to work on?',
        choices: choices.map(c => ({name: c.name, value: c.value, checked: initial.includes(c.value)})),
      },
    ])

    const services = [...selectedServices, ...always]

    // Ask which environment
    let environment: string

    if (Object.values(project.environment as any).length === 1) {
      environment = (Object.values(project.environment as any)[0] as any).name
    } else {
      const envChoices = Object.values(project.environment as any).map((env: any) => ({
        name: `${env.name}${env.description ? ` - ${env.description}` : ''}`,
        value: env.name,
      }))

      const result = await inquirer.prompt<{environment: string}>([
        {
          type: 'list',
          name: 'environment',
          message: 'Which environment do you want to use?',
          choices: envChoices,
          default: get(project, 'current.environment', null),
        },
      ])

      environment = result.environment
    }

    const currentConfig = {
      services,
      environment,
      dockerhost: '',
    }

    await writeFile(project.paths!.current, YAML.dump(currentConfig))

    await this.config.runCommand('pull-secrets', [])
    await this.config.runCommand('compile', [])
  }
}
