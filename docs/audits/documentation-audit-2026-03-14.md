# Documentation Audit — March 14, 2026

**Scope:** Full codebase documentation coverage analysis
**Prior audit:** `docs/audits/agentic-documentation-audit.md` (March 13, 2026)
**Methodology:** Deep codebase exploration (152 source files, 45+ IPC channels, 10 stores, 8 extensions, 15 tools, 8 workflows, 15 skills)

---

## Status of Prior Audit Recommendations

The March 13 audit identified 8 gaps. Here's what's been addressed:

| # | Recommendation | Status |
|---|---------------|--------|
| 1 | Add "Common Patterns" recipes to CLAUDE.md | **Not addressed** |
| 2 | Resolve roadmap.md staleness | **Not addressed** — still says "Last updated: December 2024" |
| 3 | Document LLM tool pipeline and streaming | **Not addressed** |
| 4 | Add troubleshooting/recovery playbook | **Not addressed** |
| 5 | Seed the memory system | **Not addressed** |
| 6 | Add security implementation rules | **Not addressed** |
| 7 | Update docs/README.md | **Not addressed** |
| 8 | Delete/archive stale QA_feedback.md | **Not addressed** |

**Bottom line:** The prior audit's recommendations remain fully valid. This audit builds on them with additional findings from deeper code analysis.

---

## New Findings

### 1. CLAUDE.md Architecture Section Is Out of Date (High Impact)

CLAUDE.md describes the codebase accurately at a high level but has drifted from reality in several ways:

**Stores:** CLAUDE.md lists 5 stores (editorStore, editorInstanceStore, chatStore, settingsStore, fileListStore). The codebase has **10**: the missing 5 are `tabStore`, `summaryStore`, `reviewStore`, `commandHistoryStore`, and `linkHoverStore`. The tab store in particular is critical — it manages the entire multi-tab interface. Any agent creating a new feature that involves document switching will miss the tab lifecycle unless they find this store independently.

**IPC channels:** CLAUDE.md documents 4 categories (file, settings, llm, remarkable). The actual codebase has **7**: the missing categories are `google:*` (14 handlers for Google Docs), `mcp:*` (3 handlers for MCP server management), and `window:*` / utility handlers (emoji generation, shell:openExternal, file associations, recent files). The Google Docs channels are especially significant — they represent an entire integration that CLAUDE.md only mentions in the reMarkable section's OCR note.

**Shared directory:** CLAUDE.md doesn't mention `src/shared/` at all. This directory contains the unified tool registry, Zod schemas for all tools, and shared LLM utilities. It's the architectural glue between the MCP server and the in-app chat, and an agent extending the tool system needs to know it exists.

**MCP subsystem:** CLAUDE.md doesn't document `src/main/mcp/` (HTTP/socket bridge for Claude Desktop integration) or `src/mcp-stdio/` (standalone MCP server that auto-launches Prose). These represent a full integration surface that's invisible to agents working from CLAUDE.md alone.

### 2. Google Docs Integration Is Undocumented (High Impact)

Google Docs sync is a shipping feature (listed in MVP.md, has 14 IPC handlers, full OAuth flow, bidirectional sync with conflict resolution). Yet:

- CLAUDE.md doesn't mention it in the Architecture section
- There's no `docs/` page explaining the sync model or auth flow
- The OAuth scope requirements aren't documented anywhere
- The sync metadata format (`.google/sync-metadata.json`) isn't documented
- The migration from frontmatter-based storage to metadata-file storage isn't documented

An agent asked to fix a Google Docs sync bug would need to reverse-engineer the entire flow from three files in `src/main/google/`.

### 3. MCP Server Architecture Is Undocumented (Medium Impact)

Prose exposes itself as an MCP server to Claude Desktop through two mechanisms: a Unix socket bridge (`src/main/mcp/`) and a stdio server (`src/mcp-stdio/`). The stdio server auto-launches Prose if it's not running, exposes 5 tools (`read_document`, `get_outline`, `open_file`, `suggest_edit`, `create_and_open_file`), and has specific timeout/buffer constraints.

None of this is documented in CLAUDE.md or anywhere else. The relationship between the two server types, how tools are dispatched, and the auto-launch mechanism are only discoverable by reading source code.

### 4. Tool Registry Architecture Is Undocumented (Medium Impact)

The `src/shared/tools/` directory contains a sophisticated tool system:

- A registry (`registry.ts`) that manages 15+ tools across 3 categories (document, editor, file)
- Zod schema validation for all tool inputs
- Mode-based access control — tools are tagged with which modes they're available in (`null` = all, `'suggestions'`, `'plan'`, `'full'`)
- Separate tool sets for LLM use vs. MCP use

MVP.md mentions the three tool modes in passing. CLAUDE.md doesn't mention them at all. The access control logic (which tools are available when) is a critical architectural decision that affects every new tool added to the system.

### 5. No SECURITY.md or CONTRIBUTING.md (Medium Impact)

For an open-source project on GitHub with releases:

- **SECURITY.md** — No responsible disclosure process. The security audit at `docs/issues/127/findings.md` found real vulnerabilities (path traversal in IPC handlers, missing input validation) but there's no public-facing security policy.
- **CONTRIBUTING.md** — The README says "Contributions welcome! Please open an issue first" but there's no guide for setting up the dev environment, running the app, or understanding the PR process. The information exists in CLAUDE.md, but that's written for AI agents, not human contributors.

