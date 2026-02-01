import * as YAML from 'js-yaml'
import {readFile} from 'fs/promises'

export async function readYaml(path: string): Promise<any> {
  try {
    const raw = await readFile(path, 'utf-8')
    if (!raw) {
      return null
    }
    return YAML.load(raw)
  } catch (error) {
    throw error
  }
}

export async function writeYaml(path: string, data: any): Promise<void> {
  const {writeFile} = await import('fs/promises')
  const content = YAML.dump(data)
  await writeFile(path, content, 'utf-8')
}
