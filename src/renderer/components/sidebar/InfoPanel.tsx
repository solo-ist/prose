import { useEffect } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSummaryStore } from '../../stores/summaryStore'
import { Button } from '../ui/button'
import { RefreshCw, Loader2, AlertCircle } from 'lucide-react'

export function InfoPanel() {
  const document = useEditorStore((s) => s.document)
  const { summary, isGenerating, generatedAt, isStale, error, loadForDocument, generateSummary } =
    useSummaryStore()
  const hasApiKey = useSettingsStore((s) => !!s.settings.llm.apiKey)

  // Load cached summary when document changes
  useEffect(() => {
    if (document.documentId) {
      loadForDocument(document.documentId, document.content)
    }
  }, [document.documentId, loadForDocument])

  // Recompute staleness when content changes
  useEffect(() => {
    if (summary && document.content && document.documentId) {
      loadForDocument(document.documentId, document.content)
    }
  }, [document.content, document.documentId, summary, loadForDocument])

  const wordCount = document.content
    .split(/\s+/)
    .filter((w: string) => w.length > 0).length

  const readingTime = Math.max(1, Math.round(wordCount / 200))

  const filename = document.path
    ? document.path.split('/').pop() || 'Untitled'
    : 'Untitled'

  const displayTitle = document.path
    ? filename.replace(/\.[^/.]+$/, '')
    : 'Untitled'

  const shortenedPath = document.path
    ? document.path.replace(/^\/Users\/[^/]+/, '~')
    : null

  const handleGenerate = () => {
    generateSummary(document.documentId, document.content)
  }

  const isEmpty = !document.content || document.content.trim().length === 0

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-muted/20">
      {/* Document title + path */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium truncate">{displayTitle}</h2>
        {shortenedPath && (
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={document.path || undefined}>
            {shortenedPath}
          </p>
        )}
      </div>

      {/* Summary section */}
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Summary
        </h3>

        {isGenerating ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Generating summary...</span>
          </div>
        ) : error ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleGenerate}>
              Try again
            </Button>
          </div>
        ) : summary ? (
          <div className="space-y-2">
            <p className="text-sm leading-relaxed">{summary}</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {isStale ? 'Content changed since summary' : 'Summarized by Prose'}
              </span>
              {(isStale || summary) && hasApiKey && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleGenerate}
                  title="Regenerate summary"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground">
            Start writing to generate a summary.
          </p>
        ) : hasApiKey ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleGenerate}>
            Generate Summary
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Configure an API key in Settings to generate summaries.
          </p>
        )}
      </div>

      {/* Metadata section */}
      <div className="px-4 py-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Metadata
        </h3>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Words</dt>
            <dd className="font-mono text-xs">{wordCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Reading</dt>
            <dd className="font-mono text-xs">~{readingTime} min</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Characters</dt>
            <dd className="font-mono text-xs">{document.content.length.toLocaleString()}</dd>
          </div>
          {document.path && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">Path</dt>
              <dd className="font-mono text-xs truncate" title={document.path}>
                {shortenedPath}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
