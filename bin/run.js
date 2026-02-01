#!/usr/bin/env node

const path = require('path')

// Support Yarn PnP
const pnpFile = path.join(__dirname, '..', '.pnp.cjs')
if (require('fs').existsSync(pnpFile)) {
  require(pnpFile).setup()
}

const {execute} = require('@oclif/core')

execute({development: false, dir: __dirname})
