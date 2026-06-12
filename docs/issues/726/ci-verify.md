# Post-merge verification scratch (PR #730 / #726)

Throwaway file to open a same-repo PR that exercises the new author-trust gate:
E2E → ci-gate "Check PR author trust" (expect `trusted=true`) → `/review` posted →
auto-review fires. This PR is **not** meant to be merged — close + delete after the
ci-gate run confirms the legit chain still works.
