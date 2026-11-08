// Keeps a graph dir fresh: rescans the project 3 s after the last file change (a burst of saves is one scan).
// Run: node mcp/watch.mjs <project dir> <graph dir>   (needs cargo; the first scan compiles the scanner)
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Calls `fn` once, `ms` after the last call. */
export const debounced = (fn, ms) => {
  let t
  return () => { clearTimeout(t); t = setTimeout(fn, ms) }
}

export const SKIP = /(^|[\\/])(node_modules|\.git|target|dist|build|__pycache__|\.venv)([\\/]|$)/

if (process.argv[1]?.endsWith('watch.mjs')) {
  const [project, graph] = process.argv.slice(2)
  if (!project || !graph) { console.error('usage: watch.mjs <project dir> <graph dir>'); process.exit(1) }
  const tauri = fileURLToPath(new URL('../src-tauri', import.meta.url))
  let busy = false, again = false
  const scan = () => {
    if (busy) { again = true; return } // a change during a scan means one more scan after it
    busy = true
    spawn('cargo', ['run', '-q', '--example', 'scan', '--', project, graph], { cwd: tauri, stdio: 'inherit' }).on('close', () => {
      busy = false
      if (again) { again = false; scan() }
    })
  }
  const later = debounced(scan, 3000)
  watch(project, { recursive: true }, (_, file) => { if (file && !SKIP.test(file)) later() })
  scan()
  console.log(`watching ${project}`)
}
