import {test, expect, describe} from 'vitest'
import {EOL} from 'os'
import {parseEnv, stringifyToEnv} from '../src/utils/dotenv'

describe('parseEnv', () => {
  test('parses simple key=value pairs', () => {
    expect(parseEnv('FOO=bar\nBAZ=qux')).toEqual({FOO: 'bar', BAZ: 'qux'})
  })

  test('JSON-decodes quoted and numeric values', () => {
    const parsed = parseEnv('NAME="hello world"\nPORT=3000\nFLAG=true')
    expect(parsed.NAME).toBe('hello world')
    expect(parsed.PORT).toBe(3000)
    expect(parsed.FLAG).toBe(true)
  })

  test('keeps everything after the first = in the value', () => {
    expect(parseEnv('DATABASE_URL=mysql://user:pass@host:3306/db?a=1&b=2')).toEqual({
      DATABASE_URL: 'mysql://user:pass@host:3306/db?a=1&b=2',
    })
  })

  test('skips blank lines, comments without =, and rows with empty keys', () => {
    expect(parseEnv('\n# comment\n=nokey\nGOOD=1\n')).toEqual({GOOD: 1})
  })

  test('trims whitespace and carriage returns around keys and values', () => {
    expect(parseEnv('  KEY  =  value \r\nOTHER=2\r')).toEqual({KEY: 'value', OTHER: 2})
  })

  test('accepts a Buffer', () => {
    expect(parseEnv(Buffer.from('A=1'))).toEqual({A: 1})
  })

  test('last occurrence of a duplicated key wins', () => {
    expect(parseEnv('A=1\nA=2')).toEqual({A: 2})
  })
})

describe('stringifyToEnv', () => {
  test('writes one JSON-encoded value per line', () => {
    expect(stringifyToEnv({FOO: 'bar', PORT: 3000})).toBe(`FOO="bar"${EOL}PORT=3000`)
  })

  test('round-trips through parseEnv', () => {
    const original = {STR: 'hello world', NUM: 42, BOOL: false, URL: 'https://x.dev/a?b=c'}
    expect(parseEnv(stringifyToEnv(original))).toEqual(original)
  })

  test('empty object produces an empty string', () => {
    expect(stringifyToEnv({})).toBe('')
  })
})
