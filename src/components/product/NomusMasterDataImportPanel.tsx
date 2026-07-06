/**
 * Carga Mestre Nomus — painel operacional (read-only para diagnóstico/preview;
 * apply exige confirmação textual explícita).
 *
 * Fase: NOMUS-MASTER-DATA-IMPORT-A.
 * - Diagnóstico via GET /api/nomus/master-data-import/diagnostic
 * - Apply via POST /api/nomus/master-data-import/apply-safe (confirmação obrigatória)
 * - NÃO cria ProductBOM. NÃO altera preço, proposta, pedido.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleCheck,
  CircleHelp,
  Database,
  Loader2,
  PackagePlus,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  applyAmbiguityBatch,
  applyMasterDataImportSafe,
  fetchAmbiguityBatchPreview,
  fetchMasterDataImportDiagnostic,
  MASTER_DATA_CONFIRMATION_TEXT,
  type AmbiguityBatchPreviewResult,
} from "@/src/lib/nomusMasterDataImportClient";
import type {
  MasterDataClassification,
  MasterDataImportApplyResult,
  MasterDataImportDiagnosticResult,
  MasterDataRow,
} from "@/src/lib/nomusMasterDataImportTypes";
import {
  applyMasterDataEqualize,
  EQUALIZE_CONFIRMATION_TEXT,
  fetchMasterDataEqualizePreview,
} from "@/src/lib/nomusMasterDataEqualizeClient";
import type { EqualizePreviewResult } from "@/src/lib/nomusMasterDataEqualizeTypes";
import {
  buildEqualizeFailureViewModel,
  buildEqualizeModalViewModel,
} from "@/src/lib/nomusEqualizeUserMessages";
import type { EqualizeModalViewModel } from "@/src/lib/nomusEqualizeUserMessages";
import { NomusEqualizeResultModal } from "@/src/components/product/NomusEqualizeResultModal";
import { Scale } from "lucide-react";

type RowFilter =
  | "ALL_MISSING"
  | "SAFE_PRODUCT_CANDIDATE"
  | "SAFE_MATERIAL_CANDIDATE"
  | "AMBIGUOUS_REVIEW"
  | "ALL_BLOCKED"
  | "RESOLVED_ALL"
  | "EXISTING_ALL";

const FILTER_OPTIONS: Array<{ value: RowFilter; label: string }> = [
  { value: "ALL_MISSING", label: "Todos faltantes" },
  { value: "SAFE_PRODUCT_CANDIDATE", label: "Produtos seguros" },
  { value: "SAFE_MATERIAL_CANDIDATE", label: "Materiais seguros" },
  { value: "RESOLVED_ALL", label: "Ambíguos resolvidos" },
  { value: "AMBIGUOUS_REVIEW", label: "Precisa revisão" },
  { value: "ALL_BLOCKED", label: "Bloqueados / ambíguos reais" },
  { value: "EXISTING_ALL", label: "Já existentes (auditoria)" },
];

function classificationTone(cls: MasterDataClassification): string {
  switch (cls) {
    case "SAFE_PRODUCT_CANDIDATE":
      return "bg-sky-100 text-sky-900";
    case "SAFE_MATERIAL_CANDIDATE":
      return "bg-emerald-100 text-emerald-900";
    case "RESOLVED_AS_MATERIAL":
      return "bg-teal-100 text-teal-900";
    case "RESOLVED_AS_PRODUCT":
      return "bg-cyan-100 text-cyan-900";
    case "AMBIGUOUS_REVIEW":
    case "EXISTING_BOTH_AMBIGUOUS":
      return "bg-amber-100 text-amber-900";
    case "EXISTING_PRODUCT":
    case "EXISTING_MATERIAL":
    case "SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-red-100 text-red-900";
  }
}

export const NomusMasterDataImportPanel: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const [diagnostic, setDiagnostic] = useState<MasterDataImportDiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>("ALL_MISSING");
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<MasterDataImportApplyResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Igualar Bases
  const [equalizePreview, setEqualizePreview] = useState<EqualizePreviewResult | null>(null);
  const [equalizeLoading, setEqualizeLoading] = useState(false);
  const [equalizeApplying, setEqualizeApplying] = useState(false);
  const [equalizeResultModal, setEqualizeResultModal] = useState<EqualizeModalViewModel | null>(
    null
  );
  const [equalizeResultModalOpen, setEqualizeResultModalOpen] = useState(false);
  const [equalizeShowConfirm, setEqualizeShowConfirm] = useState(false);
  const [equalizeConfirmText, setEqualizeConfirmText] = useState("");

  const [ambiguityPreview, setAmbiguityPreview] =
    useState<AmbiguityBatchPreviewResult | null>(null);
  const [ambiguityLoading, setAmbiguityLoading] = useState(false);
  const [ambiguityApplying, setAmbiguityApplying] = useState(false);
  const [ambiguityShowConfirm, setAmbiguityShowConfirm] = useState(false);
  const [ambiguityConfirmText, setAmbiguityConfirmText] = useState("");
  const [ambiguityMessage, setAmbiguityMessage] = useState<string | null>(null);

  const filterParams = useMemo(() => {
    let classification: string | undefined;
    let includeExisting = false;
    if (filter === "EXISTING_ALL") {
      includeExisting = true;
    } else if (filter === "ALL_MISSING") {
      classification = "MISSING";
    } else if (filter === "ALL_BLOCKED") {
      classification = "ALL_BLOCKED";
    } else if (filter === "RESOLVED_ALL") {
      classification = "RESOLVED_ALL";
      includeExisting = true;
    } else {
      classification = filter;
    }
    return { classification, includeExisting };
  }, [filter]);

  const loadDiagnostic = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMasterDataImportDiagnostic({
          limit: 100,
          offset,
          search: search.trim() || undefined,
          classification: filterParams.classification,
          includeExisting: filterParams.includeExisting,
        });
        setDiagnostic((prev) => {
          if (offset === 0 || !prev) return data;
          const seen = new Set(prev.rows.map((r) => r.code));
          const appended = data.rows.filter((r) => !seen.has(r.code));
          return { ...data, rows: [...prev.rows, ...appended] };
        });
      } catch (e) {
        setDiagnostic(null);
        setError(
          e instanceof Error
            ? `${e.message} Tente novamente.`
            : "Erro ao gerar diagnóstico de Carga Mestre Nomus."
        );
      } finally {
        setLoading(false);
      }
    },
    [filterParams.classification, filterParams.includeExisting, search]
  );

  const reload = useCallback(() => {
    setApplyResult(null);
    void loadDiagnostic(0);
  }, [loadDiagnostic]);

  const loadEqualizePreview = useCallback(async () => {
    setEqualizeLoading(true);
    try {
      const data = await fetchMasterDataEqualizePreview({
        limit: 200,
        offset: 0,
        scope: "ACTIONABLE",
      });
      setEqualizePreview(data);
    } catch (e) {
      setEqualizePreview(null);
      setEqualizeResultModal(
        buildEqualizeFailureViewModel(
          e instanceof Error
            ? e.message
            : "Erro ao gerar preview de Igualar Bases."
        )
      );
      setEqualizeResultModalOpen(true);
    } finally {
      setEqualizeLoading(false);
    }
  }, []);

  const onApplyEqualize = useCallback(async () => {
    if (equalizeApplying) return;
    if (equalizeConfirmText !== EQUALIZE_CONFIRMATION_TEXT) return;
    setEqualizeApplying(true);
    setEqualizeResultModalOpen(true);
    setEqualizeResultModal(null);
    setEqualizeShowConfirm(false);
    const confirmSnapshot = equalizeConfirmText;
    setEqualizeConfirmText("");
    try {
      const result = await applyMasterDataEqualize({
        confirmationText: confirmSnapshot,
      });
      let previewTotals = equalizePreview?.totals ?? result.previewTotals ?? null;
      try {
        const refreshed = await fetchMasterDataEqualizePreview({
          limit: 200,
          offset: 0,
          scope: "ACTIONABLE",
        });
        setEqualizePreview(refreshed);
        previewTotals = refreshed.totals;
      } catch {
        // preview refresh opcional; mantém totais anteriores
      }
      await loadDiagnostic(0);
      setEqualizeResultModal(buildEqualizeModalViewModel(result, previewTotals));
    } catch (e) {
      const isNetwork =
        e instanceof TypeError ||
        (e instanceof Error && /Failed to fetch|NetworkError|ECONNREFUSED/i.test(e.message));
      const msg = isNetwork
        ? "O navegador não conseguiu se comunicar com o backend da aplicação."
        : e instanceof Error
          ? e.message
          : "Erro ao aplicar Igualar Bases.";
      setEqualizeResultModal(
        buildEqualizeFailureViewModel(msg, { isNetwork })
      );
    } finally {
      setEqualizeApplying(false);
    }
  }, [
    equalizeApplying,
    equalizeConfirmText,
    equalizePreview?.totals,
    loadDiagnostic,
  ]);

  const onApply = useCallback(async () => {
    if (confirmText !== MASTER_DATA_CONFIRMATION_TEXT) return;
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const result = await applyMasterDataImportSafe({ confirmationText: confirmText });
      setApplyResult(result);
      setShowConfirm(false);
      setConfirmText("");
      // recarrega diagnóstico para refletir o novo estado
      await loadDiagnostic(0);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Tente novamente ou rode o preview pelo terminal.`
          : "Erro ao aplicar Carga Mestre Nomus."
      );
    } finally {
      setApplying(false);
    }
  }, [confirmText, loadDiagnostic]);

  const loadAmbiguityPreview = useCallback(async () => {
    setAmbiguityLoading(true);
    setAmbiguityMessage(null);
    try {
      const data = await fetchAmbiguityBatchPreview();
      setAmbiguityPreview(data);
    } catch (e) {
      setAmbiguityPreview(null);
      setAmbiguityMessage(
        e instanceof Error ? e.message : "Erro ao gerar preview de ambiguidades."
      );
    } finally {
      setAmbiguityLoading(false);
    }
  }, []);

  const onApplyAmbiguityBatch = useCallback(async () => {
    if (!ambiguityPreview || ambiguityApplying) return;
    if (ambiguityConfirmText !== ambiguityPreview.confirmationRequiredText) return;
    setAmbiguityApplying(true);
    setAmbiguityMessage(null);
    try {
      const result = await applyAmbiguityBatch({
        planHash: ambiguityPreview.planHash,
        confirmationText: ambiguityConfirmText,
      });
      setAmbiguityMessage(result.message);
      setAmbiguityShowConfirm(false);
      setAmbiguityConfirmText("");
      await loadDiagnostic(0);
      await loadAmbiguityPreview();
    } catch (e) {
      setAmbiguityMessage(
        e instanceof Error ? e.message : "Erro ao aplicar resolução de ambiguidades."
      );
    } finally {
      setAmbiguityApplying(false);
    }
  }, [
    ambiguityApplying,
    ambiguityConfirmText,
    ambiguityPreview,
    loadAmbiguityPreview,
    loadDiagnostic,
  ]);

  const totals = diagnostic?.totals;
  const realBlockedCount =
    (totals?.blocked ?? 0) +
    (totals?.ambiguousReview ?? 0) +
    (totals?.existingBothAmbiguous ?? 0);
  const resolvedCount =
    (totals?.resolvedAsMaterial ?? 0) + (totals?.resolvedAsProduct ?? 0);

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">Carga Mestre Nomus</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Importação controlada do cadastro base (Product/Material) que falta no IndusCost. Não
            cria BOM, não altera preço, proposta ou pedido. Itens 800.xx (montagem local) nunca são
            importados automaticamente.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => reload()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Diagnosticar cadastro base
        </button>
        <button
          type="button"
          disabled={disabled || equalizeLoading}
          onClick={() => void loadEqualizePreview()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-background px-3 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {equalizeLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Scale className="h-3.5 w-3.5" />
          )}
          Preview igualar bases
        </button>
        <button
          type="button"
          disabled={
            disabled ||
            equalizeApplying ||
            !equalizePreview ||
            (equalizePreview.totals.createProducts +
              equalizePreview.totals.createMaterials +
              equalizePreview.totals.updateProducts +
              equalizePreview.totals.updateMaterials +
              equalizePreview.totals.deactivateProducts +
              equalizePreview.totals.deactivateMaterials) ===
              0
          }
          onClick={() => {
            setEqualizeShowConfirm(true);
            setEqualizeConfirmText("");
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Scale className="h-3.5 w-3.5" />
          Igualar bases
        </button>
        {diagnostic ? (
          <span className="text-[10px] text-muted-foreground">
            {diagnostic.rows.length} linha(s) carregada(s) ·{" "}
            {new Date(diagnostic.generatedAt).toLocaleString("pt-BR")}
          </span>
        ) : null}
      </div>

      {equalizePreview ? (
        <div className="rounded-lg border border-primary/30 bg-background px-3 py-2 text-[11px] space-y-1">
          <p className="font-bold text-primary">
            Preview Igualar Bases · {equalizePreview.totals.totalRowsConsidered} item(ns) analisado(s)
          </p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3 text-foreground">
            <li>
              Criar Produtos: <strong>{equalizePreview.totals.createProducts}</strong>
            </li>
            <li>
              Criar Materiais: <strong>{equalizePreview.totals.createMaterials}</strong>
            </li>
            <li>
              Atualizar Produtos: <strong>{equalizePreview.totals.updateProducts}</strong>
            </li>
            <li>
              Atualizar Materiais: <strong>{equalizePreview.totals.updateMaterials}</strong>
            </li>
            <li>
              Inativar Produtos: <strong>{equalizePreview.totals.deactivateProducts}</strong>
            </li>
            <li>
              Inativar Materiais: <strong>{equalizePreview.totals.deactivateMaterials}</strong>
            </li>
            <li>
              Preservar locais:{" "}
              <strong>
                {equalizePreview.totals.preserveLocalProducts +
                  equalizePreview.totals.preserveLocalMaterials}
              </strong>
            </li>
            <li>
              Ambíguos/Bloqueados:{" "}
              <strong>
                {equalizePreview.totals.ambiguous + equalizePreview.totals.blocked}
              </strong>
            </li>
            <li>
              Já alinhados (Nomus): <strong>{equalizePreview.totals.preserveNomusControlled}</strong>
            </li>
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {applyResult ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-[11px] space-y-1",
            applyResult.status === "APPLIED"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : applyResult.status === "NO_CHANGES"
                ? "border-muted bg-muted/50 text-muted-foreground"
                : "border-red-300 bg-red-50 text-red-900"
          )}
        >
          <p className="font-bold flex items-center gap-1.5">
            {applyResult.status === "APPLIED" ? (
              <CircleCheck className="h-3.5 w-3.5" />
            ) : applyResult.status === "NO_CHANGES" ? (
              <CircleHelp className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {applyResult.message}
          </p>
          <p>
            Produtos criados: <strong>{applyResult.createdProducts}</strong> · Materiais criados:{" "}
            <strong>{applyResult.createdMaterials}</strong> · Ignorados (já existiam):{" "}
            <strong>{applyResult.skippedExisting}</strong> · Bloqueados:{" "}
            <strong>{applyResult.blocked}</strong> · Erros: <strong>{applyResult.errors}</strong>
          </p>
        </div>
      ) : null}

      {totals ? (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Códigos distintos Nomus" value={totals.distinctNomusCodes} tone="neutral" />
          <StatCard label="Faltam no IndusCost" value={totals.missingTotal} tone="warn" />
          <StatCard
            label="Seguros como Produto"
            value={totals.safeProductCandidates}
            tone="info"
          />
          <StatCard
            label="Seguros como Material"
            value={totals.safeMaterialCandidates}
            tone="success"
          />
          <StatCard
            label="Ambíguos resolvidos"
            value={resolvedCount}
            tone="success"
          />
          <StatCard label="Bloqueados / ambíguos reais" value={realBlockedCount} tone="danger" />
        </div>
      ) : null}

      {ambiguityMessage ? (
        <p className="text-[11px] text-muted-foreground rounded-lg border border-border px-3 py-2">
          {ambiguityMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || ambiguityLoading}
          onClick={() => void loadAmbiguityPreview()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
        >
          {ambiguityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Preview: resolver ambiguidades
        </button>
        {ambiguityPreview && ambiguityPreview.totals.autoApplicable > 0 ? (
          <button
            type="button"
            disabled={disabled || ambiguityApplying}
            onClick={() => {
              setAmbiguityShowConfirm(true);
              setAmbiguityConfirmText("");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 text-xs font-bold text-teal-950 hover:bg-teal-100 disabled:opacity-50"
          >
            Resolver automaticamente ({ambiguityPreview.totals.autoApplicable})
          </button>
        ) : null}
      </div>

      {ambiguityPreview ? (
        <div className="rounded-lg border border-border bg-background/80 p-3 text-[11px] space-y-2 max-h-48 overflow-y-auto">
          <p className="font-bold">
            Preview lote · aplicáveis={ambiguityPreview.totals.autoApplicable} · bloqueados=
            {ambiguityPreview.totals.keepBlocked} · resolvidos (exibição)=
            {ambiguityPreview.totals.resolvedDisplay}
          </p>
          <ul className="space-y-1">
            {ambiguityPreview.items.slice(0, 12).map((item) => (
              <li key={item.code}>
                <span className="font-mono">{item.code}</span> — {item.suggestedDecision}:{" "}
                {item.justification.slice(0, 120)}
                {item.justification.length > 120 ? "…" : ""}
              </li>
            ))}
          </ul>
          {ambiguityPreview.items.length > 12 ? (
            <p className="text-muted-foreground">+ {ambiguityPreview.items.length - 12} código(s)</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2 pt-1">
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground block">
            Buscar (código, descrição)
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: 110.03"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground block">
            Filtro
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as RowFilter)}
            className="mt-1 h-9 rounded-lg border border-border bg-background px-2 text-xs"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {(filter !== "ALL_MISSING" || search) ? (
          <button
            type="button"
            onClick={() => {
              setFilter("ALL_MISSING");
              setSearch("");
            }}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        ) : null}
        {totals && (totals.safeProductCandidates + totals.safeMaterialCandidates) > 0 ? (
          <button
            type="button"
            disabled={disabled || applying}
            onClick={() => {
              setShowConfirm(true);
              setConfirmText("");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 ml-auto"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Importar itens seguros (
            {totals.safeProductCandidates + totals.safeMaterialCandidates})
          </button>
        ) : null}
      </div>

      {diagnostic ? (
        diagnostic.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground space-y-1">
            <p>Nenhum item para os filtros atuais.</p>
            <p>Tente trocar o filtro ou limpar a busca.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-2">Classificação</th>
                  <th className="text-left px-2 py-2">Código</th>
                  <th className="text-left px-2 py-2">Descrição</th>
                  <th className="text-left px-2 py-2">Sinais</th>
                  <th className="text-left px-2 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {diagnostic.rows.map((row) => (
                  <MasterDataRowView key={row.code} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {diagnostic?.pagination.hasMore ? (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() =>
              void loadDiagnostic(diagnostic.pagination.nextOffset ?? diagnostic.rows.length)
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-4 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Carregar mais
          </button>
        </div>
      ) : null}

      {ambiguityShowConfirm && ambiguityPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-4 space-y-3 shadow-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold">Resolver ambiguidades automaticamente</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Aplica relink/reativação apenas para códigos com evidência Material (preview
                  aprovado). Não remove Product nem Material. Digite a frase exata.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={ambiguityConfirmText}
              onChange={(e) => setAmbiguityConfirmText(e.target.value)}
              placeholder={ambiguityPreview.confirmationRequiredText}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAmbiguityShowConfirm(false);
                  setAmbiguityConfirmText("");
                }}
                disabled={ambiguityApplying}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void onApplyAmbiguityBatch()}
                disabled={
                  ambiguityApplying ||
                  ambiguityConfirmText !== ambiguityPreview.confirmationRequiredText
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {ambiguityApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar resolução
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-4 space-y-3 shadow-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold">Confirmar Carga Mestre Nomus</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Esta ação cria apenas registros base (Product/Material) classificados como
                  seguros. <strong>Nenhuma BOM é criada</strong>, nada além de cadastro é
                  alterado. Digite a frase exata para confirmar.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={MASTER_DATA_CONFIRMATION_TEXT}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText("");
                }}
                disabled={applying}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void onApply()}
                disabled={applying || confirmText !== MASTER_DATA_CONFIRMATION_TEXT}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar importação
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <NomusEqualizeResultModal
        open={equalizeResultModalOpen}
        applying={equalizeApplying}
        viewModel={equalizeResultModal}
        onClose={() => {
          setEqualizeResultModalOpen(false);
          setEqualizeResultModal(null);
        }}
        onRefreshPreview={() => void loadEqualizePreview()}
        previewRefreshing={equalizeLoading}
      />

      {equalizeShowConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-4 space-y-3 shadow-lg">
            <div className="flex items-start gap-2">
              <Scale className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold">Confirmar Igualar Bases Nomus</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Esta ação aplica somente <strong>cadastros mestre seguros</strong>:
                  cria/atualiza Products e Materials controlados pelo Nomus e marca como
                  INACTIVE itens controlados que sumiram do Nomus.{" "}
                  <strong>Nenhuma ProductBOM, preço, proposta ou pedido é alterado.</strong>{" "}
                  Itens locais do IndusCost são preservados. Digite a frase exata para confirmar.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={equalizeConfirmText}
              onChange={(e) => setEqualizeConfirmText(e.target.value)}
              placeholder={EQUALIZE_CONFIRMATION_TEXT}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEqualizeShowConfirm(false);
                  setEqualizeConfirmText("");
                }}
                disabled={equalizeApplying}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void onApplyEqualize()}
                disabled={equalizeApplying || equalizeConfirmText !== EQUALIZE_CONFIRMATION_TEXT}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {equalizeApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar igualação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  tone: "neutral" | "info" | "warn" | "danger" | "success";
}> = ({ label, value, tone }) => {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-800"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : tone === "info"
          ? "border-sky-300 bg-sky-50 text-sky-800"
          : tone === "success"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-border bg-card text-foreground";
  return (
    <div className={cn("rounded-xl border p-2.5", toneClass)}>
      <p className="text-[10px] uppercase font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
};

const MasterDataRowView: React.FC<{ row: MasterDataRow }> = ({ row }) => {
  return (
    <tr className="border-t border-border/60 hover:bg-accent/30 align-top">
      <td className="px-2 py-2 align-top">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
            classificationTone(row.classification)
          )}
        >
          {row.classificationLabel}
        </span>
      </td>
      <td className="px-2 py-2 align-top font-mono font-bold">{row.code}</td>
      <td className="px-2 py-2 align-top max-w-[280px]">
        <p className="truncate" title={row.description ?? "—"}>
          {row.description ?? "—"}
        </p>
      </td>
      <td className="px-2 py-2 align-top text-[10px] text-muted-foreground">
        <ul className="space-y-0">
          {row.appearsAsParent ? <li>· Pai em {row.parentCount} BOM(s)</li> : null}
          {row.appearsAsComponent ? <li>· Componente em {row.componentCount} BOM(s)</li> : null}
          {row.isOptional ? <li>· Opcional</li> : null}
          {row.isAlternative ? <li>· Alternativo</li> : null}
        </ul>
      </td>
      <td className="px-2 py-2 align-top max-w-[320px] text-[11px]">
        <p>{row.reason}</p>
        {row.blockers.length > 0 ? (
          <ul className="mt-1 list-disc list-inside text-red-700">
            {row.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        {row.warnings.length > 0 ? (
          <ul className="mt-1 list-disc list-inside text-amber-700">
            {row.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </td>
    </tr>
  );
};
