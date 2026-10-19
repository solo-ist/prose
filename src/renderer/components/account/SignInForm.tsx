import { Loader2 } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { useAccountStore } from '../../stores/accountStore'

/**
 * The signed-out half of the gateway sign-in flow: email → 6-digit code.
 *
 * Shared by the Share dialog and Settings → Account so the two cannot drift apart
 * (#1059). All state lives in `accountStore`; this renders it and nothing else.
 */
export function SignInForm({ codeSentTo }: { codeSentTo: string | null }) {
  const busy = useAccountStore((s) => s.busy)
  const emailInput = useAccountStore((s) => s.emailInput)
  const codeInput = useAccountStore((s) => s.codeInput)
  const setEmailInput = useAccountStore((s) => s.setEmailInput)
  const setCodeInput = useAccountStore((s) => s.setCodeInput)
  const requestCode = useAccountStore((s) => s.requestCode)
  const completeSignIn = useAccountStore((s) => s.completeSignIn)
  const useDifferentEmail = useAccountStore((s) => s.useDifferentEmail)

  // Submit as soon as the sixth digit lands — the code is fixed-length, so making
  // the user also press a button adds a step with no decision in it.
  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCodeInput(digits)
    if (digits.length === 6 && busy === null) void completeSignIn(digits)
  }

  if (codeSentTo === null) {
    return (
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="you@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && busy === null && emailInput.trim()) void requestCode()
          }}
          disabled={busy !== null}
        />
        <Button onClick={() => void requestCode()} disabled={busy !== null || !emailInput.trim()}>
          {busy === 'request' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        We emailed a 6-digit code to {codeSentTo}. Enter it here.
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
          value={codeInput}
          onChange={(e) => handleCodeChange(e.target.value)}
          disabled={busy !== null}
        />
        <Button
          onClick={() => void completeSignIn(codeInput)}
          disabled={busy !== null || codeInput.length !== 6}
        >
          {busy === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
        </Button>
      </div>
      <div className="flex gap-3 text-xs">
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() => void requestCode()}
          disabled={busy !== null}
        >
          {busy === 'request' ? 'Sending…' : 'Resend code'}
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          onClick={useDifferentEmail}
          disabled={busy !== null}
        >
          Use a different email
        </button>
      </div>
    </div>
  )
}
