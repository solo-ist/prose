/**
 * relay/pages.ts — the two pages a writer sees while connecting ChatGPT or
 * claude.ai to Prose (#1238, design §3 "Consent").
 *
 *   GET /oauth/sign-in   the existing email code sign-in, carrying the signed
 *                        authorization request so the provider resumes it
 *   GET /oauth/consent   "Allow <client> to use Prose?": the first of the
 *                        relay's two gates (the second is in the app)
 *
 * Both arrive with the OAuth provider's signed query string. Scripts are
 * static and allowed by CSP hash, as on /auth/code; every dynamic value in
 * the consent page is server-rendered through escapeHtml, never assigned as
 * HTML in the browser.
 */
import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { auth } from '../auth/index.js'
import { OAUTH_CONSENT_PATH, OAUTH_SIGN_IN_PATH } from '../auth/oauth.js'
import { prisma } from '../db/index.js'
import { escapeHtml } from '../util/html.js'
import { RELAY_SCOPES } from './scopes.js'

const STYLE = `:root{--bg:#fafafa;--card:#fff;--line:#e4e4e7;--ink:#09090b;--muted:#52525b;--faint:#71717a;--box:#f4f4f5;--btn:#18181b;--btn-ink:#fafafa;--warn:#92400e}
    @media(prefers-color-scheme:dark){:root{--bg:#0f0f0f;--card:#18181b;--line:#2a2a2e;--ink:#fafafa;--muted:#a1a1aa;--faint:#a1a1aa;--box:#27272a;--btn:#e2d9cb;--btn-ink:#0f0f0f;--warn:#fbbf24}}
    *{box-sizing:border-box}
    body{margin:0;padding:40px 24px;background:var(--bg);color:var(--ink);font-family:'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace;-webkit-text-size-adjust:100%}
    .wrap{max-width:552px;margin:0 auto}
    .card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:24px 40px}
    .mark{font-family:Fraunces,Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;line-height:20px}
    .rule{height:1px;background:var(--line);margin:24px 0 32px}
    h1{margin:0;font-size:24px;line-height:30px;font-weight:600;overflow-wrap:anywhere}
    p{margin:16px 0 0;font-size:16px;line-height:26px}
    ul{margin:12px 0 0;padding-left:20px;font-size:15px;line-height:24px}
    .note{margin-top:12px;font-size:13px;line-height:20px;color:var(--muted);overflow-wrap:anywhere}
    .warn{color:var(--warn)}
    label{display:block;margin-top:24px;font-size:13px;color:var(--muted)}
    input{display:block;width:100%;margin-top:8px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--box);color:var(--ink);font:inherit;font-size:16px}
    button{margin-top:24px;margin-right:8px;padding:12px 20px;border-radius:6px;border:1px solid var(--btn);background:var(--btn);color:var(--btn-ink);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
    button.secondary{background:transparent;color:var(--ink);border-color:var(--line)}
    button[disabled]{opacity:.6;cursor:default}
    .link{background:none;border:0;padding:0;margin:0;color:var(--muted);text-decoration:underline;font-size:13px}
    [hidden]{display:none}
    #error{color:var(--warn)}
    .site{padding:24px 40px 0;font-size:12px;line-height:18px;color:var(--faint)}
    @media(max-width:620px){body{padding:24px 16px}.card{padding:24px}.site{padding:24px 24px 0}}`

