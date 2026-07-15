import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Shield, Unlink, UserCheck, ExternalLink } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  accessStateBadgeClass,
  type EmployeeUserAccessState,
} from "@/src/lib/employeeUserLink";

export type EmployeeUserLinkDto = {
  employeeId: string;
  corporateEmail: string | null;
  status: EmployeeUserAccessState;
  message: string;
  canLink: boolean;
  canUnlink: boolean;
  appUser: {
    id: string;
    email: string;
    isActive: boolean;
    role: string;
    name: string;
  } | null;
  matchedUser: {
    id: string;
    email: string;
    isActive: boolean;
    employeeId: string | null;
  } | null;
  emailMismatch: boolean;
};

type Props = {
  employeeId: string;
  canManageLink: boolean;
  canOpenUsersAdmin: boolean;
  onLinked?: (appUser: EmployeeUserLinkDto["appUser"]) => void;
  onUnlinked?: () => void;
};

export function EmployeeSystemAccessCard({
  employeeId,
  canManageLink,
  canOpenUsersAdmin,
  onLinked,
  onUnlinked,
}: Props) {
  const [data, setData] = useState<EmployeeUserLinkDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<EmployeeUserLinkDto>(
        `/api/employees/${employeeId}/user-link-status`
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o status de acesso.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLink = async () => {
    if (!data?.canLink || actionBusy) return;
    const email = data.matchedUser?.email || data.corporateEmail || "";
    if (
      !window.confirm(
        `Vincular o usuário de login “${email}” a este colaborador?\n\nNão cria senha nova nem altera o e-mail de login.`
      )
    ) {
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{
        ok: boolean;
        appUser: EmployeeUserLinkDto["appUser"];
      }>(`/api/employees/${employeeId}/link-user`, { method: "POST" });
      onLinked?.(result.appUser);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao vincular.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnlink = async () => {
    if (!data?.canUnlink || actionBusy) return;
    if (
      !window.confirm(
        "Remover o vínculo com o usuário de acesso?\n\nO login NÃO será desativado e o e-mail de login não muda. Apenas a ligação com este colaborador é removida."
      )
    ) {
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/employees/${employeeId}/unlink-user`, { method: "POST" });
      onUnlinked?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desvincular.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold">Acesso ao sistema</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Vínculo explícito com usuário de login. Não cria conta nesta tela.
            </p>
          </div>
        </div>
        {data && (
          <span
            className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${accessStateBadgeClass(data.status)}`}
          >
            {data.message}
          </span>
        )}
      </div>

      {busy && !data && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Consultando vínculo…
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          {error}
        </p>
      )}

      {data && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            E-mail corporativo:{" "}
            <span className="text-foreground font-medium">
              {data.corporateEmail || "— (defina na aba Profissional)"}
            </span>
          </p>

          {data.appUser && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
              <p className="font-medium">{data.appUser.name}</p>
              <p className="text-xs text-muted-foreground">
                Login: {data.appUser.email}
                {!data.appUser.isActive ? " · inativo" : ""}
              </p>
              <p className="text-xs text-muted-foreground">Papel: {data.appUser.role}</p>
              {data.emailMismatch && (
                <p className="text-xs text-amber-900">
                  O e-mail corporativo do colaborador difere do login. O login não foi alterado
                  automaticamente.
                </p>
              )}
            </div>
          )}

          {!data.appUser && data.matchedUser && data.status === "available_match" && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-950">
              Usuário encontrado com o mesmo e-mail ({data.matchedUser.email}
              {!data.matchedUser.isActive ? ", inativo" : ""}). Confirme o vínculo abaixo.
            </div>
          )}

          {!data.appUser && data.status === "conflict" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950">
              Existe usuário com este e-mail já vinculado a outro colaborador. Resolva em
              Configurações → Usuários.
            </div>
          )}

          {!data.appUser && data.status === "none" && (
            <p className="text-xs text-muted-foreground">
              Nenhum usuário com este e-mail. Crie o acesso em Configurações → Usuários (fluxo
              administrativo explícito) e depois vincule aqui.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {canManageLink && data.canLink && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleLink()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60"
              >
                {actionBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserCheck className="h-3.5 w-3.5" />
                )}
                Vincular usuário existente
              </button>
            )}
            {canManageLink && data.canUnlink && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleUnlink()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                {actionBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlink className="h-3.5 w-3.5" />
                )}
                Remover vínculo
              </button>
            )}
            {canOpenUsersAdmin && (
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {data.appUser ? "Abrir Usuários" : "Criar acesso em Usuários"}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
