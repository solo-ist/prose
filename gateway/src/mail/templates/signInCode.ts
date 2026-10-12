/**
 * mail/templates/signInCode.ts — the 6-digit sign-in code email (#964, #966).
 * Design: `emails/sign-in-code.html` in the Prose design system.
 */
import { escapeHtml } from '../../util/html.js'
import { MONO, renderEmail, renderText, type RenderedEmail } from './layout.js'

/**
 * `link` is the "Open in Prose" URL, or null when the request carried no
 * usable desktop state. Without it the email has no button: the code alone
 * signs in.
 */
export function signInCodeEmail(code: string, link: string | null, minutes: number): RenderedEmail {
  const safeCode = escapeHtml(code)
  // Screen readers read the spaced digits one by one instead of as a number.
  const spaced = escapeHtml(code.split('').join(' '))
  const block = `          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; border-collapse: separate;">
            <tr><td align="center" bgcolor="#f4f4f5" class="codebox code ink" aria-label="Sign-in code ${spaced}" style="background: #f4f4f5; border-radius: 6px; padding: 28px 16px; font-family: ${MONO}; font-size: 40px; line-height: 44px; mso-line-height-rule: exactly; font-weight: 500; letter-spacing: 12px; color: #09090b;">${safeCode}</td></tr>
          </table>`

  const html = renderEmail({
    title: 'Sign in to Prose',
    preheader: `Your Prose sign-in code is ${code}. Expires in ${minutes} minutes.`,
    intro: 'Enter this code in Prose to finish signing in.',
    block,
    blockNote: `Expires in ${minutes} minutes. Works once.`,
    ...(link ? { action: { label: 'Open in Prose', href: link } } : {}),
    footnote: "Didn't request this? Ignore this email. Nothing happens without the code.",
  })

  const text = renderText([
    'Sign in to Prose',
    '',
    'Enter this code in Prose to finish signing in.',
    '',
    `    ${code}`,
    '',
    `This code expires in ${minutes} minutes and works once.`,
    ...(link ? ['', 'Or open Prose with the code filled in:', link] : []),
    '',
    "Didn't request this? Ignore this email. Nothing happens without the code.",
  ])

  return { subject: `Your Prose sign-in code: ${code}`, html, text }
}
