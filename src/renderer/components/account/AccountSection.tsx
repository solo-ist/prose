import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useAccountStore, bindAccountDeepLink } from '../../stores/accountStore'
import { useWebPlatformEnabled } from '../../lib/featureFlags'
import { SignInForm } from './SignInForm'

/**
 * Settings → Account (#1059). Sign-in state only — deliberately no membership or
 * entitlement layer, which is #955 and depends on #953's entitlements endpoint.
 *
 * The tab this fills was emptied by the Google Docs removal (#1057).
 */
export function AccountSection() {
  const webPlatform = useWebPlatformEnabled()
  const isMasBuild = !!window.api?.isMasBuild

  const auth = useAccountStore((s) => s.auth)
  const access = useAccountStore((s) => s.access)
  const busy = useAccountStore((s) => s.busy)
  const error = useAccountStore((s) => s.error)
  const refresh = useAccountStore((s) => s.refresh)
  const signOut = useAccountStore((s) => s.signOut)
  const requestAccess = useAccountStore((s) => s.requestAccess)
  const surfaceShown = useAccountStore((s) => s.surfaceShown)
  const surfaceHidden = useAccountStore((s) => s.surfaceHidden)

  const enabled = webPlatform && !isMasBuild

  useEffect(() => {
    if (!enabled) return
    bindAccountDeepLink()
    surfaceShown()
    void refresh()
    return () => surfaceHidden()
  }, [enabled, refresh, surfaceShown, surfaceHidden])

  // Web and MAS builds have no gateway session to show: every share channel there
  // returns "not available", so a sign-in form would be a dead end.
  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        {isMasBuild
          ? 'Account sign-in is not available in the Mac App Store version.'
          : 'Sharing is turned off, so there is no account to sign in to.'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {auth.phase === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking gateway session…
        </div>
      )}

      {auth.phase === 'signed-out' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sharing is in invite-only beta. Sign in with your email to publish, or to
            request access.
          </p>
          <SignInForm codeSentTo={auth.codeSentTo} />
        </div>
      )}

      {auth.phase === 'signed-in' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm">{auth.email ?? 'Signed in'}</p>
              <p className="text-xs text-muted-foreground">
                {access === 'can-publish'
                  ? 'You can publish share links.'
                  : access === 'requested'
                    ? 'Access requested — we will email you when you are in.'
                    : access === 'not-invited'
                      ? 'Sharing is invite-only for now.'
                      : 'Signed in to the sharing gateway.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void signOut()}
              disabled={busy !== null}
            >
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>

          {access === 'not-invited' && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void requestAccess()}
              disabled={busy !== null}
            >
              {busy === 'request-access' ? 'Requesting…' : 'Request access'}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
