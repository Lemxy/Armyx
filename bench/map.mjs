// Prints the graph map exactly as the app sends it to the agent (reuses src/deso.ts).
import { readdirSync, readFileSync } from 'node:fs'
import { graphMap } from '../src/deso.ts'

const dir = process.argv[2]
const notes = readdirSync(dir).filter((f) => f.endsWith('.deso')).sort().map((f) => ({ name: f.slice(0, -5), content: readFileSync(`${dir}/${f}`, 'utf8') }))
process.stdout.write(graphMap(notes))
