/**
 * app.ts — the Hono application factory. Wiring order:
 *   secure headers → cors → sign-in code (/api/sign-in/*)
 *   → Better Auth (/api/auth/*) → health
 *   → gated LLM proxy (/api/llm/*) → gated share management (/api/share/*)
 *   → public share surface (/s/*)
 */
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { config } from './config.js'
import { bodyLimit } from 'hono/body-limit'
import { corsMiddleware } from './middleware/cors.js'
import { requireSession, type AppEnv } from './middleware/session.js'
import { requireEntitlement } from './middleware/entitlement.js'
import { rateLimit, userRateLimit } from './middleware/rateLimit.js'
import { ipRateLimit } from './middleware/ipRateLimit.js'
import { auth } from './auth/index.js'
import { SIGN_IN_LINK_PATH, signInCodeRoutes } from './auth/code.js'
import health from './routes/health.js'
import { llmRoutes } from './routes/llm/stream.js'
import { shareAuthorRoutes } from './routes/share/author.js'
import { sharePublicRoutes } from './routes/share/public.js'
import { MAX_ARTIFACT_BYTES, buildShareUrl, hashShareToken } from './routes/share/common.js'
import { prisma } from './db/index.js'

// The sign-in email's "Open in Prose" page (#964). Reads code + state from
// the URL fragment (never sent to a server), shows the code, and hands both
// to the app via prose://auth. Strips the fragment from history afterwards.
// Static, so the CSP allows it by hash instead of 'unsafe-inline'; any edit
// changes the hash automatically. The patterns mirror auth/code.ts and the
// desktop's parser (src/main/share/deepLink.ts).
const SIGN_IN_PAGE_SCRIPT =
  "(function(){var h=new URLSearchParams(location.hash.slice(1)),c=h.get('c')||'',s=h.get('s')||'';" +
  "history.replaceState(null,'',location.pathname);" +
  "if(!/^\\d{6}$/.test(c)){document.getElementById('missing').hidden=false;return}" +
  "document.getElementById('code').textContent=c;document.getElementById('found').hidden=false;" +
  "if(!/^[A-Za-z0-9_-]{22,64}$/.test(s))return;" +
  "var u='prose://auth?code='+c+'&state='+s,a=document.getElementById('open');" +
  "a.href=u;a.hidden=false;location.href=u})()"
const SIGN_IN_PAGE_SCRIPT_HASH = `sha256-${createHash('sha256').update(SIGN_IN_PAGE_SCRIPT).digest('base64')}`

