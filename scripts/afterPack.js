const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName === 'darwin') {
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    console.log(`Ad-hoc signing: ${appPath}`);
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  }
};
