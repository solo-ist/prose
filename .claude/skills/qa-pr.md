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

### 5. Handle Non-Automatable Tests

Some things cannot be automated:
- Native file dialogs (Cmd+O, Cmd+S, Cmd+Shift+S)
- System-level interactions

For these, generate **manual testing instructions** with:
- Clear numbered steps
- Checkboxes for verification points
- Explanation of why automation isn't possible

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
