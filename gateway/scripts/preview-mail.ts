/**
 * preview-mail.ts — `npm run mail:preview` (#966). Renders every email
 * template with sample data to gateway/.mail-preview/ (gitignored) for a
 * browser check: open the .html files, and flip the OS appearance to see the
 * dark-mode block. Before switching a new template on, also send a live test
 * to Gmail, Apple Mail and Outlook; browsers are far more forgiving than
 * mail clients.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signInCodeEmail } from '../src/mail/templates/signInCode.js'
import { accessGrantedEmail, accessRequestedEmail, accessRequestOperatorEmail } from '../src/mail/templates/access.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.mail-preview')
const SAMPLE_LINK = 'https://api.prose.solo.ist/auth/code#c=404020&s=Zm9vYmFyYmF6cXV4cXV1eDEy'

const previews = {
  'sign-in-code': signInCodeEmail('404020', SAMPLE_LINK, 10),
  'sign-in-code-no-link': signInCodeEmail('404020', null, 10),
  'access-requested': accessRequestedEmail(),
  'access-request-operator': accessRequestOperatorEmail('reader@example.com'),
  'access-granted': accessGrantedEmail(),
}

mkdirSync(OUT, { recursive: true })
for (const [name, email] of Object.entries(previews)) {
  writeFileSync(join(OUT, `${name}.html`), email.html)
  writeFileSync(join(OUT, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`)
  console.log(`${name}: ${email.html.length} bytes  →  ${join(OUT, `${name}.html`)}`)
}
