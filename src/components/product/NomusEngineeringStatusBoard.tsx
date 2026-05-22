/**
 * Painel agregador de status da Engenharia Nomus.
 *
 * Junta, sob demanda, as métricas dos endpoints já existentes:
 *  - Cockpit (engineering-operations-cockpit) → totais da fila;
 *  - Carga Mestre (master-data-import/diagnostic) → faltantes/ambíguos;
 *  - Igualar Bases (master-data-equalize/preview) → previsão;
 *  - Runs recentes (engineering-runs/recent) → último Igualar, último Apply BOM.
 *
 * Read-only. Não força nada. O usuário clica para gerar e o painel mostra.
 */
import React, { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  Loader2,
  PackagePlus,
  RefreshCw,
  Scale,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchMasterDataImportDiagnostic } from "@/src/lib/nomusMasterDataImportClient";
import { fetchMasterDataEqualizePreview } from "@/src/lib/nomusMasterDataEqualizeClient";
import {
  fetchEngineeringRunsRecent,
  type EngineeringRunRecentItem,
} from "@/src/lib/nomusEngineeringRunsRecentClient";
import { fetchJsonOk } from "@/src/lib/http";
import type { CockpitResult } from "@/src/lib/nomusEngineeringOperationsCockpitTypes";
import type { MasterDataImportDiagnosticResult } from "@/src/lib/nomusMasterDataImportTypes";
import type { EqualizePreviewResult } from "@/src/lib/nomusMasterDataEqualizeTypes";

type StatusSnapshot = {
  cockpit: CockpitResult | null;
  masterData: MasterDataImportDiagnosticResult | null;
  equalize: EqualizePreviewResult | null;
  runs: EngineeringRunRecentItem[];
  generatedAt: string;
};

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function pickLastByOrigin(
  runs: EngineeringRunRecentItem[],
  origin: EngineeringRunRecentItem["origin"]
): EngineeringRunRecentItem | null {
  return runs.find((r) => r.origin === origin) ?? null;
}

