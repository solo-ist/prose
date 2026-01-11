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
  remarkable?: {
    enabled: boolean
    deviceToken?: string
    syncDirectory: string
    lastSyncedAt?: string
  }
  recentFiles?: string[]
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

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  modifiedAt: string
  children?: FileItem[]
  hasChildren?: boolean // For lazy loading - indicates folder has content without loading it
}

export interface RemarkableRegisterResponse {
  deviceToken: string
}

export interface RemarkableStatusResponse {
  connected: boolean
  lastSyncedAt?: string
}

export interface RemarkableSyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
}

export interface RemarkableNotebookMetadata {
  name: string
  parent: string | null
  type: 'folder' | 'notebook'
  fileType?: 'epub' | 'pdf' | 'notebook'
  lastModified: string
  hash: string
  localPath: string
  markdownPath?: string
}

export interface RemarkableSyncMetadata {
  lastSyncedAt: string
  notebooks: Record<string, RemarkableNotebookMetadata>
}

export interface RemarkableCloudNotebook {
  id: string
  name: string
  type: 'folder' | 'notebook'
  parent: string | null
  fileType?: string
}

export interface RemarkableSyncState {
  selectedNotebooks: string[]
  lastUpdated: string
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
  // Directory listing (with lazy loading support via maxDepth parameter)
  listDirectory: (path: string, maxDepth?: number) => Promise<FileItem[]>
  // reMarkable sync
  remarkableRegister: (code: string) => Promise<RemarkableRegisterResponse>
  remarkableValidate: (deviceToken: string) => Promise<boolean>
  remarkableSync: (deviceToken: string, syncDirectory: string) => Promise<RemarkableSyncResult>
  remarkableDisconnect: () => Promise<void>
  remarkableGetMetadata: (syncDirectory: string) => Promise<RemarkableSyncMetadata | null>
  remarkableListCloudNotebooks: (deviceToken: string) => Promise<RemarkableCloudNotebook[]>
  remarkableGetSyncState: (syncDirectory: string) => Promise<RemarkableSyncState | null>
  remarkableUpdateSyncSelection: (syncDirectory: string, selectedNotebooks: string[]) => Promise<void>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
