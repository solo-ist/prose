export interface FileOperationSuccess {
  ok: true
}

export interface FileReadSuccess extends FileOperationSuccess {
  content: string
}

export interface FileOperationFailure {
  ok: false
  code: string
  path: string
  message: string
}

export type SaveFileResult = FileOperationSuccess | FileOperationFailure
export type ReadFileResult = FileReadSuccess | FileOperationFailure

function readErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN'
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.length > 0
    ? message
    : 'File operation failed'
}

/** Human-readable, sanitized messages for known POSIX error codes. */
const FILE_ERROR_MESSAGES: Record<string, string> = {
  ENOENT: 'File or directory not found',
  ENOTDIR: 'Path component is not a directory',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  EISDIR: 'Expected a file but found a directory',
  EEXIST: 'File already exists',
  ENOTEMPTY: 'Directory is not empty',
  ENOSPC: 'No space left on device',
}

/**
 * Return a stable, sanitized message for a file-operation error.
 * Avoids leaking raw OS error strings (which may embed extra filesystem metadata).
 */
function sanitizeFileErrorMessage(code: string): string {
  return FILE_ERROR_MESSAGES[code] ?? 'File operation failed'
}

export function toFileOperationFailure(path: string, error: unknown): FileOperationFailure {
  const code = readErrorCode(error)
  return {
    ok: false,
    code,
    path,
    message: sanitizeFileErrorMessage(code),
  }
}

export function isFileOperationFailure(error: unknown): error is FileOperationFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { ok?: unknown }).ok === false &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { path?: unknown }).path === 'string'
  )
}

export function isMissingPathFileError(error: unknown): boolean {
  if (isFileOperationFailure(error)) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR'
  }

  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return true

  const message = readErrorMessage(error).toLowerCase()
  return message.includes('enoent') || message.includes('no such file or directory')
}

export function unwrapSaveFileResult(result: SaveFileResult): void {
  if (!result.ok) throw result
}

export function unwrapReadFileResult(result: ReadFileResult): string {
  if (!result.ok) throw result
  return result.content
}
