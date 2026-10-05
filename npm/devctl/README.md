# @maktouch/devctl

Easily start developing in monorepos with docker-compose.

This package ships a native binary (written in Rust) for macOS and Linux,
x64 and arm64. The right binary is selected automatically through an
optionalDependency; the `devctl` command is a thin launcher.

```sh
pnpm add -g @maktouch/devctl
devctl init
devctl switch
```

Documentation: https://github.com/maktouch/devctl