export const NomusEngineeringStatusBoard: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cockpit, masterData, equalize, runs] = await Promise.all([
        fetchJsonOk<CockpitResult>(
          "/api/nomus/engineering-operations-cockpit?scope=ALL&limit=1&offset=0"
        ).catch(() => null),
        fetchMasterDataImportDiagnostic({ limit: 1, includeExisting: true }).catch(() => null),
        fetchMasterDataEqualizePreview({ limit: 1, scope: "ACTIONABLE" }).catch(() => null),
        fetchEngineeringRunsRecent(20).catch(() => ({
          mode: "READ_ONLY" as const,
          generatedAt: new Date().toISOString(),
          items: [],
        })),
      ]);
      setSnapshot({
        cockpit,
        masterData,
        equalize,
        runs: runs?.items ?? [],
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Tente novamente em alguns segundos.`
          : "Erro ao carregar visão geral da engenharia."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const cockpit = snapshot?.cockpit ?? null;
  const md = snapshot?.masterData ?? null;
  const eq = snapshot?.equalize ?? null;
  const lastEqualize = snapshot ? pickLastByOrigin(snapshot.runs, "MASTER_DATA_EQUALIZE") : null;
  const lastBomApply = snapshot
    ? pickLastByOrigin(snapshot.runs, "BOM_APPLY_AFTER_MASTER_DATA")
    : null;
  const lastBackfill = snapshot
    ? pickLastByOrigin(snapshot.runs, "MASTER_DATA_HISTORY_BACKFILL")
    : null;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">
            Central de Engenharia Nomus — Resumo
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Painel consolidado read-only. Mostra produtos prontos, faltantes, base com divergência
            e últimas execuções. Nada é alterado por esta tela — siga para Carga Mestre, Igualar
            bases ou abra o produto para Aplicar BOM.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void loadAll()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Atualizar painel da engenharia
        </button>
        {snapshot ? (
          <span className="text-[10px] text-muted-foreground">
            Atualizado em {formatDateShort(snapshot.generatedAt)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {snapshot ? (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCard
            icon={<Database className="h-3.5 w-3.5" />}
            tone="neutral"
            label="Produtos Nomus (stage)"
            value={cockpit?.totalParentsInStage ?? "—"}
            hint="Total de pais distintos no stage."
          />
          <SummaryCard
            icon={<PackagePlus className="h-3.5 w-3.5" />}
            tone="warn"
            label="Cadastro mestre faltante"
            value={md?.totals.missingTotal ?? "—"}
            hint="Códigos sem Product/Material. Use Carga Mestre."
          />
          <SummaryCard
            icon={<Scale className="h-3.5 w-3.5" />}
            tone="info"
            label="Bases com divergência"
            value={
              eq
                ? eq.totals.updateProducts +
                  eq.totals.updateMaterials +
                  eq.totals.deactivateProducts +
                  eq.totals.deactivateMaterials
                : "—"
            }
            hint="Items controlados pelo Nomus para atualizar/inativar."
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            tone="success"
            label="Prontos para aplicar BOM"
            value={cockpit?.totals.ready ?? "—"}
            hint="Sem bloqueios — preview e aplicação produto a produto."
          />
          <SummaryCard
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            tone="warn"
            label="Precisam revisão"
            value={cockpit?.totals.needsReview ?? "—"}
            hint="Diferenças exigem decisão humana."
          />
          <SummaryCard
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
            tone="danger"
            label="Bloqueados"
            value={cockpit?.totals.blocked ?? "—"}
            hint="Pendências impedem aplicação."
          />
          <SummaryCard
            icon={<Wrench className="h-3.5 w-3.5" />}
            tone="neutral"
            label="Sem ação necessária"
            value={cockpit?.totals.noChanges ?? "—"}
            hint="Produtos já alinhados com o Nomus."
          />
          <SummaryCard
            icon={<History className="h-3.5 w-3.5" />}
            tone="info"
            label="Itens com histórico Nomus"
            value={
              md
                ? md.totals.existingProducts + md.totals.existingMaterials
                : "—"
            }
            hint="Já cadastrados como Nomus no IndusCost."
          />
        </div>
      ) : null}

      {snapshot ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <LastRunCard
            title="Última Igualar bases"
            run={lastEqualize}
            emptyText="Ainda não há registro de Igualar bases."
            tone="info"
          />
          <LastRunCard
            title="Última aplicação de BOM"
            run={lastBomApply}
            emptyText="Ainda não há registro de Aplicar BOM Nomus por produto."
            tone="success"
          />
          <LastRunCard
            title="Último backfill de histórico"
            run={lastBackfill}
            emptyText="Ainda não há registro de backfill."
            tone="neutral"
          />
        </div>
      ) : null}

      {!snapshot && !loading && !error ? (
        <p className="text-[11px] text-muted-foreground italic">
          Clique em <strong>Atualizar painel da engenharia</strong> para consolidar os números das
          telas técnicas (Central, Carga Mestre, Igualar bases e runs recentes).
        </p>
      ) : null}
    </div>
  );
};

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  tone: "neutral" | "info" | "warn" | "danger" | "success";
  label: string;
  value: number | string;
  hint: string;
}> = ({ icon, tone, label, value, hint }) => {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-900"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : tone === "info"
          ? "border-sky-300 bg-sky-50 text-sky-900"
          : tone === "success"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
            : "border-border bg-card text-foreground";
  return (
    <div className={cn("rounded-xl border p-2.5", toneClass)}>
      <p className="text-[10px] uppercase font-semibold opacity-80 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{hint}</p>
    </div>
  );
};

const LastRunCard: React.FC<{
  title: string;
  run: EngineeringRunRecentItem | null;
  emptyText: string;
  tone: "info" | "success" | "neutral";
}> = ({ title, run, emptyText, tone }) => {
  const toneClass =
    tone === "info"
      ? "border-sky-200 bg-sky-50"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50"
        : "border-border bg-card";
  return (
    <div className={cn("rounded-xl border p-2.5 text-xs space-y-0.5", toneClass)}>
      <p className="text-[10px] uppercase font-bold text-muted-foreground">{title}</p>
      {run ? (
        <>
          <p className="font-semibold">{run.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatDateShort(run.finishedAt ?? run.createdAt)} · status{" "}
            <code className="font-mono">{run.status}</code>
          </p>
          {run.approvedBy ? (
            <p className="text-[10px] text-muted-foreground">por {run.approvedBy}</p>
          ) : null}
          {run.planHash ? (
            <p className="text-[10px] text-muted-foreground">
              planHash <code className="font-mono">{run.planHash.slice(0, 12)}…</code>
            </p>
          ) : null}
        </>
      ) : (
        <p className="italic text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
};
