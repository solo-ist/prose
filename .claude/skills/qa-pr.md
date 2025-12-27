# QA Pull Request

Automated QA testing for Prose PRs using Circuit Electron (desktop) and Claude in Chrome (web).

## Usage

```
/qa-pr <pr-number>
```

## Workflow

### 1. Fetch PR Details

Use the GitHub MCP to get PR information:

```
mcp__github__pull_request_read (method: "get", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
```

Then fetch comments to find QA instructions:

```
mcp__github__pull_request_read (method: "get_comments", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
```

Look for a comment containing "## QA Instructions" or similar test plan.

### 2. Build the App

```bash
npm run build:mac
```

The built app will be at `dist/mac-arm64/prose.app`. If DMG creation fails (sandbox), that's fine - the .app is what we need.

### 3. Launch with Circuit Electron

Launch in development mode (more reliable):

```
mcp__circuit-electron__app_launch (app: "/Users/angelmarino/Code/prose", mode: "development", startScript: "dev", includeSnapshots: true)
```

Save the returned `sessionId` for subsequent commands.

### 4. Execute Test Scenarios

For each test in the QA instructions:

1. **Use `evaluate` for DOM interactions** (more reliable than click/type):
   ```
   mcp__circuit-electron__evaluate (sessionId: <id>, script: "...")
   ```

2. **Use `text_content` to verify state**:
   ```
   mcp__circuit-electron__text_content (sessionId: <id>)
   ```

3. **Use `close` and `app_launch` to test persistence** across app restarts

#### Common Patterns

**Click a button by aria-label:**
```javascript
const btn = document.querySelector('[aria-label="Button Name"]');
btn?.click();
```

**Click a button by text:**
```javascript
const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Text');
btn?.click();
```

**Get editor content:**
```javascript
document.querySelector('.ProseMirror')?.innerText
```

**Set editor content:**
```javascript
const editor = document.querySelector('.ProseMirror');
editor.innerHTML = '<p>New content</p>';
editor.dispatchEvent(new Event('input', { bubbles: true }));
```

**Open settings (Cmd+,):**
```javascript
document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
```

### 5. Collaborative Manual Testing

Some things cannot be automated:
- Native file dialogs (Cmd+O, Cmd+S, Cmd+Shift+S)
- Menu keyboard shortcuts (Cmd+N, Cmd+W)
- System-level interactions

For these, use a **collaborative workflow**:

#### Pattern: Setup → Handoff → Verify

1. **Setup** (Claude does this):
   - Launch app via Circuit Electron
   - Create test state (content, settings, etc.)
   - Announce timestamp/content for later verification

2. **Handoff** (User does this):
   - Clear instruction: "Press Cmd+O and open CLAUDE.md"
   - Wait for user confirmation: "Let me know when done"

3. **Verify** (Claude does this):
   - Use `text_content` to check result
   - Compare against expected state
   - Report pass/fail

#### Example Handoff Message

```
**Your turn - Manual Step:**

The app should show:
- Title: "Untitled *"
- Content: "Test content" with timestamp `2025-12-27T17:23:13.351Z`

**Do this now:**
1. Press **Cmd+O**
2. Select **CLAUDE.md** from the project root

Let me know when done.
```

#### Closing/Reopening for Persistence Tests

When testing app restart persistence:
- Close session: `mcp__circuit-electron__close`
- Ask user to close app if needed: "Close the app with Cmd+Q"
- Relaunch: `mcp__circuit-electron__app_launch`
- Or ask user: "Reopen for me" (Claude relaunches)

### 6. Post Results to PR

Use GitHub MCP to comment:

```
mcp__github__add_issue_comment (owner: "solo-ist", repo: "prose", issue_number: <pr-number>, body: "...")
```

#### Result Format

```markdown
## QA Test Results - Automated Testing

### ✅ Test Name - PASSED
- What was tested
- Verification details

### ❌ Test Name - FAILED
- What was tested
- What went wrong
- Steps to reproduce

### ⚠️ Test Name - PARTIAL
- What was automated
- What needs manual verification

---

## Manual Testing Required

### Test Name (Manual Steps)

**Setup:** [prerequisites]

1. Step one
2. Step two

**Verify:**
- [ ] Checkbox item
- [ ] Another checkbox

**Why manual:** [explanation]

---

## Summary

| Test | Status | Notes |
|------|--------|-------|
| Test 1 | ✅ PASSED | Details |
| Test 2 | ❌ FAILED | Details |

**Recommendation:** [merge/fix/needs work]
```

## Troubleshooting

### Circuit Electron Issues

- **Snapshot errors**: Use `evaluate` with `text_content` instead of `snapshot`
- **Click not working**: Use `evaluate` to click via JavaScript
- **Keyboard shortcuts not working**: Dispatch KeyboardEvent via `evaluate`
- **App won't launch**: Try `mode: "development"` with `startScript: "dev"`

### Common Gotchas

- Always wait for content to save before closing (brief pause or verify via evaluate)
- Radix UI dropdowns need actual clicks, not just setting values
- Recovery dialogs appear on app restart if there's unsaved content

---

## Web Browser Testing (Claude in Chrome)

For testing the web/browser version of the app (not Electron), use **Claude in Chrome** MCP.

### When to Use

- Testing browser-specific behavior (e.g., `window.api` being undefined)
- Testing platform detection fallbacks
- Testing features that behave differently in browser vs Electron
- Cross-platform UI verification

### Setup

1. Start the Vite dev server (runs alongside Electron but accessible at localhost):
   ```bash
   npm run dev
   ```
   The web app will be available at `http://localhost:5173/`

2. Get tab context:
   ```
   mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
   ```

3. Navigate to the app:
   ```
   mcp__claude-in-chrome__navigate (url: "http://localhost:5173", tabId: <tabId>)
   ```

### Testing Commands

**Take screenshot:**
```
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <tabId>)
```

**Execute JavaScript to verify state:**
```
mcp__claude-in-chrome__javascript_tool (action: "javascript_exec", tabId: <tabId>, text: "...")
```

**Read page content:**
```
mcp__claude-in-chrome__get_page_text (tabId: <tabId>)
```

**Find elements:**
```
mcp__claude-in-chrome__find (query: "search bar", tabId: <tabId>)
```

### Common Verification Patterns

**Check if running in browser (not Electron):**
```javascript
({
  windowApiExists: typeof window.api !== 'undefined',
  platform: window.api?.platform ?? 'undefined (browser mode)'
})
```

**Check computed styles:**
```javascript
const element = document.querySelector('.my-element');
const style = getComputedStyle(element);
({ paddingLeft: style.paddingLeft, display: style.display })
```

**Check CSS classes:**
```javascript
const element = document.querySelector('.toolbar');
({
  hasClass: element?.classList.contains('pl-4'),
  allClasses: element?.className
})
```

### Example: Platform-Specific UI Test

```javascript
// Verify browser shows standard padding (not macOS traffic light padding)
const toolbar = document.querySelector('.app-region-drag');
const style = toolbar ? getComputedStyle(toolbar) : null;
({
  hasPl4: toolbar?.classList.contains('pl-4'),      // Should be true in browser
  hasPl20: toolbar?.classList.contains('pl-20'),    // Should be false in browser
  paddingLeft: style?.paddingLeft                    // Should be "16px" in browser
})
```
