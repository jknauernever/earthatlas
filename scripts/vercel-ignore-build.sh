#!/bin/bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand), Josh 2026-10-02: every build is billed, and pushes that only
# touch the GitHub-run bake pipelines, workflows, docs or tests change nothing Vercel serves. Exit 0 = SKIP the build,
# exit 1 = build. When in doubt (no previous deployed commit, or it isn't in the clone), build.
#   Ignored paths: docs/, .github/, scripts/ships/bake-*/ (GitHub Actions bakes; api/ only reads their gitignored local
#   outputs in dev), scripts/ships/gisis/, lib/ships/test/, *.md
PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
if [ -z "$PREV" ]; then echo "no previous deployed commit: build"; exit 1; fi
git cat-file -e "$PREV^{commit}" 2>/dev/null || git fetch --quiet --depth=50 origin "$PREV" 2>/dev/null || true
if ! git cat-file -e "$PREV^{commit}" 2>/dev/null; then echo "previous commit $PREV not available: build"; exit 1; fi
if git diff --quiet "$PREV" "$CUR" -- . \
    ':(exclude)docs/**' ':(exclude).github/**' ':(exclude)scripts/ships/bake-*/**' ':(exclude)scripts/ships/gisis/**' \
    ':(exclude)lib/ships/test/**' ':(exclude)*.md'; then
  echo "only pipeline / workflow / docs / test files changed since $PREV: skipping the build"
  exit 0
fi
echo "site files changed since $PREV: build"
exit 1