function page(c: Context, title: string, body: string, script?: string, status: 200 | 400 = 200) {
  const scriptHash = script ? `'sha256-${createHash('sha256').update(script).digest('base64')}'` : "'none'"
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    ${STYLE}
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      <div class="mark">&para; Prose.</div>
      <div class="rule"></div>
${body}
    </main>
    <div class="site">Prose &middot; prose.solo.ist</div>
  </div>${script ? `\n  <script>${script}</script>` : ''}
</body>
</html>`
  return c.html(html, status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptHash}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  })
}

/** A dead-end page for a request Prose can't continue (no script). */
export function oauthErrorPage(c: Context, heading: string, message: string) {
  return page(c, 'Connect to Prose', `      <h1>${escapeHtml(heading)}</h1>\n      <p>${escapeHtml(message)}</p>`, undefined, 400)
}

function expiredPage(c: Context) {
  return oauthErrorPage(c, 'This request has expired', 'Go back to the app you were connecting and start again.')
}

// The sign-in page: email → code → the provider resumes the authorization.
// The signed query rides as `oauth_query`; the provider checks its signature.
const SIGN_IN_SCRIPT =
  "(function(){var q=location.search.slice(1),email='',err=document.getElementById('error');" +
  "function show(m){err.textContent=m;err.hidden=!m}" +
  "function post(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})}" +
  "var f1=document.getElementById('email-form'),f2=document.getElementById('code-form');" +
  "f1.addEventListener('submit',function(e){e.preventDefault();show('');email=document.getElementById('email').value.trim();" +
  "var b=f1.querySelector('button');b.disabled=true;post('/api/sign-in/code',{email:email}).then(function(r){b.disabled=false;" +
  "if(r.ok){f1.hidden=true;f2.hidden=false;document.getElementById('sent-to').textContent=email;document.getElementById('code').focus()}" +
  "else if(r.status===429){show('Too many codes were requested. Wait a few minutes, then try again.')}" +
  "else{show('Prose couldn\\u2019t send a code to that address.')}}).catch(function(){b.disabled=false;show('Prose couldn\\u2019t be reached. Check your connection.')})});" +
  "f2.addEventListener('submit',function(e){e.preventDefault();show('');var otp=document.getElementById('code').value.replace(/\\D/g,'');" +
  "var b=f2.querySelector('button[type=submit]');b.disabled=true;post('/api/auth/sign-in/email-otp',{email:email,otp:otp,oauth_query:q})" +
  ".then(function(r){return r.json().catch(function(){return null}).then(function(d){return{ok:r.ok,d:d}})}).then(function(x){b.disabled=false;" +
  "if(x.ok&&x.d&&typeof x.d.url==='string'){location.assign(x.d.url)}" +
  "else if(x.d&&x.d.error==='invalid_signature'){show('This request has expired. Go back to the app you were connecting and start again.')}" +
  "else{show('That code didn\\u2019t work. Check it, or send a new one.')}}).catch(function(){b.disabled=false;show('Prose couldn\\u2019t be reached. Check your connection.')})});" +
  "document.getElementById('restart').addEventListener('click',function(){f2.hidden=true;f1.hidden=false;show('')})})()"

// The consent page: Allow / Deny post the decision with the signed query; the
// provider answers with where to go next (the client's redirect_uri).
const CONSENT_SCRIPT =
  "(function(){var q=location.search.slice(1),err=document.getElementById('error');" +
  "function show(m){err.textContent=m;err.hidden=!m}" +
  "function post(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})}" +
  "function decide(accept){show('');var bs=document.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].disabled=true;" +
  "post('/api/auth/oauth2/consent',{accept:accept,oauth_query:q}).then(function(r){return r.json().catch(function(){return null}).then(function(d){return{ok:r.ok,d:d}})})" +
  ".then(function(x){if(x.ok&&x.d&&typeof x.d.url==='string'){location.assign(x.d.url);return}" +
  "for(var i=0;i<bs.length;i++)bs[i].disabled=false;show('Prose couldn\\u2019t record that. Go back to the app you were connecting and start again.')})" +
  ".catch(function(){for(var i=0;i<bs.length;i++)bs[i].disabled=false;show('Prose couldn\\u2019t be reached. Check your connection.')})}" +
  "document.getElementById('allow').addEventListener('click',function(){decide(true)});" +
  "document.getElementById('deny').addEventListener('click',function(){decide(false)});" +
  "document.getElementById('switch').addEventListener('click',function(){post('/api/auth/sign-out',{}).finally(function(){location.assign('" +
  OAUTH_SIGN_IN_PATH +
  "?'+q)})})})()"

const SCOPE_TEXT: Record<string, string> = {
  read: 'Read the documents you have open in Prose, their comments and suggestions',
  propose: 'Suggest edits, revise its suggestions and reply to them. You accept or reject every one',
  comment: 'Add comments and replies, resolve and reopen comments',
  offline_access: 'Stay connected for up to 30 days without asking again',
}

/** The query string as the browser sent it (the signature covers it verbatim). */
function rawQuery(c: Context): string {
  const url = c.req.url
  const i = url.indexOf('?')
  return i < 0 ? '' : url.slice(i + 1)
}

async function querySignatureValid(query: string): Promise<boolean> {
  if (!query) return false
  try {
    return await verifyOAuthQueryParams(query, (await auth.$context).secret)
  } catch {
    return false
  }
}

export const relayPageRoutes = new Hono()

relayPageRoutes.get(OAUTH_SIGN_IN_PATH, async (c) => {
  if (!(await querySignatureValid(rawQuery(c)))) return expiredPage(c)
  return page(
    c,
    'Sign in to Prose',
    `      <h1>Sign in to Prose</h1>
      <p>To connect an app to Prose, sign in with the email you use for your Prose account. We&rsquo;ll email you a code.</p>
      <form id="email-form">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required maxlength="254">
        <button type="submit">Email me a code</button>
      </form>
      <form id="code-form" hidden>
        <p>Enter the 6-digit code we sent to <strong id="sent-to"></strong>.</p>
        <label for="code">Code</label>
        <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required maxlength="7">
        <button type="submit">Sign in</button>
        <button type="button" class="link" id="restart">Use a different email</button>
      </form>
      <p id="error" role="alert" hidden></p>`,
    SIGN_IN_SCRIPT
  )
})

relayPageRoutes.get(OAUTH_CONSENT_PATH, async (c) => {
  const query = rawQuery(c)
  if (!(await querySignatureValid(query))) return expiredPage(c)
  const params = new URLSearchParams(query)

  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers })
  } catch {
    return c.text('Service unavailable', 503)
  }
  if (!session?.user) return c.redirect(`${OAUTH_SIGN_IN_PATH}?${query}`, 302)

  const clientId = params.get('client_id') ?? ''
  const client = clientId
    ? await prisma.oauthClient.findUnique({ where: { clientId }, select: { name: true, clientDiscoveryId: true } })
    : null
  if (!client) return expiredPage(c)

  const verified = client.clientDiscoveryId === 'cimd'
  const name = client.name?.trim() || 'An app'
  let domain = ''
  if (verified) {
    try {
      domain = new URL(clientId).host
    } catch {
      /* a CIMD client id is always a URL */
    }
  }
  const requested = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)
  const scopes = [...RELAY_SCOPES.filter((s) => requested.includes(s)), ...(requested.includes('offline_access') ? ['offline_access'] : [])]
  const scopeList = scopes.length
    ? `<ul>${scopes.map((s) => `<li>${escapeHtml(SCOPE_TEXT[s] ?? s)}</li>`).join('')}</ul>`
    : '<ul><li>Nothing beyond knowing who you are</li></ul>'
  const identity = verified
    ? `<p class="note">Verified: this app is published by <strong>${escapeHtml(domain)}</strong>.</p>`
    : `<p class="note warn">Not verified: this app registered itself under this name. Continue only if you just asked ${escapeHtml(name)} to connect to Prose.</p>`

  return page(
    c,
    'Connect to Prose',
    `      <h1>Allow ${escapeHtml(name)} to use Prose?</h1>
      ${identity}
      <p>It is asking to:</p>
      ${scopeList}
      <p>It can only work on documents you have open in Prose, and never opens or lists your files. Prose will also ask you to approve it in the app, under Settings &rarr; Integrations &rarr; Connections, before it can see anything.</p>
      <p class="note">Signed in as ${escapeHtml(session.user.email)}. <button type="button" class="link" id="switch">Not you?</button></p>
      <button type="button" id="allow">Allow</button>
      <button type="button" class="secondary" id="deny">Deny</button>
      <p id="error" role="alert" hidden></p>`,
    CONSENT_SCRIPT
  )
})
