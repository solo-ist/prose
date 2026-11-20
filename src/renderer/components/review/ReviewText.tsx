import { visibleWhitespace, type DiffSegment } from '../../lib/diffUtils'
import type { ReviewContext } from './reviewContext'

/**
 * One side of a review card, Original or Suggested: the changed text with its
 * highlighting (`reviewDiff`, #891) inside the text around it, muted
 * (`reviewContext`, #1295). A side with nothing of its own (a pure insertion's
 * Original, a pure deletion's Suggested) shows a thin marker where the change
 * goes or went, so no card is an empty box.
 */
export function ReviewText({
  segments,
  mode,
  context,
}: {
  segments: DiffSegment[]
  mode: 'old' | 'new'
  context?: ReviewContext | null
}) {
  return (
    <>
      {context?.above && <div className="opacity-50 mb-1">{context.above}</div>}
      <span>
        {context?.before && <span className="opacity-50">{context.before}</span>}
        {segments.length === 0 ? (
          <span
            role="img"
            aria-label={mode === 'old' ? 'Inserted here' : 'Removed here'}
            title={mode === 'old' ? 'Inserted here' : 'Removed here'}
            className={
              mode === 'old'
                ? 'inline-block w-0.5 h-[1.1em] mx-0.5 align-text-bottom rounded-full bg-emerald-500/80'
                : 'inline-block w-0.5 h-[1.1em] mx-0.5 align-text-bottom rounded-full bg-red-500/80'
            }
          />
        ) : (
          segments.map((seg, i) => {
            if (mode === 'old' && seg.type === 'removed') {
              return (
                <span key={i} className="bg-red-500/20 text-red-700 dark:text-red-400 line-through rounded-sm px-0.5">
                  {visibleWhitespace(seg.text)}
                </span>
              )
            }
            if (mode === 'new' && seg.type === 'added') {
              return (
                <span key={i} className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-sm px-0.5">
                  {visibleWhitespace(seg.text)}
                </span>
              )
            }
            return <span key={i} className="opacity-50">{seg.text}</span>
          })
        )}
        {context?.after && <span className="opacity-50">{context.after}</span>}
      </span>
      {context?.below && <div className="opacity-50 mt-1">{context.below}</div>}
    </>
  )
}
