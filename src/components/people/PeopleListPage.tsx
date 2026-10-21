import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PersonFormDialog } from "@/src/components/people/PersonMasterDialogs";
import { useAuth } from "@/src/contexts/AuthContext";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, Contact, FileText, KeyRound, Loader2, Search, Truck, UserRound, Wallet } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  fetchPeople,
  LINK_STATE_LABEL,
  PERSON_FLAG_LABEL,
  PERSON_STATUS_LABEL,
  type PeopleListResponse,
  type PersonLinkState,
} from "@/src/lib/people/peopleClient";

const PAGE_SIZE = 25;

function stateTone(state: PersonLinkState): string {
  switch (state) {
    case "LINKED":
      return "text-emerald-700";
    case "INACTIVE":
      return "text-muted-foreground";
    case "PENDING_REVIEW":
      return "text-amber-700";
    case "CONFLICT":
      return "text-red-700";
    default:
      return "text-muted-foreground/50";
  }
}

export function LinkIndicator({ state, icon: Icon, label }: { state: PersonLinkState; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", stateTone(state))}
      title={`${label}: ${LINK_STATE_LABEL[state]}`}
      aria-label={`${label}: ${LINK_STATE_LABEL[state]}`}
      data-testid={`people-link-${label.toLowerCase()}-${state.toLowerCase()}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {state === "CONFLICT" ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
    </span>
  );
}

export function PeopleListPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const canCreate = auth.authUser?.role === "SUPER_ADMIN" || auth.authUser?.role === "ADMIN" || auth.hasAnyPermission(["employees.edit"]);
  const [creating, setCreating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "ACTIVE";
  const has = searchParams.get("has") ?? "";
  const missing = searchParams.get("missing") ?? "";
  const pending = searchParams.get("pending") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const [draftQ, setDraftQ] = useState(q);
  const [data, setData] = useState<PeopleListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraftQ(q), [q]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchPeople({ q, page, limit: PAGE_SIZE, status, has, missing, pending })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Não foi possível carregar as pessoas.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [q, page, status, has, missing, pending]);

  const summary = useMemo(() => {
    if (!data) return null;
    const from = (data.meta.page - 1) * data.meta.limit + 1;
    const to = Math.min(data.meta.total, data.meta.page * data.meta.limit);
    return data.meta.total === 0 ? "Nenhuma pessoa" : `${from}–${to} de ${data.meta.total}`;
  }, [data]);

  return (
    <div className="space-y-4" data-testid="people-list-page">
      <form
        className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draftQ.trim() || null });
        }}
      >
        <label className="flex-1 min-w-[240px] space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Buscar</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="Nome, nome social, e-mail, identificador ou CPF (se autorizado)"
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm"
              data-testid="people-search-input"
            />
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Situação</span>
          <select value={status} onChange={(e) => update({ status: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm" data-testid="people-filter-status">
            <option value="ACTIVE">Ativas</option>
            <option value="INACTIVE">Inativas</option>
            <option value="NEEDS_REVIEW">Em revisão</option>
            <option value="MERGED">Unificadas</option>
            <option value="ALL">Todas</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tem vínculo</span>
          <select value={has} onChange={(e) => update({ has: e.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm" data-testid="people-filter-has">
            <option value="">Qualquer</option>
            <option value="employee">Funcionário</option>
            <option value="app_user">Usuário</option>
            <option value="fleet_driver">Motorista</option>
            <option value="commission_person">Comissionável</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sem vínculo</span>
          <select value={missing} onChange={(e) => update({ missing: e.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm" data-testid="people-filter-missing">
            <option value="">—</option>
            <option value="employee">Funcionário</option>
            <option value="app_user">Usuário</option>
            <option value="fleet_driver">Motorista</option>
            <option value="commission_person">Comissionável</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pendências</span>
          <select value={pending} onChange={(e) => update({ pending: e.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm" data-testid="people-filter-pending">
            <option value="">Todas as pessoas</option>
            <option value="mismatch">Conta × colaborador divergentes</option>
            <option value="duplicate">CPF repetido (duplicidade)</option>
            <option value="orphan">Sem nenhum vínculo</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" data-testid="people-search-submit">
          Buscar
        </button>
        {canCreate ? (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg border border-primary px-3 py-2 text-sm font-semibold text-primary" data-testid="people-new-person">
            Nova pessoa
          </button>
        ) : null}
      </form>
      {creating ? <PersonFormDialog personId={null} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); navigate(`/people/${id}`); }} /> : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground border-b border-border">
          <span>{loading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : summary}</span>
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> Funcionário</span>
            <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> Usuário</span>
            <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Motorista</span>
            <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> Comissionável</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm" data-testid="people-table">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Pessoa</th>
                <th className="px-3 py-2">Identificador</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2">Vínculos</th>
                <th className="px-3 py-2 text-right">Docs</th>
                <th className="px-3 py-2">Atualizada</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhuma pessoa encontrada com estes filtros.
                  </td>
                </tr>
              ) : null}
              {data?.items.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-muted/30" data-testid={`people-row-${row.shortId}`}>
                  <td className="px-3 py-2">
                    <Link to={`/people/${row.id}`} className="font-medium text-foreground hover:underline" data-testid={`people-open-${row.shortId}`}>
                      {row.displayName}
                    </Link>
                    {row.socialName && row.socialName !== row.civilName ? (
                      <p className="text-xs text-muted-foreground">civil: {row.civilName}</p>
                    ) : null}
                    {row.flags.filter((f) => f !== "NO_LINKS").length > 0 ? (
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {row.flags
                          .filter((f) => f !== "NO_LINKS")
                          .map((f) => (
                            <span key={f} className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", f === "USER_ON_OTHER_PERSON" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                              {PERSON_FLAG_LABEL[f] ?? f}
                            </span>
                          ))}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.shortId}…</td>
                  <td className="px-3 py-2 text-xs">{PERSON_STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <LinkIndicator state={row.links.employee} icon={UserRound} label="Funcionário" />
                      <LinkIndicator state={row.links.appUser} icon={KeyRound} label="Usuário" />
                      <LinkIndicator state={row.links.fleetDriver} icon={Truck} label="Motorista" />
                      <LinkIndicator state={row.links.commissionPerson} icon={Wallet} label="Comissionável" />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-3.5 w-3.5" />{row.documentsCount}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(row.updatedAt).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.meta.totalPages > 1 ? (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
            <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40" data-testid="people-page-prev">
              Anterior
            </button>
            <span className="text-muted-foreground">Página {data.meta.page} de {data.meta.totalPages}</span>
            <button type="button" disabled={page >= data.meta.totalPages} onClick={() => update({ page: String(page + 1) })} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40" data-testid="people-page-next">
              Próxima
            </button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Contact className="h-3.5 w-3.5" /> A ficha mostra os vínculos e leva ao cadastro de origem com a permissão daquele módulo. Dados sensíveis só com a permissão de dados pessoais.
      </p>
    </div>
  );
}
