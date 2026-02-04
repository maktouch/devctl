import type {DevctlConfig} from './config'

export interface CustomCommandPayload {
  args: string[]
  argv: string[]
  command: string
  cwd: string
  config: DevctlConfig
  project: DevctlConfig
}
