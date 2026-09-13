# Prose on the Web — Web Foundations Epic

**Status:** Planning (reconciled to Foundations MVP) · **Created:** 2026-06-13 · **Reconciled:** 2026-06-15 (spike split — 3 discovery spikes + 7 build phases) · **Infra decisions:** 2026-06-30 (Prisma 7, Render, Hover DNS, storage split — see §7) · **Comment-layer design:** 2026-08-27 (spike #776 resolved — embedded-artifact model, §4.3–4.5; ATProto + operating-model direction, §8) · **Owner:** Angel
**Parent epic:** Track C — Paid Platform Foundation ([#598](https://github.com/solo-ist/prose/issues/598))
**Children (filed 2026-06-15; native sub-issues of #598):** spikes [#601](https://github.com/solo-ist/prose/issues/601) · [#775](https://github.com/solo-ist/prose/issues/775) · [#776](https://github.com/solo-ist/prose/issues/776) — then phases [#765](https://github.com/solo-ist/prose/issues/765) · [#766](https://github.com/solo-ist/prose/issues/766) · [#767](https://github.com/solo-ist/prose/issues/767) · [#768](https://github.com/solo-ist/prose/issues/768) · [#769](https://github.com/solo-ist/prose/issues/769) · [#770](https://github.com/solo-ist/prose/issues/770) · [#771](https://github.com/solo-ist/prose/issues/771)
**Threads into:** web build ([#258](https://github.com/solo-ist/prose/issues/258), superseded), prose.solo.ist ([#364](https://github.com/solo-ist/prose/issues/364)), billing spike ([#602](https://github.com/solo-ist/prose/issues/602), resolved). Discovery spikes are children: [#601](https://github.com/solo-ist/prose/issues/601) auth · [#775](https://github.com/solo-ist/prose/issues/775) SSE · [#776](https://github.com/solo-ist/prose/issues/776) comment-sync.

> This is the canonical planning narrative for Prose's first real web surface. It was **reconciled on 2026-06-15** from the broader 2026-06-13 draft down to a **Foundations MVP**: accounts, a backend, server-side storage, hash-gated share links, and a thin at-cost paid tier. Everything beyond that (AtProto, Nostr, DWeb hosting, multi-provider LLM, managed published pages, real-time/CRDT comments) is preserved in a clearly-marked **Deferred** section (§8) with its seam kept open. Read `../roadmap.md` for wave context and `../../CLAUDE.md` for conventions.

---

## 1. What we're building (the Foundations MVP)

One epic — **Web Foundations** — that delivers five fundamentals on top of a single backend (the **gateway**). Everything else layers on later.

1. **Accounts / registration** — email magic-link to start, behind an *Account ⟂ credential* model so Nostr / AtProto / Google are additive later.
2. **Backend web service** — a self-hostable **monolith** (the gateway) that does auth, document storage, share-link serving, comment sync, and an **LLM proxy**.
3. **Subscription + entitlements** — one cheap **at-cost** plan, modeled so co-op/non-profit funding is a future experiment, not a corner we coded ourselves into.
4. **Frontend, user-facing** — once logged in, the full Prose web experience, with **server-side storage** for markdown *and* published HTML.
5. **Frontend, share-facing** — share a document via a **hash-protected URL** serving a **self-contained HTML artifact**: rendered content + embedded markdown + embedded comment threads + a tiny inline viewer, in one file. An invited reviewer can **read, comment, and reply** (no account); the same file opened from `file://` still shows its comments read-only. *(Reconciled 2026-08-27 — replaces the earlier "share SPA" concept; see §4.3–4.5.)*

**Key reframe:** the renderer *already runs in a browser* (§3). The net-new work is the **backend + the artifact/viewer layer**, not "porting to the browser."

---

## 2. How this maps to the roadmap

This epic is the product layer of **Track C — Paid Platform Foundation ([#598](https://github.com/solo-ist/prose/issues/598))**. It concretizes existing issues and concludes the two gating spikes.

| Roadmap item | Action |
| --- | --- |
| [#598](https://github.com/solo-ist/prose/issues/598) Paid Platform Foundation (epic) | **Parent.** 3 spikes (#601/#775/#776) + 7 phases (#765–771) tracked as native sub-issues. |
| [#258](https://github.com/solo-ist/prose/issues/258) Web version + HTML/publishing | **Closed (superseded)** by #598 + children #765–771. |
| [#364](https://github.com/solo-ist/prose/issues/364) prose.solo.ist (marketing shell + blog) | **Domain coordination** — the gateway + `/s/:token` serving share the domain. |
| [#601](https://github.com/solo-ist/prose/issues/601) Auth spike | **Resolved (2026-06-28) → Better Auth** (self-hostable, no Auth0); Account⟂credential + origin/CSRF settled. Fed #765. |
| [#775](https://github.com/solo-ist/prose/issues/775) SSE-proof spike | **New** — prove Anthropic SSE through Hono `streamSSE`; renderer protocol intact; gates #765/#766. |
| [#776](https://github.com/solo-ist/prose/issues/776) comment-sync design spike | **Resolved (2026-08-27) → the embedded-artifact model** (§4.3–4.5); reconciles #699; reshaped #768/#769. |
| [#602](https://github.com/solo-ist/prose/issues/602) Billing/metering spike | **Resolved** — one at-cost plan; entitlements decoupled from billing via a `granted_by` seam; impl in Phase 4 (#770). |
| [#699](https://github.com/solo-ist/prose/issues/699) comment threading | **Coordinated** — share comments (3a/3b) reuse its threading + resolved-state model, not a parallel schema. |
| [#685](https://github.com/solo-ist/prose/issues/685) (merged) / [#386](https://github.com/solo-ist/prose/issues/386) (closed) Activity history | **Reused** — Phase 3b extends the Activity projection for resolved-comment history. |
| [#683](https://github.com/solo-ist/prose/issues/683) BYOK · [#120](https://github.com/solo-ist/prose/issues/120) Google verify | Deferred; see §8 + §9. |

**Distribution model holds:** MAS is the free taste; paid lives on the self-distributed / web account layer (no Apple IAP). A MAS client may *sign in* to consume an externally-bought subscription (reader-app pattern) but must not advertise the purchase (anti-steering). Unified codebase, gated by build target + feature flags (§5).

---

## 3. What already exists (audit, verified 2026-06-15)

The renderer is **already web-capable**. The gap is a backend + identity layer.

| Area | State | Reuse |
| --- | --- | --- |
| **Web build** (`vite.web.config.ts`, `web-main.tsx`, `web-index.html`, `lib/webApi.ts`) | ✅ Works. Builds to `dist/web/`, mounts the real `<App/>` with a mock `window.api`. Scripts `dev:web`/`build:web`/`test:web`; 4 `e2e/web*.spec.ts`. | The shell of the web app + share viewer. Needs a **router** and a **single-doc view**. |
| **Cross-platform seam** (`getApi()`, `browserApi.ts`, `ElectronAPI` in `types/index.ts`) | ✅ Mature. All renderer code calls `getApi()`. **LLM is CORS-blocked** in-browser → today a stub. | Where the gateway client plugs in. `llmChatStream()` reroutes to the proxy; keep the `llm:stream:*` window-event protocol so `useChat` is untouched. |
| **HTML export** (`lib/htmlExport.ts` `buildProseHtml()`) | ✅ Standalone, round-trippable (inline CSS, base64 images, embedded markdown). | **Directly the flat-HTML share artifact.** |
| **Comments** (`extensions/comments/*`, IndexedDB `comments` store) | ⚠️ Local-only TipTap marks. `CommentData = {id, markedText, comment, createdAt, occurrenceIndex?, from, to}`, anchored by `markedText` + `occurrenceIndex` (**position-independent → network-portable**), stripped from `.md`. **Resolving DELETES the comment** (`unsetComment`). No authorship, no sync. | The biggest net-new work: authorship + a **sync engine** (3b) + resolution-to-history. |
| **Google sync** (`main/google/sync.ts`) | ✅ Bidirectional, **timestamp newest-wins** (no CRDT), per-doc `GoogleDocEntry` keyed by stable remote id, persisted to `.google/sync-metadata.json`; `getSyncMetadata`/`updateSyncMetadataEntry`/`removeSyncMetadataEntry` IPC. | **The model for comment sync** (3b): stable IDs, per-doc sync-metadata, newest-wins. |
| **Activity tab** (`AIEditsHistoryPanel`) | ✅ A **pure projection of `useAnnotationStore`** (no separate ledger; `detached:true` keeps overwritten entries as immutable history). Comments are **not** in it yet. | Phase 3b extends this projection to resolved comments. |
| **Auth/secrets** (`main/google/auth.ts`, `credentialStore.ts`) | ✅ Local-redirect OAuth + `safeStorage` keychain. | Generalize the *concept*; store the gateway session token via `credentialStore`. Web needs a backend redirect. |
| **Feature flags** (`lib/featureFlags.ts`) | ✅ `googleDocs` (opt-in), `remarkable` (on desktop / forced-off MAS via `isMasBuild()`). | New `webPlatform` flag, opt-in (`=== true`), MAS-gated. |

---

## 4. Architecture — the new pieces

```
                    ┌────────────── gateway/ (self-hostable monolith, prose.solo.ist) ──────────────┐
 Prose desktop      │  Hono + @hono/node-server · Postgres (Prisma 7) · Cloudflare R2 (blobs)        │
   getApi() ─IPC──▶ │  /api/auth/*       magic-link via a self-hostable auth library (engine = spike)│
   account:* share:*│  /api/llm/stream   GATED by ai_proxy entitlement → Anthropic SSE  ◀ meter point │
                    │  /api/documents/*  server-owned markdown CRUD (web users)                      │
 Prose web      ──▶ │  /api/share/*      publish/re-publish/revoke/comment-pull (author, 3a → 3b)     │
   fetch()          │  GET /s/:token     self-contained artifact from R2 (embedded comments + viewer) │
                    │  POST /s/:token/comments[/​:id/replies]   anonymous reviewer comments            │
 Reviewer's     ──▶ │  entitlements (granted_by seam) · sessions · llm_usage (write-only)             │
   browser          └──────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 The gateway (the long pole)
A **portable, self-hostable Node monolith** — Hono + Postgres (**Prisma 7**) + Cloudflare R2 — kept as one process for **self-hostability** (the co-op value), native streaming for the LLM proxy, and a clean path to add custom signature-based auth later. For the MVP it deploys to **Render** (managed web service + managed Postgres) with **DNS on Hover** and **Render-managed TLS** — but nothing pins it there; the fallback is a self-managed VPS (Hetzner/DO). See §7 for the infra decisions. Responsibilities: accounts, server-side document storage, share-link store + serving, comment sync, the LLM proxy, and entitlements.

- **LLM proxy** — renderer → gateway → Anthropic. Solves the web-mode CORS wall *and* is the metering chokepoint. **It is GATED from day one** by an `ai_proxy` entitlement / beta allowlist (Angel is the only user initially) — never an ungated proxy on the operator's key. `llm_usage` is a **write-only meter, not the gate**.

### 4.2 Identity (reframes #601)
**Account ⟂ credential.** A stable internal **Account** owns entitlements and documents; each auth method is a linked **credential** row (`type ∈ email_magic_link | google | nostr | atproto`). Entitlements attach to the Account, never to a provider — so additional identities are additive and never cost a user their subscription.

- **MVP = email magic-link only**, via **Better Auth** (self-hostable; the resolved **#601** pick, 2026-06-28) with its **Prisma adapter**. **Do not hand-roll session/token crypto.**
- Google / AtProto / Nostr → **Deferred** (§8); the credential row + a `verifyCredential(type, payload)` dispatch are the kept seams.

### 4.3 Share service — the self-contained artifact *(reconciled 2026-08-27, resolves #776)*

**The unit of sharing is a self-contained HTML artifact**, built on `htmlExport.ts`'s existing `buildProseHtml()`. Three embedded blocks:

1. `<script type="application/x-prose-markdown" data-encoding="base64">` — the existing round-trip markdown block, **unchanged** (`isProseHtml()`/`extractMarkdownFromHtml()` stay byte-compatible).
2. `<script type="application/x-prose-comments" data-version="1" data-encoding="base64">` — `{version, publishRev, publishedAt, comments: CommentData[]}`, the **full thread data** (replies, resolved, author) serialized after `mergeCommentsForPersistence()`. Base64 kills `</script>` breakout; string fields are additionally length-capped and control-character-stripped (`sanitizeCommentField`: comment ≤ 5000, name ≤ 100 chars) — deliberately **not** entity-escaped, since the viewer renders exclusively via `textContent` and escaping would corrupt legitimate text like `1 < 2` at display time.
3. `<script type="application/x-prose-share" data-version="1">` — `{shareEndpoint, publishRev, publishedAt}`, **published artifacts only** (never local exports). **No token in the PUBLISHED file** — the inline viewer reads it from `window.location.pathname`, so a gateway/R2 dump never exposes live links. The one place the full capability URL IS baked: annotated copies the viewer downloads from the served page gain a `shareUrl` field (the downloader already holds that URL) — this is what lets a local file:// copy publish its comments back (the public `/s/*` routes serve permissive CORS for exactly this; anonymous + capability-gated, no cookies).

`publishRev` = first 16 hex chars of SHA-256 over the rendered HTML + embedded markdown (content-derived — comments and share config excluded → identical content produces an identical rev, so re-publish is idempotent). Local "Export as HTML" now also embeds block 2, so **comments travel with every export** — the artifact survives the server dying (local-first holds).

- **Capability URL:** `https://prose.solo.ist/s/<token>`, token = 32 random bytes (256-bit, base64url). The server stores only `SHA-256(token)`; the raw token lives only in the URL → a DB dump never exposes live links. Never logged (log the `/s/` prefix only).
- `GET /s/:token` → stream the artifact from R2 (`shares/<pubId>/artifact.html`). Revoked → a small styled takedown page at 410 ("This link was taken down by its author." + a downloaded-copies-still-work note), served on the same artifact headers; the comment GET/POST surfaces keep JSON 410s. Headers: `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src data: https://fonts.gstatic.com; connect-src 'self'` (the fonts pair covers the artifact's Newsreader/Fraunces/IBM Plex Mono links; file:// copies fall back to the committed local stacks).
- **Author routes** (session + `share_publish` entitlement): `POST /api/share/publish`, `PUT /api/share/:pubId/publish` (re-publish keeps the token), `GET /api/share/:pubId/comments?since=ISO` (timestamp-cursor pull), `POST /api/share/:pubId/comments` (author new-thread push — `fromAuthor: true`, anchored by `markedText` + `occurrenceIndex`, `publishRev` = the currently-served rev), `POST /api/share/:pubId/comments/:commentId/replies` (author reply push — `fromAuthor: true`, name defaults `Author`), `PATCH /api/share/:pubId/comments/:commentId` (`{resolved: bool}` → `resolvedAt`, top-level rows only), `DELETE /api/share/:pubId` (revoke: sets `revokedAt`, deletes the R2 object, cascades comments), `GET /api/share` (list).
- **Reviewer/viewer routes** (public, length-validated): `POST /s/:token/comments` + `POST /s/:token/comments/:id/replies` (writes, ~10/min/IP) · `GET /s/:token/comments` (the viewer's live poll, ~30/min/IP; same capability the link already grants — `publicComment` excludes `authorEmail` by construction).
- **Tables:** `Publication` (id, tokenHash unique, authorId→User, title, r2Key, publishedAt/updatedAt, revokedAt?, revCount, publishRev, + nullable `atprotoAtUri`/`atprotoBskyPostUri` — the §8 ATProto seam) · `ShareComment` (id, publicationId cascade, markedText, occurrenceIndex, commentText, authorName, authorEmail? notification-only/never exposed, `fromAuthor` bool, `resolvedAt?` author-controlled, parentId? self-join for replies, publishRev, createdAt; index `(publicationId, createdAt)`).
- **Commenter identity:** **no account required.** A reviewer gives a display name + an **optional email used only for reply notifications**, plus a *very unpushy, optional* "create a Prose account" nudge — the captured email is a one-click magic-link seed. Both are remembered in the viewer's `localStorage` (`prose-commenter-name` / `prose-commenter-email`) and prefilled on the next comment; the email field appears wherever the comment can reach the server (served pages AND publish-capable local copies — a local draft posts it at Publish time, scoped to drafts this reader wrote in this page). **The email lives in storage and POST bodies only — never on a thread object, so it can never bake into an annotated copy** (e2e-guarded).

### 4.4 The inline viewer *(replaces the share-SPA concept; redesigned 2026-09-07 to the "two materials" spec)*

**No SPA, no second Rollup mount.** A hand-written vanilla-JS (ES5) IIFE plus stylesheet strings (`src/renderer/lib/viewerScript.ts`, template literals inlined into the artifact — no build step, diffable) and a baked chrome shell emitted by `htmlExport.ts`:

- **Two materials:** the article renders as a blog (Newsreader serif, 660px column, ivory/ink inversion pair on the `--bg`/`--fg` surface vars); everything Prose adds — sticky top bar (wordmark, comment count, theme toggle), doc header (eyebrow date + derived title when the doc lacks a leading H1), "— End" mark, footer with the annotated-copy download, marks, rail, forms — is IBM Plex Mono on the app's shadcn token set. Theme = `.dark` on `<html>`, set pre-paint by an inline init script (localStorage override, else `prefers-color-scheme`), toggleable and persisted. **All baked chrome lives OUTSIDE `<article>`** — the artifact `<article>` wraps exactly `editor.getHTML()`, the anchor-purity invariant, pinned by an e2e guard.
- renders the **comment panel** as a fixed floating sidebar on the right (340px, rounded, token `--background` surface — deliberately a different material than the ivory page; below the sticky chrome, most of the viewport height but not all): desktop-Prose card anatomy (serif 2-line-clamped quote on every card, name · date meta, flat hairline-separated replies), cards in **document order** of their marks with unanchored threads last; collapsed Resolved (cards dimmed) and "Lost their place" sections; the panel body scrolls internally — no stacking engine, no absolute tops, and page scroll can never drive panel content into the chrome. The article yields (`padding-right` on the page, <1460px only) so at wide widths the panel floats over pure whitespace. The compose form is a **popover-style card floating at the selection** (384px, prefer-below-flip-above, clamped to the viewport, scrolls with the text) with a "Commenting on" anchor-quote block; mark ↔ card activation syncs both ways (card scrolls into panel view, mark scroll-centers in the article). The file:// banner is a single fixed-height 36px row carrying only a "Local copy" label plus the draft state and Publish action — the full explanation lives in the panel note, so the banner never truncates a sentence.
- **anchors client-side:** threads without a baked span (live-merged, or posted before a reload) re-anchor from `markedText` + `occurrenceIndex` via a text-node index that skips ONLY U+0020 — structural parity with `restoreComments`' normalization (the e2e tripwire pins both sites); failures land in "Lost their place" (runtime state, never baked).
- detects mode by protocol — **`file://` → full in-file commenting as a DRAFT surface**: a local bar under the top bar carries the "local copy" line plus, when the copy has a baked `shareUrl`, a draft state ("Draft · N unpublished", where anything with a `local-` id counts — including additions baked by an earlier session) and a **Publish comments** action that pushes every local thread/reply up sequentially (remapping to server ids in place) and pulls the latest conversation in the same exchange; a publish-capable copy also **joins the live loop** (pull on open, 45s poll, focus pull — reading is strictly less privileged than the publish POST it can already make), so a reload re-shows comments it published in an earlier session and author replies reach the local reader; pull failures are swallowed — the copy opens anywhere, network or not, and a copy without `shareUrl` makes no requests at all. The footer's save link appears only when the page holds unsaved additions ("Save updated copy (N new)"), and the annotated copy remains the offline/sneakernet path (Prose re-imports it). `https://` + shareEndpoint → online commenting, token read from the `/s/<token>` path, never embedded in the served file;
- POSTs comments **and inline replies** to the reviewer routes, updating the rail optimistically under server ids; a 429 shows the honest retry time with the draft kept; a network failure or 5xx keeps the text in the page as a **"not sent"** thread with an offline chip + a download-recovery explainer (no auto-retry — the annotated copy is the recovery vehicle);
- **polls the live conversation** (`GET /s/:token/comments` on load, every 45s, on window focus, ~2s after a post — same-origin, so CSP `connect-src 'self'` holds): the merge dedupes threads and replies **by id** and never invents deletions on its own — but it IS authoritative for `resolvedAt` and for **owner revisions**: viewer rows adopt edited text/name (+ an "edited" marker via `editedAt`), and `deleted: true` tombstones remove the row and unwrap its highlight (author rows are never adopted over — their truth is the bake/desktop). A 410 stops polling, swaps the rail note to the takedown copy and closes every commenting entry point while the page stays readable. Author replies (`fromAuthor`, or nameless baked replies) get an "· author" tag;
- **owns its rows via anonymous edit tokens**: the creating POST returns a per-row `editToken` (random capability, stored on the row, returned ONLY in that response — `publicComment` is an explicit picker, so no read can leak it; held client-side in localStorage, never on a thread object an annotated copy could carry). Holding it makes the row's **name click-to-edit**, its **text editable inline** (PATCH, sets `editedAt`), and the row **deletable** — DELETE is a **soft tombstone** (content + email scrubbed, capability burned, row kept so polls/pulls convey the deletion and the republish backfill can't resurrect it). **A thread with live replies is editable only** (409 `has_replies`): nobody's words vanish because someone else retracted theirs. The author list's `commentCount` counts live rows only;
- **persists unpublished drafts in localStorage** (`prose-drafts:` + share token, else `publishRev`): this reader's `local-` threads/replies (not-sent fallbacks included) survive a reload and re-join the page by id (a re-opened annotated copy bakes the same ids — no duplicates), clearing on publish or draft delete; the beforeunload warning now fires only when storage is blocked and persistence ISN'T protecting them;
- **narrow mode (< 1000px):** no rail — marks get text-free superscript indices (numbered via CSS `attr(data-n)`, so article text is untouched), a fixed bottom bar carries the count, and threads open in a full-screen sheet with its own reply composer; the compose form docks as a fixed bottom card;
- renders comment content only via `textContent`/`createTextNode` — never `innerHTML`.

### 4.5 Sync model (3b) — content follows the mode; the conversation is always live

**The one-line contract:** *content follows the sync mode; the conversation is always live.* Comments are dialogue, not document state — versioning them was only ever an artifact of the bake model.

**Sync modes** (per publication, `syncMode` in `share-sync.json`, default `auto`):

- **auto** — every save (manual or autosave, caught as the editor store's `isDirty` true→false transition) schedules a background artifact push (`lib/shareContentSync.ts`: 4s quiet debounce + 15s per-publication floor against the ~20/min per-user budget and 8 MB artifacts). No user-facing version ceremony; `publishRev`/`revCount` stay as internal anchoring/diagnostic state.
- **publish** — content freezes at the last push; saves set a `shareDirty` badge on the status icon until "Share latest updates" pushes on demand. Push failures degrade to dirty + status `offline`/`error` and retry on the next save or window focus — local state is never blocked on the gateway.
- **Dirty is honest in both modes:** `shareDirty` is set the moment the document *goes* dirty (and seeded when an already-dirty doc's entry resolves — restored tabs), not only at save time. Content still pushes exclusively from saves — disk is the source of truth — so with autosave off the ◎ shows "unshared changes" with a *save to sync* hint instead of falsely reading synced over unsaved edits; publish mode's manual push hides while the doc is unsaved (it would publish the un-saved buffer).

**Live conversation, both directions and both modes:**

- **Pull** (reviewer → Prose): `share:pullComments` fetches since the stored cursor **without advancing it**; the renderer merges + persists, then acks (`share:ackCursor`) — a failed merge can never lose comments. Triggers: a 60s background poll while the shared doc is open and the window visible, window focus, and opening the ◎ popover (poll and focus share a 30s per-publication debounce; the popover pull is immediate) — the desktop matches the viewer's live poll instead of waiting for an app switch. The renderer reload (`loadComments` → `needsRestore` → `restoreComments`) derives anchors; unmatched threads are **flagged `anchorLost: true` and KEPT**.
- **Push** (Prose → reviewers): author **new threads, replies, and resolves** POST up immediately via `lib/sharePush.ts`, fire-and-forget, hooked ONLY into the user/AI action handlers (the Comment extension's `onCommentAdded` mirror for new threads — the shared choke point of the AddCommentDialog and `add_comment` tool paths, never fired by restore — plus CommentPopover, Comment Review, the AI tool executors) — **never into `saveComments`**, which also runs on tab flushes and the sync merge itself and would echo-loop. Failures queue and flush on focus / after content pushes. New threads land via `POST /api/share/:pubId/comments` as `fromAuthor` rows anchored by `markedText` + `occurrenceIndex` against the currently-served `publishRev`; a thread push that succeeds releases any replies/resolves written while it was in flight.
- **Dedupe invariant (threads AND replies):** a pushed row records its gateway row id as `shareId` (`CommentData.shareId` / `CommentReply.shareId`). The pull-merge treats a local row's `id` AND `shareId` as seen; artifact bakes emit the row **under `shareId`** (and never embed the field) — so one comment is one id everywhere: desktop store, baked page, live poll.
- **Backfill + conversation migration:** every content push runs `backfillShareThreads()` BEFORE baking (and an initial publish re-bakes once after it): threads with **no** server row (written before the doc was shared) are pushed so the artifact bakes under server ids, and threads whose `shareId` is **not a row in the live publication** (revoke deletes reviewer rows server-side; re-publish mints a new publication) are **re-seeded from the desktop store** — the source of truth for the whole conversation — with viewer identity preserved (`fromAuthor: false` + the original name on the author POST routes; the gateway rejects a nameless re-seed). Verified row ids are cached per publication for the session. Without this, replies to baked history 404 forever. The viewer degrades gracefully anyway: a reply 404 (stale history in an old tab/copy) becomes a local **not-sent** reply — never a dead-end error — and a local copy's publish chain skips such replies instead of aborting.
- **Resolution is one-way author-controlled:** PATCH pushes it up; the desktop pull ignores `resolvedAt` (local wins); the viewer treats the poll as authoritative. **Resolving preserves the thread as history** — never deletes.

**Surface:** the share UI is a **pinned ◎ status icon** top-right of the document (absent when unshared; states synced/dirty/syncing/offline-error per the Solo.ist glyph spec) with a popover — link + copy, Auto|Publish toggle, "Share latest updates", conversation count, revoke. `ShareDialog` shrinks to sign-in + first publish. Everything sits behind the `webPlatform` flag (force-off on MAS).

`src/main/share/` plumbing (parallel to `src/main/google/`): `metadata.ts` (entries in `share-sync.json` incl. `syncMode`; **raw tokens and the gateway session live in `credentialStore`/safeStorage, never in the JSON**), `client.ts` (Node fetch), `index.ts` (IPC-shaped ops). Rename/move: the `useTabs` rename path also calls `share:updateLocalPath`. No sockets, no SSE, **no CRDT** — the viewer poll + focus pulls are the whole transport. Types are backward-compatible optionals: `CommentData += {shareId?, anchorLost?, publishRev?}`, `CommentReply += {authorName?, shareId?}`.

Anchoring note: auto mode republishes frequently, so a reviewer can comment against a page one revision behind — anchors still resolve by `markedText` + `occurrenceIndex` and degrade to `anchorLost`, never dropped. The threading + resolved-state model is #699's, reused — not a parallel schema. **#769** implements this design; the earlier "design spike" framing of **#776 is resolved by this section**.

---

## 5. Security & MAS

- **Sharing = uploading a copy.** Local-first still holds: the file on disk stays the source of truth; a share deliberately copies a snapshot to the gateway. Make it explicit, visible, revocable; deleting the share deletes the server copy.
- **Origin + CSRF (decided in the #601 auth spike):** choose same-origin (SPA + gateway) vs cross-origin, and protect cookie-authed endpoints (`/api/llm/stream`, `/api/documents/*`) with **SameSite + CSRF tokens**, or switch to **bearer-token** auth. CSRF must not be left unaddressed.
- **Capability tokens** are bearer secrets: TLS-only, no logging, no Referer leakage, revocable.
- **Credentials** → `credentialStore` (`safeStorage`) only, never plaintext, never `homedir()`. No keys in `settings.json`.
- **Cross-surface sync is punted** — desktop stays local-first; web docs are server-owned; the only bridge is explicit publish/share. Keep the **storage interface abstract** so all-surfaces sync is additive.
- **MAS seams (#771):** gate every web-platform desktop surface behind the `webPlatform` flag **and** `IS_MAS_BUILD` (force-off, like reMarkable). Reader-app sign-in only — no IAP, no purchase/upsell UI (anti-steering). Skip MAS hardening for now; just keep the seams.
- **No `innerHTML` with shared/LLM content** — rendered through the existing safe path.

---

## 6. Phased plan (filed children)

**Spikes — all three resolved:** **#601** → Better Auth (2026-06-28) · **#775** → SSE-through-Hono proven (PR #808) · **#776** → comment-layer design locked 2026-08-27 (the embedded-artifact model in §4.3–4.5; reconciles #699's threading model). #601 + #775 fed #765/#766; #776 feeds #768/#769.

| Phase | Issue | Scope | Sequencing |
| --- | --- | --- | --- |
| **0** | [#765](https://github.com/solo-ist/prose/issues/765) | Gateway scaffold (Hono+PG+**Prisma 7**+R2) + deploy to **Render** (Hover CNAME → Render, Render-managed TLS). (Auth-library, origin/CSRF, SSE, and comment-sync work split into spikes #601/#775/#776.) | Skeleton ∥ spikes; auth+SSE integration gate on #601/#775 |
| **1** | [#766](https://github.com/solo-ist/prose/issues/766) | Accounts (`account:*` IPC + preload + `ElectronAPI`); **gated** LLM proxy (`ai_proxy` minimal allowlist, generalized in #770); web router + gateway client behind `getApi()`; `webPlatform` flag; `llm_usage` write-only meter. | After 0 (#765) |
| **2** | [#767](https://github.com/solo-ist/prose/issues/767) | Server-side document storage; `serverApi.ts` over the abstract storage interface; swap the web mock. | After 1 (#766) |
| **3a** | [#768](https://github.com/solo-ist/prose/issues/768) | **Share artifact + embedded viewer + one-way comments** (per §4.3–4.4): artifact comment/share blocks + `sanitizeCommentField`; inline viewer (`viewerScript.ts`); `Publication`/`ShareComment` tables + publish/serve/comment routes + rate limit + R2 activation; `ShareDialog`; `webPlatform` flag; `share_publish` entitlement. *(Share SPA dropped.)* | After 1 (#766) — **no longer gated on #767** (the artifact is self-contained) |
| **3b** | [#769](https://github.com/solo-ist/prose/issues/769) | **Live sync model** (per §4.5, reshaped 2026-09-07): sync modes (auto/publish) + background content push; live conversation both ways (viewer poll GET, author reply/resolve push, reply-dedupe invariant); `anchorLost` flagging; pinned ◎ status icon + popover as the share surface; rename hook; **resolution-to-history** (extend the Activity projection). | After 3a (#768); #776 design resolved in §4.3–4.5; reuses #685/#386 |
| **4** | [#770](https://github.com/solo-ist/prose/issues/770) | `entitlements` + gateway middleware; **manual/beta-invite grants**; `granted_by` seam + **unwired Stripe skeleton**; `sessions` for revocation. | After 1; resolves #602 |
| **×-cut** | [#771](https://github.com/solo-ist/prose/issues/771) | MAS seams + `webPlatform` flag across all surfaces. | Spans all |

---

## 7. Decisions captured

**From clarifying questions (2026-06-14):**
- **Backend:** self-managed **Hono + Postgres + Cloudflare R2** monolith.
- **Commenter identity:** no account; **optional notification email** + a very-unpushy optional account nudge.
- **Desktop ↔ web:** **publish-on-intent only** (no background sync).
- **Paid tier:** **entitlements + manual grants** (no payment collection yet).

**From corrections (2026-06-15):**
1. LLM proxy **gated from Phase 1** (`ai_proxy` entitlement); meter is write-only, not the gate.
2. **Origin/CSRF** decided in the #601 auth spike; cookie endpoints get SameSite+CSRF or bearer auth.
3. Auth engine: **drop Auth0**; self-hostable library inside the monolith; **#601 resolved → Better Auth** (2026-06-28), used via its Prisma adapter.
4. Comments = a **sync engine** modeled on `google/sync.ts` (stable IDs, per-doc sync-metadata, newest-wins, no CRDT); resolution **preserves to Activity history**, never deletes; re-anchor by `markedText`, "anchor lost" kept. **Split into 3a/3b**; coordinate #699.
5. **MAS** seams kept (flag + `IS_MAS_BUILD`, reader-app, `safeStorage`); no MAS hardening now.
6. **Cross-surface sync punted**; storage interface abstract.
7. **Billing:** one at-cost plan + entitlements + `granted_by` seam + unwired Stripe skeleton; **resolves #602**.

**Refinement (2026-06-15):** the discovery work was split into three discrete spikes — **#601** (auth engine + Account⟂credential + origin/CSRF), **#775** (SSE-through-Hono proof), **#776** (comment-sync design) — and **#765** slimmed to scaffold + deploy. All three spikes sit in **Do First** on the *Spikes — Discovery & De-risking* milestone (moved there 2026-06-16 when the explorations kicked off); the seven build phases are on *Wave 1*.

**Infrastructure decisions (2026-06-30):** with #601 resolved (Better Auth) and #775 proven (SSE-through-Hono, 15/15), Phase 0 (#765) moved to **Do First** and these infra choices were locked:

1. **ORM = Prisma 7** (over Drizzle) — safer migrations / reliable rename detection vs Drizzle Kit's destructive drop+create risk, Prisma Studio for inspecting accounts/entitlements, Better Auth's first-class Prisma adapter; Prisma 7 dropped the Rust engine (~1.6 MB / ~90 ms cold start), and Drizzle's bundle/edge advantage is irrelevant on a long-running Node service. *Constraint:* Prisma 7 compiles its query-compiler WASM at runtime — fine on Render (Node), would break on a Cloudflare Workers / edge runtime.
2. **Deploy = Render** (managed web service running the Docker image as a persistent process + managed Postgres, from $6/mo). **DNS = Hover** (`api.prose.solo.ist` CNAME → the Render target) with **Render-managed TLS (Let's Encrypt)**; **no CDN/proxy** in front (Cloudflare's only role in this stack is R2). Chosen over Fly for flat pricing, AWS-backed reliability, and cheap managed Postgres; **validated via a go/no-go gate** (SSE-unbuffered + Prisma-migrate-over-SSL on prod) before lock-in; VPS (Hetzner/DO) is the fallback, not Fly.
3. **Render buffers SSE by default** — the LLM-proxy route **must** set **`X-Accel-Buffering: no`** (+ `Cache-Control: no-cache`, `Connection: keep-alive`) and flush headers immediately. Render allows 100-minute responses, so long generations aren't cut (tune Node `keepAliveTimeout`/`headersTimeout`).
4. **Storage split:** document **content is markdown text → Postgres** (the #767 `documents` table), **never** object storage; **R2 holds binary blobs only** (embedded images, attachments, flat-HTML share snapshots, future hosted-OCR #439), **stubbed in Phase 0** (prove SDK/env). **No Render Disks** (a single-instance attachment pins the service to one instance and breaks zero-downtime deploys). **R2 over S3:** zero-egress + cheaper + S3-compatible (reversible to S3/B2/Wasabi/MinIO); revisit only for EU data-residency.

**Comment-layer design (2026-08-27, resolves #776):** the share surface is a **self-contained HTML artifact** (comments embedded in the file, inline vanilla-JS viewer, works from `file://`) rather than a share SPA; the gateway is a **thin relay** (hashed-token serving + anonymous comment POSTs + author cursor-pull); sync is a **pure data merge** in `src/main/share/` with all anchoring done by the renderer's existing `restoreComments` (extended to flag `anchorLost` instead of dropping). Consequences: **#768 de-gated from #767** (self-contained artifact needs no server doc storage), the `webPlatform` flag and `share_publish` entitlement land with #768, and `Publication` carries nullable ATProto seam columns from day one. Full design + build order: the 2026-08-27 plan (§4.3–4.5 here are the canonical distillation).

**A.5 go/no-go (2026-07-17): Render VALIDATED — GO.** The full §4d ladder ran against the live deploy (`prose-gateway.onrender.com`, commit `f070f34`): health 200 with `dbStatus: connected` (Prisma 7 `migrate deploy` over Render Postgres works), unauthenticated 401, magic-link sign-in → session cookie, authed-but-unentitled 403, and — after seeding the `ai_proxy` grant — a live Anthropic SSE stream arriving **incrementally** (first event 0.9 s; continuous delivery through a 73 s generation to a clean `message_stop`), proving both the anti-buffering posture and >60 s stream survival. Hardening from the #809 review verified live: production CORS refuses arbitrary localhost origins, disallowed models 400, and the per-user rate limit returns 429 + `Retry-After` after 20 req/min. One observational note: Render's proxy **consumes** `X-Accel-Buffering: no` (it does not appear in the client-visible response headers; Cloudflare fronts the response) — incremental arrival, not the header, is the correct external check. The VPS fallback is retired for Phase 0.

---

## 8. Deferred (seams kept — do NOT build now)

| Deferred capability | Kept seam |
| --- | --- |
| Google OAuth **web** login (formalize; [#120](https://github.com/solo-ist/prose/issues/120) gates public) | `credentials.type='google'` row |
| **ATProto document publishing** — *direction locked 2026-08-27, see [`atproto-publishing.md`](atproto-publishing.md)*: self-hosted PDS on a cheap VPS (`pds.prose.solo.ist`); lexicons = **`site.standard.document` + `at.markpub.markdown`** (community standards — no custom `ist.solo.prose.*`); comments via companion Bluesky post (`bskyPostRef`) bridged into the share viewer later | `credentials.type='atproto'` (Better Auth `account.providerId`) + a `PublishTarget` interface + nullable `atprotoAtUri`/`atprotoBskyPostUri` on `Publication` (kept from #768 day one) |
| Nostr (NIP-07) identity + public publishing | `credentials.type='nostr'` + `verifyCredential` dispatch |
| Distributed Press / IPFS / DWeb hosting | `PublishTarget` interface |
| Public/private **managed published pages** (beyond the flat-file share) | the `publications` table + share-serving route |
| Multi-provider / **BYOK** gateway-metering policy ([#683](https://github.com/solo-ist/prose/issues/683)) | the gateway proxy is the single metering point |
| Real-time / **CRDT** comments | the newest-wins sync engine (3b) |
| **Stripe payment collection** | `granted_by='stripe'` + the unwired webhook skeleton |
| Full **cross-surface (all-devices) sync** | the abstract storage interface (§5) |

---

## 9. Open questions

- **BYOK ([#683](https://github.com/solo-ist/prose/issues/683)) vs the meter:** a BYOK key could bypass gateway metering — needs a policy before BYOK ships on web.
- **Snapshot vs live markdown share:** MVP is a **snapshot with manual re-publish**; when (if ever) do we want live updates short of CRDT?
- **Wave-1 headline:** does "Prose anywhere (web)" become the Track C story over reMarkable parity? (Roadmap open question.)

## 10. Verification / QA

- **Web E2E** (`playwright.web.config.ts`, `test:web`): sign-in; gated proxy returns a clean block when un-entitled; artifact viewer from `file://` (rail renders embedded threads, no add-comment UI offline); publish → anonymous comment → author pull → revoke → 410; rate limit 429; `<script>` in a comment renders inert.
- **Desktop** via Circuit Electron: account sign-in (reader-app), publish/re-publish/revoke via ShareDialog, desktop↔web comment coherence incl. an anchor-lost collision case (3b), MAS force-off.
- **Security review** (`/security-review`): capability-token handling, CSRF/origin model, credential storage, MAS anti-steering.
- **Principles check:** markdown stays the source of truth; sharing is explicit/revocable; nothing destroys local content on a blocked/gated call.
