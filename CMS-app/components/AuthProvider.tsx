"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Client-side wrapper for NextAuth's SessionProvider so `useSession()` works
 * anywhere in the tree. Harmless when OAuth isn't configured — there's simply
 * never a session, and CurrentUserProvider falls back to the dev identity.
 */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
