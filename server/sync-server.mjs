/**
 * Nodeflow sync relay — Stage 2 (ROADMAP). A thin y-websocket-protocol server:
 * one Y.Doc per room (board), sync protocol (message 0) + awareness (message 1),
 * binary update persistence to ./data/<room>.bin (debounced). The client uses
 * the stock y-websocket WebsocketProvider; this speaks the same protocol.
 *
 *   node server/sync-server.mjs          # ws://localhost:1234
 *   PORT=8080 node server/sync-server.mjs
 *
 * PHASE2 note (SPEC §15): auth/permissions arrive with Stage 3 accounts —
 * anyone who knows a board id can join its room. Run it on a trusted network.
 */
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT) || 1234
const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data')
mkdirSync(DATA_DIR, { recursive: true })

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const PERSIST_DEBOUNCE_MS = 1200

/** room name → live state */
const rooms = new Map()

const safeName = (name) => name.replace(/[^\w-]/g, '_').slice(0, 80)

function getRoom(name) {
  let room = rooms.get(name)
  if (room) return room
  const doc = new Y.Doc()
  const file = join(DATA_DIR, `${safeName(name)}.bin`)
  if (existsSync(file)) {
    try {
      Y.applyUpdate(doc, new Uint8Array(readFileSync(file)))
    } catch (e) {
      console.error(`[room ${name}] failed to load snapshot:`, e.message)
    }
  }
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null) // the server is not a peer
  room = { name, doc, awareness, conns: new Map(), file, persistTimer: null }

  doc.on('update', (update, origin) => {
    // fan out to every client except the sender
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeUpdate(enc, update)
    const msg = encoding.toUint8Array(enc)
    for (const ws of room.conns.keys()) {
      if (ws !== origin) send(ws, msg)
    }
    schedulePersist(room)
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed]
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    )
    const msg = encoding.toUint8Array(enc)
    for (const ws of room.conns.keys()) {
      if (ws !== origin) send(ws, msg)
    }
  })

  rooms.set(name, room)
  return room
}

function schedulePersist(room) {
  clearTimeout(room.persistTimer)
  room.persistTimer = setTimeout(() => {
    try {
      writeFileSync(room.file, Y.encodeStateAsUpdate(room.doc))
    } catch (e) {
      console.error(`[room ${room.name}] persist failed:`, e.message)
    }
  }, PERSIST_DEBOUNCE_MS)
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(data, (err) => err && ws.terminate())
  }
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws, req) => {
  const roomName = (req.url || '/').slice(1).split('?')[0] || 'default'
  const room = getRoom(roomName)
  ws.binaryType = 'arraybuffer'
  room.conns.set(ws, new Set()) // controlled awareness client ids

  // handshake: sync step 1 + current awareness states
  {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    send(ws, encoding.toUint8Array(enc))
    const states = room.awareness.getStates()
    if (states.size > 0) {
      const aw = encoding.createEncoder()
      encoding.writeVarUint(aw, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      )
      send(ws, encoding.toUint8Array(aw))
    }
  }

  ws.on('message', (data) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data))
      const enc = encoding.createEncoder()
      const type = decoding.readVarUint(dec)
      if (type === MESSAGE_SYNC) {
        encoding.writeVarUint(enc, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(dec, enc, room.doc, ws)
        if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
      } else if (type === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(dec)
        // remember which client ids this socket controls (cleanup on close)
        const ids = room.conns.get(ws)
        if (ids) {
          const tmp = decoding.createDecoder(update)
          const len = decoding.readVarUint(tmp)
          for (let i = 0; i < len; i++) {
            ids.add(decoding.readVarUint(tmp))
            decoding.readVarUint(tmp) // clock
            decoding.readVarString(tmp) // state json
          }
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws)
      }
    } catch (e) {
      console.error(`[room ${room.name}] bad message:`, e.message)
    }
  })

  const close = () => {
    const ids = room.conns.get(ws)
    room.conns.delete(ws)
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null)
    }
    // keep the room hot for quick rejoins; snapshot is already persisted
  }
  ws.on('close', close)
  ws.on('error', close)
})

console.log(`nodeflow sync relay listening on ws://localhost:${PORT} (data: ${DATA_DIR})`)
