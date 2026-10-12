/**
 * mail/templates/access.ts — the sharing beta's waitlist emails (#1018), on
 * the #966 card. Copy follows the design rules: sentence case, short
 * declaratives, no exclamation marks, no "we".
 */
import { escapeHtml } from '../../util/html.js'
import { monoBox, renderEmail, renderText, type RenderedEmail } from './layout.js'

/** Where a newly approved user gets the app (the updater handles the rest). */
export const DOWNLOAD_URL = 'https://github.com/solo-ist/prose/releases/latest'

/**
 * POSIX single-quote a value for a shell command line. Inside '…' nothing is
 * special; an embedded ' becomes '\''.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The command that approves `email`; shown to the operator, copy-paste ready
 * for a Render shell. The address is REQUESTER-CONTROLLED: sign-in accepts
 * local parts with `;`, `|`, `$`, backticks and the like, and anyone with
 * their own mail domain can receive a code at such an address. Unquoted, a
 * pasted command would run their shell on the gateway host, so it is always
 * single-quoted.
 */
export function grantCommand(email: string): string {
  return `npm run grant -- --email ${shellQuote(email)} --feature share_publish --by beta --notify`
}

/** To the requester, right after they ask. */
export function accessRequestedEmail(): RenderedEmail {
  const footnote = 'You asked for sharing access from Prose. Nothing else happens until the request is approved.'
  const html = renderEmail({
    title: 'Request received',
    preheader: 'Your request to try sharing in Prose is in.',
    intro: "Your request to try sharing in Prose is in. You'll get an email when sharing is on for this address.",
    footnote,
  })
  const text = renderText([
    'Request received',
    '',
    "Your request to try sharing in Prose is in. You'll get an email when sharing is on for this address.",
    '',
    footnote,
  ])
  return { subject: 'Your Prose sharing request', html, text }
}

/** To the operator, with reply-to set to the requester. */
export function accessRequestOperatorEmail(email: string): RenderedEmail {
  const command = grantCommand(email)
  const html = renderEmail({
    title: 'Sharing access request',
    preheader: `${email} asked to join the sharing beta.`,
    intro: `${email} asked to join the sharing beta. Reply to this email to reach them.`,
    block: monoBox(escapeHtml(command)),
    blockNote: 'Run it as a Render one-off job on prose-gateway to approve and email them.',
    footnote: 'Sent because OPERATOR_EMAIL is set on the gateway.',
  })
  const text = renderText([
    'Sharing access request',
    '',
    `${email} asked to join the sharing beta. Reply to this email to reach them.`,
    '',
    'To approve and email them, run as a Render one-off job on prose-gateway:',
    '',
    `    ${command}`,
  ])
  return { subject: `Sharing access request: ${email}`, html, text }
}

/** To an approved user (npm run grant -- --notify). */
export function accessGrantedEmail(): RenderedEmail {
  const steps = 'Open any document in Prose 1.8.1 or later, choose Share, and sign in with this address. Publishing works straight away.'
  const footnote = 'You got this because this address was added to the Prose sharing beta.'
  const html = renderEmail({
    title: 'Sharing is on',
    preheader: 'This address can now publish from Prose.',
    intro: 'This address can now publish from Prose.',
    blockNote: steps,
    action: { label: 'Get Prose', href: DOWNLOAD_URL },
    footnote,
  })
  const text = renderText([
    'Sharing is on',
    '',
    'This address can now publish from Prose.',
    '',
    steps,
    '',
    `Get Prose: ${DOWNLOAD_URL}`,
    '',
    footnote,
  ])
  return { subject: 'Sharing is on for your Prose account', html, text }
}
