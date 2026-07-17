import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, LogIn, RefreshCw, TrendingUp } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";

type AuthLoginPageProps = {
  networkError?: string | null;
  onRetry?: () => void;
};

export const AuthLoginPage: React.FC<AuthLoginPageProps> = ({
  networkError,
  onRetry,
}) => {
  const auth = useAuth();
  const navigate = useNavigate();
  const { login, loadMe } = auth;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // Sempre a home autenticada — não retorna à URL anterior.
      navigate("/home", { replace: true });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Não foi possível entrar. Verifique e-mail e senha."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (networkError && onRetry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg text-center space-y-4">
          <p className="text-sm text-muted-foreground">{networkError}</p>
          <button
            type="button"
            onClick={() => void loadMe()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-background to-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar à página inicial
        </Link>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <TrendingUp className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Acesse o IndusCost</h1>
            <p className="text-sm text-muted-foreground mt-1">Entre com seu usuário e senha.</p>
          </div>
        </div>

        {formError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              E-mail
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/25"
              placeholder="usuario@empresa.com"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="auth-password"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Senha
            </label>
            <input
              id="auth-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/25"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
};
