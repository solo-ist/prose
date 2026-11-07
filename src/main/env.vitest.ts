// Unit-test stand-in for the generated `src/main/env.ts` (#1223).
//
// `npm run build:env` writes `env.ts` and it is gitignored, but CI runs the unit
// tests before it builds. `vitest.config.ts` aliases every main-process `./env`
// import here so a test can import main code without a build; tests that need
// the App Store edition mock `./env` themselves.
export const IS_MAS_BUILD = false
