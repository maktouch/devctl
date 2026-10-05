//! Database presets offered by `devctl init`.

pub struct DatabaseEnvField {
    pub name: &'static str,
    pub initial: &'static str,
}

pub struct DatabaseConfig {
    pub name: &'static str,
    pub versions: &'static [&'static str],
    pub default_port: u16,
    pub default_mount: &'static str,
    pub env: &'static [DatabaseEnvField],
}

pub const DATABASES: [DatabaseConfig; 4] = [
    DatabaseConfig {
        name: "mongo",
        versions: &[
            "3.4-xenial",
            "3.6-xenial",
            "4.0-xenial",
            "5.0",
            "6.0",
            "7.0",
        ],
        default_port: 27017,
        default_mount: "/data/db",
        env: &[
            DatabaseEnvField {
                name: "MONGO_INITDB_ROOT_USERNAME",
                initial: "dev-user",
            },
            DatabaseEnvField {
                name: "MONGO_INITDB_ROOT_PASSWORD",
                initial: "dev-password",
            },
        ],
    },
    DatabaseConfig {
        name: "mysql",
        versions: &["5.6", "5.7", "8.0", "8.4", "9.0"],
        default_port: 3306,
        default_mount: "/var/lib/mysql",
        env: &[
            DatabaseEnvField {
                name: "MYSQL_ROOT_PASSWORD",
                initial: "dev-root-password",
            },
            DatabaseEnvField {
                name: "MYSQL_DATABASE",
                initial: "dev-database",
            },
            DatabaseEnvField {
                name: "MYSQL_USER",
                initial: "dev-user",
            },
            DatabaseEnvField {
                name: "MYSQL_PASSWORD",
                initial: "dev-password",
            },
        ],
    },
    DatabaseConfig {
        name: "postgres",
        versions: &[
            "12-alpine",
            "13-alpine",
            "14-alpine",
            "15-alpine",
            "16-alpine",
            "17-alpine",
        ],
        default_port: 5432,
        default_mount: "/var/lib/postgresql/data",
        env: &[
            DatabaseEnvField {
                name: "POSTGRES_DB",
                initial: "dev-database",
            },
            DatabaseEnvField {
                name: "POSTGRES_USER",
                initial: "dev-user",
            },
            DatabaseEnvField {
                name: "POSTGRES_PASSWORD",
                initial: "dev-password",
            },
        ],
    },
    DatabaseConfig {
        name: "redis",
        versions: &["6-alpine", "7-alpine"],
        default_port: 6379,
        default_mount: "/data",
        env: &[],
    },
];

pub fn find(name: &str) -> Option<&'static DatabaseConfig> {
    DATABASES.iter().find(|db| db.name == name)
}
