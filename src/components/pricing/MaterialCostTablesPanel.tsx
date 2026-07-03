import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Package, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatMaterialCostVersionStatusLabel,
  MATERIAL_COST_IMMUTABLE_NOTICE,
  isMaterialCostVersionReadOnly,
} from "@/src/lib/materialCostTablesUi";

export type MaterialCostVersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: string;
  status: string;
  revision: number;
  publishedAt: string | null;
  itemsCount: number;
  summaryJson?: {
    materialsEvaluated?: number;
    materialsWithValidCost?: number;
    itemsCreated?: number;
    itemsSkipped?: number;
    errors?: Array<{ code?: string; materialCode?: string; message?: string }>;
    warnings?: Array<{ message?: string }>;
  } | null;
};

type MaterialCostTablesPanelProps = {
  canManage?: boolean;
  canPublish?: boolean;
};

function statusBadgeClass(status: string): string {
  switch (String(status).toUpperCase()) {
    case "DRAFT":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "PUBLISHED":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "SUPERSEDED":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function MaterialCostTablesPanel({
  canManage = false,
  canPublish = false,
}: MaterialCostTablesPanelProps) {
  const [versions, setVersions] = useState<MaterialCostVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [lastGenMessage, setLastGenMessage] = useState<string | null>(null);
  const [lastGenErrors, setLastGenErrors] = useState<
    Array<{ code?: string; materialCode?: string; message?: string }>
  >([]);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchJsonOk<MaterialCostVersionRow[]>(
        "/api/material-cost-tables/versions?limit=20"
      );
      setVersions(Array.isArray(rows) ? rows : []);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleGenerate = async () => {
    if (!effectiveDate.trim()) {
      alert("Informe a vigência desejada.");
      return;
    }
    setGenerating(true);
    setLastGenMessage(null);
    setLastGenErrors([]);
    try {
      const payload = await fetchJsonOk<{
        version?: { id?: string; code?: string; revision?: number; itemsCount?: number };
        summary?: MaterialCostVersionRow["summaryJson"];
      }>("/api/material-cost-tables/versions/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveDate,
          includeAllActiveMaterials: true,
          notes: notes.trim() || undefined,
        }),
      });
      const v = payload.version;
      const summary = payload.summary ?? {};
      const errors = Array.isArray(summary?.errors) ? summary.errors : [];
      setLastGenErrors(errors);
      setLastGenMessage(
        v?.id
          ? `DRAFT ${v.code ?? ""} rev. ${v.revision ?? 1} — ${v.itemsCount ?? 0} item(ns) criado(s).` +
              (errors.length > 0 ? ` ${errors.length} pendência(s) (sem custo).` : "")
          : "DRAFT gerado."
      );
      await loadVersions();
    } catch (error) {
      setLastGenMessage(error instanceof Error ? error.message : "Falha ao gerar DRAFT.");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async (versionId: string) => {
    if (!canPublish) return;
    if (!window.confirm("Publicar esta versão de custo de matéria-prima? Versões publicadas são imutáveis.")) {
      return;
    }
    setPublishingId(versionId);
    try {
      await fetchJsonOk(`/api/material-cost-table-versions/${versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await loadVersions();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Falha ao publicar.");
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        {MATERIAL_COST_IMMUTABLE_NOTICE} O motor de produção ainda usa{" "}
        <span className="font-semibold">Material.currentCost</span> vivo — esta camada prepara o custo oficial
        congelado por vigência.
      </div>

      {canManage ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="space-y-1.5 lg:col-span-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Vigência</label>
            <input
              type="date"
              className="w-full p-2.5 rounded-xl border border-border bg-background text-sm outline-none"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={generating}
            />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Observações</label>
            <input
              type="text"
              className="w-full p-2.5 rounded-xl border border-border bg-background text-sm outline-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
              disabled={generating}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            Gerar DRAFT (materiais ativos)
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void loadVersions()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {lastGenMessage ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{lastGenMessage}</div>
      ) : null}

      {lastGenErrors.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
          <p className="text-xs font-bold text-amber-900 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Pendências (sem custo — não incluídas no DRAFT)
          </p>
          <ul className="text-xs text-amber-900 max-h-32 overflow-y-auto space-y-0.5">
            {lastGenErrors.slice(0, 20).map((err, idx) => (
              <li key={`${err.materialCode}-${idx}`}>
                {err.materialCode ?? "—"}: {err.message ?? err.code ?? "SEM_CUSTO"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-bold uppercase text-muted-foreground">
          Versões de custo de matéria-prima
        </div>
        {loading && versions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Carregando…
          </div>
        ) : versions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma versão cadastrada.</div>
        ) : (
          <div className="divide-y divide-border">
            {versions.map((v) => {
              const pending =
                v.status === "DRAFT" && v.summaryJson?.errors && v.summaryJson.errors.length > 0
                  ? v.summaryJson.errors.length
                  : v.summaryJson?.itemsSkipped ?? 0;
              return (
                <div key={v.id} className="px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm truncate">{v.name}</span>
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                          statusBadgeClass(v.status)
                        )}
                      >
                        {formatMaterialCostVersionStatusLabel(v.status)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {v.code} · rev. {v.revision} · {v.itemsCount} item(ns)
                      {pending > 0 ? ` · ${pending} pendência(s) na geração` : ""}
                    </p>
                  </div>
                  {canPublish && v.status === "DRAFT" && v.itemsCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handlePublish(v.id)}
                      disabled={publishingId === v.id || isMaterialCostVersionReadOnly(v.status)}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {publishingId === v.id ? "Publicando…" : "Publicar"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Consulta de custo vigente: GET{" "}
        <code className="text-[10px]">/api/material-cost-tables/effective-cost?materialId=…&date=…</code>
      </p>
    </div>
  );
}
