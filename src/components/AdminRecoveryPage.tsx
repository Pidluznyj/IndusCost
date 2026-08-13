import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";

type BootstrapAdminStatus = {
  enabled: boolean;
  authenticated: boolean;
  mode: "bootstrap-env";
  misconfigured: boolean;
  username: string | null;
  expiresAt: string | null;
};

/**
 * Break-glass / recuperação. Não substitui o login principal do IndusCost.
 * Usa apenas o cookie `induscost_bootstrap_admin`.
 */
export const AdminRecoveryPage: React.FC = () => {
  const [status, setStatus] = useState<BootstrapAdminStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [pendingLogin, setPendingLogin] = useState(false);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refreshStatus = async () => {
    setLoadingStatus(true);
    try {
      const data = await fetchJsonOk<BootstrapAdminStatus>("/api/bootstrap-admin/status", {
        suppressAuthEvent: true,
      });
      setStatus(data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível consultar o acesso de recuperação."
      );
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPendingLogin(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await fetchJsonOk("/api/bootstrap-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        suppressAuthEvent: true,
      });
      setPassword("");
      setSuccessMessage(
        "Sessão de recuperação ativa. A sessão principal do IndusCost não foi alterada."
      );
      await refreshStatus();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao autenticar recuperação."
      );
    } finally {
      setPendingLogin(false);
    }
  };

  const handleCreateSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPendingCreate(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await fetchJsonOk("/api/admin/users/bootstrap-super-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
        }),
        suppressAuthEvent: true,
      });
      setNewPassword("");
      setSuccessMessage(
        "Super administrador criado/atualizado. Entre pelo login normal do IndusCost."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível criar o super administrador."
      );
    } finally {
      setPendingCreate(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldOff className="h-5 w-5 text-amber-600 mt-0.5" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Recuperação administrativa</h1>
            <p className="text-sm text-muted-foreground">
              Mecanismo de emergência (break-glass). Não é o login cotidiano. Não substitui a
              sessão principal do IndusCost.
            </p>
          </div>
        </div>

        {loadingStatus ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando disponibilidade...
          </div>
        ) : null}

        {status && !status.enabled ? (
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            A recuperação bootstrap está desabilitada neste ambiente.
          </div>
        ) : null}

        {status?.misconfigured ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Bootstrap habilitado, mas sem configuração completa de ambiente.
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        {status?.enabled && !status.authenticated ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Usuário de recuperação
              </label>
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Senha
              </label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={pendingLogin || status.misconfigured}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {pendingLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Entrar na recuperação
            </button>
          </form>
        ) : null}

        {status?.enabled && status.authenticated ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Sessão bootstrap ativa para <strong>{status.username}</strong>. Use isto só para
                criar/reativar um SUPER_ADMIN e depois entre pelo login normal.
              </p>
            </div>
            <form onSubmit={handleCreateSuperAdmin} className="space-y-3">
              <p className="text-sm font-semibold">Criar ou reativar Super Administrador</p>
              <input
                required
                placeholder="Nome"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              <input
                required
                type="email"
                placeholder="E-mail"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              <input
                required
                type="password"
                placeholder="Senha do novo SUPER_ADMIN"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={pendingCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {pendingCreate ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Gravar SUPER_ADMIN
              </button>
            </form>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          <Link to="/login" className="font-semibold text-foreground hover:underline">
            Voltar ao login normal
          </Link>
        </p>
      </div>
    </div>
  );
};
