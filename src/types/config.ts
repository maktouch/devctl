export interface ServicesConfigEntry {
  name: string;
  path: string;
  description?: string;
  notes?: string;
}

export interface EnvironmentConfigEntry {
  name: string;
  description: string;
}

export interface CommandConfigEntry {
  name: string;
  description?: string;
  handler: string;
}

export interface DevctlCurrent {
  services: string[];
  environment: string;
  dockerhost?: {
    address: string;
    interfaceName: string;
  }
}

export interface DevctlConfig {
  services?: ServicesConfigEntry[] | {[key: string]: ServicesConfigEntry};
  environment?: EnvironmentConfigEntry[] | {[key: string]: EnvironmentConfigEntry};
  commands?: CommandConfigEntry[];
  current?: Partial<DevctlCurrent>;
  cwd?: string;
  paths?: {
    [key: string]: string;
  };
}
