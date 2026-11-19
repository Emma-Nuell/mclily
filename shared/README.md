# Shared deployment sources

These are canonical helper sources. Apps commit local `vendor/` copies so Render can select an individual folder without exposing siblings.

After editing a helper, run `node scripts/sync-shared.mjs` at the repository root and commit all affected copies. CI runs `--check` to reject drift. Do not hand-edit vendor copies. The command also synchronizes each app's Node pin and the backend's sample JSON from `frontend/src/data/preview-catalog.json`. Deployment build/start commands do not need the root script.
