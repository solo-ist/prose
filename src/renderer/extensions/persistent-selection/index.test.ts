import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { PersistentSelection } from './index'

let editor: Editor

const painted = () => editor.view.dom.querySelectorAll('.persistent-selection').length
const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type, { bubbles: true }))

beforeEach(() => {
  vi.useFakeTimers()
  editor = new Editor({ extensions: [Document, Paragraph, Text, PersistentSelection], content: '<p>The quick fox.</p>' })
  editor.commands.setTextSelection({ from: 1, to: 15 })
  fire(editor.view.dom, 'blur') // focus moved elsewhere (the chat input)
})

afterEach(() => {
  editor.destroy()
  vi.useRealTimers()
})

describe('persistent selection (#1264)', () => {
  it('paints a blurred selection', () => {
    expect(painted()).toBe(1)
  })

  it('a focus from a pointer press keeps the highlight until the press ends, then clears after its click', () => {
    fire(editor.view.dom, 'mousedown')
    fire(editor.view.dom, 'focus')
    expect(painted()).toBe(1) // still there between mousedown and mouseup, so the click can fire
    fire(window, 'pointerup')
    expect(painted()).toBe(1) // the click is dispatched in this same task
    vi.runAllTimers()
    expect(painted()).toBe(0)
  })

  it('a cancelled press clears too', () => {
    fire(editor.view.dom, 'mousedown')
    fire(editor.view.dom, 'focus')
    fire(window, 'pointercancel')
    vi.runAllTimers()
    expect(painted()).toBe(0)
  })

  it('a focus without a press (keyboard, commands.focus) clears at once', () => {
    fire(editor.view.dom, 'focus')
    expect(painted()).toBe(0)
  })

  it('a press that ended before the focus does not hold the next focus', () => {
    fire(editor.view.dom, 'mousedown')
    fire(window, 'pointerup')
    fire(editor.view.dom, 'focus')
    expect(painted()).toBe(0)
  })
})