export function createApp() {
  const app = new Hono<AppEnv>()

  // Dev-only request log. Share capability tokens are redacted from the path
  // (the raw token must never be logged); production logging is the
  // platform's concern.
  if (config.NODE_ENV === 'development') {
    app.use('*', async (c, next) => {
      const started = Date.now()
      await next()
      const path = c.req.path.replace(/^\/s\/[^/]+/, '/s/<token>')
      console.log(`[gateway] ${c.req.method} ${path} -> ${c.res.status} (${Date.now() - started}ms)`)
    })
  }

  // 2y HSTS (the gateway is TLS-only in every deployed environment).
  // xFrameOptions DENY globally: API responses are never framed, and served
  // share artifacts (#768) must not be — secureHeaders runs on unwind, so it
  // would overwrite a weaker per-route value anyway.
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
      xFrameOptions: 'DENY',
    })
  )

  // Origin isolation (#902 + #917): served share pages are author-controlled
  // HTML+JS by design, so when SHARE_BASE_URL is set they live on a
  // dedicated cookie-less host. The share host serves ONLY /s/* (+ health) —
  // artifact JS finds no API and no session there, and the two origins'
  // localStorage never mix. The API host redirects artifact PAGE loads to
  // the share host; the JSON comment sub-routes stay dual-host so file://
  // copies baked before the split keep publishing (they're capability-gated
  // and cookie-free — serving them on either host executes nothing).
  //
  // With SHARE_SUBDOMAINS=1 (#917): each publication gets its own subdomain
  // origin (<label>.<shareHost>), so every publication's localStorage is
  // isolated from every other's. Routing rules:
  //   - A label host IS part of the share host family — serve /s/* there.
  //   - GET /s/:token on the bare share host, the API host, or a WRONG label
  //     → 308 to the publication's own label host (look up by token hash).
  //     Unknown token → 404. Revoked → 410 (no redirect — page is gone).
  //   - JSON sub-routes (/s/:token/comments, replies, PATCH/DELETE) work on
  //     ANY host (bare share, API, or label) — older file:// copies bake the
  //     bare host and CORS * applies anyway. A mismatched label host serves
  //     them without 404'ing: the token IS the credential; the host is not
  //     security-sensitive for JSON routes since CORS * is already open.
  const shareHost = (() => {
    if (!config.SHARE_BASE_URL) return null
    const host = new URL(config.SHARE_BASE_URL).host
    if (host === new URL(config.BETTER_AUTH_URL).host) {
      console.warn('[app] SHARE_BASE_URL matches the API host — origin isolation disabled')
      return null
    }
    return host
  })()
  if (shareHost) {
    const ARTIFACT_PAGE = /^\/s\/[^/]+$/

    /** True when `host` is the bare share host OR any label subdomain of it. */
    function isShareHostFamily(host: string | undefined): boolean {
      if (!host) return false
      return host === shareHost || host.endsWith(`.${shareHost}`)
    }

    app.use('*', async (c, next) => {
      const host = c.req.header('host') ?? ''
      const path = c.req.path

      if (isShareHostFamily(host)) {
        // Share host family: only /s/* and /health are valid.
        if (!path.startsWith('/s/') && path !== '/health') {
          return c.text('Not found', 404)
        }

        // Per-publication subdomain mode (#917): enforce that each publication
        // is accessed from its OWN label host for the artifact page.
        if (config.SHARE_SUBDOMAINS && ARTIFACT_PAGE.test(path) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
          const token = path.slice(3) // strip /s/
          const pub = await prisma.publication.findUnique({
            where: { tokenHash: hashShareToken(token) },
            select: { hostLabel: true, revokedAt: true },
          })
          if (!pub) {
            // Unknown token — fall through to the /s/* handler for the 404.
            await next()
            return
          }
          if (pub.revokedAt) {
            // Revoked: fall through to the /s/* handler which serves the 410 page.
            await next()
            return
          }
          if (pub.hostLabel) {
            const correctLabelHost = `${pub.hostLabel}.${shareHost}`
            if (host !== correctLabelHost) {
              // Wrong label (bare share host or a different label) → 308 to the
              // publication's own label host, preserving the query string.
              // Use .host (hostname:port) not .hostname to preserve the port.
              const shareUrl = new URL(config.SHARE_BASE_URL!)
              shareUrl.host = correctLabelHost
              const dest = `${shareUrl.origin}${path}${c.req.url.includes('?') ? '?' + new URL(c.req.url).searchParams.toString() : ''}`
              return c.redirect(dest, 308)
            }
          }
        }

        await next()
        return
      }

      // API host: redirect artifact page loads to the share host family.
      if (ARTIFACT_PAGE.test(path) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        if (config.SHARE_SUBDOMAINS) {
          // Look up the publication to get its label host.
          const token = path.slice(3)
          const pub = await prisma.publication.findUnique({
            where: { tokenHash: hashShareToken(token) },
            select: { hostLabel: true, revokedAt: true },
          })
          if (!pub) {
            // Unknown token — serve 404 directly (no useful redirect target).
            return c.text('Not found', 404)
          }
          if (pub.revokedAt) {
            // Revoked: redirect to the bare share host which will serve the 410 page.
            const shareBase = config.SHARE_BASE_URL!.replace(/\/$/, '')
            return c.redirect(shareBase + path, 308)
          }
          if (pub.hostLabel) {
            // Use .host (hostname:port) not .hostname to preserve the port.
            const shareUrl = new URL(config.SHARE_BASE_URL!)
            shareUrl.host = `${pub.hostLabel}.${shareHost}`
            const dest = `${shareUrl.origin}${path}${c.req.url.includes('?') ? '?' + new URL(c.req.url).searchParams.toString() : ''}`
            return c.redirect(dest, 308)
          }
        }
        // Subdomains off (or no label): redirect to the bare share host.
        const shareBase = config.SHARE_BASE_URL!.replace(/\/$/, '')
        return c.redirect(shareBase + path, 308)
      }

      await next()
    })
  }

  app.use('/api/*', corsMiddleware)

  // Sign-in (#964): the gateway emails the code (auth/code.ts); Better Auth
  // verifies it at /api/auth/sign-in/email-otp. Better Auth's own limiter is
  // off (it can't see client IPs behind Render), so cap code checks per IP
  // here. Each code also burns after 5 wrong tries (auth/index.ts).
  app.use('/api/sign-in/*', bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'body_too_large' }, 413) }))
  app.route('/api/sign-in', signInCodeRoutes)
  app.use('/api/auth/sign-in/*', ipRateLimit(config.SIGN_IN_VERIFY_IP_MAX, 600))

  // Better Auth owns all /api/auth/* routes (code sign-in, session, sign-out…).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // "Open in Prose" fallback page (#964). Mail clients often refuse custom
  // schemes in links, so the email links here (https) and this page opens
  // prose://auth, falling back to showing the code to type.
  app.get(SIGN_IN_LINK_PATH, (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in to Prose</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:480px;margin:3rem auto;padding:0 1.5rem;color:#111;background:#fff;text-align:center}
    h1{font-size:1.25rem;margin-bottom:0.5rem}
    p{color:#374151;line-height:1.6;margin:0.5rem 0}
    #code{font-family:ui-monospace,monospace;font-size:2rem;letter-spacing:0.3em;background:#f4f4f5;border-radius:6px;padding:0.75rem 1rem;margin:1rem 0}
    #open{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:0.6rem 1.25rem;border-radius:6px;margin:0.5rem 0}
    #open[hidden]{display:none}
    .note{font-size:0.8rem;color:#6b7280;margin-top:1.5rem}
    @media(prefers-color-scheme:dark){body{background:#0f172a;color:#f1f5f9}p{color:#cbd5e1}#code{background:#1e293b}.note{color:#94a3b8}}
  </style>
</head>
<body>
  <h1>Sign in to Prose</h1>
  <div id="found" hidden>
    <p>Prose should open and finish signing in. If it doesn&rsquo;t, enter this code in Prose:</p>
    <div id="code"></div>
    <a id="open" hidden>Open in Prose</a>
    <p class="note">The code expires 10 minutes after it was sent. If you didn&rsquo;t request it, you can ignore this page.</p>
  </div>
  <p id="missing" hidden>This link is missing its sign-in code. Use the 6-digit code in the email instead.</p>
  <script>${SIGN_IN_PAGE_SCRIPT}</script>
</body>
</html>`
    return c.html(html, 200, {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        `default-src 'none'; style-src 'unsafe-inline'; script-src '${SIGN_IN_PAGE_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    })
  })

  // Public liveness/DB probe.
  app.route('/', health)

  // Gated LLM proxy: session + ai_proxy entitlement + per-user rate limit,
  // all enforced before the handler opens an upstream connection. bodyLimit
  // runs first so an oversized POST is rejected before c.req.json() buffers
  // it; 1 MiB covers MAX_TOTAL_CONTENT_CHARS worst-case (multi-byte + JSON
  // escaping) while bounding memory on the 512MB instance.
  app.use(
    '/api/llm/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    requireSession,
    requireEntitlement('ai_proxy'),
    rateLimit
  )
  app.route('/api/llm', llmRoutes)

  // Gated share management (#768): publish/re-publish/list/comments/revoke.
  // The artifact ceiling covers image-fattened exports; the JSON envelope
  // roughly doubles the raw HTML bytes. Its OWN rate bucket — sharing the
  // LLM proxy's 20/min starved conversation migrations (one write per
  // thread/reply/resolve in a burst) and then 429'd the re-publish itself.
  app.use(
    '/api/share/*',
    bodyLimit({
      maxSize: MAX_ARTIFACT_BYTES * 2,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    requireSession,
    requireEntitlement('share_publish'),
    userRateLimit(config.SHARE_RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_S)
  )
  app.route('/api/share', shareAuthorRoutes)

  // Public share surface (#768): artifact serving + anonymous reviewer
  // comments. No session — per-IP rate limit only (~10 comments/min).
  // The GET is limited too (generously) to blunt token brute-forcing.
  app.use(
    '/s/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    ipRateLimit(60, 60)
  )
  app.route('/s', sharePublicRoutes)

  return app
}
