# DevCTL

[![asciicast](https://asciinema.org/a/AXypjq8FmtdsmCFLWwHPoOL0f.svg)](https://asciinema.org/a/AXypjq8FmtdsmCFLWwHPoOL0f)

DevCTL is a CLI app designed to:

- start docker-compose presets for easier onboarding and project switching
- customize what to run depending on what you're working on
- run everything through a local HTTPS proxy for easy HTTPS development
- heavily configurable and extensible using NodeJS

## Requirements

- Docker
- Docker Compose V2
- Node.js 18+ (only needed to install via npm and for JavaScript-based custom commands / `.devconfig.js` files)

## Technology Stack

devctl is a single native binary written in **Rust**, distributed through npm
(prebuilt binaries for macOS and Linux, x64 and arm64). JavaScript extension
points (`.devconfig.cjs`/`.js` files and JS custom-command handlers) still
work; they are executed through Node.

## What DevCTL is useful for

- You have a frontend team that prefers to use the staging environment as their backend, so they don't need the API running
- You have a backend team that needs to run MySQL and Redis locally so they can test migrations and new endpoints
- You have a fullstack integration team that requires both frontend and backend to run on their machine, but they don't want to run MySQL, they prefer to use the shared Dev MySQL on the office servers
- You switch between projects back and forth, and they all have their own services to run, and they collide in ports.
- You have a new guy to onboard fast.

DevCTL decreases the onboarding time of new devs in any of our projects. All the new users needs to have installed is docker (with docker compose V2) and Node.js (to install devctl via npm). Once a project is setup with devctl, its users does not require knowledge of docker.

## What DevCTL is **NOT**

- It is not a thick layer on docker compose. It's a tool to switch "presets" of services. For advanced use cases, you still need to know how docker compose and its networking components works. For simple use cases, the CLI generators should be enought to help you. **If you don't understand docker compose, this project will most likely make it more confusing.**
- The docker-compose.yaml files that it generates are not meant to be used in production.

## Getting Started

```bash
# Install globally
pnpm add -g @maktouch/devctl
# or
npm install -g @maktouch/devctl

# Initialize a new project
devctl init

# Switch services and start
devctl switch

# View available commands
devctl --help
```

## Available Commands

- `devctl init` - Initialize a new devctl project with database presets
- `devctl switch` - Interactively select services and environment, then start alongside other running projects
- `devctl up` - Start selected services alongside other running projects
- `devctl up --no-merge` - Stop other tracked projects before starting selected services
- `devctl down` - Stop and remove containers for the current project
- `devctl down --all` - Stop and remove containers for all tracked projects
- `devctl status` - View current configuration
- `devctl logs` - View container logs
- `devctl exec` - Execute commands in running containers
- `devctl run` - Run one-off commands
- `devctl secrets` - Pull secrets from configured providers
- `devctl compile` - Generate docker-compose.yaml (advanced)

## Git Worktrees

A devctl project is one shared dev stack: containers, ports and the proxy are the same no matter which checkout you run from. To avoid several worktrees fighting over that stack, devctl detects when it is run inside a linked git worktree (`git worktree add`) and transparently runs against the main checkout instead. It prints a notice on stderr when it does so.

If you really want an isolated stack for a worktree, pass `--force-in-worktree` to any command:

```bash
devctl switch --force-in-worktree
```

### Custom commands in worktrees

Custom commands (the `commands:` section of `.devctl.yaml`) are **not** redirected. They are per-checkout by nature: a `dev` command starts *this* worktree's dev servers, a `url` command prints *this* worktree's URL. devctl resolves the handler from the checkout you ran it in and executes it with that checkout as `cwd`. The handler receives that checkout's config as `config` / `project`, exactly as in devctl 7.

Handlers that need the shared stack get it as an extra `shared` field on the payload. It is the main checkout's config when run from a worktree, and the same object as `config` otherwise.

If the checkout you are in does not define the handler file (for example an older branch), devctl falls back to the main checkout's handler and `cwd`, and says so on stderr.

`--force-in-worktree` is accepted by custom commands too. It is stripped before the remaining arguments reach the handler.

## Custom Commands (JavaScript Example)

Define a custom command in `.devctl.yaml` and implement the handler as an
executable script, a shell script, or a JavaScript module. JS module handlers
are executed through Node and receive a payload object. (TypeScript handlers
work too on Node 22.18+, which strips types natively.)

```yaml
# .devctl.yaml
commands:
  - name: setup-ssl
    description: Generate local SSL certificates using mkcert
    handler: .devctl/commands/setup-ssl
```

```js
// .devctl/commands/setup-ssl/index.js
module.exports = async function setupSsl({ command, cwd, config, args }) {
  console.log("Command:", command);
  console.log("Running in:", cwd);
  console.log("Has config:", Boolean(config));
  console.log("Args:", args);
};
```

## Development

```bash
cargo build --release   # binary at target/release/devctl
cargo test              # full test suite
cargo fmt && cargo clippy --all-targets
```

Releases are automated: pushing to `master` with a new `version` in
`Cargo.toml` builds binaries for all platforms and publishes
`@maktouch/devctl` (plus its platform packages) to npm. See
`.github/workflows/release-rust.yml`.

## Documentation

### Guides

- [HTTPS Proxy Setup](./docs/https-proxy.md) - Complete guide to setting up local HTTPS development with the DevCTL proxy

### References

- [Configuration Reference](./docs/readme.md) - `.devctl.yaml` and `.devconfig.yaml` documentation
