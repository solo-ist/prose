import { useState, useEffect, useRef, type RefObject } from 'react'

export type TabTier = 0 | 1 | 2 | 3 | 4

interface UseTabTierOptions {
  tabCount: number
}

// Breakpoints: px per tab thresholds
const TIER_HIGH = 120  // Above this = unconstrained (Tier 0)
const TIER_LOW = 60    // Below this = compact (Tier 3+)
const HYSTERESIS = 20  // Buffer to prevent flapping

/**
 * Calculates the appropriate tab display tier based on available width.
 *
 * Tier 0: Natural width, full filenames
 * Tier 1: Equal-width, truncated names
 * Tier 2: Compressed, shorter names
 * Tier 3: Emoji + name
 * Tier 4: Emoji only
 */
export function useTabTier(
  containerRef: RefObject<HTMLElement | null>,
  { tabCount }: UseTabTierOptions
): { tier: TabTier; containerWidth: number } {
  const [tier, setTier] = useState<TabTier>(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const lastTierRef = useRef<TabTier>(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Single tab is always Tier 0
    if (tabCount <= 1) {
      setTier(0)
      lastTierRef.current = 0
      return
    }

    const calculate = () => {
      const width = el.clientWidth
      setContainerWidth(width)
      const perTab = width / tabCount
      const prev = lastTierRef.current

      let next: TabTier

      // Use hysteresis: expanding (going to lower tier) needs higher threshold
      // contracting (going to higher tier) needs lower threshold
      if (prev <= 0) {
        // Currently unconstrained — need to drop below threshold to compress
        next = perTab < TIER_HIGH ? (perTab < TIER_LOW ? 3 : 1) : 0
      } else if (prev >= 3) {
        // Currently compact — need to rise above threshold + hysteresis to decompress
        next = perTab > TIER_LOW + HYSTERESIS
          ? (perTab > TIER_HIGH + HYSTERESIS ? 0 : 1)
          : (perTab < 36 ? 4 : 3)
      } else if (prev === 4) {
        next = perTab > 36 + HYSTERESIS ? 3 : 4
      } else {
        // Tier 1 or 2 — mid range
        if (perTab > TIER_HIGH + HYSTERESIS) {
          next = 0
        } else if (perTab < TIER_LOW) {
          next = perTab < 36 ? 4 : 3
        } else {
          // Stay in the compressed range, pick 1 vs 2
          next = perTab < 80 ? 2 : 1
        }
      }

      if (next !== prev) {
        lastTierRef.current = next
        setTier(next)
      }
    }

    const observer = new ResizeObserver(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(calculate, 150)
    })

    observer.observe(el)
    // Initial calculation
    calculate()

    return () => {
      observer.disconnect()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [containerRef, tabCount])

  return { tier, containerWidth }
}
