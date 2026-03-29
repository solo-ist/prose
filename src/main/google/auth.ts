import { google } from 'googleapis'
import { BrowserWindow, session } from 'electron'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { URL } from 'url'
import { randomBytes } from 'crypto'
import { credentialStore } from '../credentialStore'

const SETTINGS_DIR = join(homedir(), '.prose')
const REFRESH_TOKEN_PATH = join(SETTINGS_DIR, '.google-refresh-token')
const GOOGLE_CREDENTIAL_KEY = 'google-refresh-token'
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 min before expiry

// Google OAuth credentials - these are for a desktop app
// Client ID and secret are safe to embed in desktop apps (not secrets for installed apps)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''

const SCOPES = [
  'https://www.googleapis.com/auth/drive', // Read/write access to files (needed for import + push)
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
    let authCompleted = false
    let authWindow: BrowserWindow | null = null
    let csrfState: string = ''

    // Create a temporary HTTP server on a random port
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '', `http://localhost`)

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')

        // Verify CSRF state token
        if (returnedState !== csrfState) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>Invalid state parameter. This may indicate a CSRF attack.</p>
              </body>
            </html>
          `)
          authCompleted = true
          server.close()
          if (authWindow && !authWindow.isDestroyed()) authWindow.close()
          resolve({ success: false, error: 'Invalid state parameter (possible CSRF attack)' })
          return
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
              </body>
            </html>
          `)
          authCompleted = true
          server.close()
          if (authWindow && !authWindow.isDestroyed()) authWindow.close()
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
              </body>
            </html>
          `)
          authCompleted = true
          server.close()
          if (authWindow && !authWindow.isDestroyed()) authWindow.close()
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
              </body>
            </html>
          `)
          authCompleted = true
          server.close()
          if (authWindow && !authWindow.isDestroyed()) authWindow.close()
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
              </body>
            </html>
          `)
          authCompleted = true
          server.close()
          if (authWindow && !authWindow.isDestroyed()) authWindow.close()
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

      // Generate CSRF state token to prevent cross-site request forgery
      csrfState = randomBytes(16).toString('hex')

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent', // Force consent to always get refresh token
        state: csrfState
      })

      // Open auth URL in an embedded BrowserWindow
      const parent = BrowserWindow.getFocusedWindow()
      authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        parent: parent || undefined,
        modal: false,
        autoHideMenuBar: true,
        title: 'Sign in with Google',
        webPreferences: {
          partition: 'persist:google-auth',
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      if (parent) {
        const parentBounds = parent.getBounds()
        authWindow.setPosition(
          Math.round(parentBounds.x + (parentBounds.width - 500) / 2),
          Math.round(parentBounds.y + (parentBounds.height - 700) / 2)
        )
      }

      authWindow.on('closed', () => {
        authWindow = null
        if (!authCompleted) {
          server.close()
          resolve({ success: false, error: 'User cancelled authentication' })
        }
      })

      authWindow.loadURL(authUrl)
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
 * Store refresh token securely using credentialStore
 */
async function storeRefreshToken(refreshToken: string): Promise<void> {
  await credentialStore.set(GOOGLE_CREDENTIAL_KEY, refreshToken)
}

/**
 * Get stored refresh token, with one-time migration from legacy file
 */
export async function getRefreshToken(): Promise<string | null> {
  // Try credentialStore first, then migrate from legacy file if needed
  const token = await credentialStore.get(GOOGLE_CREDENTIAL_KEY)
  if (token) return token

  return credentialStore.migrateFromLegacyFile(REFRESH_TOKEN_PATH, GOOGLE_CREDENTIAL_KEY)
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getAccessToken(): Promise<string | null> {
  // Check if cached token is still valid (with 5 min buffer)
  if (cachedTokens && cachedTokens.expiry_date > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
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
 * Clear all stored tokens (disconnect).
 * Revokes the token on Google's side first so that a fresh reconnect
 * picks up any scope changes made in the GCP console.
 */
export async function clearTokens(): Promise<void> {
  // Revoke token on Google's side before clearing locally
  const refreshToken = await getRefreshToken()
  if (refreshToken) {
    try {
      const oauth2Client = createOAuth2Client()
      await oauth2Client.revokeToken(refreshToken)
    } catch {
      // Revocation failed (network error, already revoked, etc.) — proceed with local cleanup
    }
  }

  cachedTokens = null
  await credentialStore.delete(GOOGLE_CREDENTIAL_KEY)
  // Also clean up legacy file if it exists
  try { await unlink(REFRESH_TOKEN_PATH) } catch { /* ignore */ }

  // Clear auth session cookies so re-auth starts fresh
  try {
    await session.fromPartition('persist:google-auth').clearStorageData()
  } catch {
    // Session cleanup failed, ignore
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
