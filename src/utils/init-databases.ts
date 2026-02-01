interface DatabaseEnvField {
  name: string
  message: string
  initial: string
}

interface DatabaseConfig {
  versions: string[]
  default: {
    defaultPort: number
    defaultMount: string
  }
  env: DatabaseEnvField[]
}

export const databases: Record<string, DatabaseConfig> = {
  mongo: {
    versions: ['3.4-xenial', '3.6-xenial', '4.0-xenial', '5.0', '6.0', '7.0'],
    default: {
      defaultPort: 27017,
      defaultMount: '/data/db',
    },
    env: [
      {
        name: 'MONGO_INITDB_ROOT_USERNAME',
        message: 'MONGO_INITDB_ROOT_USERNAME',
        initial: 'dev-user',
      },
      {
        name: 'MONGO_INITDB_ROOT_PASSWORD',
        message: 'MONGO_INITDB_ROOT_PASSWORD',
        initial: 'dev-password',
      },
    ],
  },
  mysql: {
    versions: ['5.6', '5.7', '8.0', '8.4', '9.0'],
    default: {
      defaultPort: 3306,
      defaultMount: '/var/lib/mysql',
    },
    env: [
      {
        name: 'MYSQL_ROOT_PASSWORD',
        message: 'MYSQL_ROOT_PASSWORD',
        initial: 'dev-root-password',
      },
      {
        name: 'MYSQL_DATABASE',
        message: 'MYSQL_DATABASE',
        initial: 'dev-database',
      },
      {
        name: 'MYSQL_USER',
        message: 'MYSQL_USER',
        initial: 'dev-user',
      },
      {
        name: 'MYSQL_PASSWORD',
        message: 'MYSQL_PASSWORD',
        initial: 'dev-password',
      },
    ],
  },
  postgres: {
    versions: ['12-alpine', '13-alpine', '14-alpine', '15-alpine', '16-alpine', '17-alpine'],
    default: {
      defaultPort: 5432,
      defaultMount: '/var/lib/postgresql/data',
    },
    env: [
      {
        name: 'POSTGRES_DB',
        message: 'POSTGRES_DB',
        initial: 'dev-database',
      },
      {
        name: 'POSTGRES_USER',
        message: 'POSTGRES_USER',
        initial: 'dev-user',
      },
      {
        name: 'POSTGRES_PASSWORD',
        message: 'POSTGRES_PASSWORD',
        initial: 'dev-password',
      },
    ],
  },
  redis: {
    versions: ['6-alpine', '7-alpine'],
    default: {
      defaultPort: 6379,
      defaultMount: '/data',
    },
    env: [],
  },
}
