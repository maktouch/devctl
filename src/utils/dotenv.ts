import {EOL} from 'os'

export function stringifyToEnv(obj: Record<string, any>): string {
  return Object.keys(obj)
    .map(name => `${name}=${JSON.stringify(obj[name])}`)
    .join(EOL)
}

export function parseEnv(env: string | Buffer): Record<string, any> {
  const obj: Record<string, any> = {}

  try {
    // Use \n since it's present for both *nix and windows .envs.
    // trim later to remove \r if needed
    const EOL = '\n'

    const props = env.toString().split(EOL)

    props.forEach((row = '') => {
      const idx = row.indexOf('=')
      if (idx === -1) {
        return
      }

      const key = row.substring(0, idx).trim()
      if (!key) {
        return
      }

      const rawVal = row.substring(idx + 1).trim()

      try {
        obj[key] = JSON.parse(rawVal)
      } catch (e) {
        obj[key] = rawVal
      }
    })
  } catch (e) {
    // noop
  }

  return obj
}
