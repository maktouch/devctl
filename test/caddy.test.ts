import {test, expect, describe} from 'vitest'
import {deriveConfigName, extractHostnames} from '../src/utils/caddy'

describe('deriveConfigName', () => {
  test('returns the hostname of a simple site block', () => {
    expect(deriveConfigName('myapp.localhost {\n\treverse_proxy :3000\n}\n')).toBe('myapp.localhost')
  })

  test('strips protocol, port, and path from the address', () => {
    expect(deriveConfigName('https://api.test:8443/v1 {\n}\n')).toBe('api.test')
  })

  test('takes the first address when several share a block', () => {
    expect(deriveConfigName('a.test, b.test {\n}\n')).toBe('a.test')
  })

  test('skips comments and blank lines before the site address', () => {
    expect(deriveConfigName('# managed by devctl\n\nsite.test {\n}\n')).toBe('site.test')
  })

  test('skips snippet definitions', () => {
    const content = '(common) {\n\tencode gzip\n}\n\nreal.test {\n\timport common\n}\n'
    expect(deriveConfigName(content)).toBe('real.test')
  })

  test('ignores braces nested inside a block', () => {
    const content = 'outer.test {\n\thandle {\n\t\trespond "inner.test {"\n\t}\n}\n'
    expect(deriveConfigName(content)).toBe('outer.test')
  })

  test('rejects wildcard and port-only addresses', () => {
    expect(deriveConfigName('* {\n}\n')).toBeNull()
    expect(deriveConfigName(':8080 {\n}\n')).toBeNull()
  })

  test('returns null when no site address exists', () => {
    expect(deriveConfigName('# just a comment\n')).toBeNull()
    expect(deriveConfigName('')).toBeNull()
  })
})

describe('extractHostnames', () => {
  test('collects every address of a shared block', () => {
    expect(extractHostnames('a.test, b.test {\n\treverse_proxy :3000\n}\n')).toEqual([
      'a.test',
      'b.test',
    ])
  })

  test('collects addresses across multiple site blocks', () => {
    const content = 'one.test {\n\trespond "1"\n}\n\ntwo.test {\n\trespond "2"\n}\n'
    expect(extractHostnames(content)).toEqual(['one.test', 'two.test'])
  })

  test('deduplicates repeated hostnames', () => {
    const content = 'dup.test {\n}\nhttp://dup.test:8080 {\n}\n'
    expect(extractHostnames(content)).toEqual(['dup.test'])
  })

  test('ignores wildcards, port-only addresses, and snippets', () => {
    const content = '(snippet) {\n}\n* {\n}\n:9999 {\n}\nkeep.test {\n}\n'
    expect(extractHostnames(content)).toEqual(['keep.test'])
  })

  test('returns an empty list for content without site blocks', () => {
    expect(extractHostnames('# nothing here\n')).toEqual([])
  })
})
