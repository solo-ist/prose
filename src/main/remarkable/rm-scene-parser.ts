/**
 * Minimal reMarkable v6 ".rm" (lines) binary parser — TYPED-TEXT extraction only.
 *
 * Ported to TypeScript from the MIT-licensed Python library `rmscene` by Rick
 * Lupton (https://github.com/ricklupton/rmscene) — specifically its tagged-block
 * reader, the RootTextBlock structure, and the text-extraction algorithm in
 * `text.py`. rmscene is MIT-licensed, and this port carries that lineage. It is
 * deliberately NOT derived from the GPL-3.0 TypeScript port in the
 * TimDommett/Remarkable-Sync Obsidian plugin (Prose is MIT).
 *
 * Scope is intentionally narrow: read just enough of the format to pull out
 * typed ("Type Folio" keyboard) text and to detect the presence of handwriting
 * strokes. Everything else is skipped by block/subblock length. Any parse error
 * yields a safe fallback ({ hasStrokes: true, hasTypedText: false }) so the
 * caller degrades to the existing OCR path instead of crashing the sync worker.
 *
 * Format references: rmscene (source of truth), the reMarkable v6 ".lines" spec
 * (github.com/YakBarber/remarkable_file_format), and ddvk's v6 reader.
 */

// --- Format constants -------------------------------------------------------

// Tag types (low nibble of a tag varuint); high bits are the field index.
// (Only the tag types this reader consumes are declared.)
const TAG_ID = 0xf
const TAG_LENGTH4 = 0xc
const TAG_BYTE4 = 0x4

// Top-level block types we care about. All others are skipped by length.
const BLOCK_ROOT_TEXT = 0x07 // RootTextBlock — the page's typed text
const BLOCK_SCENE_LINE_ITEM = 0x05 // SceneLineItemBlock — a handwriting stroke

// reMarkable paragraph styles (rmscene `ParagraphStyle`).
const STYLE_BASIC = 0
const STYLE_PLAIN = 1
const STYLE_HEADING = 2
const STYLE_BOLD = 3
const STYLE_BULLET = 4
const STYLE_BULLET2 = 5
const STYLE_CHECKBOX = 6
const STYLE_CHECKBOX_CHECKED = 7

const HEADER_PREFIX = 'reMarkable .lines file, version='
const HEADER_LENGTH = 43 // "reMarkable .lines file, version=6" + trailing padding

// --- Public API -------------------------------------------------------------

export type RmParagraphStyle =
  | 'plain'
  | 'heading'
  | 'bold'
  | 'bullet'
  | 'bullet2'
  | 'checkbox'
  | 'checkbox-checked'

export interface RmParagraph {
  text: string
  style: RmParagraphStyle
}

export interface RmPageParseResult {
  /** Ordered paragraphs of typed text (empty for pure-handwriting pages). */
  paragraphs: RmParagraph[]
  /** True when a RootTextBlock with non-empty typed text was found. */
  hasTypedText: boolean
  /** True when the page contains handwriting strokes (SceneLineItemBlock). */
  hasStrokes: boolean
  /** The .rm format version from the header (0 if unknown / parse failed). */
  formatVersion: number
}

/** Safe fallback: treat the page as handwriting so the caller runs OCR. */
function fallbackResult(formatVersion = 0): RmPageParseResult {
  return { paragraphs: [], hasTypedText: false, hasStrokes: true, formatVersion }
}

/**
 * Parse a single .rm v6 page for typed text. Never throws — any malformed or
 * unexpected input returns the fallback result.
 */
