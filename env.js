import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = path.dirname(fileURLToPath(import.meta.url))
if (fs.existsSync(path.join(cwd, '.env'))) {
  for (const line of fs.readFileSync(path.join(cwd, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}