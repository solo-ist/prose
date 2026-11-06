import type { CSSProperties } from 'react'

/**
 * The Prose mark, as delivered vector art (#1063).
 *
 * The path is the `pilcrow` layer from the `AppIcon.icon` bundle that is the
 * source of truth for the app icon, so the in-app mark and the shipped icon are
 * the same drawing rather than two things that look alike.
 *
 * It replaces a mark that was *synthesized*: a `¶` character set in Fraunces
 * italic inside a CSS squircle, screenshotted through a browser at build time.
 * That made the app's identity depend on a Google Fonts fetch and on Playwright
 * Chromium being installed. As a path it depends on neither.
 */

/** Ground colour of the icon tile — `srgb:0.05882` in the bundle's `icon.json`. */
const GROUND = '#0F0F0F'
/** The glyph's cream, from the delivered `pilcrow.svg`. */
const MARK = '#E2D9CB'

/** The delivered pilcrow outline, on the bundle's 1024×1024 canvas. */
const PILCROW_PATH =
  'M214.71 378.47Q230.61 318.91 269.56 274.9Q308.51 230.89 365.51 206.45Q422.51 182 491.82 182H797.8Q807.18 182 813.15 186.7Q819.11 191.39 816.29 200.87Q813.99 208.9 807.91 213.78Q801.83 218.66 792.69 221.68L760.45 230.36Q745.71 234.54 736.48 241.95Q727.24 249.36 723.67 261.25L592.43 762.27Q588.52 774.64 592.7 782.21Q596.88 789.79 608.73 793.24L635.65 800.54Q644.71 803.27 648.37 808.02Q652.02 812.76 649.49 821.35Q646.3 832.09 636.15 837.05Q626.01 842 616.55 842H264Q254.62 842 250.25 837.25Q245.87 832.5 248.34 824.5Q251.44 814.87 258.66 809.11Q265.87 803.36 276.95 800.7L310.28 793.4Q325.87 789.71 335.65 782.9Q345.43 776.09 348.52 765.58L406.29 545.65Q395.27 547.55 383.18 550.06Q371.08 552.57 356.3 552.57Q269.07 552.57 231.01 505.88Q192.96 459.19 214.71 378.47ZM510.55 760.93 640.75 263.51Q645.01 249.09 638.95 239.87Q632.89 230.64 611.34 230.64Q590.42 230.64 578.21 240.68Q566 250.72 561.98 263.51L431.62 760.93Q428.04 773.25 434.56 782.99Q441.09 792.72 462.3 792.72Q483.7 792.72 495.09 783.68Q506.48 774.64 510.55 760.93Z'

interface ProseMarkProps {
  className?: string
  style?: CSSProperties
  /**
   * Render the full app-icon tile (rounded ground + cream glyph). Without it the
   * glyph alone is drawn in `currentColor`, which is what a UI surface that
   * supplies its own background wants.
   */
  tile?: boolean
  /** Accessible name. Omit for decorative use, where the mark is hidden instead. */
  title?: string
}

export function ProseMark({ className, style, tile = false, title }: ProseMarkProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      data-testid="prose-mark"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {tile && (
        // 22.37% of the canvas is Apple's squircle corner radius at this size.
        // Close enough to read as the app icon without pretending to be the real
        // superellipse, which Icon Composer applies at package time.
        <rect width="1024" height="1024" rx="229" ry="229" fill={GROUND} />
      )}
      <path d={PILCROW_PATH} fill={tile ? MARK : 'currentColor'} />
    </svg>
  )
}
