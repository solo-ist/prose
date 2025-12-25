export interface Settings {
  theme: 'light' | 'dark' | 'system'
  llm: {
    provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama'
    model: string
    apiKey: string
    baseUrl?: string
  }
  google?: {
    refreshToken: string
    email: string
  }
  editor: {
    fontSize: number
    lineHeight: number
    fontFamily: string
  }
}

export interface Document {
  path: string | null
  content: string
  frontmatter: Record<string, unknown>
  isDirty: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  context?: string
  timestamp: Date
}

export interface FileResult {
  path: string
  content: string
}

export interface ElectronAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (path: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  onMenuAction: (callback: (action: string) => void) => () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
