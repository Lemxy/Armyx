// Builds plugin/armyx/scripts from the sources (a plugin is copied on install, so it cannot import ../src).
// Run: node mcp/build-plugin.mjs        (npm run plugin)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'plugin', 'armyx', 'scripts')
const scripts = ['claude-hook', 'load', 'tools-to-notes', 'debt', 'armyx-ctl', 'gateway', 'graph-server']

mkdirSync(out, { recursive: true })
copyFileSync(join(root, 'src', 'deso.ts'), join(out, 'deso.ts'))
for (const s of scripts) {
  const src = readFileSync(join(root, 'mcp', `${s}.mjs`), 'utf8')
  writeFileSync(join(out, `${s}.mjs`), src.replaceAll('../src/deso.ts', './deso.ts'))
}
console.log(`built ${scripts.length + 1} files into ${out}`)
