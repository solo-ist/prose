const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses')
const path = require('path')

/**
 * afterPack hook for electron-builder.
 * Flips Electron fuses to disable dangerous runtime features in production builds.
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context

  let executableName
  switch (electronPlatformName) {
    case 'darwin':
    case 'mas':
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
  })

  console.log('[Fuses] Fuses flipped successfully')
}
