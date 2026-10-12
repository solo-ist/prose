/**
 * mail/templates/layout.ts — the one card every Prose email uses (#966).
 *
 * Ported from the Prose design system's `emails/sign-in-code.html`
 * (claude.ai/design project "Prose Email Options"): table layout, inline
 * styles, 600px single column, light by default with a
 * `prefers-color-scheme` dark block. Clients that strip <style> keep the
 * light inline version, which reads fine either way.
 *
 * Design rules carried over:
 * - Type is IBM Plex Mono with system-mono fallbacks; no web-font <link>
 *   (most clients strip it, Outlook falls back to Times).
 * - The wordmark is text (`¶ Prose.` in Fraunces → Georgia), never an image.
 * - No gradients, images or shadows. One action per email.
 * - Copy: sentence case, short declaratives, no exclamation marks, no "we".
 *
 * Every string field is escaped here. `block` is the one exception: it is
 * HTML the calling template builds from values it has already escaped.
 */
import { escapeHtml } from '../../util/html.js'

const MONO = "'IBM Plex Mono', Menlo, Consolas, 'Courier New', monospace"
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const HOME_URL = 'https://prose.solo.ist'

export interface EmailLayout {
  /** <title> and the card's <h1>. */
  title: string
  /** Inbox preview text shown next to the subject. Keep it under ~85 chars. */
  preheader: string
  /** One-sentence body under the heading. */
  intro: string
  /** Optional central block: trusted HTML built from escaped values. */
  block?: string
  /** Optional muted line directly under the block. */
  blockNote?: string
  /** Optional single action button. */
  action?: { label: string; href: string }
  /** Muted closing line, e.g. "Didn't request this? …" on security mail. */
  footnote: string
}

// Long run of non-joining spaces: stops clients from pulling body text into
// the inbox preview after the preheader.
const PREHEADER_PAD = '&nbsp;&zwnj;'.repeat(16)

const textRow = (cls: string, padding: string, style: string, content: string): string =>
  `        <tr><td class="${cls}" style="padding: ${padding}; font-family: ${MONO}; mso-line-height-rule: exactly; ${style}">\n          ${content}\n        </td></tr>`

export function renderEmail(p: EmailLayout): string {
  const rows: string[] = []

  rows.push(
    `        <tr><td class="pad ink" style="padding: 24px 40px 0 40px; font-family: ${SERIF}; font-style: italic; font-size: 20px; line-height: 20px; mso-line-height-rule: exactly; color: #09090b;">\n          ¶ Prose.\n        </td></tr>`,
    `        <tr><td class="pad" style="padding: 24px 40px 0 40px;">\n          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="rule" style="height: 1px; line-height: 1px; font-size: 1px; background: #e4e4e7;">&nbsp;</td></tr></table>\n        </td></tr>`,
    textRow(
      'pad ink',
      '32px 40px 0 40px',
      'font-size: 24px; line-height: 30px; font-weight: 600; color: #09090b;',
      `<h1 style="margin: 0; font-size: 24px; line-height: 30px; font-weight: 600; color: inherit; font-family: inherit;">${escapeHtml(p.title)}</h1>`
    ),
    textRow('pad ink', '16px 40px 0 40px', 'font-size: 16px; line-height: 26px; color: #09090b;', escapeHtml(p.intro))
  )

  if (p.block) {
    rows.push(`        <tr><td class="pad" style="padding: 24px 40px 0 40px;">\n${p.block}\n        </td></tr>`)
  }
  if (p.blockNote) {
    rows.push(textRow('pad muted', '12px 40px 0 40px', 'font-size: 13px; line-height: 20px; color: #52525b;', escapeHtml(p.blockNote)))
  }
  if (p.action) {
    rows.push(
      `        <tr><td class="pad" style="padding: 32px 40px 0 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
            <tr><td bgcolor="#18181b" class="btn" style="background: #18181b; border-radius: 6px;">
              <a href="${escapeHtml(p.action.href)}" style="display: block; padding: 12px 20px; font-family: ${MONO}; font-size: 14px; line-height: 20px; mso-line-height-rule: exactly; font-weight: 500; color: #fafafa; text-decoration: none;">${escapeHtml(p.action.label)}</a>
            </td></tr>
          </table>
        </td></tr>`
    )
  }
  rows.push(textRow('pad muted', '32px 40px 24px 40px', 'font-size: 13px; line-height: 20px; color: #52525b;', escapeHtml(p.footnote)))

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(p.title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table, td { font-family: Consolas, 'Courier New', monospace !important; }</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  @media only screen and (max-width: 620px) {
    .wrap { width: 100% !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .code { font-size: 32px !important; letter-spacing: 8px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background: #0f0f0f !important; }
    .card { background: #18181b !important; border-color: #2a2a2e !important; }
    .ink { color: #fafafa !important; }
    .muted { color: #a1a1aa !important; }
    .rule { background: #2a2a2e !important; }
    .codebox { background: #27272a !important; }
    .btn { background: #e2d9cb !important; }
    .btn a { color: #0f0f0f !important; }
  }
</style>
</head>
<body class="bg" style="margin: 0; padding: 0; background: #fafafa;">
<span style="display: none; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeHtml(p.preheader)}${PREHEADER_PAD}</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bg" style="background: #fafafa;">
<tr><td align="center" style="padding: 40px 0;">

  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width: 600px; max-width: 600px;">
    <tr><td style="padding: 0 24px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="card" style="width: 100%; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; border-collapse: separate;">
${rows.join('\n')}
      </table>

    </td></tr>
    <tr><td class="pad muted" style="padding: 24px 64px 0 64px; font-family: ${MONO}; font-size: 12px; line-height: 18px; mso-line-height-rule: exactly; color: #71717a;">
      Prose · <a href="${HOME_URL}" class="muted" style="color: #71717a; text-decoration: underline;">prose.solo.ist</a>
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>
`
}

/** The plain-text alternative's shared header and footer around a body. */
export function renderText(lines: string[]): string {
  return ['¶ Prose.', '', ...lines, '', `Prose · ${HOME_URL}`].join('\n')
}

export { MONO }
