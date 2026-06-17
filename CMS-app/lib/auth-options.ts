/**
 * NextAuth configuration — GitHub OAuth for login identity.
 *
 * OAuth here authenticates *who the user is*. It is independent of the GitHub
 * PAT (`GITHUB_TOKEN`) the storage layer uses to read/write content — that
 * keeps working unchanged. Roles are NOT stored on the session; they're
 * resolved from `CMS-content/users.json` server-side (see lib/server-auth.ts)
 * and client-side (see CurrentUserProvider), so a user's role can change
 * without re-issuing their session.
 *
 * Graceful fallback: when the OAuth env vars are absent, `isAuthConfigured()`
 * returns false and the app stays on the dev identity switcher + `x-cms-user`
 * header path. Set the vars (see .env.example) to require real GitHub login.
 */

import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

/**
 * True when GitHub OAuth credentials are present. Single source of truth for
 * "auth is on" — read by both the server (getRequestUser) and the client
 * (passed into CurrentUserProvider from the layout).
 */
export function isAuthConfigured(): boolean {
  return (
    !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      // `user:email` ensures NextAuth can fetch the account's primary email
      // even when the public profile email is hidden — we key roles on email.
      authorization: { params: { scope: "read:user user:email" } },
    }),
  ],
  // JWT sessions — no database. The email in the token is all we need; roles
  // are looked up fresh from users.json on each request.
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};
