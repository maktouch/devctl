#!/usr/bin/env node
import {execute} from '@oclif/core'

export async function run(argv?: string[] | string): Promise<void> {
  // For backward compatibility, if called with a single command name string
  // convert it to array format
  const args = argv ? (typeof argv === 'string' ? [argv] : argv) : process.argv.slice(2)

  await execute({args, development: false, dir: __dirname})
}

// If run directly (not imported), execute
if (require.main === module) {
  run()
}
