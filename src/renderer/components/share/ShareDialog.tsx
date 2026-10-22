/**
 * ShareDialog (#768/#769) — gateway sign-in + FIRST publish only. Once a
 * document is published, the pinned ◎ status icon (ShareStatusIcon/
 * ShareStatusPopover) is the share surface: link, sync mode, share-latest,
 * conversation, revoke. The Toolbar routes "Share..." there when an entry
 * exists, so this dialog normally only ever sees unshared documents.
 *
 * Gated by the webPlatform feature flag (Toolbar renders the entry point),
 * which is on by default since 1.8.1. Sign-in is the interim pre-#766 flow
 * (#964): request a 6-digit code by email, type it here. The main process
 * records the requested address and submits the code with it, so this dialog
 * only ever passes digits.
 *
 * Sharing is an invite-only beta (#1018). Once signed in, the dialog asks the
 * gateway where THIS user stands: invited users publish, everyone else can
 * request access. The check is deliberately post-sign-in — asking before
 * would let anyone probe which addresses are in the beta.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { getApi } from '../../lib/browserApi'
import { buildShareArtifact } from '../../lib/shareArtifact'
import { backfillShareThreads } from '../../lib/sharePush'
import { pushShareContent } from '../../lib/shareContentSync'
import { useAccountStore, bindAccountDeepLink } from '../../stores/accountStore'
import { SignInForm } from '../account/SignInForm'
import { useEditor } from '../../hooks/useEditor'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useShareStore } from '../../stores/shareStore'
import type { ShareEntry } from '../../types'
import { Loader2 } from 'lucide-react'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  const { document } = useEditor()
  // Session state is shared with Settings → Account (#1059) so the two surfaces
  // cannot disagree about who is signed in. Only `entry` is document-specific
  // and therefore still local.
  const auth = useAccountStore((s) => s.auth)
  const access = useAccountStore((s) => s.access)
  const busy = useAccountStore((s) => s.busy)
  const error = useAccountStore((s) => s.error)
  const refreshAccount = useAccountStore((s) => s.refresh)
  const signOut = useAccountStore((s) => s.signOut)
  const requestAccess = useAccountStore((s) => s.requestAccess)
  const setAccess = useAccountStore((s) => s.setAccess)
  const runAction = useAccountStore((s) => s.runAction)
  const surfaceShown = useAccountStore((s) => s.surfaceShown)
  const surfaceHidden = useAccountStore((s) => s.surfaceHidden)
  const [entry, setEntry] = useState<ShareEntry | null>(null)

  const refresh = useCallback(async () => {
    await refreshAccount()
    if (document.path) {
      const existing = await getApi().shareGetForPath(document.path)
      setEntry(existing.ok && existing.entries.length > 0 ? existing.entries[0] : null)
    } else {
      setEntry(null)
    }
  }, [document.path, refreshAccount])

  useEffect(() => {
    if (!open) return
    // Registering as a visible surface keeps a deep-link sign-in showing in place
    // here rather than as a toast; the store owns the subscription itself.
    bindAccountDeepLink()
    surfaceShown()
    void refresh()
    return () => surfaceHidden()
  }, [open, refresh, surfaceShown, surfaceHidden])

  const openShareControls = useCallback(() => {
    onOpenChange(false)
    useShareStore.getState().setPopoverOpen(true)
  }, [onOpenChange])

  const handlePublish = () =>
    runAction('publish', async () => {
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
      if (!res.ok) {
        // The grant can change under an open dialog (revoked, or never there
        // when the access check was unavailable): show where they stand.
        if (res.code === 'forbidden') {
          const standing = await getApi().shareAccess()
          if (standing.ok && !standing.canPublish) {
            setAccess(standing.requested ? 'requested' : 'not-invited')
            return null
          }
        }
        return res.error
      }
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
              Sharing is in invite-only beta. Sign in with your email to publish, or to
              request access.
            </p>
            <SignInForm codeSentTo={auth.codeSentTo} />
          </div>
        )}

        {auth.phase === 'signed-in' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>Signed in{auth.email ? ` as ${auth.email}` : ''}.</p>
              <button
                type="button"
                className="shrink-0 underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => void signOut()}
                disabled={busy !== null}
              >
                {busy === 'signout' ? 'Signing out…' : 'Sign out'}
              </button>
            </div>

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

            {document.path && !entry && access === 'not-invited' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Sharing is invite-only for now, and {auth.email ?? 'this address'} isn&apos;t in
                  the beta yet. Request access and you&apos;ll get an email when it&apos;s on.
                </p>
                <Button onClick={() => void requestAccess()} disabled={busy !== null} className="w-full">
                  {busy === 'request-access' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Request access'}
                </Button>
              </div>
            )}

            {document.path && !entry && access === 'requested' && (
              <p className="text-sm text-muted-foreground">
                Request sent. You&apos;ll get an email at {auth.email ?? 'this address'} when sharing
                is on for you.
              </p>
            )}

            {document.path && !entry && (access === 'can-publish' || access === 'unknown') && (
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
