// Generates a small polyglot shop app for the cross-module bug benchmark: a Node server (route, rules and a shared money library per
// feature), a Python command-line client and a web (JavaScript) client per feature, and integration tests that start the server and
// call both clients. Server and clients meet only at an HTTP route string; the totals meet in one shared library. No dependencies.
//   node bench/gen-polyglot.mjs <out dir>
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2]
const FEATURES = 'orders invoices refunds shipments payroll coupons loyalty tickets reviews wallets'.split(' ')
const write = (p, s) => { mkdirSync(`${out}/${p.split('/').slice(0, -1).join('/')}`, { recursive: true }); writeFileSync(`${out}/${p}`, s) }
const roundMoney = (x) => Math.round(x * 100) / 100
const withTax = (x) => roundMoney(x * 1.2)
const cap = (s) => s[0].toUpperCase() + s.slice(1)

write('package.json', '{ "name": "polyglot-shop", "private": true, "type": "module" }\n')
write('server/lib/money.js', `// Money helpers shared by every feature of the server.
export const roundMoney = (x) => Math.round(x * 100) / 100
export const withTax = (x) => roundMoney(x * 1.2)
`)

const expected = {}
const items = (i) => Array.from({ length: 3 + (i % 2) }, (_, k) => ({ price: 4.35 + i * 1.1 + k * 2.15, qty: 1 + ((i + k) % 3) }))
const itemsText = []
FEATURES.forEach((f, i) => {
  const F = cap(f), thresh = [10, 15, 20, 25][i % 4], rate = [0.05, 0.1, 0.15][i % 3], list = items(i).map((x) => ({ price: roundMoney(x.price), qty: x.qty }))
  const subtotal = list.reduce((s, x) => s + x.price * x.qty, 0), discount = subtotal > thresh ? roundMoney(subtotal * rate) : 0
  expected[f] = { count: list.length, total: withTax(subtotal - discount) }
  itemsText.push(`  ${f}: ${JSON.stringify(list)},`)
  write(`server/lib/${f}_rules.js`, `// Business rules of the ${f} summary: subtotal, volume discount and the total with tax.
import { roundMoney, withTax } from './money.js'

export function summarize${F}(items) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const discount = subtotal > ${thresh} ? roundMoney(subtotal * ${rate}) : 0
  return {
    count: items.length,
    subtotal: roundMoney(subtotal),
    discount,
    total: withTax(subtotal - discount),
  }
}
`)
  write(`server/routes/${f}.js`, `// Route of the ${f} summary: GET /api/${f}/summary returns the totals of the stored ${f}.
import { summarize${F} } from '../lib/${f}_rules.js'
import { ITEMS } from '../data.js'

export function register(router) {
  router.get('/api/${f}/summary', () => summarize${F}(ITEMS.${f}))
}
`)
  write(`cli/${f}.py`, `"""Command-line view of the ${f} summary."""
import json
import urllib.request


def show(base):
    data = json.load(urllib.request.urlopen(f"{base}/api/${f}/summary"))
    return f"${f}: {data['count']} items, total {data['total']:.2f}"
`)
  write(`web/${f}.js`, `// Web page loader of the ${f} summary.
export async function load(base) {
  const response = await fetch(base + '/api/${f}/summary')
  const data = await response.json()
  return { label: '${f}', total: data.total, items: data.count }
}
`)
})
write('server/data.js', `// The stored items of every feature (fixed sample data).
export const ITEMS = {
${itemsText.join('\n')}
}
`)
write('server/app.js', `// The server: a tiny router over node:http, with one route file per feature.
import http from 'node:http'
${FEATURES.map((f) => `import { register as ${f} } from './routes/${f}.js'`).join('\n')}

export function startServer() {
  const routes = new Map()
  const router = { get: (path, handler) => routes.set(path, handler) }
  for (const register of [${FEATURES.join(', ')}]) register(router)
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const handler = routes.get(req.url)
      if (!handler) { res.statusCode = 404; return res.end('{}') }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(handler()))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}
`)
write('cli/main.py', `"""Command-line entry point: python cli/main.py <feature> <server url>."""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
print(importlib.import_module(sys.argv[1]).show(sys.argv[2]))
`)
write('tests/integration.test.js', `import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startServer } from '../server/app.js'

const EXPECTED = ${JSON.stringify(expected, null, 2)}
const server = await startServer()
const base = \`http://127.0.0.1:\${server.address().port}\`
after(() => server.close())

for (const [feature, want] of Object.entries(EXPECTED)) {
  test(\`\${feature}: web page\`, async () => {
    const { load } = await import(\`../web/\${feature}.js\`)
    assert.deepEqual(await load(base), { label: feature, total: want.total, items: want.count })
  })
  test(\`\${feature}: command line\`, async () => { // async on purpose: the server lives in this process and must keep answering
    const run = await promisify(execFile)('python', ['cli/main.py', feature, base])
    assert.equal(run.stdout.trim(), \`\${feature}: \${want.count} items, total \${want.total.toFixed(2)}\`)
  })
}
`)
console.log(`${FEATURES.length} features written to ${out}`)
