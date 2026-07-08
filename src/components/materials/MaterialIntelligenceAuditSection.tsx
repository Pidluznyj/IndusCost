import React, { useCallback, useEffect, useState } from "react";
import { FileSearch, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketAuditApiItem } from "@/src/lib/materialMarketAudit";
import { getMaterialMarketIntelligenceAuditApiPath } from "@/src/lib/materialsNavigation";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { cn } from "@/src/lib/utils";

type Props = {
  materialId: string;
};

function formatAuditDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function AuditEventRow({ event }: { event: MaterialMarketAuditApiItem }) {
  return (
    <li
      className="rounded-lg border border-border bg-muted/10 px-4 py-3 space-y-2"
      data-testid={`material-market-audit-event-${event.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{event.eventTypeLabel}</p>
          <p className="text-xs text-muted-foreground">{event.entityTypeLabel}</p>
        </div>
        <time className="text-xs text-muted-foreground whitespace-nowrap">
          {formatAuditDateTime(event.occurredAt)}
        </time>
      </div>

      <div className="grid gap-1 text-sm">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Usuário:</span>{" "}
          {event.userName ?? event.userId ?? "Sistema"}
        </p>
        {event.details ? (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Detalhes:</span> {event.details}
          </p>
        ) : null}
        {event.reason ? (
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              "border-amber-200 bg-amber-50 text-amber-950"
            )}
            data-testid="material-market-audit-reason"
          >
            <span className="font-medium">Motivo:</span> {event.reason}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function MaterialIntelligenceAuditSection({ materialId }: Props) {
  const [items, setItems] = useState<MaterialMarketAuditApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ items: MaterialMarketAuditApiItem[] }>(
        getMaterialMarketIntelligenceAuditApiPath(materialId, { limit: 50 })
      );
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a auditoria.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MaterialIntelligence360Section
      id="audit"
      title="Auditoria"
      description="Registro de alterações de cotações, aprovações e configurações."
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico de auditoria…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-audit-empty"
        >
          <FileSearch className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda</p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="material-intelligence-audit-timeline">
          {items.map((event) => (
            <AuditEventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </MaterialIntelligence360Section>
  );
}