### 6. Tab System Not Documented (Medium Impact)

The multi-tab interface (managed by `tabStore.ts` at 8.1KB) is a core user-facing feature with session persistence, preview tabs, and lifecycle management. It's not mentioned in CLAUDE.md's architecture section. An agent implementing any feature that opens, closes, or switches documents needs to understand tab lifecycle to avoid bugs like state leaking between tabs.

### 7. Stale Key Files Section in Roadmap (Low Impact)

The "Key Files" section at the bottom of `docs/roadmap.md` references files that no longer exist or have moved. For example, it suggests creating `src/renderer/lib/documentEditor.ts` and `src/main/google.ts` — the former may not exist, and the latter has been refactored into `src/main/google/client.ts`, `auth.ts`, and `sync.ts`. Agents using the roadmap for file navigation will be misled.

### 8. GitHub Workflows Undocumented (Low Impact)

There are 8 workflows in `.github/workflows/` but only `claude.yml` and `review-feedback.yml` are documented in CLAUDE.md. The remaining 6 (`dispatch.yml`, `e2e.yml`, `web-e2e.yml`, `feature-request-triage.yml`, `pipeline-fix.yml`, `pipeline-triage.yml`) are unmentioned. The e2e workflows are particularly relevant — they represent a testing infrastructure that CLAUDE.md says doesn't exist ("No tests: This project has no test suite").

### 9. Review System Undocumented (Low Impact)

`reviewStore.ts` and the `src/renderer/components/review/` directory implement a document review system (quick review with inline diff, side-by-side diff, per-change accept/reject). This is mentioned in MVP.md but not in CLAUDE.md's architecture section. It's a non-trivial subsystem with its own store and component tree.

---

## Consolidated Recommendations

### Tier 1 — Should Fix Soon (high impact, prevents agent mistakes)

1. **Update CLAUDE.md Architecture section.** Add the 5 missing stores, the Google/MCP/utility IPC categories, the `src/shared/` directory, and the MCP subsystem. This is the single highest-ROI fix — every agent session reads this section.

2. **Add "Common Patterns" recipes to CLAUDE.md** (carried from prior audit). The five most needed: how to add a new IPC channel end-to-end, how to add a new tool to the chat system, how to add a new settings tab, how to add a new TipTap extension, and how to add a new panel.

3. **Document Google Docs integration.** Either a section in CLAUDE.md or a dedicated `docs/google-docs.md`. Must cover: auth flow, sync model, metadata format, and the migration story.

4. **Document the tool registry and modes.** The three modes (suggestions/full/plan), how tools are registered, how access control works, and how to add a new tool. This is the subsystem agents are most likely to extend incorrectly.

### Tier 2 — Should Fix When Convenient (medium impact)

5. **Resolve roadmap staleness** (carried from prior audit). `docs/roadmap.md` contradicts CLAUDE.md and MVP.md in multiple places. Either deprecate it with a pointer to MVP.md, or bring it current.

6. **Document the MCP server architecture.** How the stdio server and socket bridge relate, the 5 exposed tools, auto-launch behavior, timeout/buffer constraints.

7. **Add a troubleshooting section to CLAUDE.md** (carried from prior audit). The 5 most common: build failures, port conflicts, stale LevelDB locks, IndexedDB version issues, Circuit Electron connection failures.

8. **Create CONTRIBUTING.md.** Extract the human-relevant parts from CLAUDE.md (dev setup, build commands, PR process) into a contributor guide. Can be short.

9. **Create SECURITY.md.** Standard responsible disclosure template plus a note about the path validation findings from the security audit.

10. **Correct CLAUDE.md's "No tests" claim.** The e2e and web-e2e workflows exist. Either document the Playwright test infrastructure or clarify what "no tests" means (no unit test suite, but e2e exists).

### Tier 3 — Nice to Have (low impact)

11. **Update docs/README.md** (carried from prior audit). Map the full documentation landscape including spikes, research, audits, and skills.

12. **Delete or archive QA_feedback.md** (carried from prior audit).

13. **Seed the memory system** (carried from prior audit). A `projects/prose.md` file with vocabulary, current priorities, and canonical sources of truth.

14. **Document the tab system and review system** in CLAUDE.md architecture.

15. **Clean up roadmap.md Key Files section** or remove it entirely.

---

## Documentation Health Scorecard

| Area | Coverage | Notes |
|------|----------|-------|
| README | Good | Clear, concise, covers quick start |
| CLAUDE.md (process) | Excellent | Checklists, PID protocol, workflow rules |
| CLAUDE.md (architecture) | Partial | Core is solid, but 5 stores, 3 IPC categories, and 2 subsystems missing |
| Editor/TipTap | Minimal | Extensions undocumented beyond file existence |
| Chat/Tool system | Poor | Most complex subsystem, least documented |
| Google Docs | None | Shipping feature with zero documentation |
| MCP integration | None | Two server types, completely undocumented |
| reMarkable | Adequate | Covered in CLAUDE.md, sync model clear |
| CI/CD workflows | Partial | 2 of 8 workflows documented |
| Skills | Good | Self-documenting via skill files |
| Issue plans | Excellent | Thorough, actionable, agent-ready |
| Security | Poor | Audit exists but findings not integrated |

**Overall: B.** Strong process documentation, but feature documentation hasn't kept pace with the codebase's growth. The gap between what CLAUDE.md describes and what the codebase actually contains has widened since the last audit.
