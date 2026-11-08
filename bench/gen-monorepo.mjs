// Generates a noisy monorepo for the bug-fix benchmark: 60 small services that all define the same function names
// (handleEvent, processItem), share three helper libraries, and are wired by one routing table. Tests use node:test, no dependencies.
//   node bench/gen-monorepo.mjs <out dir>
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2]
const DOMAINS = 'invoice refund shipment payroll subscription chargeback tax coupon loyalty warehouse returns ledger payout escrow deposit withdrawal billing quote order cart catalog inventory supplier customer support ticket survey review referral affiliate commission rebate voucher giftcard wallet transfer exchange remittance audit compliance fraud risk credit loan mortgage insurance claim premium pension dividend bond equity futures option swap treasury budget expense license rental booking tuition'.split(' ')
const write = (p, s) => { mkdirSync(`${out}/${p.split('/').slice(0, -1).join('/')}`, { recursive: true }); writeFileSync(`${out}/${p}`, s) }
const roundMoney = (x) => Math.round(x * 100) / 100
const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi))
const cap = (s) => s[0].toUpperCase() + s.slice(1)

write('package.json', '{ "name": "noisy-monorepo", "private": true, "type": "module" }\n')
write('shared/money.js', `// Money helpers shared by every service.
export const roundMoney = (x) => Math.round(x * 100) / 100
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi))
`)
write('shared/ids.js', `// Identifier format shared by every service: lower-case name, dash, four digits.
export const isValidId = (id) => /^[a-z]+-\\d{4}$/.test(String(id))
`)
write('shared/dates.js', `// Date helpers shared by services that charge late fees.
export const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000)
`)

const imports = [], routes = [], routeTests = []
DOMAINS.forEach((d, i) => {
  const D = d.toUpperCase(), rate = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04][i % 7], max = 1000 * (3 + (i % 9)), fixed = i % 2 ? 0 : [0.25, 0.5, 0.75][i % 3]
  const late = i % 5 === 0, lateRate = 1.5 + (i % 4) * 0.5
  const amount = [123.45, 77.77, 250.5, 19.99, 333.33, 41.41, 987.65].find((a) => { const v = clamp(a, 0, max) * rate + fixed; return Math.round(v * 100) !== Math.floor(v * 100 + 1e-9) }) ?? 123.45
  const fee = roundMoney(clamp(amount, 0, max) * rate + fixed), capped = roundMoney(clamp(max * 3, 0, max) * rate + fixed)
  write(`services/${d}/config.js`, `// Tuning constants of the ${d} service.
export const ${D}_FEE_RATE = ${rate}
export const ${D}_MAX_AMOUNT = ${max}
export const ${D}_FIXED_FEE = ${fixed}
${late ? `export const ${D}_LATE_RATE = ${lateRate}\n` : ''}`)
  write(`services/${d}/handler.js`, `// ${cap(d)} events: validates the item and computes the ${d} fee.
import { clamp, roundMoney } from '../../shared/money.js'
import { isValidId } from '../../shared/ids.js'
${late ? "import { daysBetween } from '../../shared/dates.js'\n" : ''}import { ${D}_FEE_RATE, ${D}_FIXED_FEE, ${D}_MAX_AMOUNT${late ? `, ${D}_LATE_RATE` : ''} } from './config.js'

export function processItem(item) {
  if (!isValidId(item.id)) throw new Error('bad id')
  const base = clamp(item.amount, 0, ${D}_MAX_AMOUNT)
  return roundMoney(base * ${D}_FEE_RATE + ${D}_FIXED_FEE)
}
${late ? `
export function lateFee(item) {
  return roundMoney(daysBetween(item.due, item.paid) * ${D}_LATE_RATE)
}
` : ''}
export function handleEvent(evt) {
  return { id: evt.id, fee: processItem(evt), kind: '${d}.created' }
}
`)
  write(`services/${d}/handler.test.js`, `import test from 'node:test'
import assert from 'node:assert/strict'
import { handleEvent, processItem${late ? ', lateFee' : ''} } from './handler.js'

test('${d}: fee for a normal amount', () => assert.equal(processItem({ id: '${d}-0001', amount: ${amount} }), ${fee}))
test('${d}: amounts above the maximum are capped', () => assert.equal(processItem({ id: '${d}-0001', amount: ${max * 3} }), ${capped}))
test('${d}: an invalid id is rejected', () => assert.throws(() => processItem({ id: 'nope', amount: 1 })))
test('${d}: event shape', () => assert.deepEqual(handleEvent({ id: '${d}-0002', amount: ${amount} }), { id: '${d}-0002', fee: ${fee}, kind: '${d}.created' }))
${late ? `test('${d}: late fee counts the days', () => assert.equal(lateFee({ due: '2026-03-01', paid: '2026-03-11' }), ${roundMoney(10 * lateRate)}))\n` : ''}`)
  imports.push(`import * as ${d} from '../services/${d}/handler.js'`)
  routes.push(`  '${d}.created': ${d}.handleEvent,`)
  routeTests.push(`test('routes ${d}', () => assert.deepEqual(dispatch({ type: '${d}.created', id: '${d}-0003', amount: ${amount} }), { id: '${d}-0003', fee: ${fee}, kind: '${d}.created' }))`)
})
write('gateway/routes.js', `// The routing table: which service handles which event type.
${imports.join('\n')}

export const ROUTES = {
${routes.join('\n')}
}

export function dispatch(evt) {
  const handler = ROUTES[evt.type]
  if (!handler) throw new Error('no route for ' + evt.type)
  return handler(evt)
}
`)
write('gateway/routes.test.js', `import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './routes.js'

${routeTests.join('\n')}
test('unknown event types are refused', () => assert.throws(() => dispatch({ type: 'nothing.created' })))
`)
write('shared/shared.test.js', `import test from 'node:test'
import assert from 'node:assert/strict'
import { clamp, roundMoney } from './money.js'
import { isValidId } from './ids.js'
import { daysBetween } from './dates.js'

test('roundMoney rounds to the nearest cent', () => assert.equal(roundMoney(1.006), 1.01))
test('clamp keeps a value inside its range', () => { assert.equal(clamp(5, 0, 3), 3); assert.equal(clamp(-1, 0, 3), 0); assert.equal(clamp(2, 0, 3), 2) })
test('isValidId', () => { assert.ok(isValidId('order-0042')); assert.ok(!isValidId('Order-42')) })
test('daysBetween', () => assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10))
`)
console.log(`${DOMAINS.length} services written to ${out}`)
