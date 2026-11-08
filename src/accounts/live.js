/**
 * Accounts launch switch (docs/USER_ACCOUNTS_PLAN.md Phase 5). Until VITE_ACCOUNTS_LIVE=true is set for the
 * build, the account, admin, contact and legal pages aren't routed and the footer links (LegalLinks) are hidden,
 * so the code can ship before launch. localhost sets it in .env.local; production gets it at launch, together with
 * the server settings api/auth.js needs (it answers 404 until USERS_DATABASE_URL and BETTER_AUTH_SECRET are set).
 */
export const ACCOUNTS_LIVE = import.meta.env.VITE_ACCOUNTS_LIVE === 'true'
