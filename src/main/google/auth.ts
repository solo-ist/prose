import { google } from 'googleapis'
import { shell, safeStorage } from 'electron'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { URL } from 'url'

const SETTINGS_DIR = join(homedir(), '.prose')
const REFRESH_TOKEN_PATH = join(SETTINGS_DIR, '.google-refresh-token')

// Google OAuth credentials - these are for a desktop app
// Client ID and secret are safe to embed in desktop apps (not secrets for installed apps)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Access to files created/opened by the app
  'https://www.googleapis.com/auth/drive.readonly', // Read access to all files (for import)
  'https://www.googleapis.com/auth/userinfo.email', // Get user's email for display
  'https://www.googleapis.com/auth/userinfo.profile' // Get user's profile picture
]

export interface GoogleAuthResult {
  success: boolean
  email?: string
  picture?: string
  error?: string
}

export interface GoogleConnectionStatus {
  connected: boolean
  email?: string
  picture?: string
  error?: string
}

interface TokenData {
  access_token: string
  refresh_token: string
  expiry_date: number
}

// Cache for current token data (in-memory only, refresh token stored securely)
let cachedTokens: TokenData | null = null

/**
 * Create an OAuth2 client with credentials
 */
function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    redirectUri
  )
}

/**
 * Start the OAuth flow by opening browser and waiting for callback
 */
export async function startOAuthFlow(): Promise<GoogleAuthResult> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      success: false,
      error: 'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.'
    }
  }

  return new Promise((resolve) => {
    // Port will be set when server starts listening
    let serverPort: number = 0

    // Create a temporary HTTP server on a random port
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '', `http://localhost`)

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          resolve({ success: false, error })
          return
        }

        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          resolve({ success: false, error: 'No authorization code received' })
          return
        }

        try {
          // Exchange code for tokens
          const result = await exchangeCodeForTokens(code, `http://localhost:${serverPort}/callback`)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Successful</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Successful!</h1>
                <p>Connected as ${result.email}</p>
                <p>You can close this window and return to Prose.</p>
                <script>window.close()</script>
              </body>
            </html>
          `)
          server.close()
          resolve(result)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>${errorMessage}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          resolve({ success: false, error: errorMessage })
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        resolve({ success: false, error: 'Failed to start callback server' })
        return
      }

      serverPort = address.port
      const redirectUri = `http://localhost:${serverPort}/callback`
      const oauth2Client = createOAuth2Client(redirectUri)

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Force consent to always get refresh token
      })

      // Open browser to auth URL
      shell.openExternal(authUrl)
    })
  })
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleAuthResult> {
  const oauth2Client = createOAuth2Client(redirectUri)

  const { tokens } = await oauth2Client.getToken(code)

  if (!tokens.refresh_token) {
    return { success: false, error: 'No refresh token received. Please try again.' }
  }

  // Store refresh token securely
  await storeRefreshToken(tokens.refresh_token)

  // Cache tokens in memory
  cachedTokens = {
    access_token: tokens.access_token || '',
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000
  }

  // Get user info (email + profile picture)
  oauth2Client.setCredentials(tokens)
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const userInfo = await oauth2.userinfo.get()
  const email = userInfo.data.email || 'Unknown'
  const picture = userInfo.data.picture || undefined

  return { success: true, email, picture }
}

/**
 * Store refresh token securely using safeStorage
 */
async function storeRefreshToken(refreshToken: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system')
  }

  await mkdir(SETTINGS_DIR, { recursive: true })
  const encryptedToken = safeStorage.encryptString(refreshToken)
  await writeFile(REFRESH_TOKEN_PATH, encryptedToken)
}

/**
 * Get stored refresh token
 */
export async function getRefreshToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Google] Secure storage not available')
    return null
  }

  try {
    const encryptedToken = await readFile(REFRESH_TOKEN_PATH)
    return safeStorage.decryptString(encryptedToken)
  } catch {
    // File doesn't exist or can't be read
    return null
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getAccessToken(): Promise<string | null> {
  // Check if cached token is still valid (with 5 min buffer)
  if (cachedTokens && cachedTokens.expiry_date > Date.now() + 5 * 60 * 1000) {
    return cachedTokens.access_token
  }

  // Try to refresh
  const refreshToken = await getRefreshToken()
  if (!refreshToken) {
    return null
  }

  try {
    const tokens = await refreshAccessToken(refreshToken)
    return tokens.access_token
  } catch (error) {
    console.error('[Google] Failed to refresh token:', error)
    return null
  }
}

/**
 * Refresh the access token using stored refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const { credentials } = await oauth2Client.refreshAccessToken()

  cachedTokens = {
    access_token: credentials.access_token || '',
    refresh_token: credentials.refresh_token || refreshToken,
    expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000
  }

  // If we got a new refresh token, store it
  if (credentials.refresh_token && credentials.refresh_token !== refreshToken) {
    await storeRefreshToken(credentials.refresh_token)
  }

  return cachedTokens
}

/**
 * Clear all stored tokens (disconnect)
 */
export async function clearTokens(): Promise<void> {
  cachedTokens = null
  try {
    await unlink(REFRESH_TOKEN_PATH)
  } catch {
    // File doesn't exist, ignore
  }
}

/**
 * Validate connection by testing the token and fetching user email
 */
export async function validateConnection(): Promise<GoogleConnectionStatus> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) {
    return { connected: false }
  }

  try {
    const accessToken = await getAccessToken()
    if (!accessToken) {
      return { connected: false, error: 'Failed to get access token' }
    }

    // Test the token by fetching user info
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    return {
      connected: true,
      email: userInfo.data.email || undefined,
      picture: userInfo.data.picture || undefined
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    // If token is invalid, clear it
    if (errorMessage.includes('invalid_grant') || errorMessage.includes('Invalid Credentials')) {
      await clearTokens()
      return { connected: false, error: 'Session expired. Please reconnect.' }
    }
    return { connected: false, error: errorMessage }
  }
}

/**
 * Get an authenticated OAuth2 client for API calls
 */
export async function getAuthenticatedClient() {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new Error('Not authenticated with Google')
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ access_token: accessToken })

  return oauth2Client
}
