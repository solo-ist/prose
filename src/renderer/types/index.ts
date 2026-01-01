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
  recovery?: {
    mode: 'silent' | 'prompt'
  }
  defaultSaveDirectory?: string
}

export interface Document {
  documentId: string
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
  hidden?: boolean
}

export interface FileResult {
  path: string
  content: string
}

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  messages: LLMMessage[]
  system: string
}

export interface LLMResponse {
  content: string
}

// Streaming types
export interface LLMStreamRequest extends LLMRequest {
  streamId: string
}

export interface LLMStreamChunk {
  streamId: string
  delta: string
}

export interface LLMStreamComplete {
  streamId: string
  content: string
}

export interface LLMStreamError {
  streamId: string
  error: string
}

export interface ElectronAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (path: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  onMenuAction: (callback: (action: string) => void) => () => void
  onFileOpenExternal: (callback: (path: string) => void) => () => void
  llmChat: (request: LLMRequest) => Promise<LLMResponse>
  platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'android' | 'cygwin' | 'netbsd' | null
  // Streaming LLM
  llmChatStream: (request: LLMStreamRequest) => Promise<{ success: boolean }>
  llmAbortStream: (streamId: string) => Promise<{ success: boolean }>
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => () => void
  onLLMStreamError: (callback: (error: LLMStreamError) => void) => () => void
  // Folder operations for quick save
  selectFolder: () => Promise<string | null>
  saveToFolder: (folder: string, filename: string, content: string) => Promise<string>
  getDocumentsPath: () => Promise<string>
  fileExists: (path: string) => Promise<boolean>
  // File reveal
  showInFolder: (path: string) => Promise<void>
  // File rename/delete
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
