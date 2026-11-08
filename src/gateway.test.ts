import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'

const node = ['--experimental-strip-types', '--no-warnings']
const abs = (p: string) => new URL(p, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

describe('gateway', () => {
  it('hides a server behind find_tool and call_tool', async () => {
    const dir = mkdtempSync(`${tmpdir()}/gw-`)
    writeFileSync(`${dir}/cfg.json`, JSON.stringify({ mcpServers: Object.fromEntries(['alpha', 'beta', 'gamma'].map((n) => [n, { command: 'node', args: [...node, abs('../mcp/graph-server.mjs'), abs('../vault')] }])) }))
    const p = spawn('node', [...node, abs('../mcp/gateway.mjs'), `${dir}/cfg.json`], { stdio: ['pipe', 'pipe', 'inherit'] })
    const waiting = new Map<number, (m: any) => void>()
    createInterface({ input: p.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m) })
    let id = 0
    const rpc = (method: string, params: object = {}) => new Promise<any>((res) => { waiting.set(++id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    try {
      expect((await rpc('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['find_tool', 'call_tool'])
      const found = JSON.parse((await rpc('tools/call', { name: 'find_tool', arguments: { query: 'alpha files' } })).result.content[0].text)
      expect(found[0].name).toBe('alpha__find')
      expect(found[0].inputSchema.required).toEqual(['query'])
      // the hand-written vault notes have no ?path/?about, so the child answers "no match": enough to prove the call reached it
      const out = (await rpc('tools/call', { name: 'call_tool', arguments: { name: 'beta__find', arguments: { query: 'auth tokens' } } })).result.content[0].text
      expect(out).toBe('no match')
      expect((await rpc('tools/call', { name: 'find_tool', arguments: { query: 'zzz' } })).result.content[0].text).toContain('gamma__find')
      expect((await rpc('tools/call', { name: 'call_tool', arguments: { name: 'nope' } })).result.isError).toBe(true)
    } finally { p.kill() }
  }, 20000)
})

describe('readgate hook', () => {
  const gate = (tool_input: object) => spawnSync('node', [...node, abs('../mcp/claude-hook.mjs'), 'x', 'readgate'], { input: JSON.stringify({ tool_input }), encoding: 'utf8' }).stdout
  it('denies a whole-file Read of a big file only', () => {
    const big = abs('../package-lock.json')
    expect(gate({ file_path: big })).toContain('deny')
    expect(gate({ file_path: big, limit: 50 })).toBe('')
    expect(gate({ file_path: abs('../package.json') })).toBe('')
    expect(gate({ file_path: '/no/such/file' })).toBe('')
  })
})
