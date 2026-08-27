# ATProto Document Publishing — Direction & Phasing

**Status:** Direction locked (research 2026-08-27) · **Build:** deferred — all phases gated (see boundaries) · **Owner:** Angel
**Parent:** Track C — Paid Platform Foundation ([#598](https://github.com/solo-ist/prose/issues/598)), §8 Deferred seam in [`web-platform.md`](web-platform.md)

> Prose documents should be distributable as records under the author's own DID — portable, federated, and readable by the wider ATmosphere, per the solo.ist local-first/sovereignty principles. This doc records the lexicon decision, the comment model, the PDS hosting posture, and the phased path. Nothing here builds yet.

---

## 1. Lexicon decision: adopt the community standards — no custom namespace

**Metadata: `site.standard.document` + `site.standard.publication` (Standard.site).** Created jointly by Leaflet, pckt.blog, and Offprint (late 2025); by mid-2026 it is the de-facto ATProto long-form standard — 6+ consuming apps (Leaflet, pckt.blog, Offprint, a WordPress plugin, EmDash, Sequoia, Standard Reader, the Heron/Anisota clients) and native enhanced card renders in the Bluesky app. `site.standard.document`'s `content` field is an **open union** (`$type`-discriminated), deliberately not mandating a content format.

**Content union: `at.markpub.markdown` (Markpub.at).** A companion lexicon family purpose-built to slot markdown into `site.standard.document.content`: `at.markpub.markdown` (flavor: CommonMark/GFM, extensions incl. YAML frontmatter) wrapping `at.markpub.text` (the markdown string + optional blob storage + facets). Prose's `.md` maps directly — file on disk → `at.markpub.text` → `content.$type='at.markpub.markdown'`; embedded images become blobs; `coverImage`/`title`/`description`/`tags` fill from frontmatter.

**Rejected:**
- **Custom `ist.solo.prose.*`** — zero readers outside our own tooling; the entire point of ATProto publishing is ecosystem reach. If Prose's format ever outgrows markdown, the `content` open union lets us add a Prose-specific type *later* without breaking the metadata layer.
- **WhiteWind `com.whtwnd.blog.entry`** — the markdown pioneer, but a single-consumer lexicon (WhiteWind only). Good prior art, no interop.
- **Leaflet `pub.leaflet.*`** — block-based rich text, explicitly not markdown; Leaflet itself now uses Standard.site for document metadata.

## 2. Comments in the ATmosphere

There is **no comment lexicon** — by design, the ecosystem convention is a **companion `app.bsky.feed.post`** announcing the document, referenced from the record's `bskyPostRef` field. Replies to that post *are* the comments; any Bluesky client can write them; `app.bsky.feed.getPostThread` reads them.

This is **orthogonal to the gateway comment layer** (web-platform.md §4.3–4.5), which serves share-link reviewers who have no Bluesky account. The two coexist; a future bridge renders Bluesky replies alongside gateway comments in the share viewer. Seam kept now: nullable `atprotoAtUri` + `atprotoBskyPostUri` columns on `Publication` from #768's first migration.

## 3. PDS hosting

**Self-hosted reference PDS (`bluesky-social/pds`) on a $6–10/mo VPS at `pds.prose.solo.ist`.** Requirements are trivial (1 vCPU / 1 GB / 10 GB; three Docker containers — PDS, Caddy auto-TLS, Watchtower; ports 80/443; one DNS A record). Custom-lexicon records need **no registration anywhere** — a PDS is lexicon-agnostic and stores any `$type`.

- **Not solo-prime for production**: uptime and networking (the Mac Studio + Cloudflare Tunnel pattern works and is the *dev/test* path, but home hosting makes critical identity infrastructure depend on a residential connection and a free tunnel tier).
- **DID:** `did:plc` accepted for now (same PLC-directory dependency every ATProto participant has); `did:web` rooted at `prose.solo.ist` is the escape hatch if PLC centralization becomes a problem. Account migration is tooled (`goat`) if the PDS ever moves.

## 4. Phases (all gated — do NOT build yet)

| Phase | Scope | Gate |
|---|---|---|
| **AT-0 (spike)** | Provision the VPS PDS; create the DID/handle; write + read back a test `site.standard.document` (+ `at.markpub.markdown` content) via `@atproto/api`; confirm the client library. | After #768 ships the `Publication` table |
| **AT-1** | `atproto` credential in Better Auth (`account.providerId='atproto'`, DID in `accountId`); PDS session token in `credentialStore` (safeStorage). | After #766 is stable + AT-0 |
| **AT-2** | `PublishTarget` implementation: markdown → record upsert (stable `rkey`) → optional companion Bluesky post; store `at://` URIs on `Publication`. Gateway route `POST /api/publish/atproto` (session-gated; separate from `ai_proxy`). | After AT-1 |
| **AT-3** | Comment bridge: Bluesky replies (via `bskyPostRef`) rendered alongside gateway comments in the share viewer. | After AT-2 + #769 |

## 5. Boundaries

- No custom lexicon namespace at any stage.
- No PDS provisioning before the AT-0 spike is opened (which itself gates on #768).
- No AppView, no firehose/relay subscription, no `did:web` migration work now.
- ATProto publishing is **additive** to the gateway share layer — never a replacement for the accountless reviewer flow.

## 6. Sources

- Standard.site document lexicon: https://standard.site/docs/lexicons/document
- ATProto blog — Standard.site in the Bluesky timeline: https://atproto.com/blog/standard-site-bluesky-timeline
- Markpub.at markdown lexicons: https://markpub.at/
- Leaflet Lab Notes — longform lexicons: https://lab.leaflet.pub/3lxy5sg373k2z
- WhiteWind lexicons: https://github.com/whtwnd/whitewind-blog
- Custom lexicons need no registration: https://github.com/bluesky-social/atproto/discussions/3116
- PDS self-hosting: https://jola.dev/posts/self-hosting-your-pds · macOS/Colima/Tunnel pattern: https://github.com/echoja/atproto-pds
- Account migration: https://atproto.com/guides/account-migration