export function parseRmPageForText(buffer: Buffer): RmPageParseResult {
  try {
    const reader = new Reader(buffer)
    const formatVersion = reader.readHeader()
    // Typed text (RootTextBlock) only exists in v6+. Legacy pages are strokes.
    if (formatVersion < 6) return fallbackResult(formatVersion)

    let hasStrokes = false
    let paragraphs: RmParagraph[] = []

    while (reader.hasBlockHeader()) {
      const block = reader.readBlockHeader()
      if (block === null) break

      if (block.blockType === BLOCK_SCENE_LINE_ITEM) {
        hasStrokes = true
      } else if (block.blockType === BLOCK_ROOT_TEXT) {
        try {
          const rootText = readRootTextBlock(reader)
          if (rootText) paragraphs = extractParagraphs(rootText)
        } catch {
          // A RootTextBlock we couldn't decode — leave paragraphs empty and let
          // OCR handle the page. Skipping to block end below keeps us aligned.
        }
      }

      // Skip anything unread in this block (unknown/newer fields, or a block we
      // don't parse) by seeking to the block's end.
      reader.seekTo(block.end)
    }

    const hasTypedText = paragraphs.some((p) => p.text.trim().length > 0)
    return { paragraphs, hasTypedText, hasStrokes, formatVersion }
  } catch {
    return fallbackResult()
  }
}

