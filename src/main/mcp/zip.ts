/**
 * A minimal store-only ZIP writer (#1257): enough for a Claude Desktop
 * extension (`.mcpb`), which is a zip of a manifest and a bundled server.
 * No compression and no dependency: CRC-32 comes from node:zlib.
 *
 * Every entry carries the same fixed timestamp (1980-01-01 00:00, the DOS
 * epoch), so the same input always produces the same bytes. ZIP64 is out of
 * scope: an archive here is a few hundred kilobytes.
 */

import { crc32 } from 'zlib'

export interface ZipEntry {
  /** Path inside the archive, `/`-separated. */
  name: string
  data: Buffer | string
  /** Unix permission bits, e.g. 0o644 (the default) or 0o755. */
  mode?: number
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const VERSION = 20 // 2.0: what a stored entry needs
const MADE_BY_UNIX = (3 << 8) | VERSION // "made by" Unix, so the external attributes carry the mode
const UTF8_NAMES = 0x0800
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01
const REGULAR_FILE = 0o100000
const MAX_32 = 0xffffffff

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 0xffff) throw new Error('Too many entries for a non-ZIP64 archive')
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data
    if (data.length > MAX_32 || offset > MAX_32) throw new Error('Archive too large for a non-ZIP64 zip')
    const crc = crc32(data) >>> 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    parts.push(local, name, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_HEADER, 0)
    header.writeUInt16LE(MADE_BY_UNIX, 4)
    header.writeUInt16LE(VERSION, 6)
    header.writeUInt16LE(UTF8_NAMES, 8)
    header.writeUInt16LE(0, 10) // stored
    header.writeUInt16LE(DOS_TIME, 12)
    header.writeUInt16LE(DOS_DATE, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30) // extra field length
    header.writeUInt16LE(0, 32) // comment length
    header.writeUInt16LE(0, 34) // disk number
    header.writeUInt16LE(0, 36) // internal attributes
    header.writeUInt32LE(((REGULAR_FILE | (entry.mode ?? 0o644)) << 16) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + data.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with the directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length
  return Buffer.concat([...parts, directory, end])
}
