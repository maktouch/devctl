import {networkInterfaces, homedir} from 'os'
import getPort from 'get-port'
import flatten from 'lodash/flatten'
import get from 'lodash/get'
import Docker from 'dockerode'
import {createServer, Server} from 'http'
import {existsSync} from 'fs'
import {join} from 'path'
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)

const DOCKER_CURL = 'spotify/alpine:latest'

interface DeviceIP {
  address: string
  interfaceName: string
  reachable?: boolean
}

function listDeviceIps(): DeviceIP[] {
  const interfaces = networkInterfaces()

  return flatten(
    Object.keys(interfaces).map(interfaceName =>
      (interfaces[interfaceName] || [])
        // filter ipv6 and localhost
        .filter(i => (i.family === 'IPv4' || (i.family as any) === 4) && i.internal === false)
        // discard information we don't need
        .map(i => ({
          address: i.address,
          interfaceName,
        }))
    )
  )
}

function startServer(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const requestHandler = (_req: any, res: any) => {
      res.end('ok')
    }

    const server = createServer(requestHandler)

    server.listen(port, (err?: Error) => {
      if (err) {
        return reject(err)
      }

      resolve(server)
    })
  })
}

async function isIpReachableInsideDocker(ip: string, port: number): Promise<boolean> {
  const socketPath = (() => {
    if (existsSync('/var/run/docker.sock')) {
      return '/var/run/docker.sock'
    }

    const home = join(homedir(), '.docker', 'run', 'docker.sock')

    if (existsSync(home)) {
      return home
    }

    return undefined
  })()

  const docker = new Docker({socketPath})

  try {
    const [output] = await docker.run(DOCKER_CURL, ['curl', '-m', '1', `http://${ip}:${port}`])

    return get(output, 'StatusCode') === 0
  } catch (err) {
    return false
  }
}

async function getReachableIP(): Promise<DeviceIP | undefined> {
  console.log('Starting Docker IP Detection')

  try {
    await execAsync(`docker image inspect ${DOCKER_CURL}`)
    console.log(`✔ docker image ${DOCKER_CURL} already exists`)
  } catch (err) {
    console.log(`Fetching ${DOCKER_CURL} image`)
    await execAsync(`docker pull ${DOCKER_CURL}`)
  }

  const port = await getPort()
  console.log(`Starting dummy HTTP server on port ${port} and fetch IP`)
  const server = await startServer(port)

  // check the list, and ping inside of docker to see if it's reachable
  const deviceIps = listDeviceIps()
  const ips: DeviceIP[] = []

  for (const ip of deviceIps) {
    const reachable = await isIpReachableInsideDocker(ip.address, port)
    if (reachable) {
      ips.push({
        ...ip,
        reachable,
      })
    }
  }

  server.close()

  const ip = ips[0]
  const address = ip?.address

  if (address) {
    console.log(`✔ IP Reachable from inside Docker found: ${address}`)
  }

  return ip
}

export async function getDockerHost(current: any): Promise<DeviceIP | undefined> {
  const currentIp = get(current, 'dockerhost.address')

  // if there's no current IP, do the detection
  if (!currentIp) {
    return getReachableIP()
  }

  // if there's a saved one, make sure it still exists
  const filtered = listDeviceIps().filter(ip => ip.address === currentIp)

  return filtered[0] ? filtered[0] : getReachableIP()
}
