# Feature Color Token Map

Reference: what each feature-semantic token colors, declared in `src/renderer/index.css`.

Tokens are declared under `:root` (Mono light baseline) and `.dark` (Mono dark). Theme overrides appear under `.theme-prose`, `.theme-prose.dark`, `.theme-termy`, `.theme-termy.dark`. Mono renders pixel-identical to the pre-tokenization literals — every token value in `:root`/`.dark` equals the original hardcoded literal exactly.

## Design Principle

Where the original CSS used **distinct lightness values** for different roles within the same color family (e.g., mark background vs. mark border; text color vs. tint background; light vs. dark variant), separate tokens are declared. This preserves Mono pixel-identity while giving theme overrides clean anchors to override.

## Token Reference

### Diff Suggestions (blue-210)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--diff-suggest` | `210 100% 50%` | `210 100% 60%` | Diff suggestion container border |
| `--diff-suggest-dark-bg` | `210 100% 30%` | _(dark-specific)_ | Diff suggestion container bg in `.dark` only |

### Deletion Text in Diff (red-0, 70%)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--diff-del` | `0 70% 50%` | `0 70% 65%` | Deleted text color |
| `--diff-del-bg-dark` | `0 70% 40%` | _(dark-specific)_ | Deleted text bg tint in `.dark` |

### Insertion Text in Diff (green-140, 60%)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--diff-ins` | `140 60% 35%` | `140 60% 60%` | Inserted text color |
| `--diff-ins-bg` | `140 60% 40%` | `140 60% 40%` | Inserted text bg tint (light) |
| `--diff-ins-bg-dark` | `140 60% 30%` | _(dark-specific)_ | Inserted text bg tint in `.dark` |

### Diff Action Buttons

| Token | Mono value | What it colors |
|---|---|---|
| `--diff-accept-btn` | `140 60% 45%` | Accept button bg |
| `--diff-accept-btn-hover` | `140 60% 38%` | Accept button hover bg |
| `--diff-reject-btn` | `0 65% 50%` | Reject button bg (diff bar) |
| `--diff-reject-btn-hover` | `0 65% 42%` | Reject button hover |

### Comment Marks (amber-45)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--comment-mark-bg` | `45 100% 70%` | `45 100% 40%` | Comment mark highlight bg (higher lightness than border) |
| `--comment` | `45 100% 50%` | `45 100% 60%` | Comment mark border; search highlight; grammar-error anchor |
| `--comment-bg` | `45 60% 20%` | `45 60% 20%` | Comment popover text-box bg (opaque dark amber) |
| `--comment-text-fg` | `45 70% 80%` | `45 70% 80%` | Comment popover text-box fg |

### Comment Popover Remove Button (dark red, distinct from diff-reject)

| Token | Mono value | What it colors |
|---|---|---|
| `--comment-remove-btn` | `0 60% 40%` | Remove button bg |
| `--comment-remove-btn-hover` | `0 60% 35%` | Remove button hover |

### AI Suggestion Marks (violet-270, 70%)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--ai-suggest-mark-bg` | `270 70% 70%` | `270 70% 40%` | AI suggestion mark highlight bg |
| `--ai-suggest` | `270 70% 50%` | `270 70% 60%` | AI suggestion mark border |
| `--ai-suggest-reply-bg` | `270 70% 60%` | `270 70% 45%` | `[data-ai-user-reply]` mark bg |
| `--ai-suggest-reply-border` | `270 70% 50%` | `270 70% 65%` | `[data-ai-user-reply]` mark border |

### AI Suggestion Popover — Suggested Text Block (green-145)

| Token | Mono value | What it colors |
|---|---|---|
| `--ai-suggest-text-bg` | `145 60% 20%` | Suggested-text box bg (opaque) |
| `--ai-suggest-text-fg` | `145 70% 75%` | Suggested-text box fg |
| `--ai-suggest-text-border` | `145 70% 45%` | Suggested-text box left border |

### AI Suggestion Popover — Accept Button (green-145, distinct from diff-accept)

| Token | Mono value | What it colors |
|---|---|---|
| `--ai-suggest-accept-btn` | `145 60% 40%` | Accept button bg |
| `--ai-suggest-accept-hover` | `145 60% 35%` | Accept button hover |

### AI Action Buttons (violet-270, 60%)

| Token | Mono value | What it colors |
|---|---|---|
| `--ai-action` | `270 60% 50%` | Feedback / process / submit button bg |
| `--ai-action-hover` | `270 60% 45%` | Action button hover |
| `--ai-action-muted` | `270 60% 30%` | Feedback-text display bg tint |
| `--ai-action-link` | `270 60% 60%` | Edit-feedback button text color |
| `--ai-action-link-hover` | `270 60% 70%` | Edit-feedback button hover text |

### AI Annotations (deep violet-262)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--annotation` | `262 83% 58%` | `262 70% 60%` | Annotation gradient start + border |
| `--annotation-end` | `270 70% 50%` | `270 60% 45%` | Annotation gradient tail |
| `--annotation-shimmer` | `262 90% 70%` | `262 80% 65%` | Hover shimmer highlight stop |

### Pending Annotation / Word-Diff (pink-330)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--pending` | `330 81% 60%` | `330 70% 55%` | Pending annotation dashed underline + glow |
| `--pending-word` | `330 60% 50%` | `330 55% 45%` | Word-diff removed highlight |

### Word-Diff Added (violet-262)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--diff-word-added` | `262 70% 55%` | `262 65% 50%` | Word-diff added highlight |

### Spell / Grammar Underlines

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--spell-error` | `0 75% 55%` | `0 80% 60%` | `::spelling-error` wavy underline |
| `--grammar-error` | `45 80% 50%` | `45 85% 55%` | `::grammar-error` wavy underline |

### Frontmatter Pending Overlay (green-145)

| Token | Mono light | Mono dark | What it colors |
|---|---|---|---|
| `--frontmatter-bg` | `145 60% 20%` | `145 60% 15%` | Overlay background |
| `--frontmatter-ins` | `145 70% 45%` | `145 70% 55%` | Overlay border + label color |
| `--frontmatter-val` | `145 60% 55%` | `145 60% 65%` | Pending value text color |
| `--frontmatter-accept-btn` | `145 60% 40%` | `145 60% 40%` | Accept button bg |
| `--frontmatter-accept-hover` | `145 60% 35%` | `145 60% 35%` | Accept button hover |

## Usage Pattern

```css
background: hsl(var(--diff-suggest) / 0.1);
background: hsl(var(--diff-suggest-dark-bg) / 0.2);   /* in .dark only */
border: 1px solid hsl(var(--annotation) / calc(var(--annotation-opacity) * 0.5));
```

The `--annotation-opacity` CSS variable is set on `.ai-annotation` elements and animated separately; feature tokens provide only the color channel.

## Theme Overrides

Theme blocks (`.theme-prose*`, `.theme-termy*`) override all tokens listed above.

- **Prose** — warm/gold tints: amber shifts to gold (40 hue), greens shift warmer (142/148 hue), violets shift slightly (268–280 hue), reds shift toward orange-red (5 hue).
- **Termy** — phosphor/green tints: diff-suggest → teal (160 hue), comment → yellow-green (80 hue), annotations → phosphor green (150–160 hue), pending → lime (100 hue). Red values remain red for deletion contrast.
