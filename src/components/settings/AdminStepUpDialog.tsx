import React, { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  adminElevationConfirmedMessage,
  confirmAdminElevation,
} from "@/src/lib/adminElevationClient";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirmed: (message: string) => void;
};

export const AdminStepUpDialog: React.FC<Props> = ({ open, onClose, onConfirmed }) => {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setErrorMessage(null);
    try {
      const status = await confirmAdminElevation(password);
      setPassword("");
      onConfirmed(adminElevationConfirmedMessage(status.ttlMs));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível confirmar a identidade."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-step-up-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="space-y-1">
            <h3 id="admin-step-up-title" className="text-sm font-semibold">
              Confirme sua identidade para continuar
            </h3>
            <p className="text-sm text-muted-foreground">
              Esta ação altera parâmetros oficiais do sistema. Informe a senha da sua conta
              IndusCost. A sessão principal permanece ativa.
            </p>
          </div>
        </div>
        {errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Senha
            </label>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Confirme sua senha"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPassword("");
                setErrorMessage(null);
                onClose();
              }}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
