import {Args, Flags} from '@oclif/core'
import {dirname, join} from 'path'
import {mkdir, writeFile, readFile} from 'fs/promises'
import inquirer from 'inquirer'
import chalk from 'chalk'
import * as ejs from 'ejs'
import {Command} from '@oclif/core'
import {databases} from '../utils/init-databases'

export default class Init extends Command {
  static description = 'Initialize projects and services for devctl'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {}

  static args = {}

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)

    this.log(chalk.cyan('Welcome to DevCTL!'))
    this.log(
      'This command will help you setup a basic devctl project. Advanced users will need to deep dive into the YAML files generated, and/or generate new ones.'
    )
    this.log('')

    const {dbs} = await inquirer.prompt<{dbs: string[]}>([
      {
        type: 'checkbox',
        name: 'dbs',
        message:
          'Select which databases you need locally. If you need something different, just choose one and modify its file afterward.',
        choices: ['mongo', 'mysql', 'postgres', 'redis'],
        validate: (input: string[]) => {
          if (input.length === 0) {
            return 'Please select at least one database'
          }
          return true
        },
      },
    ])

    const response: any[] = []

    for (const database of dbs) {
      const {version} = await inquirer.prompt<{version: string}>([
        {
          type: 'list',
          name: 'version',
          message: `Choose a version for ${chalk.yellow(database)}`,
          choices: databases[database].versions,
        },
      ])

      let env: Record<string, string> = {}

      if (databases[database].env.length > 0) {
        const envAnswers = await inquirer.prompt(
          databases[database].env.map(field => ({
            type: 'input',
            name: field.name,
            message: field.message,
            default: field.initial,
          }))
        )
        env = envAnswers
      }

      const target = `.devctl/${database}/.devconfig.yaml`
      const templatePath = join(__dirname, '..', 'templates', 'database.devconfig.yaml.ejs')

      const props = {
        ...databases[database].default,
        targetDir: dirname(target),
        database,
        version,
        env,
      }

      // Read and render template
      const templateContent = await readFile(templatePath, 'utf-8')
      const rendered = ejs.render(templateContent, props)

      // Ensure directory exists
      await mkdir(dirname(target), {recursive: true})

      // Write file
      await writeFile(target, rendered)

      this.log(`${chalk.cyan(target)} written.`)

      response.push({
        template: 'database.devconfig.yaml.ejs',
        target,
        props,
      })
    }

    // Generate .devctl.yaml
    const devctlTemplatePath = join(__dirname, '..', 'templates', 'devctl.yaml.ejs')
    const devctlTemplate = await readFile(devctlTemplatePath, 'utf-8')
    const devctlRendered = ejs.render(devctlTemplate, {values: response})
    await writeFile('.devctl.yaml', devctlRendered)

    this.log(`${chalk.cyan('.devctl.yaml')} written.`)

    // Generate .gitignore
    const gitignoreTemplatePath = join(__dirname, '..', 'templates', '.gitignore.ejs')
    const gitignoreTemplate = await readFile(gitignoreTemplatePath, 'utf-8')
    const gitignoreRendered = ejs.render(gitignoreTemplate, {values: response})
    await writeFile('.gitignore', gitignoreRendered)

    this.log(`${chalk.cyan('.gitignore')} written.`)

    this.log('')
    this.log(chalk.green('Your project has been successfully bootstrapped!'))
    this.log(`Please add these files in ${chalk.cyan('.gitignore')}:`)
    this.log(`  - .devctl-current.yaml ${chalk.gray('(This is your current state)')}`)
    this.log(`  - .devctl-docker-compose.yaml ${chalk.gray('(This is your generated docker-compose file)')}`)
    this.log(`  - .devctl/data ${chalk.gray('(This is where your databases will save state)')}`)
    this.log('')
    this.log(chalk.green(`You can now run ${chalk.cyan('devctl switch')} in this folder.`))
  }
}
