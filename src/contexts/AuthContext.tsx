import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { APP_AUTH_REQUIRED_EVENT, fetchJsonOk } from "@/src/lib/http";
import type { AuthMeResponse, AuthUser } from "@/src/lib/appAuthClient";

const SESSION_EXPIRED_MESSAGE = "Sessão expirada. Faça login novamente.";

export type AuthContextValue = {
  authUser: AuthUser | null;
  authenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  loadMe: () => Promise<void>;
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
  const loadSeq = useRef(0);

  const loadMe = useCallback(async () => {
    const seq = ++loadSeq.current;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const data = await fetchJsonOk<AuthMeResponse>("/api/auth/me", {
        suppressAuthEvent: true,
      });
      if (seq !== loadSeq.current) return;
      if (data.authenticated && data.user) {
        setAuthUser(data.user);
        setAuthenticated(true);
      } else {
        setAuthUser(null);
        setAuthenticated(false);
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setAuthUser(null);
      setAuthenticated(false);
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
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // 401 global (qualquer chamada protegida sem sessão válida): limpa o usuário e
  // deixa o RequireAuth redirecionar ao login. Idempotente — evita avalanche.
  useEffect(() => {
    const handleAuthRequired = () => {
      loadSeq.current += 1; // invalida loadMe em voo
      setAuthUser(null);
      setAuthenticated(false);
      setAuthLoading(false);
      setAuthError((prev) => prev ?? SESSION_EXPIRED_MESSAGE);
    };
    window.addEventListener(APP_AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(APP_AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const res = await fetchJsonOk<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
      // Falha de credenciais (401) é tratada no formulário, não como sessão expirada.
      suppressAuthEvent: true,
    });
    setAuthUser(res.user);
    setAuthenticated(true);
    setAuthLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchJsonOk("/api/auth/logout", { method: "POST" });
    } catch {
      // Limpa estado local mesmo se a rede falhar.
    }
    setAuthUser(null);
    setAuthenticated(false);
    setAuthError(null);
    setAuthLoading(false);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!authUser) return false;
      return authUser.effectivePermissions.includes(permission);
    },
    [authUser]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => {
      if (!authUser) return false;
      return permissions.some((p) => authUser.effectivePermissions.includes(p));
    },
    [authUser]
  );

  const isSuperAdmin = useCallback(() => authUser?.role === "SUPER_ADMIN", [authUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authUser,
      authenticated,
      authLoading,
      authError,
      loadMe,
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
      loadMe,
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
