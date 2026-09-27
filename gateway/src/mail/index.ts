/**
 * mail/index.ts — thin email seam (#813).
 *
 * When RESEND_API_KEY is set, sends via Resend's /emails endpoint using
 * Node's built-in fetch (no new deps). When unset (dev / test without a
 * key) it logs to console — email is never silently dropped.
 *
 * RESEND_API_URL is a test-only override that points at a local mock
 * server; it is not documented for production use.
 */
import { config } from '../config.js'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendMail(msg: MailMessage): Promise<void> {
  if (!config.RESEND_API_KEY) {
    // Dev / test without a key: log so the operator can still read the link.
    console.log(
      `[mail] dev: would send to ${msg.to}\n  Subject: ${msg.subject}\n  (no RESEND_API_KEY — set it to enable email delivery)`,
    )
    return
  }

  const resendBase = config.RESEND_API_URL ?? 'https://api.resend.com'

  let res: Response
  try {
    res = await fetch(`${resendBase}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.MAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[mail] send failed: ${detail}`)
    throw new Error(`Mail delivery failed: ${detail}`)
  }

  if (!res.ok) {
    // Truncate the body to avoid logging any secrets that Resend might echo.
    const body = (await res.text()).slice(0, 200)
    console.error(`[mail] Resend returned ${res.status}: ${body}`)
    throw new Error(`Mail delivery failed (Resend ${res.status})`)
  }
}
