# Feature Color Token Map

Reference: what each feature-semantic token colors, declared in `src/renderer/index.css`.

Tokens are declared under `:root` (Mono light baseline) and `.dark` (Mono dark). Theme overrides appear under `.theme-prose`, `.theme-prose.dark`, `.theme-termy`, `.theme-termy.dark`. Mono renders pixel-identical to the pre-tokenization literals.

## Token Reference

| Token | Mono (light) | What it colors |
|---|---|---|
| `--diff-suggest` | `210 100% 50%` | Diff suggestion container — border and background |
| `--diff-del` | `0 70% 50%` | Deleted text within a diff suggestion (strikethrough text and bg) |
| `--diff-ins` | `140 60% 35%` | Inserted text within a diff suggestion (text and bg tint) |
| `--diff-accept-btn` | `140 60% 45%` | "Accept" button in diff suggestion and AI suggestion popovers |
| `--diff-reject-btn` | `0 65% 50%` | "Reject" button in diff suggestion popovers; remove button in comment popovers |
| `--comment` | `45 100% 50%` | Comment marks (highlight + border), search match highlights, grammar-error underlines |
| `--comment-bg` | `45 60% 20%` | Comment popover text box background |
| `--ai-suggest` | `270 70% 50%` | AI suggestion marks (purple highlight + border) and pending-feedback dashed border |
| `--ai-action` | `270 60% 50%` | AI popover action buttons (feedback, process, submit) and feedback input focus ring |
| `--annotation` | `262 83% 58%` | AI annotation primary color — gradient start, border, shimmer base |
| `--annotation-end` | `270 70% 50%` | AI annotation gradient endpoint (insertion/replacement gradient tail) |
| `--annotation-shimmer` | `262 90% 70%` | AI annotation hover shimmer highlight stop |
| `--pending` | `330 81% 60%` | Pending annotation state — dashed underline and glow box-shadow |
| `--pending-word` | `330 60% 50%` | Word-diff "removed" highlight background within suggestions |
| `--spell-error` | `0 75% 55%` | Spell-check wavy underline (`::spelling-error`) |
| `--grammar-error` | `45 80% 50%` | Grammar-check wavy underline (`::grammar-error`) |
| `--frontmatter-ins` | `145 70% 45%` | Frontmatter pending overlay — border, label, value, and accept button |

## Theme Overrides

### Prose (warm/gold)
Warm tints: amber shifts to gold (`40–42 hue`), greens shift warmer (`142 hue`), violets shift slightly warmer (`268–280 hue`), reds shift toward orange-red (`5 hue`).

### Termy (phosphor/green)
Terminal phosphor tints: diff-suggest → teal (`160 hue`), comment → yellow-green (`80 hue`), annotations → phosphor green (`150–160 hue`), pending → lime (`100 hue`). Red values remain red for deletion contrast.

## Usage Pattern

All feature colors use the `hsl(var(--token) / <alpha>)` form, e.g.:

```css
background: hsl(var(--diff-suggest) / 0.1);
border: 1px solid hsl(var(--annotation) / calc(var(--annotation-opacity) * 0.5));
```

The `--annotation-opacity` CSS variable is set on `.ai-annotation` elements and animated separately; feature tokens provide only the color channel.
