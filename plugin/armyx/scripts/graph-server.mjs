// Minimal MCP server (stdio, JSON-RPC): one tool, find(query) = the best-matching files for a question.
// The link tools (neighbors, impact, outline) and the editing tools (show, patch) were removed: in every benchmark here the agent
// rarely used them, and when told to, it read more files and cost more (see README).
// Run: node --experimental-strip-types mcp/graph-server.mjs <graph dir>
import { createInterface } from 'node:readline'
import { scoredHits } from './deso.ts'
import { loadNotes } from './load.mjs'

const dir = process.argv[2]
const notes = loadNotes(dir)
const prop = (n, k) => n.content.match(new RegExp(`^\\?${k}:\\s*(.+)$`, 'm'))?.[1].trim()
const line = (n) => [prop(n, 'path') ?? n.name, prop(n, 'about')?.slice(0, 90)].filter(Boolean).join(' — ')

const find = (query) => scoredHits(notes, String(query)).slice(0, 10).map((h) => line(h.note)).join('\n') || 'no match'

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', (l) => {
  let m
  try { m = JSON.parse(l) } catch { return }
  if (m.method === 'initialize') reply(m.id, { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'armyx-graph', version: '0.2.0' } })
  else if (m.method === 'tools/list') reply(m.id, { tools: [{ name: 'find', description: 'Best-matching files for a question or keywords (file path and one-line purpose).', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] })
  else if (m.method === 'tools/call') {
    const ok = m.params?.name === 'find'
    reply(m.id, { content: [{ type: 'text', text: ok ? find(m.params.arguments?.query ?? '') : 'unknown tool' }], isError: !ok })
  } else if (m.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } }) + '\n')
})
