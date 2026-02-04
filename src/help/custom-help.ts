import {Help} from '@oclif/core'

import {getProjectConfig} from '../lib/config'

export default class CustomHelp extends Help {
  protected async showRootHelp(): Promise<void> {
    await super.showRootHelp()

    const project = await getProjectConfig()
    const commands = project?.commands ?? []

    if (commands.length > 0) {
      const body = this.renderList(
        commands.map(cmd => [cmd.name, cmd.description ?? '']),
        {indentation: 2, stripAnsi: this.opts.stripAnsi},
      )
      this.log(this.section('CUSTOM COMMANDS', body))
      this.log('')
    }
  }
}