/** Render extracted paragraphs to markdown. */
export function paragraphsToMarkdown(paragraphs: RmParagraph[]): string {
  const lines = paragraphs.map((p) => {
    const text = p.text
    switch (p.style) {
      case 'heading':
        return text ? `# ${text}` : ''
      case 'bold':
        return text ? `## ${text}` : ''
      case 'bullet':
        return text ? `- ${text}` : ''
      case 'bullet2':
        return text ? `  - ${text}` : ''
      case 'checkbox':
        return text ? `- [ ] ${text}` : ''
      case 'checkbox-checked':
        return text ? `- [x] ${text}` : ''
      default:
        return text
    }
  })
  // Join paragraphs with blank lines, then collapse runs of 3+ newlines to a
  // single blank line and trim the ends.
  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

// --- CRDT ids ---------------------------------------------------------------

interface CrdtId {
  part1: number
  part2: number
}

const END_MARKER: CrdtId = { part1: 0, part2: 0 }

function idKey(id: CrdtId): string {
  return `${id.part1}:${id.part2}`
}

function isEndMarker(id: CrdtId): boolean {
  return id.part1 === 0 && id.part2 === 0
}

// --- Binary reader ----------------------------------------------------------

interface BlockHeader {
  blockType: number
  /** Absolute offset of the byte after this block's payload. */
  end: number
}

class Reader {
  private buf: Buffer
  private pos = 0

  constructor(buffer: Buffer) {
    this.buf = buffer
  }

  get position(): number {
    return this.pos
  }

  seekTo(offset: number): void {
    // Clamp forward-only to the buffer end; the block loop tolerates this.
    this.pos = Math.min(Math.max(offset, 0), this.buf.length)
  }

  private ensure(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('EOF')
  }

  readUint8(): number {
    this.ensure(1)
    return this.buf[this.pos++]
  }

  readUint32(): number {
    this.ensure(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  readFloat64(): number {
    this.ensure(8)
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }

  readBytes(n: number): Buffer {
    this.ensure(n)
    const b = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }

  /** LEB128 varuint. Uses multiplication so values above 2^31 stay correct. */
  readVaruint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.readUint8()
      result += (byte & 0x7f) * Math.pow(2, shift)
      if ((byte & 0x80) === 0) break
      shift += 7
      if (shift > 63) throw new Error('varuint too long')
    }
    return result
  }

  readCrdtId(): CrdtId {
    const part1 = this.readUint8()
    const part2 = this.readVaruint()
    return { part1, part2 }
  }

  /** Read a tag varuint, returning its field index and type nibble. */
  private readTagValues(): { index: number; type: number } {
    const x = this.readVaruint()
    return { index: x >> 4, type: x & 0xf }
  }

  /** Peek whether the next tag matches an index+type without advancing. */
  checkTag(expectedIndex: number, expectedType: number): boolean {
    const save = this.pos
    try {
      const { index, type } = this.readTagValues()
      return index === expectedIndex && type === expectedType
    } catch {
      return false
    } finally {
      this.pos = save
    }
  }

  private readTag(expectedIndex: number, expectedType: number): void {
    const save = this.pos
    const { index, type } = this.readTagValues()
    if (index !== expectedIndex || type !== expectedType) {
      this.pos = save
      throw new Error(
        `Unexpected tag: wanted index ${expectedIndex}/type ${expectedType}, got ${index}/${type}`
      )
    }
  }

  // --- Header ---

  /** Read the 43-byte header and return the format version digit. */
  readHeader(): number {
    const header = this.readBytes(HEADER_LENGTH).toString('latin1')
    if (!header.startsWith(HEADER_PREFIX)) {
      throw new Error('Not a reMarkable .lines file')
    }
    // Parse the full version token (handles multi-digit versions like v10+, not
    // just a single digit); the trailing header padding is trimmed off.
    const version = parseInt(header.slice(HEADER_PREFIX.length).trim(), 10)
    return Number.isNaN(version) ? 0 : version
  }

  // --- Blocks ---

  hasBlockHeader(): boolean {
    // Need at least the 4-byte length + 4 header bytes to start a block.
    return this.pos + 8 <= this.buf.length
  }

  readBlockHeader(): BlockHeader | null {
    if (this.pos + 8 > this.buf.length) return null
    const length = this.readUint32()
    const unknown = this.readUint8()
    /* min_version */ this.readUint8()
    /* current_version */ this.readUint8()
    const blockType = this.readUint8()
    if (unknown !== 0) throw new Error('Bad block header')
    const end = this.pos + length
    return { blockType, end }
  }

  // --- Tagged simple values ---

  readIdTagged(index: number): CrdtId {
    this.readTag(index, TAG_ID)
    return this.readCrdtId()
  }

  readIntTagged(index: number): number {
    this.readTag(index, TAG_BYTE4)
    return this.readUint32()
  }

  // --- Subblocks ---

  /** Read a Length4-tagged subblock header; returns the absolute end offset. */
  readSubblockHeader(index: number): number {
    this.readTag(index, TAG_LENGTH4)
    const length = this.readUint32()
    return this.pos + length
  }

  hasSubblock(index: number): boolean {
    return this.checkTag(index, TAG_LENGTH4)
  }

  /**
   * Read a length-prefixed string with an optional trailing format code.
   * Mirrors rmscene's `read_string_with_format`. Returns the decoded UTF-8
   * string and, if present, an integer inline-format code.
   */
  readStringWithFormat(index: number): { text: string; format: number | null } {
    const end = this.readSubblockHeader(index)
    const strLength = this.readVaruint()
    /* is_ascii flag (actually UTF-8) */ this.readUint8()
    const text = this.readBytes(strLength).toString('utf-8')
    let format: number | null = null
    if (this.pos < end && this.checkTag(2, TAG_BYTE4)) {
      format = this.readIntTagged(2)
    }
    this.seekTo(end)
    return { text, format }
  }
}

// --- RootTextBlock decoding -------------------------------------------------

interface TextItem {
  itemId: CrdtId
  leftId: CrdtId
  rightId: CrdtId
  deletedLength: number
  value: string | number
}

interface RootText {
  items: TextItem[]
  /** Paragraph styles keyed by the char id that begins each line. */
  styles: Map<string, number>
}

/** Read one text item (a run of characters or an inline format code). */
function readTextItem(reader: Reader): TextItem {
  const end = reader.readSubblockHeader(0)
  const itemId = reader.readIdTagged(2)
  const leftId = reader.readIdTagged(3)
  const rightId = reader.readIdTagged(4)
  const deletedLength = reader.readIntTagged(5)

  let value: string | number = ''
  if (reader.position < end && reader.hasSubblock(6)) {
    const { text, format } = reader.readStringWithFormat(6)
    value = format !== null ? format : text
  }
  reader.seekTo(end)
  return { itemId, leftId, rightId, deletedLength, value }
}

/** Read one paragraph-format entry: (char id, paragraph style). */
function readTextFormat(reader: Reader): { charId: CrdtId; style: number } {
  // The char id here is written WITHOUT a leading tag.
  const charId = reader.readCrdtId()
  /* timestamp id (tagged, index 1) — unused */ reader.readIdTagged(1)
  const end = reader.readSubblockHeader(2)
  /* marker byte, expected 17 */ reader.readUint8()
  const style = reader.readUint8()
  reader.seekTo(end)
  return { charId, style }
}

/** Parse a RootTextBlock (block type 0x07). Reader is positioned after the header. */
function readRootTextBlock(reader: Reader): RootText | null {
  /* block_id (tagged id, index 1) — asserted CrdtId(0,0) upstream */ reader.readIdTagged(1)

  const outerEnd = reader.readSubblockHeader(2)

  // Text items: subblock(1) -> subblock(1) -> varuint count -> items
  const items: TextItem[] = []
  const itemsOuterEnd = reader.readSubblockHeader(1)
  const itemsInnerEnd = reader.readSubblockHeader(1)
  const numItems = reader.readVaruint()
  for (let i = 0; i < numItems; i++) items.push(readTextItem(reader))
  reader.seekTo(itemsInnerEnd)
  reader.seekTo(itemsOuterEnd)

  // Formatting: subblock(2) -> subblock(1) -> varuint count -> formats
  const styles = new Map<string, number>()
  if (reader.position < outerEnd && reader.hasSubblock(2)) {
    const fmtOuterEnd = reader.readSubblockHeader(2)
    const fmtInnerEnd = reader.readSubblockHeader(1)
    const numFormats = reader.readVaruint()
    for (let i = 0; i < numFormats; i++) {
      const { charId, style } = readTextFormat(reader)
      styles.set(idKey(charId), style)
    }
    reader.seekTo(fmtInnerEnd)
    reader.seekTo(fmtOuterEnd)
  }

  reader.seekTo(outerEnd)
  return { items, styles }
}

// --- Text extraction (port of rmscene text.py) ------------------------------

interface CharItem {
  itemId: CrdtId
  leftId: CrdtId
  rightId: CrdtId
  value: string | number // single character, '' for a deleted char, or a format code
}

/**
 * Expand text items (runs of characters) into single-character items, assigning
 * each character its implicit sequential id. Mirrors `expand_text_item`.
 */
function expandTextItems(items: TextItem[]): CharItem[] {
  const out: CharItem[] = []
  for (const item of items) {
    if (item.deletedLength > 0) {
      // Deleted run: `deletedLength` tombstone chars, each contributing no text.
      let leftId = item.leftId
      let itemId = item.itemId
      for (let k = 0; k < item.deletedLength; k++) {
        const isLast = k === item.deletedLength - 1
        const rightId = isLast ? item.rightId : { part1: itemId.part1, part2: itemId.part2 + 1 }
        out.push({ itemId, leftId, rightId, value: '' })
        leftId = itemId
        itemId = rightId
      }
      continue
    }
    if (typeof item.value === 'number') {
      out.push({ itemId: item.itemId, leftId: item.leftId, rightId: item.rightId, value: item.value })
      continue
    }
    const chars = Array.from(item.value) // code-point aware
    if (chars.length === 0) continue // empty, non-deleted item — skip
    let leftId = item.leftId
    let itemId = item.itemId
    for (let k = 0; k < chars.length; k++) {
      const isLast = k === chars.length - 1
      const rightId = isLast ? item.rightId : { part1: itemId.part1, part2: itemId.part2 + 1 }
      out.push({ itemId, leftId, rightId, value: chars[k] })
      leftId = itemId
      itemId = rightId
    }
  }
  return out
}

const START_NODE = '__start'
const END_NODE = '__end'

/**
 * Topologically sort char items by their left/right ids (Kahn's algorithm),
 * returning item-id keys in document order. Ported from `toposort_items`.
 */
function toposortItems(items: CharItem[]): string[] {
  const itemDict = new Map<string, CharItem>()
  for (const item of items) itemDict.set(idKey(item.itemId), item)
  if (itemDict.size === 0) return []

  const sideId = (id: CrdtId, side: 'left' | 'right'): string => {
    if (isEndMarker(id) || !itemDict.has(idKey(id))) {
      return side === 'left' ? START_NODE : END_NODE
    }
    return idKey(id)
  }

  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  const allNodes = new Set<string>([START_NODE, END_NODE])
  const nodeIds = new Map<string, CrdtId>() // key -> CrdtId for sort ordering

  const bump = (key: string, by: number) => inDegree.set(key, (inDegree.get(key) ?? 0) + by)
  const addDependent = (from: string, to: string) => {
    const list = dependents.get(from)
    if (list) list.push(to)
    else dependents.set(from, [to])
  }

  for (const item of itemDict.values()) {
    const key = idKey(item.itemId)
    const left = sideId(item.leftId, 'left')
    const right = sideId(item.rightId, 'right')
    allNodes.add(key)
    allNodes.add(left)
    allNodes.add(right)
    nodeIds.set(key, item.itemId)
    // item depends on left; right depends on item.
    bump(key, 1)
    addDependent(left, key)
    bump(right, 1)
    addDependent(key, right)
  }
  for (const node of allNodes) if (!inDegree.has(node)) inDegree.set(node, 0)

  // Deterministic ordering when several nodes are ready: matches reMarkable's
  // "higher author id first" via the (-part1, part2) key.
  const sortKey = (node: string): [number, number, number] => {
    if (node === START_NODE) return [0, 0, 0]
    if (node === END_NODE) return [2, 0, 0]
    const id = nodeIds.get(node)
    if (!id) return [1, 0, 0]
    return [1, -id.part1, id.part2]
  }
  const less = (a: string, b: string): boolean => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i]
    }
    return a < b
  }

  const ready: string[] = []
  for (const node of allNodes) if ((inDegree.get(node) ?? 0) === 0) ready.push(node)

  const order: string[] = []
  while (ready.length > 0) {
    // Extract the minimum by sortKey (linear scan — pages hold few thousand chars).
    let minIdx = 0
    for (let i = 1; i < ready.length; i++) if (less(ready[i], ready[minIdx])) minIdx = i
    const node = ready.splice(minIdx, 1)[0]

    if (itemDict.has(node)) order.push(node)
    if (node === END_NODE) break

    for (const dep of dependents.get(node) ?? []) {
      const d = (inDegree.get(dep) ?? 0) - 1
      inDegree.set(dep, d)
      if (d === 0) ready.push(dep)
    }
  }
  return order
}

