#!/bin/zsh
# Copy Josh's /shoreline panel edits (made on localhost) to production, in one go:
#   1. reads the production users-database address from the clipboard (copied with "Copy Snippet" on Vercel; never shown or saved)
#   2. creates the content tables in prod if they aren't there yet (scripts/accounts/migrate.mjs)
#   3. shows what will be copied (dry run) and asks before copying (scripts/content/copy-to-prod.mjs)
# Run from the repo:  zsh scripts/content/shoreline-to-prod.sh
set -e
cd "$(dirname "$0")/../.."

# Josh clicks "Show secret" then "Copy Snippet" on the Vercel page for earthatlas-users (Getting Started → Quickstart →
# .env.local); the clipboard then holds the whole .env block, and the DATABASE_URL line is the one we want.
echo "In Chrome, on the earthatlas-users page: click \"Show secret\", then \"Copy Snippet\"."
echo "Don't paste it here. Just come back to this window and press Enter."
read -rs "?Press Enter when copied. "
echo
# Either the whole snippet (its DATABASE_URL line) or just the address on its own
CLIP="$(pbpaste)"
PROD="$(printf '%s\n' "$CLIP" | grep -E '^DATABASE_URL=' | head -1 | cut -d= -f2-)"
[[ -z "$PROD" ]] && PROD="$(printf '%s\n' "$CLIP" | grep -oE 'postgres(ql)?://[^[:space:]"]+' | head -1)"
unset CLIP
PROD="${PROD//\"/}"; PROD="${PROD//\'/}"
if [[ "$PROD" == \** ]]; then echo "The copied text has stars instead of the address. Click \"Show secret\" first, then \"Copy Snippet\", then run this again. Nothing done."; exit 1; fi
if [[ -z "$PROD" ]]; then echo "Didn't find DATABASE_URL in what you copied. On the Vercel page, click \"Copy Snippet\", then run this again. Nothing done."; exit 1; fi
if [[ "$PROD" != postgres* ]]; then echo "That doesn't look like a connection string (should start with postgresql://). Nothing done."; exit 1; fi
if [[ "$PROD" == *ep-proud-mountain* ]]; then echo "That's the DEV database, not production. Nothing done."; exit 1; fi
if [[ "$PROD" != *ep-summer-morning* ]]; then echo "Warning: this isn't the production users database I expected (ep-summer-morning…)."; read -r "ok?Continue anyway? (y/n) "; [[ "$ok" == y ]] || exit 1; fi

quiet() { grep -v -i -E "ssl|libpq|prepare|trace-warn|explicitly|See https|^$" || true; }

echo "Step 1 of 2: making sure production has the content tables…"
USERS_DATABASE_URL="$PROD" node --env-file=.env.local scripts/accounts/migrate.mjs --apply 2>&1 | quiet

echo
echo "Step 2 of 2: what will be copied:"
PROD_USERS_DATABASE_URL="$PROD" node --env-file=.env.local scripts/content/copy-to-prod.mjs --site shoreline 2>&1 | quiet
echo
read -r "ok?Copy these to production now? (y/n) "
if [[ "$ok" != y ]]; then echo "Stopped. Nothing copied."; exit 0; fi
PROD_USERS_DATABASE_URL="$PROD" node --env-file=.env.local scripts/content/copy-to-prod.mjs --site shoreline --apply 2>&1 | quiet
unset PROD
echo "Done. You can clear the clipboard now (copy any other text)."
