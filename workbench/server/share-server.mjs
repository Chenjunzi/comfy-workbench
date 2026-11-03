import { createStaticShareServer, repoPaths } from './comfy-server.mjs'

const readArg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}

const host = readArg('--host', process.env.COMFY_PRESET_SHARE_HOST || '127.0.0.1')
const port = Number(readArg('--port', process.env.PORT || '5173'))

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid port: ${port}`)
  process.exit(1)
}

console.log(`SQLite state: ${repoPaths.sqliteFile}`)
console.log(`Legacy shared state import source: ${repoPaths.sharedStateFile}`)
console.log(`Access keys file: ${repoPaths.accessKeysFile}`)
createStaticShareServer({ host, port })
