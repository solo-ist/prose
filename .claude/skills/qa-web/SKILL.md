---
name: qa-web
description: Validate Prose features against the web mode build using Playwright. Use for CI-compatible QA that doesn't require Electron or a display server.
---

# QA Web Mode

Automated QA testing for Prose using Playwright against the web mode build (`http://localhost:5174`). Unlike Circuit Electron, this runs headlessly in CI — no display server or Electron required.

## Usage

```
/qa-web
```

Or target a specific PR branch:

```
/qa-web <branch-name>
```

## Prerequisites

Playwright browsers must be installed once:

```bash
npx playwright install --with-deps chromium
```

## Workflow

### 1. (Optional) Checkout Branch

If testing a specific PR branch:

```bash
git fetch origin
git checkout <branch-name>
```

### 2. Run Tests

**With auto-managed dev server** (recommended for local development):

```bash
npm run test:web
```

The Playwright config automatically starts `npm run dev:web` and waits for `http://localhost:5174` to be ready.

**Against an already-running dev server** (if `npm run dev:web` is already running):

```bash
PLAYWRIGHT_TEST_BASE_URL=http://localhost:5174 npx playwright test
```

**Against the production build** (recommended for CI — faster, no HMR overhead):

```bash
npm run build:web
npm run preview:web &
npx playwright test --config playwright.config.ts
```

### 3. Interpret Results

| Status | Meaning |
|--------|---------|
| ✅ passed | Feature works as expected |
| ❌ failed | Bug detected — check error message and screenshot |
| ⚠️ flaky | Timing issue — re-run with `--retries=2` |

On failure, Playwright saves a screenshot and trace under `test-results/`. Open the trace viewer:

```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

### 4. Report Results to PR

Post a comment on the PR with results:

```bash
gh pr comment <pr-number> --body "$(cat <<'EOF'
## Web QA Results

**Branch**: \`<branch>\`
**Tested**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

### Results

| Test | Status | Notes |
|------|--------|-------|
| App loads without errors | ✅ | |
| File explorer renders files | ✅ | |
| Clicking file loads content | ✅ | |
| Editor accepts input | ✅ | |
| Settings panel opens | ✅ | |
| Theme toggle works | ✅ | |

### Recommendation

✅ **Ready for Review** — All smoke tests pass.
EOF
)"
```

## Test Suite

The smoke test suite at `tests/smoke.spec.ts` covers:

1. **App loads without console errors** — No JS errors on startup
2. **File explorer renders fixture files** — Sidebar shows pre-loaded fixture files
3. **Clicking a file loads content** — Clicking a file populates the editor
4. **Editor accepts text input** — The ProseMirror editor is interactive
5. **Settings panel opens** — More options → Settings shows the dialog
6. **Theme toggle works** — Dark/light toggle switches the `dark` class on `<html>`

## Writing New Tests

Add tests to `tests/smoke.spec.ts` or create new files under `tests/`.

### Common Selectors

```typescript
// Editor
const editor = page.locator('.ProseMirror')

// Toolbar buttons
page.getByRole('button', { name: /show files/i })     // file list toggle
page.getByRole('button', { name: /hide files/i })
page.getByRole('button', { name: /toggle theme/i })
page.getByRole('button', { name: /more options/i })   // overflow menu

// File items in sidebar
page.getByText('Welcome to Prose.md')
page.getByText('Formatting Examples.md')

// Dialogs
page.getByRole('dialog')                               // any dialog
page.getByRole('alertdialog')                          // alert dialogs (consent, delete confirm)
```

### Dismissing the AI Consent Dialog

Prose shows a consent dialog on first launch in a fresh browser context. Dismiss it before testing:

```typescript
async function dismissAIConsent(page: Page) {
  const dialog = page.getByRole('alertdialog').filter({ hasText: 'AI Writing Assistance' })
  if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'Enable AI Features' }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
}
```

### Waiting for App Initialization

```typescript
async function waitForAppReady(page: Page) {
  await page.locator('[aria-label="Toggle theme"]').waitFor({ state: 'visible', timeout: 15_000 })
  await dismissAIConsent(page)
}
```

### Keyboard Shortcuts

Unlike Electron, browser keyboard shortcuts work reliably with Playwright:

```typescript
// Ctrl+/ to open chat (web mode uses Ctrl instead of Cmd)
await page.keyboard.press('Control+/')

// Type in editor
await editor.click()
await page.keyboard.type('Hello world')
```

## Fixture Files

The web mock pre-loads these files at `/Documents/`:

| File | Description |
|------|-------------|
| `Welcome to Prose.md` | Intro document, exercises basic editor |
| `Formatting Examples.md` | Markdown formatting showcase |
| `Meeting Notes/Weekly Standup.md` | Subdirectory — tests folder expansion |
| `Meeting Notes/Q1 Planning.md` | Frontmatter parsing |
| `Blog Drafts/AI Writing Tools.md` | Longer content |
| `Empty Note.md` | Empty file edge case |

## Configuration

`playwright.config.ts` at the project root:

- **Base URL**: `http://localhost:5174` (web mode dev server)
- **Workers**: 1 (serial execution — avoids IndexedDB conflicts between tests)
- **Global timeout**: 120s (prevents hung CI jobs)
- **CI reporters**: `json` (outputFile) + `github` (inline PR annotations)
- **Local reporter**: `list` (human-readable terminal output)

## Troubleshooting

### `net::ERR_CONNECTION_REFUSED`

The dev server isn't running. Either:
- Let Playwright start it automatically via `npm run test:web`
- Start it manually: `npm run dev:web` then re-run tests

### Tests time out waiting for `.ProseMirror`

The editor may be blocked by the AI consent dialog or recovery dialog. Make sure you call `dismissAIConsent()` in your test setup.

### Fixture files not visible in file explorer

The file list auto-initializes from `getDocumentsPath()`. If files aren't showing:
1. Check `npm run dev:web` console for errors
2. Confirm the `[aria-label="Show files"]` button was clicked first

### Theme toggle test fails

The initial theme (`dark` class on `<html>`) may differ if a previous test changed it. Use isolated browser contexts or clear `localStorage` between test runs:

```typescript
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})
```