const STYLE_TO_NAME: Record<number, RmParagraphStyle> = {
  [STYLE_BASIC]: 'plain',
  [STYLE_PLAIN]: 'plain',
  [STYLE_HEADING]: 'heading',
  [STYLE_BOLD]: 'bold',
  [STYLE_BULLET]: 'bullet',
  [STYLE_BULLET2]: 'bullet2',
  [STYLE_CHECKBOX]: 'checkbox',
  [STYLE_CHECKBOX_CHECKED]: 'checkbox-checked'
}

/**
 * Split ordered characters into paragraphs on newlines, attaching each
 * paragraph's style. Ported from `TextDocument.from_scene_item`: a paragraph's
 * style is keyed by the id of the newline that begins its line (or END_MARKER
 * for the first paragraph).
 */
function extractParagraphs(root: RootText): RmParagraph[] {
  const charItems = expandTextItems(root.items)
  const valueByKey = new Map<string, string | number>()
  for (const c of charItems) valueByKey.set(idKey(c.itemId), c.value)

  const orderedKeys = toposortItems(charItems)

  const styleFor = (startKey: string): RmParagraphStyle => {
    const code = root.styles.get(startKey)
    if (code === undefined) return 'plain'
    return STYLE_TO_NAME[code] ?? 'plain'
  }

  const paragraphs: RmParagraph[] = []
  let i = 0
  while (i < orderedKeys.length) {
    // The newline that begins this line is consumed as the style key; the very
    // first paragraph keys off END_MARKER.
    let startKey = idKey(END_MARKER)
    if (valueByKey.get(orderedKeys[i]) === '\n') {
      startKey = orderedKeys[i]
      i++
    }
    let text = ''
    while (i < orderedKeys.length) {
      const v = valueByKey.get(orderedKeys[i])
      if (typeof v === 'number') {
        // Inline format code (bold/italic on/off) — not rendered in v1.
        i++
        continue
      }
      if (v === '\n') break // start of the next paragraph; leave for next loop
      text += v ?? ''
      i++
    }
    paragraphs.push({ text, style: styleFor(startKey) })
  }
  return paragraphs
}
