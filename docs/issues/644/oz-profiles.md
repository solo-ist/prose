# Oz local Agent Profiles

Two local profiles, configured in the Warp/Oz UI. They mirror the conservative-but-productive posture already encoded for Claude Code in `.claude/settings.json` and the house rules in `CLAUDE.md`. **Keep them in sync with that file** — when the `.claude/settings.json`allow/deny list changes, update these profiles too.

Permission axes (Warp/Oz): *Read files · Create plans · Apply code diffs · Execute commands · Interact with running commands*, each set to **Always allow / Agent decides / Always ask**, plus a command **allowlist** and **denylist (always-ask)**.

---

## Profile 1 — `Trusted Coding`

For normal work in this trusted, version-controlled repo. Default profile for `prose`.

| Axis | Setting |
| --- | --- |
| Read files | **Always allow** — *except* the secret files denied below |
| Create plans | Agent decides |
| Apply code diffs | Agent decides |
| Execute commands | Agent decides — bounded by the allow/deny lists |
| Interact with running commands | Agent decides |

### Allowlist (auto-run) — mirrors `.claude/settings.json` `allow`

```
npm run *            npx *                node *
lsof *               ps *                 sleep *
kill <pid>           pkill -f "prose.*Electron"   pkill -f "electron-vite.*prose"
cat .dev.pid*
git status*          git diff*            git log*            git branch*
ls *
gh issue *           gh pr *              gh project *        gh run *            gh api *
```

Plus common read-only dev commands: `git fetch*`, `git show*`, `rg`/`grep`/`find` (read), `git -C <worktree> <readonly-subcmd>`.

### Denylist (always ask) — destructive / credential / publishing / network-mutation

Encodes the security rules and operational footguns from `CLAUDE.md` and `.claude/settings.json`:

| Class | Always-ask commands |
| --- | --- |
| **Read secrets** | reading `.env`, `.env.sentry-build-plugin`, `.mcp.json`, `build/*.provisionprofile`, any `*.p8` ASC key, `~/Library/Application Support/Prose/settings.json` |
| **Destructive FS/git** | `rm -rf`, `git clean -fdx`, `git reset --hard`, `git push --force*`, any push to `main` / protected branches, `git branch -D` on shared branches |
| **Process footguns** | `pkill -f node` (kills Circuit Electron MCP), `pkill -f Electron` (kills all Electron apps), broad `kill -9` |
| **Publishing / distribution** | `npm publish`, `gh release *`, `vercel --prod`, `electron-builder --publish*`, `xcrun iTMSTransporter`/Transporter upload, `xcrun altool` |
| **App Store boundary** | **App Store *submission for review* is never automated** — TestFlight upload is the human edge (see `CLAUDE.md`). Hard-stop, not just ask. |
| **Network mutation** | `curl`/`wget` with `-X POST/PUT/DELETE/PATCH`, arbitrary `gh api -X {POST,PUT,DELETE,PATCH}` to non-board endpoints |
| **MAS versioning** | edits that reset `buildVersion` (it is global-monotonic — never reset on a marketing bump) |
| **Board field defs** | any GraphQL `updateProjectV2Field` mutation (silently wipes board status) — board ops are limited to `gh project item-{edit,add,archive}` |

### Denylist — paste-ready command patterns

Drop these into Warp's "always ask" command list (wildcards shown as `*`; adjust to Warp's matcher if it uses prefix-match rather than globs):

```text
# Secrets (reading) — prefer the Read-files axis deny for full coverage
cat .env
cat .env.*
cat .mcp.json
cat build/*.provisionprofile
cat *.p8

# Destructive filesystem / git
rm -rf *
rm -fr *
git reset --hard*
git push --force*
git push -f*
git push * main*
git clean -fd*
git branch -D *

# Process-kill footguns
pkill -f node*
pkill node
killall node
killall Electron
pkill -f Electron*
kill -9 *

# Publishing / distribution
npm publish*
gh release*
vercel --prod*
vercel deploy --prod*
electron-builder*--publish*
xcrun iTMSTransporter*
xcrun altool*

# Network mutation
curl *-X POST*
curl *-X PUT*
curl *-X DELETE*
curl *-X PATCH*
curl *--request*
wget *--post*
gh api graphql*
gh api *-X POST*
gh api *-X PUT*
gh api *-X DELETE*
gh api *-X PATCH*
```

**Notes:**

- **Precedence** — ensure the denylist is evaluated *before* the `gh api *` / `npm run *` allows (more-specific match wins). If Warp doesn't do that, narrow those allows (e.g. drop `gh api *`, keep read-only `gh issue/pr/project/run` allows) — the gated `gh api graphql*` / `gh api *-X POST*` entries are the risky ones.
- **Two rules aren't shell commands:** reading secrets is cleanest via the **Read-files axis** deny (`.env*`, `.mcp.json`, `build/*.provisionprofile`, `*.p8`) since the `cat` entries only catch one reader; and a `buildVersion` **reset** is an *edit* to `electron-builder.yml`, enforced by diff review + the house rule, not the command denylist.
- **App Store submission for review = hard no** (human only) — no single CLI exists; gating the `xcrun altool` / `iTMSTransporter` uploads covers the automatable surface. Building (`npm run build:mas`) stays allowed; only upload/publish is gated.

### House-rule reminders baked into the profile prompt

- Never chain bash with `&&`, `;`, or `|` — one command per invocation (matches the user's auto-approve patterns).
- Worktree git: `git -C <path> <subcmd>`, never `cd <path> && git …`.
- Process mgmt via the `.dev.pid` file, never broad `pkill` patterns.
- Use `gh` CLI for all GitHub ops; never a GitHub MCP server.

---

## Profile 2 — `Review / Untrusted`

For unfamiliar repos, review-only tasks, or high-risk changes. Strictly tighter than Trusted Coding.

| Axis | Setting |
| --- | --- |
| Read files | **Always allow** (except the secret files above) |
| Create plans | Agent decides |
| Apply code diffs | **Always ask** |
| Execute commands | **Always ask** — or a narrow read-only allowlist only |
| Interact with running commands | Always ask |

### Narrow read-only allowlist

```
git status*   git diff*   git log*   git show*   ls *   rg/grep/find (read)
gh issue view*   gh pr view*   gh pr diff*   gh run view*
```

Everything else — any write, any execution beyond inspection, all network and destructive commands — is **always ask**. The full Trusted-Coding denylist also applies (it is a superset of gated actions here).

---

## Recreate steps (Warp UI)

1. Settings → Agents → Profiles → **New profile** → name `Trusted Coding`; set the five axes and paste the allow/deny lists above.
2. Repeat for `Review / Untrusted` with the tighter settings.
3. Set `Trusted Coding` as the default profile for the `prose` repo/workspace; use `Review / Untrusted` when opening unfamiliar repos or doing review-only passes.
4. Sanity check: in `Trusted Coding`, `npm run dev` auto-runs but `git push --force` and reading `.env` prompt; in `Review / Untrusted`, even a code diff prompts.