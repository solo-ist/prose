---
name: qa-pr
description: Automated QA testing for Prose PRs using Circuit Electron. Use when testing pull requests before merge.
---

# QA Pull Request

Automated QA testing for Prose PRs using Circuit Electron.

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

### 2. Checkout PR Branch

**CRITICAL**: Always checkout the PR branch before testing to ensure you're testing the correct code:

```bash
git fetch origin <branch-name>
git checkout <branch-name>
```

The branch name is in the PR details under `head.ref`.

### 3. Fresh Build (Kill Stale Processes)

**CRITICAL**: Kill any existing Electron/Vite processes to ensure a fresh build. Stale processes can use cached preload scripts and miss PR changes:

```bash
pkill -f "electron" 2>/dev/null
pkill -f "vite" 2>/dev/null
```

This is especially important when:
- Testing changes to preload scripts (`src/preload/`)
- Testing changes to main process (`src/main/`)
- Switching between PR branches

### 4. Launch with Circuit Electron

Launch in development mode (rebuilds all code fresh):

```
mcp__circuit-electron__app_launch (app: "/Users/angelmarino/Code/prose", mode: "development", startScript: "dev", includeSnapshots: false)
```

**Note**: Use `includeSnapshots: false` to avoid snapshot-related errors with keyboard tools.

Save the returned `sessionId` for subsequent commands.

### 5. Execute Test Scenarios

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

### 6. Collaborative Manual Testing

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

### 7. Post Results to PR

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

- **Snapshot errors**: Use `includeSnapshots: false` when launching, use `evaluate` with `text_content` instead of `snapshot`
- **Keyboard tools broken**: The `key`, `keyboard_press`, and `keyboard_type` tools often fail with "Cannot read properties of undefined (reading 'snapshot')". Use `type` tool with selector instead, or `evaluate` to dispatch KeyboardEvents
- **Click not working**: Use `evaluate` to click via JavaScript
- **Keyboard shortcuts via JS don't work**: Synthetic KeyboardEvents don't properly trigger React state updates. Some shortcuts (like Cmd+F) are intercepted by Electron/macOS before reaching the renderer. For these, use collaborative manual testing
- **App won't launch**: Try `mode: "development"` with `startScript: "dev"`
- **"Not connected" errors**: Circuit Electron MCP may disconnect. Try relaunching or use bash to start dev server directly

### Keyboard Shortcut Testing

Keyboard shortcuts in Electron are tricky to test:

1. **Electron menu shortcuts** (registered in `src/main/menu.ts`) intercept keys before they reach the renderer
2. **Synthetic JS KeyboardEvents** don't trigger React's event handlers properly - `metaKey` is often stripped
3. **System shortcuts** (like Cmd+F) may be intercepted by macOS

**Workaround**: For keyboard shortcut testing, use collaborative manual testing where the user presses the keys and Claude verifies the results.

### Common Gotchas

- Always wait for content to save before closing (brief pause or verify via evaluate)
- Radix UI dropdowns need actual clicks, not just setting values
- Recovery dialogs appear on app restart if there's unsaved content
- **Stale preload scripts**: Always kill existing electron/vite processes and checkout the correct branch before testing
