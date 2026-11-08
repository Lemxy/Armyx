// MCP gateway: many MCP servers behind two tools, so their schemas stay out of the context until needed.
//   find_tool(query)            -> the best-matching tools with their full schemas (same ranking as the file graph)
//   call_tool(name, arguments)  -> runs it on the right server
// Config = the usual { "mcpServers": { name: { command, args, env } } }. Run: node --experimental-strip-types mcp/gateway.mjs <config.json>
// shortcut: stdio servers only (an HTTP/OAuth connector like Figma needs an HTTP client), upgrade when one is worth proxying.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { scoredHits } from '../src/deso.ts'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')).mcpServers ?? {}

// minimal JSON-RPC client for one child server
const connect = (name, { command, args = [], env = {} }) => {
  const p = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const pending = new Map()
  let id = 0
  createInterface({ input: p.stdout }).on('line', (l) => {
    try { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id) } catch {}
  })
  const call = (method, params) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${name}: ${method} timed out`)), 30000)
    pending.set(++id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result) })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const ready = call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'armyx-gateway', version: '0.1.0' } })
    .then(() => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'))
    .then(() => call('tools/list', {}))
  return { call, ready }
}

const servers = Object.fromEntries(Object.entries(config).map(([n, c]) => [n, connect(n, c)]))
const tools = new Map() // "server__tool" -> { server, tool }
await Promise.all(Object.entries(servers).map(async ([server, s]) => {
  try { for (const tool of (await s.ready).tools ?? []) tools.set(`${server}__${tool.name}`, { server, tool }) } catch (e) { console.error(`gateway: ${server} unavailable: ${e.message}`) }
}))
const notes = [...tools].map(([name, { tool }]) => ({ name, content: `?path:${name}\n?about:${(tool.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}\n` }))

const find = (query) => {
  const hits = scoredHits(notes, String(query)).slice(0, 5)
  // the ranking ignores words found in 40%+ of the tools, so a tiny or vague catalogue matches nothing: show the names instead
  if (!hits.length) return `no match; tools: ${[...tools.keys()].slice(0, 40).join(', ')}`
  return JSON.stringify(hits.map(({ note }) => { const { tool } = tools.get(note.name); return { name: note.name, description: tool.description, inputSchema: tool.inputSchema } }))
}
const run = async (name, args) => {
  const t = tools.get(name)
  if (!t) return { content: [{ type: 'text', text: `unknown tool ${name}; use find_tool first` }], isError: true }
  return servers[t.server].call('tools/call', { name: t.tool.name, arguments: args ?? {} })
}

const defs = [
  { name: 'find_tool', description: `Find a tool among ${tools.size} hidden ones by keywords; returns names, descriptions and input schemas. Call before call_tool.`, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'call_tool', description: 'Run a tool found with find_tool.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] } },
]
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', async (l) => {
  let m
  try { m = JSON.parse(l) } catch { return }
  if (m.method === 'initialize') reply(m.id, { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'armyx-gateway', version: '0.1.0' } })
  else if (m.method === 'tools/list') reply(m.id, { tools: defs })
  else if (m.method === 'tools/call') {
    const { name, arguments: a = {} } = m.params ?? {}
    try { reply(m.id, name === 'find_tool' ? { content: [{ type: 'text', text: find(a.query ?? '') }] } : name === 'call_tool' ? await run(a.name, a.arguments) : { content: [{ type: 'text', text: 'unknown tool' }], isError: true }) }
    catch (e) { reply(m.id, { content: [{ type: 'text', text: String(e.message) }], isError: true }) }
  } else if (m.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } }) + '\n')
})
