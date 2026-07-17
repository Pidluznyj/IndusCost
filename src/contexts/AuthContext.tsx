import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_AUTH_REQUIRED_EVENT,
  APP_PERMISSIONS_STALE_EVENT,
  fetchJsonOk,
} from "@/src/lib/http";
import type {
  AuthMeResponse,
  AuthPermissionsVersionResponse,
  AuthUser,
  EffectiveAccessMeDto,
} from "@/src/lib/appAuthClient";
import { PERMISSIONS_CHANGED_SESSION_MESSAGE } from "@/src/lib/actionPermissionCatalog";
import { legacyPermissionGrantedByDto } from "@/src/lib/canAccessFromEffectiveAccess";

const SESSION_EXPIRED_MESSAGE = "Sessão expirada. Faça login novamente.";
const PERMISSIONS_POLL_MS = 60_000;

export type AuthContextValue = {
  authUser: AuthUser | null;
  authenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  /** Bloco shadow `/me.effectiveAccess` quando o servidor anexa (P04/P10). */
  effectiveAccess: EffectiveAccessMeDto | null;
  /** PERM-38 — aviso quando permissões mudam durante a sessão. */
  permissionsChangedNotice: string | null;
  clearPermissionsChangedNotice: () => void;
  loadMe: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  isSuperAdmin: () => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [effectiveAccess, setEffectiveAccess] = useState<EffectiveAccessMeDto | null>(null);
  const [permissionsChangedNotice, setPermissionsChangedNotice] = useState<string | null>(
    null
  );
  const loadSeq = useRef(0);
  const authUserRef = useRef<AuthUser | null>(null);

  const clearPermissionsChangedNotice = useCallback(() => {
    setPermissionsChangedNotice(null);
  }, []);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  const applyMePayload = useCallback((data: AuthMeResponse) => {
    if (data.authenticated && data.user) {
      setAuthUser(data.user);
      setAuthenticated(true);
      setEffectiveAccess(data.effectiveAccess ?? null);
    } else {
      setAuthUser(null);
      setAuthenticated(false);
      setEffectiveAccess(null);
    }
  }, []);

  const loadMe = useCallback(async () => {
    const seq = ++loadSeq.current;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const data = await fetchJsonOk<AuthMeResponse>("/api/auth/me", {
        suppressAuthEvent: true,
      });
      if (seq !== loadSeq.current) return;
      applyMePayload(data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setAuthUser(null);
      setAuthenticated(false);
      setEffectiveAccess(null);
      setAuthError(
        e instanceof Error
          ? e.message
          : "Não foi possível verificar sua sessão. Verifique a conexão e tente novamente."
      );
    } finally {
      if (seq === loadSeq.current) {
        setAuthLoading(false);
      }
    }
  }, [applyMePayload]);

  const refreshPermissions = useCallback(
    async (opts?: { announceChange?: boolean }) => {
      try {
        const data = await fetchJsonOk<AuthMeResponse>(
          "/api/auth/sync-session-permissions",
          {
            method: "POST",
            suppressAuthEvent: true,
          }
        );
        applyMePayload(data);
        setAuthError(null);
        if (opts?.announceChange) {
          setPermissionsChangedNotice(PERMISSIONS_CHANGED_SESSION_MESSAGE);
        }
      } catch {
        await loadMe();
      }
    },
    [applyMePayload, loadMe]
  );

  const pollPermissionsVersion = useCallback(async () => {
    if (!authUserRef.current) return;
    try {
      const data = await fetchJsonOk<AuthPermissionsVersionResponse>(
        "/api/auth/permissions-version",
        { suppressAuthEvent: true }
      );
      if (!data.authenticated) return;
      const current = authUserRef.current.permissionsVersion ?? 0;
      if (data.permissionsVersion !== current) {
        await refreshPermissions({ announceChange: true });
      }
    } catch {
      // 401 tratado pelo próximo request protegido ou poll seguinte.
    }
  }, [refreshPermissions]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    const handleAuthRequired = () => {
      loadSeq.current += 1;
      setAuthUser(null);
      setAuthenticated(false);
      setEffectiveAccess(null);
      setAuthLoading(false);
      setAuthError((prev) => prev ?? SESSION_EXPIRED_MESSAGE);
    };
    const handlePermissionsStale = () => {
      void refreshPermissions({ announceChange: true });
    };
    window.addEventListener(APP_AUTH_REQUIRED_EVENT, handleAuthRequired);
    window.addEventListener(APP_PERMISSIONS_STALE_EVENT, handlePermissionsStale);
    return () => {
      window.removeEventListener(APP_AUTH_REQUIRED_EVENT, handleAuthRequired);
      window.removeEventListener(APP_PERMISSIONS_STALE_EVENT, handlePermissionsStale);
    };
  }, [refreshPermissions]);

  useEffect(() => {
    if (!authenticated) return;
    const onFocus = () => {
      void pollPermissionsVersion();
    };
    const timer = window.setInterval(() => {
      void pollPermissionsVersion();
    }, PERMISSIONS_POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void pollPermissionsVersion();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [authenticated, pollPermissionsVersion]);

  const login = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      await fetchJsonOk<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        suppressAuthEvent: true,
      });
      await loadMe();
    },
    [loadMe]
  );

  const logout = useCallback(async () => {
    try {
      await fetchJsonOk("/api/auth/logout", { method: "POST" });
    } catch {
      // Limpa estado local mesmo se a rede falhar.
    }
    setAuthUser(null);
    setAuthenticated(false);
    setEffectiveAccess(null);
    setAuthError(null);
    setPermissionsChangedNotice(null);
    setAuthLoading(false);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!authUser) return false;
      // PERM-31: SUPER_ADMIN não recebe catálogo na bag — bypass por role.
      if (authUser.role === "SUPER_ADMIN") return true;
      // Com DTO canônico, a bag não amplia acesso além do perfil/overrides.
      if (effectiveAccess) {
        return legacyPermissionGrantedByDto(effectiveAccess, permission);
      }
      return authUser.effectivePermissions.includes(permission);
    },
    [authUser, effectiveAccess]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => {
      if (!authUser) return false;
      if (authUser.role === "SUPER_ADMIN") return true;
      if (effectiveAccess) {
        return permissions.some((p) =>
          legacyPermissionGrantedByDto(effectiveAccess, p)
        );
      }
      return permissions.some((p) => authUser.effectivePermissions.includes(p));
    },
    [authUser, effectiveAccess]
  );

  const isSuperAdmin = useCallback(() => authUser?.role === "SUPER_ADMIN", [authUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authUser,
      authenticated,
      authLoading,
      authError,
      effectiveAccess,
      permissionsChangedNotice,
      clearPermissionsChangedNotice,
      loadMe,
      refreshPermissions: () => refreshPermissions(),
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      isSuperAdmin,
    }),
    [
      authUser,
      authenticated,
      authLoading,
      authError,
      effectiveAccess,
      permissionsChangedNotice,
      clearPermissionsChangedNotice,
      loadMe,
      refreshPermissions,
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      isSuperAdmin,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }
  return ctx;
}
