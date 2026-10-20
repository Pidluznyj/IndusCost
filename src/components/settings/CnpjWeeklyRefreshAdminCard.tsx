import React, { useCallback, useEffect, useState } from "react";
import type { CnpjRefreshMonitor } from "@/src/lib/cnpjWeeklyRefresh/monitor";

export function CnpjWeeklyRefreshAdminCard(props: {
  monitor: CnpjRefreshMonitor | null;
  changes: Array<{ id: string; field: string; previousValue: string | null; nextValue: string | null }>;
  canManage: boolean;
  error: string | null;
  onRun?: () => void;
  onRetry?: () => void;
}) {
  const last = props.monitor?.lastRun;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" data-testid="cnpj-weekly-refresh-admin">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Consulta semanal de CNPJ</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Domingo às 08:00, horário de Brasília. Atualiza a inteligência cadastral de clientes e fornecedores.
            Não altera o cadastro do Nomus e não libera crédito.
          </p>
        </div>
        {props.canManage ? (
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-medium" onClick={props.onRun}>
              Executar agora
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-medium" onClick={props.onRetry}>
              Reprocessar falhas
            </button>
          </div>
        ) : null}
      </div>
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Agendamento</dt>
          <dd>{props.monitor?.schedulerEnabled ? "Ativo" : "Desligado"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Próxima execução</dt>
          <dd>{props.monitor ? new Date(props.monitor.nextAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última situação</dt>
          <dd data-testid="cnpj-weekly-refresh-status">{last?.status ?? "Nenhuma"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Concluído</dt>
          <dd>{last ? `${last.percent}%` : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Clientes</dt>
          <dd>{last?.customerCount ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fornecedores</dt>
          <dd>{last?.supplierCount ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Falhas</dt>
          <dd>{last?.failedCount ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Parciais</dt>
          <dd>{last?.partialCount ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sem documento</dt>
          <dd>{last?.missingDocumentCount ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Alterações</dt>
          <dd>{props.changes.length}</dd>
        </div>
      </dl>
      {props.changes.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {props.changes.map((change) => (
            <li key={change.id}>
              {change.field}: {change.previousValue ?? "—"} → {change.nextValue ?? "—"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma alteração cadastral relevante nesta execução.</p>
      )}
    </section>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function CnpjWeeklyRefreshAdminPanel({ canView, canManage }: { canView: boolean; canManage: boolean }) {
  const [monitor, setMonitor] = useState<CnpjRefreshMonitor | null>(null);
  const [changes, setChanges] = useState<Array<{ id: string; field: string; previousValue: string | null; nextValue: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const status = await fetchJson<CnpjRefreshMonitor>("/api/admin/cnpj-weekly-refresh/status");
      setMonitor(status);
      if (status.lastRun) {
        const history = await fetchJson<{ changes: typeof changes }>("/api/admin/cnpj-weekly-refresh/runs/" + status.lastRun.id + "/changes");
        setChanges(history.changes);
      }
      setError(null);
    } catch {
      setError("Não foi possível carregar a consulta semanal de CNPJ.");
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return null;

  return (
    <CnpjWeeklyRefreshAdminCard
      monitor={monitor}
      changes={changes}
      canManage={canManage}
      error={error}
      onRun={
        canManage
          ? () => {
              void fetchJson("/api/admin/cnpj-weekly-refresh/run", { method: "POST" }).then(() => load()).catch(() => setError("A execução não foi iniciada."));
            }
          : undefined
      }
      onRetry={
        canManage && monitor?.lastRun
          ? () => {
              void fetchJson("/api/admin/cnpj-weekly-refresh/runs/" + monitor.lastRun!.id + "/retry-failures", { method: "POST" })
                .then(() => load())
                .catch(() => setError("As falhas não foram reprocessadas."));
            }
          : undefined
      }
    />
  );
}
