interface DockerHost {
  address: string
  interfaceName: string
}

/**
 * Get the Docker host address for containers to reach the host machine.
 * Modern Docker Desktop supports host.docker.internal which automatically
 * resolves to the host machine's IP address.
 */
export async function getDockerHost(_current?: any): Promise<DockerHost> {
  return {
    address: 'host.docker.internal',
    interfaceName: 'docker0',
  }
}
