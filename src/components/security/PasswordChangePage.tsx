import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { HttpError } from "@/src/lib/http";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  describePasswordPolicy,
  validatePasswordPolicy,
} from "@/src/lib/auth/passwordPolicy";
import {
  describePasswordError,
  requestChangeOwnPassword,
  requestCompletePasswordChange,
} from "@/src/lib/auth/passwordLifecycleClient";

/**
 * Tela única do ciclo de senha do próprio usuário, em dois modos:
 *
 *  - obrigatório (`mustChangePassword`): sem senha atual, sem saída para o
 *    resto do sistema. É a única tela que o usuário consegue usar.
 *  - voluntário: exige a senha atual.
 *
 * Esta tela é UX. A segurança real é do backend: o guard
 * `passwordChangeRequiredGuard` nega as demais APIs enquanto a troca estiver
 * pendente, então voltar no histórico, dar F5 ou digitar a URL na mão não
 * libera nada.
 *
 * A senha vive apenas no estado local deste componente e no corpo da
 * requisição — nunca em localStorage, sessionStorage, URL ou query string.
 */

type FieldProps = {
  id: string;
  label: string;
  value: string;
  autoComplete: "current-password" | "new-password";
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

const PasswordField: React.FC<FieldProps> = ({
  id,
  label,
  value,
  autoComplete,
  onChange,
  disabled,
  autoFocus,
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm disabled:opacity-60"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
};

export const PasswordChangePage: React.FC = () => {
  const { authUser, loadMe } = useAuth();
  const navigate = useNavigate();

  const forced = authUser?.mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Validação local é só conforto: quem decide é o backend, com a MESMA política.
  const localError = useMemo(() => {
    if (!newPassword && !confirmPassword) return null;
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) return policy.reasons[0] ?? null;
    if (confirmPassword && newPassword !== confirmPassword) {
      return "A confirmação não confere com a nova senha.";
    }
    return null;
  }, [newPassword, confirmPassword]);

  const canSubmit =
    !saving &&
    newPassword.length > 0 &&
    newPassword === confirmPassword &&
    validatePasswordPolicy(newPassword).valid &&
    (forced || currentPassword.length > 0);

  const clearFields = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      if (forced) {
        await requestCompletePasswordChange({ newPassword });
      } else {
        await requestChangeOwnPassword({ currentPassword, newPassword });
      }
      clearFields();
      // O backend rotacionou a sessão e trocou o cookie; recarregar o /me
      // confirma o novo estado (mustChangePassword = false) antes de liberar.
      await loadMe();
      setSuccess(true);
      if (forced) navigate("/home", { replace: true });
    } catch (err) {
      const code = err instanceof HttpError ? err.code : undefined;
      setError(
        describePasswordError(
          code,
          err instanceof Error ? err.message : "Não foi possível alterar a senha."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div
              className={
                forced
                  ? "rounded-lg bg-amber-100 p-2 text-amber-700"
                  : "rounded-lg bg-muted p-2 text-muted-foreground"
              }
            >
              {forced ? <ShieldAlert className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-foreground">
                {forced ? "Sua senha precisa ser alterada" : "Alterar senha"}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {forced
                  ? "Por segurança, defina uma nova senha antes de continuar."
                  : "Defina uma nova senha para a sua conta."}
              </p>
            </div>
          </div>

          {error ? (
            <div
              data-testid="password-change-error"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {error}
            </div>
          ) : null}

          {success && !forced ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Senha alterada. As outras sessões conectadas foram encerradas.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-3" autoComplete="on">
            {forced ? null : (
              <PasswordField
                id="current-password"
                label="Senha atual"
                value={currentPassword}
                autoComplete="current-password"
                onChange={setCurrentPassword}
                disabled={saving}
                autoFocus
              />
            )}
            <PasswordField
              id="new-password"
              label="Nova senha"
              value={newPassword}
              autoComplete="new-password"
              onChange={setNewPassword}
              disabled={saving}
              autoFocus={forced}
            />
            <PasswordField
              id="confirm-password"
              label="Confirmar nova senha"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={setConfirmPassword}
              disabled={saving}
            />

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {describePasswordPolicy()}
            </p>

            {localError ? (
              <p className="text-[11px] font-medium text-amber-700">{localError}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              {forced ? null : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => navigate(-1)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  Voltar
                </button>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Alterar senha
              </button>
            </div>
          </form>
        </div>

        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Trocar a senha encerra as sessões abertas em outros dispositivos. A senha do
          IndusCost não expira por tempo — mínimo de {PASSWORD_MIN_LENGTH} caracteres.
        </p>
      </div>
    </div>
  );
};

export default PasswordChangePage;
