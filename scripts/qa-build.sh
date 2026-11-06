#!/bin/zsh
#
# Build an isolated "Prose QA" app from whatever is currently checked out, for
# the HITL pass the release train calls for before a tag. Produces
# ~/Applications/Prose QA.app.
#
#   zsh scripts/qa-build.sh
#
# Why this exists rather than `npm run build:mac`: a QA build has to be able to
# run *beside* the installed Prose without touching its profile. The load-bearing
# detail is `extraMetadata` — app.getName() comes from the BUNDLED package.json,
# not CFBundleName, and it drives userData, the single-instance lock and the MCP
# socket directory. Override productName alone and the QA app quietly adopts the
# installed app's profile and hands off to the running instance.
#
# Notes:
#  - mac.icon is NOT overridden: it inherits electron-builder.yml, which since
#    #812 is the AppIcon.icon bundle. That needs actool 26+ (full Xcode, not
#    Command Line Tools) — electron-builder hard-fails without it rather than
#    falling back. Verified against Xcode 27.1; check `xcrun --find actool` and
#    its version if this step ever fails on another machine.
#  - extraMetadata rewrites the SOURCE package.json, so this restores it via a
#    trap and asserts the restore took.
#  - Ad-hoc signed (`codesign --sign -`): no Developer ID on this account.
#  - The packaged build cannot be driven by Playwright — the
#    EnableNodeCliInspectArguments fuse is off by design.
#
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p dist
node -e "
const yaml=require('js-yaml'), fs=require('fs');
const c=yaml.load(fs.readFileSync('electron-builder.yml','utf8'));
c.productName='Prose QA'; c.appId='ist.solo.prose.qa';
delete c.fileAssociations;            // don't contest the .md default handler
delete c.publish;                     // never publish a QA build
c.mac.identity=null; c.mac.target=['dir'];
// mac.icon is deliberately left alone so the QA build exercises the REAL icon
// path (AppIcon.icon → actool → Assets.car), which is the thing #812 changed and
// therefore the thing QA needs to look at.
c.directories.output='dist/qa';
// app.getName() drives userData, the single-instance lock and the MCP socket dir,
// and it comes from the BUNDLED package.json — not CFBundleName.
c.extraMetadata={name:'prose-qa',productName:'Prose QA'};
fs.writeFileSync('dist/.qa-builder.json', JSON.stringify(c,null,2));
"

# extraMetadata makes electron-builder rewrite the SOURCE package.json (renames the
# package, drops all scripts). Keep a byte copy to restore from: a `git checkout` alone
# proved unreliable here — a run on 2026-10-17 left the clobber in place despite it —
# and an un-restored package.json silently breaks every npm script afterwards.
cp package.json "$TMPDIR/qa-build-package.json.bak"
restore_package_json() {
  cp "$TMPDIR/qa-build-package.json.bak" package.json
}
trap restore_package_json EXIT

npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --config dist/.qa-builder.json

# No Developer ID on this account; ad-hoc sign so the bundle identity and seal are valid.
codesign --force --deep --sign - --entitlements build/entitlements.mac.plist "dist/qa/mac-arm64/Prose QA.app"
codesign --verify --deep --strict "dist/qa/mac-arm64/Prose QA.app"

rm -rf ~/Applications/"Prose QA.app"
cp -R "dist/qa/mac-arm64/Prose QA.app" ~/Applications/

# Restore now (the trap is the backstop for an early exit) and prove it took, so a
# clobbered package.json can never be mistaken for a working tree.
restore_package_json
node -e "
const p=require('./package.json');
if (p.name !== 'prose' || !p.scripts || !p.scripts.build) {
  console.error('FAIL: package.json still clobbered — name=' + p.name);
  process.exit(1);
}
console.log('package.json restored: name=' + p.name + ' scripts=' + Object.keys(p.scripts).length);
"

echo "installed: ~/Applications/Prose QA.app"
echo "verify isolation:  ~/Library/Application Support/Prose QA  (must NOT be 'prose')"
