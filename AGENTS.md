# Reelm Drama: read before acting

This is a standalone source export of the canonical Reelm `drama-mobile/` app. Read README.md for current release, signing, fixture and migration constraints.

- Before installs, builds, copies or deletions: inspect `git status --short`, existing artifacts and target-volume free space. Preserve dirty/untracked work.
- Keep at least 20 GiB free. At most 5 GiB new temporary files per task; ask before exceeding either limit. Do not delete older files to make room without approval.
- Reuse installed dependencies when the lockfile matches. Use one existing `.local/drama2` stage. No dated/GUID builds, project/dependency/cache copies or separate installs for test variants.
- Git preserves source history. Retain only necessary original changed-file bytes/patches when dirty data is not in Git. Rollback checks use targeted files/tiny fixtures, never project copies.
- Keep `.env*`, keys, DPAPI/passwords, credentials, recovery exports, personal libraries, HARs and phone receipts out of Git, public reports and CI artifacts. Ignored does not mean disposable.
- Preserve `native/`, plugins, build/release tooling, SDKs, tests/fixtures and signing recovery inputs. The authored observer fixture and pinned receipt are required by the native build tests.
- Before Windows deletion resolve the absolute target, verify the intended boundary and reject reparse-point targets/ancestors. Use PowerShell `-LiteralPath`; no cross-shell composed deletes, broad git clean, destructive reset or blanket purge.
- Run full Node/UI tests and typecheck. A source/fixture check is not actual native playback, offline decoding or completed Android installation. Keep diagnostics-off release verification and fresh bundling intact.
- Publish APKs through Releases only when requested, not Git. Verify exact remote availability/hash before removing local duplicates; keep the latest tested APK and required migration recovery inputs.
- Private release signing fails closed; never regenerate a key to make a build pass. Legacy-to-private migration requires owner-normal export, explicit uninstall and import; encrypted downloads are lost on uninstall.
- Document-only work needs document checks, not dependency installs/app builds. Compact receipts normally stay under 10 MiB. Remove only confirmed task-owned disposable outputs and report what remains.