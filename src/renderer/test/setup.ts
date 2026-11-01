/**
 * jsdom gaps a headless TipTap editor runs into (#1145). Nothing here
 * changes behaviour under test; it only keeps the DOM APIs ProseMirror
 * touches from throwing in a window without layout.
 */

const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = rect as unknown as () => DOMRect
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList
}

if (typeof document !== 'undefined' && !('elementFromPoint' in document)) {
  Object.defineProperty(document, 'elementFromPoint', { value: () => null })
}
