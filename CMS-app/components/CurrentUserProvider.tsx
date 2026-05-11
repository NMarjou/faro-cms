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

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
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
