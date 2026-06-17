"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User, UserRole } from "@/lib/types";

/**
 * Stand-in for "currently logged in user" until auth is wired.
 *
 * Source of truth: `localStorage["cms-current-user"]` (an email address).
 * Resolved against the live `/api/users` list to a full `User` object so the
 * UI can branch on role.
 *
 * Cross-tab updates flow naturally via the browser `storage` event.
 * Same-tab updates dispatch a custom `cms-identity-changed` event so
 * components inside the same window re-render when the user switches
 * identity in Settings without reloading.
 */

interface CurrentUserCtx {
  user: User | null;
  role: UserRole | null;
  loaded: boolean;
  /** Update the active identity. Persists + broadcasts. */
  setIdentity: (email: string) => void;
}

const Ctx = createContext<CurrentUserCtx>({
  user: null,
  role: null,
  loaded: false,
  setIdentity: () => {},
});

export const IDENTITY_STORAGE_KEY = "cms-current-user";
export const IDENTITY_EVENT = "cms-identity-changed";

/** Request header the server reads to resolve the calling user (see lib/server-auth.ts). */
export const IDENTITY_HEADER = "x-cms-user";

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
    try {
      email = localStorage.getItem(IDENTITY_STORAGE_KEY);
    } catch {
      /* localStorage blocked — send unauthenticated, server default-denies writes */
    }
    if (!email) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set(IDENTITY_HEADER, email);
    return originalFetch(input, { ...init, headers });
  };
}

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  // Install before any effect fires so the identity header rides on every
  // `/api/*` request, including this provider's own mount-time user fetch.
  // Idempotent + guarded, so calling during render is safe.
  installIdentityFetchInterceptor();

  const [users, setUsers] = useState<User[]>([]);
  const [identity, setIdentityState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Initial load: pull the user list and read the persisted identity.
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
        try {
          setIdentityState(localStorage.getItem(IDENTITY_STORAGE_KEY));
        } catch {
          /* localStorage blocked — leave identity null */
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for identity changes — cross-tab via `storage`, same-tab via the
  // custom event dispatched by `setIdentity`.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === IDENTITY_STORAGE_KEY) setIdentityState(e.newValue);
    };
    const handleCustom = () => {
      try {
        setIdentityState(localStorage.getItem(IDENTITY_STORAGE_KEY));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(IDENTITY_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(IDENTITY_EVENT, handleCustom);
    };
  }, []);

  // Refresh the user list when an identity change suggests Platform Settings
  // may have just added/edited someone.
  useEffect(() => {
    const handler = () => {
      fetch("/api/users")
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d: { users?: User[] }) => setUsers(d.users || []))
        .catch(() => {});
    };
    window.addEventListener(IDENTITY_EVENT, handler);
    return () => window.removeEventListener(IDENTITY_EVENT, handler);
  }, []);

  const setIdentity = useCallback((email: string) => {
    try {
      localStorage.setItem(IDENTITY_STORAGE_KEY, email);
    } catch {
      /* ignore */
    }
    setIdentityState(email);
    // Broadcast so other components in the same tab pick up the change.
    window.dispatchEvent(new Event(IDENTITY_EVENT));
  }, []);

  const user = identity
    ? users.find((u) => u.email.toLowerCase() === identity.toLowerCase()) || null
    : null;

  return (
    <Ctx.Provider value={{ user, role: user?.role || null, loaded, setIdentity }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCurrentUser() {
  return useContext(Ctx);
}
