/**
 * The first emoji in a model's reply, or null. Tab emoji come from whichever
 * model is in use (#1324), and not every model answers with the emoji alone.
 */
export function firstEmoji(text: string): string | null {
  const match = text.match(/\p{Emoji_Presentation}/u)
  return match ? match[0] : null
}
