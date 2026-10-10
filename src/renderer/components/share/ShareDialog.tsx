/**
 * ShareDialog (#768/#769) — gateway sign-in + FIRST publish only. Once a
 * document is published, the pinned ◎ status icon (ShareStatusIcon/
 * ShareStatusPopover) is the share surface: link, sync mode, share-latest,
 * conversation, revoke. The Toolbar routes "Share..." there when an entry
 * exists, so this dialog normally only ever sees unshared documents.
 *
 * Gated by the webPlatform feature flag (Toolbar renders the entry point).
 * Sign-in is the interim pre-#766 flow (#964): request a 6-digit code by
 * email, type it here. The main process records the requested address and
 * submits the code with it, so this dialog only ever passes digits.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { getApi } from '../../lib/browserApi'
import { buildShareArtifact } from '../../lib/shareArtifact'
import { backfillShareThreads } from '../../lib/sharePush'
import { pushShareContent } from '../../lib/shareContentSync'
import { useEditor } from '../../hooks/useEditor'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useShareStore } from '../../stores/shareStore'
import { useNotificationStore } from '../../stores/notificationStore'
import type { ShareEntry } from '../../types'
import { Loader2 } from 'lucide-react'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AuthState =
  | { phase: 'loading' }
  /** `codeSentTo`: the address a code was just mailed to, or null. */
  | { phase: 'signed-out'; codeSentTo: string | null }
  | { phase: 'signed-in'; email?: string }

export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  const { document } = useEditor()
  const [auth, setAuth] = useState<AuthState>({ phase: 'loading' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [entry, setEntry] = useState<ShareEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    const status = await getApi().shareAuthStatus()
    if (status.ok && status.signedIn) {
      setAuth({ phase: 'signed-in', email: status.email })
    } else {
      setAuth({ phase: 'signed-out', codeSentTo: null })
    }
    if (document.path) {
      const existing = await getApi().shareGetForPath(document.path)
      setEntry(existing.ok && existing.entries.length > 0 ? existing.entries[0] : null)
    } else {
      setEntry(null)
    }
  }, [document.path])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  // The email's "Open in Prose" link signs in from the main process (#964).
  // With the dialog open, show the outcome in place; otherwise as a toast.
  useEffect(() => {
    const off = getApi().onShareAuthChanged?.((result) => {
      if (open) {
        setCode('')
        if (result.ok) void refresh()
        else setError(result.error)
        return
      }
      useNotificationStore.getState().notify({
        id: 'share-sign-in',
        message: result.ok
          ? `Signed in to sharing${result.email ? ` as ${result.email}` : ''}.`
          : result.error,
      })
    })
    return () => off?.()
  }, [open, refresh])

  const run = useCallback(async (label: string, action: () => Promise<string | null>) => {
    setBusy(label)
    setError(null)
    try {
      const err = await action()
      if (err) setError(err)
    } finally {
      setBusy(null)
    }
  }, [])

  const handleRequestCode = () =>
    run('request', async () => {
      const address = email.trim()
      const res = await getApi().shareRequestSignIn(address)
      if (!res.ok) return res.error
      setCode('')
      setAuth({ phase: 'signed-out', codeSentTo: address })
      return null
    })

  const handleCompleteSignIn = (digits: string) =>
    run('complete', async () => {
      const res = await getApi().shareCompleteSignIn(digits)
      if (!res.ok) {
        // Every failure leaves the typed code unusable (wrong, expired, or
        // burned), so clear it for the next attempt.
        setCode('')
        return res.error
      }
      setCode('')
      await refresh()
      return null
    })

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && busy === null) void handleCompleteSignIn(digits)
  }

  const handleDifferentEmail = () => {
    setCode('')
    setError(null)
    setAuth({ phase: 'signed-out', codeSentTo: null })
  }

  const openShareControls = useCallback(() => {
    onOpenChange(false)
    useShareStore.getState().setPopoverOpen(true)
  }, [onOpenChange])

  const handlePublish = () =>
    run('publish', async () => {
      const artifact = await buildShareArtifact(useEditorInstanceStore.getState().editor, {
        content: document.content,
        path: document.path,
        frontmatter: document.frontmatter,
        documentId: document.documentId,
      })
      if (!artifact) return 'Save the document before sharing.'
      const res = await getApi().sharePublish({
        ...artifact,
        localPath: document.path as string,
        documentId: document.documentId,
      })
      if (!res.ok) return res.error
      // Hand off to the pinned ◎ — it appears immediately with the new entry.
      useShareStore.getState().applyEntry(res.entry)
      openShareControls()
      // Threads written before this publication existed have no server rows
      // — the just-PUT artifact baked them under desktop ids. Push them and
      // re-bake so viewer replies to them have live rows to land on.
      void backfillShareThreads().then((pushed) => {
        if (pushed) void pushShareContent('manual')
      })
      return null
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share for comments</DialogTitle>
        </DialogHeader>

        {auth.phase === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking gateway session…
          </div>
        )}

        {auth.phase === 'signed-out' && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Sign in to the Prose gateway to publish a share link.
            </p>
            {auth.codeSentTo === null ? (
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && busy === null && email.trim()) handleRequestCode()
                  }}
                  disabled={busy !== null}
                />
                <Button onClick={handleRequestCode} disabled={busy !== null || !email.trim()}>
                  {busy === 'request' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  We emailed a 6-digit code to {auth.codeSentTo}. Enter it here.
                </p>
                <div className="flex gap-2">
                  <Input
                    aria-label="Sign-in code"
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    className="font-mono tracking-[0.3em]"
                    value={code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    disabled={busy !== null}
                  />
                  <Button
                    onClick={() => handleCompleteSignIn(code)}
                    disabled={busy !== null || code.length !== 6}
                  >
                    {busy === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                  </Button>
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                    onClick={handleRequestCode}
                    disabled={busy !== null}
                  >
                    {busy === 'request' ? 'Sending…' : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                    onClick={handleDifferentEmail}
                    disabled={busy !== null}
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {auth.phase === 'signed-in' && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Signed in{auth.email ? ` as ${auth.email}` : ''}.
            </p>

            {!document.path && (
              <p className="text-sm text-muted-foreground">
                Save this document to a file before sharing.
              </p>
            )}

            {document.path && entry && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This document is already shared — the ◎ icon in the top-right corner of the
                  document is its share surface.
                </p>
                <Button onClick={openShareControls} variant="outline" className="w-full">
                  Open share controls
                </Button>
              </div>
            )}

            {document.path && !entry && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Publish this document (comments included) to a private link. Anyone with the
                  link can read and comment — no account needed. New comments and your replies
                  sync live; content updates follow the sync mode on the ◎ icon.
                </p>
                <Button onClick={handlePublish} disabled={busy !== null} className="w-full">
                  {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Publish share link'}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
