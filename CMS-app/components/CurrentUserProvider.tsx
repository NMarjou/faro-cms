"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import type { User, UserRole } from "@/lib/types";

/**
 * "Currently logged in user", with two identity sources depending on whether
 * GitHub OAuth is configured (the `authConfigured` prop, set by the layout):
 *
 *   - configured  → identity is the authenticated NextAuth session email.
 *     Unauthenticated visitors see a sign-in gate; authenticated users whose
 *     email isn't in users.json see an access-denied gate. No localStorage,
 *     no header interceptor — the session cookie carries identity server-side.
 *   - not configured (dev) → identity is `localStorage["cms-current-user"]`,
 *     switchable in Settings, sent to the server via the `x-cms-user` header.
 *
 * Either way, the email is resolved against the live `/api/users` list to a
 * full `User` so the UI can branch on role. Cross-tab/same-tab identity
 * changes (dev mode) flow via the `storage` and `cms-identity-changed` events.
 */

interface CurrentUserCtx {
  user: User | null;
  role: UserRole | null;
  loaded: boolean;
  /** True when GitHub OAuth is configured (identity is the real session). */
  authConfigured: boolean;
  /** Update the active identity. Persists + broadcasts. Dev-only; no-op under OAuth. */
  setIdentity: (email: string) => void;
}

const Ctx = createContext<CurrentUserCtx>({
  user: null,
  role: null,
  loaded: false,
  authConfigured: false,
  setIdentity: () => {},
});

export const IDENTITY_STORAGE_KEY = "cms-current-user";
export const IDENTITY_EVENT = "cms-identity-changed";

/** Request header the server reads to resolve the calling user (see lib/server-auth.ts). */
export const IDENTITY_HEADER = "x-cms-user";

/** localStorage key + header for the active project (see CurrentProjectProvider, lib/request-context.ts). */
export const PROJECT_STORAGE_KEY = "cms-current-project";
export const PROJECT_HEADER = "x-cms-project";

/**
 * Install a one-time global `fetch` shim that attaches the active identity as
 * the `x-cms-user` header on same-origin `/api/*` requests. This is how the
 * server-side authorization layer learns who's calling without real auth wired
 * up. The email is read from localStorage at call time (not install time), so
 * it always reflects the current identity. Patching `window.fetch` keeps the
 * ~100 scattered `fetch("/api/…")` call sites untouched; server-side fetches
 * (e.g. Slack in lib/notifications.ts) run in Node and are unaffected.
 */
function installIdentityFetchInterceptor() {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { __cmsFetchPatched?: boolean };
  if (w.__cmsFetchPatched) return;
  w.__cmsFetchPatched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Resolve the request URL so we only touch our own API.
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    const isApi = url.startsWith("/api/") || url.includes(`${window.location.origin}/api/`);
    if (!isApi) return originalFetch(input, init);

    let email: string | null = null;
    let project: string | null = null;
    try {
      email = localStorage.getItem(IDENTITY_STORAGE_KEY);
      project = localStorage.getItem(PROJECT_STORAGE_KEY);
    } catch {
      /* localStorage blocked — send unauthenticated, server default-denies writes */
    }
    if (!email && !project) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (email) headers.set(IDENTITY_HEADER, email);
    // The active project scopes which project's content the server resolves
    // (see lib/request-context.ts). Sourced from CurrentProjectProvider.
    if (project) headers.set(PROJECT_HEADER, project);
    return originalFetch(input, { ...init, headers });
  };
}

