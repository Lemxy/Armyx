// Draws docs/bench-orchestra.svg from results.orchestra.json (written by orchestra.mjs): how much cheaper each orchestra saver makes a call.
//   node archive/map-bench/chart.mjs [results.orchestra.json] [out.svg]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [inFile = 'archive/map-bench/results.orchestra.json', outFile = 'docs/bench-orchestra.svg'] = process.argv.slice(2)
const { summary } = JSON.parse(readFileSync(inFile, 'utf8'))
const NAMES = {
  final: ['Final answer on Haiku', 'lead writes the summary on the cheap model'],
  resume: ['Review resumes the session', 'round 2 continues the worker, no resend'],
  stagger: ['Staggered parallel start', '4 calls: 1 warms the cache, 3 reuse it'],
  slice: ['Code slice in the brief', 'the worker gets the code it names'],
  diff: ['Reviewer gets the git diff', 'no hunting for what changed'],
}
const rows = Object.keys(NAMES).map((k) => ({ k, ...summary[k].usd, n: summary[k].n })).sort((a, b) => a.pct - b.pct)
const $ = (v) => '$' + v.toFixed(4)

const W = 820, L = 300, R = 190, top = 70, rowH = 52, bar = 20, H = top + rows.length * rowH + 40, plot = W - L - R
const x = (pct) => (plot * -pct) / 100
// 4px rounded data end, square at the baseline
const barPath = (y, w) => `M${L},${y}h${w - 4}a4,4 0 0 1 4,4v${bar - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z`

const body = rows.map((r, i) => {
  const y = top + i * rowH + (rowH - bar) / 2, w = x(r.pct), [name, sub] = NAMES[r.k]
  return `<g><title>${name}: ${$(r.before)} → ${$(r.after)} per call (${r.pct}%, n=${r.n})</title>
  <text class="t1" x="${L - 14}" y="${y + 8}" text-anchor="end">${name}</text>
  <text class="t3" x="${L - 14}" y="${y + 24}" text-anchor="end">${sub}</text>
  <path class="bar" d="${barPath(y, w)}"/>
  <text class="t1 big" x="${L + w + 10}" y="${y + 15}">${-r.pct}% cheaper</text>
  <text class="t2" x="${L + w + 10}" y="${y + 31}">${$(r.before)} → ${$(r.after)}</text></g>`
}).join('\n')

const grid = [0, 25, 50, 75, 100].map((p) => `<line class="grid" x1="${L + x(-p)}" x2="${L + x(-p)}" y1="${top - 6}" y2="${H - 34}"/><text class="t3" x="${L + x(-p)}" y="${H - 18}" text-anchor="middle">${p}%</text>`).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">Armyx orchestra: cost per call saved by each technique (real claude -p runs)</title>
<style>
  svg { --bg:#fcfcfb; --t1:#0b0b0b; --t2:#52514e; --t3:#7a7975; --grid:#e4e3df; --s1:#2a78d6; font-family:-apple-system,"Segoe UI",Inter,Helvetica,Arial,sans-serif }
  @media (prefers-color-scheme: dark) { svg { --bg:#1a1a19; --t1:#f0efec; --t2:#c3c2b7; --t3:#8f8e88; --grid:#33332f; --s1:#3987e5 } }
  .bg{fill:var(--bg)} .bar{fill:var(--s1)} .grid{stroke:var(--grid);stroke-width:1}
  .t1{fill:var(--t1);font-size:14px;font-weight:600} .t2{fill:var(--t2);font-size:12.5px} .t3{fill:var(--t3);font-size:12px}
  .big{font-size:15px} .h{fill:var(--t1);font-size:18px;font-weight:700}
</style>
<rect class="bg" width="${W}" height="${H}" rx="12"/>
<text class="h" x="24" y="34">Cost per call saved by each orchestra technique</text>
<text class="t2" x="24" y="54">Real claude -p runs, Sonnet 5.5 workers; same answers before and after (stagger: one group of 4 calls)</text>
${grid}
${body}
</svg>
`
mkdirSync(outFile.replace(/[^/]+$/, '') || '.', { recursive: true })
writeFileSync(outFile, svg)
console.log(rows.map((r) => `${r.k} ${r.pct}%`).join(', '), '->', outFile)
