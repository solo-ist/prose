# Post-merge verification scratch (re-run after the #732 trust fix)

Throwaway PR to confirm the corrected gate: E2E → ci-gate "Check PR author trust"
should now resolve `trusted=true` via `getCollaboratorPermissionLevel` (write/admin)
→ `/review` posted → auto-review fires. Close + delete after the ci-gate run confirms.
