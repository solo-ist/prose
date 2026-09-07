/**
 * ShareDialog (#768/#769) — gateway sign-in + FIRST publish only. Once a
 * document is published, the pinned ◎ status icon (ShareStatusIcon/
 * ShareStatusPopover) is the share surface: link, sync mode, share-latest,
 * conversation, revoke. The Toolbar routes "Share..." there when an entry
 * exists, so this dialog normally only ever sees unshared documents.
 *
 * Gated by the webPlatform feature flag (Toolbar renders the entry point).
 * Sign-in is the interim pre-#766 flow: request a magic link, paste it back
 * (the gateway logs it in dev; hosted delivery lands with #813/#766).
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
import { useEditor } from '../../hooks/useEditor'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useShareStore } from '../../stores/shareStore'
import type { ShareEntry } from '../../types'
import { Loader2 } from 'lucide-react'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AuthState =
  | { phase: 'loading' }
  | { phase: 'signed-out'; linkRequested: boolean }
  | { phase: 'signed-in'; email?: string }

export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  const { document } = useEditor()
  const [auth, setAuth] = useState<AuthState>({ phase: 'loading' })
  const [email, setEmail] = useState('')
  const [magicLink, setMagicLink] = useState('')
  const [entry, setEntry] = useState<ShareEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    const status = await getApi().shareAuthStatus()
    if (status.ok && status.signedIn) {
      setAuth({ phase: 'signed-in', email: status.email })
    } else {
      setAuth({ phase: 'signed-out', linkRequested: false })
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

  const handleRequestLink = () =>
    run('request', async () => {
      const res = await getApi().shareRequestSignIn(email.trim())
      if (!res.ok) return res.error
      setAuth({ phase: 'signed-out', linkRequested: true })
      return null
    })

  const handleCompleteSignIn = () =>
    run('complete', async () => {
      const res = await getApi().shareCompleteSignIn(magicLink.trim())
      if (!res.ok) return res.error
      setMagicLink('')
      await refresh()
      return null
    })

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
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy !== null}
              />
              <Button onClick={handleRequestLink} disabled={busy !== null || !email.trim()}>
                {busy === 'request' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send link'}
              </Button>
            </div>
            {auth.linkRequested && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  A magic link was issued. Until email delivery lands, it appears in the
                  gateway&apos;s logs — paste it here to finish signing in.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste the magic link"
                    value={magicLink}
                    onChange={(e) => setMagicLink(e.target.value)}
                    disabled={busy !== null}
                  />
                  <Button onClick={handleCompleteSignIn} disabled={busy !== null || !magicLink.trim()}>
                    {busy === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                  </Button>
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
