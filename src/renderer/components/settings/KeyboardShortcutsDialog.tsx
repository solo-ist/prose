import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Separator } from '../ui/separator'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const modKey = isMac ? '⌘' : 'Ctrl'
const altKey = isMac ? '⌥' : 'Alt'

const shortcutSections: ShortcutSection[] = [
  {
    title: 'File',
    shortcuts: [
      { keys: [modKey, 'T'], description: 'New tab' },
      { keys: [modKey, 'O'], description: 'Open file' },
      { keys: [modKey, 'S'], description: 'Save file' },
      { keys: [modKey, '⇧', 'S'], description: 'Save as' },
    ]
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: [modKey, 'F'], description: 'Find in document' },
      { keys: [modKey, 'L'], description: 'Select current line' },
      { keys: [modKey, 'D'], description: 'Duplicate line' },
      { keys: [modKey, '⇧', '⌫'], description: 'Delete line' },
      { keys: [modKey, '/'], description: 'Toggle comment' },
      { keys: [altKey, '↑'], description: 'Move line up' },
      { keys: [altKey, '↓'], description: 'Move line down' },
      { keys: [modKey, 'Z'], description: 'Undo' },
      { keys: isMac ? [modKey, '⇧', 'Z'] : ['Ctrl', 'Y'], description: 'Redo' },
    ]
  },
  {
    title: 'Formatting',
    shortcuts: [
      { keys: [modKey, 'B'], description: 'Bold' },
      { keys: [modKey, 'I'], description: 'Italic' },
      { keys: [modKey, 'U'], description: 'Underline' },
      { keys: [modKey, '⇧', 'X'], description: 'Strikethrough' },
      { keys: [modKey, 'K'], description: 'Insert link' },
      { keys: [modKey, altKey, '1-6'], description: 'Heading level' },
    ]
  },
  {
    title: 'View',
    shortcuts: [
      { keys: [modKey, '⇧', 'E'], description: 'Toggle source view' },
      { keys: [modKey, '⇧', 'H'], description: 'Toggle file list' },
      { keys: [modKey, '⇧', 'L'], description: 'Toggle chat panel' },
    ]
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: ['⇧', 'Tab'], description: 'Toggle edit mode' },
      { keys: [modKey, '.'], description: 'Toggle document context' },
      { keys: [modKey, '⇧', 'K'], description: 'Add selection as context' },
      { keys: [modKey, '⇧', 'C'], description: 'Add comment to selection' },
      { keys: [modKey, '↵'], description: 'Send message' },
      { keys: ['Esc'], description: 'Close chat panel' },
    ]
  },
  {
    title: 'Application',
    shortcuts: [
      { keys: [modKey, ','], description: 'Open settings' },
      { keys: [modKey, '⇧', 'M'], description: 'Switch model' },
      { keys: ['F1'], description: 'Show keyboard shortcuts' },
    ]
  }
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-xs font-medium bg-muted border border-border rounded">
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {shortcutSections.map((section, sectionIndex) => (
            <div key={section.title}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <Kbd key={keyIndex}>{key}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {sectionIndex < shortcutSections.length - 1 && (
                <Separator className="mt-4" />
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
