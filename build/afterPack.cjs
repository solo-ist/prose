const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses')
const { execFileSync } = require('child_process')
const path = require('path')

// Sign-in deep link scheme (#970), declared under `mac.protocols`. The MAS
// build has no sign-in, so it must not claim the scheme — but electron-builder
// writes CFBundleURLTypes from the `mac` options even for the mas target
// (`mas.protocols` is ignored), so it is stripped here, before signing.
const SIGN_IN_SCHEME = 'prose-signin'

function urlSchemes(infoPlist) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], { encoding: 'utf8' })
  return (JSON.parse(json).CFBundleURLTypes || []).map((type) => type.CFBundleURLSchemes || [])
}

function enforceSignInScheme(infoPlist, isMas) {
  if (isMas) {
    // Delete from the end so earlier indexes stay valid.
    const types = urlSchemes(infoPlist)
    for (let i = types.length - 1; i >= 0; i--) {
      if (types[i].includes(SIGN_IN_SCHEME)) {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :CFBundleURLTypes:${i}`, infoPlist])
      }
    }
  }
  const claimed = urlSchemes(infoPlist).flat()
  if (isMas === claimed.includes(SIGN_IN_SCHEME)) {
    throw new Error(`[URL schemes] ${isMas ? 'MAS' : 'mac'} build claims ${JSON.stringify(claimed)}; ` +
      `${SIGN_IN_SCHEME} must be ${isMas ? 'absent' : 'present'}`)
  }
  console.log(`[URL schemes] ${isMas ? 'MAS' : 'mac'} build claims ${claimed.join(', ')}`)
}

/**
 * afterPack hook for electron-builder.
 * Flips Electron fuses to disable dangerous runtime features in production builds.
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName === 'mas' || electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`
    enforceSignInScheme(path.join(appOutDir, appName, 'Contents', 'Info.plist'), electronPlatformName === 'mas')
  }

  // Skip fuse flipping for MAS builds — the App Sandbox already provides
  // the security that fuses enforce, and flipping fuses on the MAS Electron
  // binary can invalidate framework signatures, causing EXC_BREAKPOINT crashes.
  if (electronPlatformName === 'mas') {
    console.log('[Fuses] Skipping fuse flipping for MAS build (sandbox provides equivalent protection)')
    return
  }

  let executableName
  switch (electronPlatformName) {
    case 'darwin':
      executableName = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'MacOS', context.packager.appInfo.productFilename)
      break
    case 'win32':
      executableName = path.join(appOutDir, `${context.packager.appInfo.productFilename}.exe`)
      break
    case 'linux':
      executableName = path.join(appOutDir, context.packager.appInfo.productFilename.toLowerCase())
      break
    default:
      throw new Error(`Unsupported platform: ${electronPlatformName}`)
  }

  console.log(`[Fuses] Flipping fuses for ${electronPlatformName}: ${executableName}`)

  await flipFuses(executableName, {
    version: FuseVersion.V1,
    // Disable ELECTRON_RUN_AS_NODE — prevents using the app binary as a Node.js runtime
    [FuseV1Options.RunAsNode]: false,
    // Disable NODE_OPTIONS environment variable — prevents injecting Node.js flags
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // Disable --inspect and related CLI flags — prevents attaching debuggers to production builds
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Validate the embedded asar at runtime against the hash electron-builder
    // writes into Info.plist (ElectronAsarIntegrity) — launch fails if the
    // bundled app code is tampered with on disk after signing.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // Refuse to load app code from loose files outside the asar archive.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })

  console.log('[Fuses] Fuses flipped successfully')
}
