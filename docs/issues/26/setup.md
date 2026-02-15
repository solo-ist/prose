# Issue #26: macOS Signing & Notarization Setup

## 1. Apple Developer Certificate

Export your "Developer ID Application" certificate from Keychain Access:

1. Open **Keychain Access**
2. Find your **Developer ID Application** certificate (under "My Certificates")
3. Right-click → **Export Items...**
4. Save as `.p12`, set a password

If you don't have this certificate yet:

1. Open Keychain Access → Certificate Assistant → **Request a Certificate From a Certificate Authority**
2. Enter your email, leave CA Email blank, select "Saved to disk"
3. Sign into [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → Certificates → **+**
4. Select **Developer ID Application**, upload your CSR
5. Download the `.cer` and double-click to install

## 2. App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Generate a new password (label: "Prose Notarization")
3. Copy the generated password

## 3. Apple Team ID

1. Go to [developer.apple.com](https://developer.apple.com) → Account → Membership Details
2. Copy your **Team ID**

## 4. Local Environment Variables

For local signed builds, export before building:

```bash
export CSC_LINK=/path/to/your-certificate.p12
export CSC_KEY_PASSWORD=your-p12-password
export APPLE_ID=your@apple.id
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
```

## 5. GitHub Repository Secrets

Go to the repo's Settings → Secrets and variables → Actions and add:

| Secret | Value |
|--------|-------|
| `CSC_LINK` | Base64-encoded `.p12` (run `base64 -i your-cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from step 2 |
| `APPLE_TEAM_ID` | Team ID from step 3 |

## Verification

### Unsigned build (no setup needed)

```bash
npm run build:mac
```

Builds with ad-hoc signing as before.

### Signed build

```bash
npm run build:mac
codesign -vvv dist/mac-arm64/Prose.app
```

Should show your Developer ID certificate.

### Notarized build

```bash
npm run build:mac
spctl -a -vvv dist/mac-arm64/Prose.app
```

Should say "source=Notarized Developer ID".
