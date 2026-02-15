const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName === 'darwin') {
    // Skip ad-hoc signing when a real certificate is available
    // (electron-builder handles signing natively via CSC_LINK)
    if (process.env.CSC_LINK) {
      console.log('CSC_LINK is set — skipping ad-hoc signing (electron-builder will sign)');
      return;
    }

    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    console.log(`Ad-hoc signing (no CSC_LINK): ${appPath}`);
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  }
};
