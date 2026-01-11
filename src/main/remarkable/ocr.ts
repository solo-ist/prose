/**
 * OCR client for extracting text from reMarkable .rm files
 *
 * Uses the remarkable-sync-lambda OCR service which provides
 * Claude Vision-powered handwriting recognition.
 *
 * Environment variables:
 *   REMARKABLE_OCR_URL - Lambda endpoint URL
 *   REMARKABLE_OCR_API_KEY - API key for authentication
 */

interface OCRRequest {
  pages: Array<{
    id: string
    data: string // Base64-encoded .rm file bytes
  }>
}

interface OCRResponse {
  pages: Array<{
    id: string
    markdown: string
    confidence: number
  }>
  failedPages?: string[]
}

interface OCRPageResult {
  id: string
  markdown: string
  confidence: number
}

interface OCRResult {
  pages: OCRPageResult[]
  failedPages: string[]
}

/**
 * Check if OCR service is configured
 */
export function isOCRConfigured(): boolean {
  const configured = !!(process.env.REMARKABLE_OCR_URL && process.env.REMARKABLE_OCR_API_KEY)
  console.log('[OCR] isOCRConfigured:', configured, 'URL:', process.env.REMARKABLE_OCR_URL ? 'set' : 'not set', 'API_KEY:', process.env.REMARKABLE_OCR_API_KEY ? 'set' : 'not set')
  return configured
}

/**
 * Get OCR configuration from environment
 */
function getOCRConfig(): { url: string; apiKey: string } {
  const url = process.env.REMARKABLE_OCR_URL
  const apiKey = process.env.REMARKABLE_OCR_API_KEY

  if (!url || !apiKey) {
    throw new Error('OCR service not configured. Set REMARKABLE_OCR_URL and REMARKABLE_OCR_API_KEY environment variables.')
  }

  return { url, apiKey }
}

/**
 * Extract text from multiple .rm file pages using OCR
 *
 * @param pages - Array of pages to process, each with id and raw bytes
 * @param anthropicApiKey - User's Anthropic API key for the OCR service
 * @returns OCR results with markdown text and confidence scores
 */
export async function extractTextFromPages(
  pages: Array<{ id: string; data: Buffer }>,
  anthropicApiKey: string
): Promise<OCRResult> {
  if (pages.length === 0) {
    return { pages: [], failedPages: [] }
  }

  if (pages.length > 20) {
    throw new Error('Maximum 20 pages per OCR request')
  }

  if (!anthropicApiKey) {
    throw new Error('Anthropic API key is required for OCR. Please add your key in Settings → Integrations.')
  }

  const { url, apiKey } = getOCRConfig()

  const requestBody: OCRRequest = {
    pages: pages.map(p => ({
      id: p.id,
      data: p.data.toString('base64')
    }))
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-anthropic-key': anthropicApiKey
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    let errorMessage = `OCR request failed: ${response.status} ${response.statusText}`
    try {
      const errorBody = await response.json()
      if (errorBody.error) {
        errorMessage = errorBody.error
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage)
  }

  const result = (await response.json()) as OCRResponse

  return {
    pages: result.pages,
    failedPages: result.failedPages || []
  }
}

/**
 * Extract text from a single .rm file
 *
 * @param pageId - Unique identifier for the page
 * @param rmBytes - Raw bytes of the .rm file
 * @param anthropicApiKey - User's Anthropic API key for the OCR service
 * @returns Markdown text and confidence score
 */
export async function extractTextFromRM(
  pageId: string,
  rmBytes: Buffer,
  anthropicApiKey: string
): Promise<{ markdown: string; confidence: number }> {
  const result = await extractTextFromPages([{ id: pageId, data: rmBytes }], anthropicApiKey)

  if (result.failedPages.includes(pageId)) {
    throw new Error(`OCR failed for page ${pageId}`)
  }

  const page = result.pages.find(p => p.id === pageId)
  if (!page) {
    throw new Error(`No OCR result for page ${pageId}`)
  }

  return {
    markdown: page.markdown,
    confidence: page.confidence
  }
}

/**
 * Process multiple pages in batches (max 20 per request)
 *
 * @param pages - Array of pages to process
 * @param anthropicApiKey - User's Anthropic API key for the OCR service
 * @param onProgress - Optional progress callback
 * @returns Combined OCR results
 */
export async function extractTextBatched(
  pages: Array<{ id: string; data: Buffer }>,
  anthropicApiKey: string,
  onProgress?: (processed: number, total: number) => void
): Promise<OCRResult> {
  const BATCH_SIZE = 20
  const allResults: OCRPageResult[] = []
  const allFailed: string[] = []

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE)
    const result = await extractTextFromPages(batch, anthropicApiKey)

    allResults.push(...result.pages)
    allFailed.push(...result.failedPages)

    onProgress?.(Math.min(i + BATCH_SIZE, pages.length), pages.length)
  }

  return {
    pages: allResults,
    failedPages: allFailed
  }
}