export function CurrentUserProvider({
  children,
  authConfigured = false,
}: {
  children: React.ReactNode;
  authConfigured?: boolean;
}) {
  // Dev-only spoofable header transport. When OAuth is on, identity rides on
  // the session cookie instead, so we never install the interceptor.
  if (!authConfigured) installIdentityFetchInterceptor();

  // useSession must be called unconditionally (hooks rules); its result is
  // only consulted when authConfigured.
  const { data: session, status } = useSession();

  const [users, setUsers] = useState<User[]>([]);
  const [devIdentity, setDevIdentity] = useState<string | null>(null);
  const [usersLoaded, setUsersLoaded] = useState(false);

  // Initial load: pull the user list. In dev mode, also read the persisted
  // identity from localStorage.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: User[] }) => {
        if (cancelled) return;
        setUsers(d.users || []);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      })
      .finally(() => {
        if (cancelled) return;
        if (!authConfigured) {
          try {
            setDevIdentity(localStorage.getItem(IDENTITY_STORAGE_KEY));
          } catch {
            /* localStorage blocked — leave identity null */
          }
        }
        setUsersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authConfigured]);

  // Dev identity-change listeners — cross-tab via `storage`, same-tab via the
  // custom event. No-op when OAuth drives identity.
  useEffect(() => {
    if (authConfigured) return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === IDENTITY_STORAGE_KEY) setDevIdentity(e.newValue);
    };
    const handleCustom = () => {
      try {
        setDevIdentity(localStorage.getItem(IDENTITY_STORAGE_KEY));
      } catch {
        /* ignore */
      }
      // A settings change may have added/edited a user — refresh the list.
      fetch("/api/users")
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d: { users?: User[] }) => setUsers(d.users || []))
        .catch(() => {});
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(IDENTITY_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(IDENTITY_EVENT, handleCustom);
    };
  }, [authConfigured]);

  const setIdentity = useCallback((email: string) => {
    // Identity switching is a dev affordance; under OAuth the session is the
    // source of truth and this is a no-op.
    if (authConfigured) return;
    try {
      localStorage.setItem(IDENTITY_STORAGE_KEY, email);
    } catch {
      /* ignore */
    }
    setDevIdentity(email);
    window.dispatchEvent(new Event(IDENTITY_EVENT));
  }, [authConfigured]);

  // Effective identity: session email when OAuth is on, else the dev value.
  const identity = authConfigured ? session?.user?.email ?? null : devIdentity;
  const user = identity
    ? users.find((u) => u.email.toLowerCase() === identity.toLowerCase()) || null
    : null;
  const loaded = authConfigured
    ? status !== "loading" && usersLoaded
    : usersLoaded;

  // ── Auth gates (configured mode only) ──────────────────────────────────────
  if (authConfigured) {
    if (status === "loading" || !usersLoaded) {
      return <AuthScreen>Loading…</AuthScreen>;
    }
    if (status === "unauthenticated") {
      return (
        <AuthScreen>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Faro CMS</h1>
          <p style={{ color: "var(--fg-muted)", marginBottom: 20, fontSize: 14 }}>
            Sign in to continue.
          </p>
          <button className="btn" onClick={() => signIn("github")}>
            Sign in with GitHub
          </button>
        </AuthScreen>
      );
    }
    // Authenticated but not provisioned in users.json → deny.
    if (!user) {
      return (
        <AuthScreen>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Access not provisioned</h1>
          <p style={{ color: "var(--fg-muted)", marginBottom: 20, fontSize: 14, maxWidth: 420 }}>
            You&apos;re signed in as <strong>{identity}</strong>, but this account
            hasn&apos;t been granted access. Ask a tech writer to add you in
            Platform Settings → Users &amp; Roles.
          </p>
          <button className="btn" onClick={() => signOut()}>
            Sign out
          </button>
        </AuthScreen>
      );
    }
  }

  return (
    <Ctx.Provider value={{ user, role: user?.role || null, loaded, authConfigured, setIdentity }}>
      {children}
    </Ctx.Provider>
  );
}

/** Minimal centered full-screen container for the sign-in / denied / loading states. */
function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
        gap: 4,
      }}
    >
      {children}
    </div>
  );
}

export function useCurrentUser() {
  return useContext(Ctx);
}
