/**
 * ShareDialog (#768) — publish the current document as a self-contained
 * share artifact, manage the resulting link, and view reviewer comments.
 *
 * Gated by the webPlatform feature flag (Toolbar renders the entry point).
 * Sign-in is the interim pre-#766 flow: request a magic link, paste it back
 * (the gateway logs it in dev; hosted delivery lands with #813/#766).
 *
 * Reviewer comments sync into the document's comment store on open and on
 * demand (#769, lib/shareSync) — the list below the actions is a read-only
 * overview of everything on the gateway.
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
import { Separator } from '../ui/separator'
import { getApi } from '../../lib/browserApi'
import { syncShareComments } from '../../lib/shareSync'
import { buildShareArtifact } from '../../lib/shareArtifact'
import { useEditor } from '../../hooks/useEditor'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import type { ShareEntry, SharePulledComment } from '../../types'
import { Copy, Check, Loader2 } from 'lucide-react'

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
  const [copied, setCopied] = useState(false)
  const [comments, setComments] = useState<SharePulledComment[] | null>(null)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)

  // Pull new reviewer comments into the document (#769), then load the full
  // gateway list for the overview below the actions.
  const syncAndLoad = useCallback(async (e: ShareEntry): Promise<string | null> => {
    const sync = await syncShareComments(e, document.documentId)
    if (sync.ok) setSyncedCount(sync.added)
    const res = await getApi().shareComments(e.publicationId)
    if (res.ok) setComments(res.comments)
    if (!sync.ok) return sync.error
    if (!res.ok) return res.error
    return null
  }, [document.documentId])

  const refresh = useCallback(async () => {
    setError(null)
    setComments(null)
    setSyncedCount(null)
    const status = await getApi().shareAuthStatus()
    if (status.ok && status.signedIn) {
      setAuth({ phase: 'signed-in', email: status.email })
    } else {
      setAuth({ phase: 'signed-out', linkRequested: false })
    }
    if (document.path) {
      const existing = await getApi().shareGetForPath(document.path)
      const found = existing.ok && existing.entries.length > 0 ? existing.entries[0] : null
      setEntry(found)
      // Opening the dialog on a published doc syncs automatically.
      if (found && status.ok && status.signedIn) {
        const err = await syncAndLoad(found)
        if (err) setError(err)
      }
    } else {
      setEntry(null)
    }
  }, [document.path, syncAndLoad])

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

  const buildArtifact = useCallback(async (): Promise<{ title: string; html: string } | null> => {
    return buildShareArtifact(useEditorInstanceStore.getState().editor, {
      content: document.content,
      path: document.path,
      frontmatter: document.frontmatter,
      documentId: document.documentId,
    })
  }, [document.content, document.frontmatter, document.path, document.documentId])

  const handlePublish = () =>
    run('publish', async () => {
      const artifact = await buildArtifact()
      if (!artifact) return 'Save the document before sharing.'
      const res = await getApi().sharePublish({
        ...artifact,
        localPath: document.path as string,
        documentId: document.documentId,
      })
      if (!res.ok) return res.error
      setEntry(res.entry)
      return null
    })

  const handleRepublish = () =>
    run('republish', async () => {
      if (!entry) return 'Nothing to re-publish.'
      const artifact = await buildArtifact()
      if (!artifact) return 'Save the document before sharing.'
      const res = await getApi().shareRepublish({ publicationId: entry.publicationId, ...artifact })
      if (!res.ok) return res.error
      setEntry(res.entry)
      return null
    })

  const handleRevoke = () =>
    run('revoke', async () => {
      if (!entry) return null
      const res = await getApi().shareRevoke(entry.publicationId)
      if (!res.ok) return res.error
      setEntry(null)
      setComments(null)
      return null
    })

  const handleCopy = async () => {
    if (!entry) return
    await getApi().copyToClipboard(entry.shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSyncComments = () =>
    run('comments', async () => {
      if (!entry) return null
      return syncAndLoad(entry)
    })

  const topLevel = (comments ?? []).filter((c) => !c.parentId)
  const repliesFor = (id: string) => (comments ?? []).filter((c) => c.parentId === id)

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

            {document.path && !entry && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Publish a snapshot of this document (comments included) to a private link.
                  Anyone with the link can read and comment — no account needed.
                </p>
                <Button onClick={handlePublish} disabled={busy !== null} className="w-full">
                  {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Publish share link'}
                </Button>
              </div>
            )}

            {document.path && entry && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input readOnly value={entry.shareUrl} className="min-w-0 flex-1 text-xs" />
                  <Button variant="outline" size="icon" onClick={handleCopy} aria-label="Copy share link" className="shrink-0">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Revision {entry.revCount} · published {new Date(entry.publishedAt).toLocaleDateString()}
                </p>
                <div className="flex gap-2">
                  <Button onClick={handleRepublish} disabled={busy !== null} variant="outline" className="flex-1">
                    {busy === 'republish' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-publish'}
                  </Button>
                  <Button onClick={handleSyncComments} disabled={busy !== null} variant="outline" className="flex-1">
                    {busy === 'comments' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sync comments'}
                  </Button>
                  <Button onClick={handleRevoke} disabled={busy !== null} variant="destructive" className="shrink-0">
                    {busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Revoke'}
                  </Button>
                </div>

                {syncedCount !== null && (
                  <p className="text-xs text-muted-foreground">
                    {syncedCount > 0
                      ? `${syncedCount} new comment${syncedCount === 1 ? '' : 's'} synced into the document.`
                      : 'Comments are up to date.'}
                  </p>
                )}

                {comments !== null && (
                  <>
                    <Separator />
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-2">
                      {topLevel.length === 0 && (
                        <p className="text-sm text-muted-foreground">No reviewer comments yet.</p>
                      )}
                      {topLevel.map((c) => (
                        <div key={c.id} className="rounded-md border p-2 text-sm">
                          {c.markedText && (
                            <p className="mb-1 line-clamp-2 border-l-2 pl-2 text-xs italic text-muted-foreground">
                              {c.markedText}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{c.commentText}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {c.authorName} · {new Date(c.createdAt).toLocaleDateString()}
                          </p>
                          {repliesFor(c.id).map((r) => (
                            <div key={r.id} className="mt-2 border-l-2 pl-2">
                              <p className="whitespace-pre-wrap break-words text-sm">{r.commentText}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {r.authorName} · {new Date(r.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Synced comments appear in the document as threads — reply or resolve them in
                      Comment Review. Re-publish to bake the latest state into the shared page.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
