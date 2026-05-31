import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthUser } from "@travel-sync/shared";
import { api, setAuthLostHandler } from "@/api/client";
import { secureTokenStore } from "@/api/secure-store";
import { endpoints } from "@travel-sync/shared";

interface AuthState {
  user: AuthUser | null;
  /** True until we've checked the keychain for an existing session. */
  initializing: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithLine: (idToken: string, nonce: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  // Bounce to sign-in when a refresh fails mid-session.
  useEffect(() => {
    setAuthLostHandler(() => setUser(null));
  }, []);

  // On cold start, if we have a stored token, hydrate the profile.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await secureTokenStore.getAccessToken();
        if (token) {
          const me = await api.get<{ user: AuthUser }>(endpoints.me);
          if (active) setUser(me.user ?? null);
        }
      } catch {
        await secureTokenStore.clear();
      } finally {
        if (active) setInitializing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const res = await api.loginWithEmail(email, password);
    setUser(res.user);
  }, []);

  const signInWithLine = useCallback(async (idToken: string, nonce: string) => {
    const res = await api.loginWithLine(idToken, nonce);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, initializing, signInWithEmail, signInWithLine, signOut }),
    [user, initializing, signInWithEmail, signInWithLine, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
