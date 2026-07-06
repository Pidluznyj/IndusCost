/**
 * Aba "Histórico" do cadastro do Produto.
 *
 * Lê de GET /api/products/:id/change-history.
 * Mostra timeline read-only de alterações em linguagem humana.
 */
import React, { useEffect, useState } from "react";
import {
  CircleCheck,
  Clock,
  Database,
  Loader2,
  PackagePlus,
  Pencil,
  ShieldAlert,
  ShieldOff,
  UserCog,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchProductChangeHistory } from "@/src/lib/productChangeHistoryClient";
import type {
  ProductChangeActionLabel,
  ProductChangeHistoryEntry,
  ProductChangeHistoryResult,
} from "@/src/lib/productChangeHistoryTypes";
import {
  productChangeActionLabel,
  summarizeFieldName,
} from "@/src/lib/nomusMasterDataEqualizeShared";

function ActionIcon({ action }: { action: ProductChangeActionLabel }) {
  switch (action) {
    case "CREATED":
    case "IMPORTED":
      return <PackagePlus className="h-3.5 w-3.5" />;
    case "EQUALIZED":
      return <Database className="h-3.5 w-3.5" />;
    case "UPDATED":
      return <Pencil className="h-3.5 w-3.5" />;
    case "DEACTIVATED":
      return <ShieldOff className="h-3.5 w-3.5" />;
    case "REACTIVATED":
      return <CircleCheck className="h-3.5 w-3.5" />;
    case "SKIPPED":
      return <Clock className="h-3.5 w-3.5" />;
    case "BLOCKED":
      return <ShieldAlert className="h-3.5 w-3.5" />;
    default:
      return <UserCog className="h-3.5 w-3.5" />;
  }
}

function toneClasses(action: ProductChangeActionLabel): string {
  switch (action) {
    case "CREATED":
    case "IMPORTED":
      return "bg-sky-50 text-sky-900 border-sky-200";
    case "EQUALIZED":
      return "bg-violet-50 text-violet-900 border-violet-200";
    case "UPDATED":
      return "bg-emerald-50 text-emerald-900 border-emerald-200";
    case "DEACTIVATED":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "REACTIVATED":
      return "bg-emerald-50 text-emerald-900 border-emerald-200";
    case "BLOCKED":
      return "bg-red-50 text-red-900 border-red-200";
    case "SKIPPED":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-card text-foreground border-border";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function shortValue(value: string | null): string {
  if (value == null) return "—";
  if (value.length > 120) return value.slice(0, 117) + "...";
  return value;
}

const ProductHistoryEntryItem: React.FC<{ entry: ProductChangeHistoryEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const tone = toneClasses(entry.actionLabel);
  return (
    <li className={cn("rounded-lg border p-3", tone)}>
      <div className="flex items-start gap-2">
        <div className="rounded-full bg-white/70 p-1.5 border border-current/20">
          <ActionIcon action={entry.actionLabel} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[11px] uppercase font-bold">
            <span>{productChangeActionLabel(entry.actionLabel)}</span>
            <span className="text-[10px] opacity-80">·</span>
            <span className="text-[10px] opacity-80">{formatDate(entry.changedAt)}</span>
            <span className="text-[10px] opacity-80">·</span>
            <span className="text-[10px] opacity-80">
              Origem:{" "}
              {entry.sourceSystem === "NOMUS"
                ? "Nomus"
                : entry.changedBy
                  ? entry.changedBy
                  : "Sistema"}
            </span>
          </div>
          {entry.summary ? (
            <p className="text-xs mt-1">{entry.summary}</p>
          ) : (
            <p className="text-xs mt-1 italic opacity-80">Sem resumo registrado.</p>
          )}
          {entry.fieldName && entry.fieldName !== "@created" && entry.fieldName !== "@deactivated" && entry.fieldName !== "@reactivated" ? (
            <p className="text-[11px] mt-1">
              <strong>{summarizeFieldName(entry.fieldName)}</strong>:{" "}
              <span className="opacity-80">{shortValue(entry.oldValue)}</span>
              {" → "}
              <strong>{shortValue(entry.newValue)}</strong>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-[10px] mt-1 underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            {expanded ? "Esconder detalhes" : "Ver detalhes"}
          </button>
          {expanded ? (
            <div className="text-[10px] mt-1.5 opacity-80 space-y-0.5 font-mono">
              {entry.runId ? <div>runId: {entry.runId}</div> : null}
              {entry.planHash ? <div>planHash: {entry.planHash}</div> : null}
              {entry.fieldName ? <div>fieldName: {entry.fieldName}</div> : null}
              {entry.entityType ? <div>entityType: {entry.entityType}</div> : null}
              {entry.entityId ? <div>entityId: {entry.entityId}</div> : null}
              {entry.changeOrigin ? <div>changeOrigin: {entry.changeOrigin}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export const ProductHistoryTab: React.FC<{ productId: string | null | undefined }> = ({
  productId,
}) => {
  const [data, setData] = useState<ProductChangeHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProductChangeHistory(productId, { signal: controller.signal, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return;
        setError(
          e instanceof Error
            ? `${e.message} Tente recarregar a aba.`
            : "Erro ao carregar histórico do produto."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [productId]);

  if (!productId) {
    return (
      <p className="text-sm text-muted-foreground">
        Salve o produto antes para consultar o histórico de alterações.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[11px] uppercase font-bold text-muted-foreground">
          Histórico de alterações
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Registro automático e somente leitura das alterações deste produto, incluindo importações
          e equalizações Nomus.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando histórico…
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900">
          {error}
        </div>
      ) : null}

      {!loading && !error && data ? (
        data.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Nenhum histórico registrado para este produto ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.entries.map((entry) => (
              <ProductHistoryEntryItem key={entry.id} entry={entry} />
            ))}
          </ul>
        )
      ) : null}

      {data && data.hasMore ? (
        <p className="text-[10px] text-muted-foreground italic">
          Mostrando os {data.entries.length} registros mais recentes (de {data.totalCount}). Use a
          API para paginar os antigos.
        </p>
      ) : null}
    </div>
  );
};
