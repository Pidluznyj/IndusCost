import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { 
  Calculator, Plus, Search, Edit2, Trash2, X, Loader2, DollarSign,
  TrendingUp, TrendingDown, Percent, Truck, Users, ShieldCheck, Save,
  BarChart3, Layers, LayoutGrid, Play, AlertCircle, CheckCircle2, ChevronRight, BookOpen, Printer
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "./shared/SearchableSelect";
import { motion, AnimatePresence } from "motion/react";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PRICING_TOUR_STEPS } from "@/src/tours/pricingTourSteps";
import { PricingOpenBookTab } from "@/src/components/pricing/PricingOpenBookTab";
import { PricingDetailedCompositionTab } from "@/src/components/pricing/PricingDetailedCompositionTab";
import { ProductionCostTablesPanel } from "@/src/components/pricing/ProductionCostTablesPanel";
import type { PricingOpenBookPayload } from "@/src/lib/pricingOpenBook";
import {
  filterAndSortPricingRows,
  pricingListSafeNumber,
  type PricingCommissionBand,
  type PricingMarginBand,
  type PricingSortKey,
} from "@/src/lib/pricingListFilters";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  DEFAULT_PRICING_BATCH_ITEM_SCOPE,
  filterProductsForPricingBatchScope,
  filterProductsForPricingBatchSearch,
  PRICING_BATCH_ITEM_SCOPE_OPTIONS,
  pricingBatchItemTypeLabel,
  pruneSelectedIdsForPricingBatchScope,
  resolvePricingBatchItemType,
  type PricingBatchItemScope,
} from "@/src/lib/pricingBatchItemScope";

type PriceTableLite = {
  id: string;
  code: string;
  name: string;
  status: string;
  defaultMarginPct: number | string;
};

type CommercialGenIssuePreview = {
  sku?: string;
  productName?: string;
  code?: string;
  message?: string;
};

type CommercialGenResult = {
  priceTableId: string;
  priceTableCode: string;
  priceTableName: string;
  status: "SUCCESS" | "ERROR";
  versionId: string | null;
  versionNumber: number | null;
  versionStatus: string;
  publishedAt: string | null;
  /** Indica que a versão foi publicada parcialmente, com errors aceitos pelo usuário. */
  publishedWithErrors?: boolean;
  /** Indica que a versão foi publicada com warnings aceitos. */
  publishedWithWarnings?: boolean;
  productsRead: number;
  itemsCreated: number;
  itemsSkipped: number;
  errorsCount: number;
  warningsCount: number;
  errorsPreview: CommercialGenIssuePreview[];
  warningsPreview: CommercialGenIssuePreview[];
  fatalErrorMessage?: string;
  /**
   * Comissão de vendedor aplicada na geração desta tabela (em %).
   * Pode vir de version.commissionPerc, summary.commissionOverridePerc ou
   * do valor informado no formulário (fallback). null se desconhecida.
   */
  commissionPerc?: number | null;
};

type ProductionCostVersionLite = {
  id: string;
  code: string;
  name: string;
  effectiveDate: string;
  status: string;
  revision: number;
  publishedAt: string | null;
  publishedBy: string | null;
  itemsCount: number;
};

type ProductionCostGenResult = {
  versionId: string;
  code: string;
  revision: number;
  status: string;
  itemsCount: number;
  productsRead: number;
  itemsCreated: number;
  itemsSkipped: number;
  errorsCount: number;
  warningsCount: number;
  fatalErrorMessage?: string;
};

const COMMERCIAL_TABLE_CODES = ["ATACADO", "VAREJO_1", "VAREJO_2", "VAREJO_3"] as const;
const COMMERCIAL_TABLE_LABELS: Record<string, string> = {
  ATACADO: "Atacado",
  VAREJO_1: "Varejo 1",
  VAREJO_2: "Varejo 2",
  VAREJO_3: "Varejo 3",
};

/**
 * Comissão padrão (%) por código de tabela comercial.
 * Política: ATACADO 1%, VAREJO_1 2%, VAREJO_2 3%, VAREJO_3 4%, VAREJO_4 5%.
 * Códigos fora desta lista usam 0 como default.
 */
const DEFAULT_COMMISSION_BY_TABLE_CODE: Record<string, number> = {
  ATACADO: 1,
  VAREJO_1: 2,
  VAREJO_2: 3,
  VAREJO_3: 4,
  VAREJO_4: 5,
};

const getDefaultCommissionForCode = (code: string): number =>
  Number.isFinite(DEFAULT_COMMISSION_BY_TABLE_CODE[code])
    ? DEFAULT_COMMISSION_BY_TABLE_CODE[code]
    : 0;

function extractIssuePreview(raw: unknown): CommercialGenIssuePreview {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: CommercialGenIssuePreview = {};
  if (typeof o.sku === "string" && o.sku.trim()) out.sku = o.sku.trim();
  if (typeof o.productName === "string" && o.productName.trim()) out.productName = o.productName.trim();
  if (typeof o.code === "string" && o.code.trim()) out.code = o.code.trim();
  if (typeof o.message === "string" && o.message.trim()) out.message = o.message.trim();
  return out;
}

export const PricingModule = () => {
  const auth = useAuth();
  const allowSimulate = auth.hasPermission("pricing.simulate");
  const allowGenerateTables = auth.hasPermission("pricing.generate_tables");
  const allowPublishTables = auth.hasPermission("pricing.publish_tables");
  const canViewProductionCostTables =
    auth.hasPermission("pricing.view") ||
    auth.hasPermission("costs.view") ||
    auth.hasPermission("products.tab.cost") ||
    allowGenerateTables;
  const [tourOpen, setTourOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"UNIT" | "BATCH">("UNIT");
  const [selectedPricings, setSelectedPricings] = useState<string[]>([]);

  const [pricings, setPricings] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any | null>(null);
  const [resultTab, setResultTab] = useState<"summary" | "composition" | "detailed">("summary");
  
  const [searchTermBatch, setSearchTermBatch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [simulatingBatch, setSimulatingBatch] = useState(false);
  const [batchResults, setBatchResults] = useState<any[] | null>(null);
  const [pricingSearchTerm, setPricingSearchTerm] = useState("");
  const [pricingTaxRuleFilter, setPricingTaxRuleFilter] = useState("");
  const [pricingMarginBand, setPricingMarginBand] = useState<PricingMarginBand>("ALL");
  const [pricingCommissionBand, setPricingCommissionBand] = useState<PricingCommissionBand>("ALL");
  const [pricingSortBy, setPricingSortBy] = useState<PricingSortKey>("NAME_ASC");
  const [simulatorForm, setSimulatorForm] = useState({
    productId: "",
    taxRuleId: "",
    desiredMargin: 15,
  });
  const [simulatorCost, setSimulatorCost] = useState<number | null>(null);
  const [simulatorCostLoading, setSimulatorCostLoading] = useState(false);
  const [simulatorError, setSimulatorError] = useState<string | null>(null);
  const [simulatorRunning, setSimulatorRunning] = useState(false);
  const [simulatorResult, setSimulatorResult] = useState<any | null>(null);
  const [isSimulatorModalOpen, setIsSimulatorModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    productId: "",
    taxRuleId: "",
    desiredMargin: 15,
    commission: 5,
    freightOut: 0,
    otherVariables: 0,
  });

  const [batchFormData, setBatchFormData] = useState({
    taxRuleId: "",
    desiredMargin: 15,
    commission: 5,
    freightOut: 0,
    otherVariables: 0,
  });
  const [batchItemScope, setBatchItemScope] = useState<PricingBatchItemScope>(
    DEFAULT_PRICING_BATCH_ITEM_SCOPE
  );

  const [priceTables, setPriceTables] = useState<PriceTableLite[]>([]);
  const [commercialGenOpen, setCommercialGenOpen] = useState(false);
  const [commercialGenTaxRuleId, setCommercialGenTaxRuleId] = useState("");
  const [commercialGenEffectiveFrom, setCommercialGenEffectiveFrom] = useState("");
  const [commercialGenNotes, setCommercialGenNotes] = useState("");
  /**
   * Comissão de vendedor (%) por código de tabela comercial.
   * Cada tabela pode ter uma comissão diferente. Defaults vêm de DEFAULT_COMMISSION_BY_TABLE_CODE.
   * Mantido como string para permitir digitação livre (vírgula/ponto).
   */
  const [commercialGenCommissionByCode, setCommercialGenCommissionByCode] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      for (const code of COMMERCIAL_TABLE_CODES) {
        initial[code] = String(getDefaultCommissionForCode(code));
      }
      return initial;
    }
  );
  const [commercialGenSelectedCodes, setCommercialGenSelectedCodes] = useState<Set<string>>(
    () => new Set(COMMERCIAL_TABLE_CODES)
  );
  const [commercialGenRunning, setCommercialGenRunning] = useState(false);
  const [commercialGenCurrentCode, setCommercialGenCurrentCode] = useState<string | null>(null);
  const [commercialGenResults, setCommercialGenResults] = useState<CommercialGenResult[] | null>(null);
  /** "Aprovado por" usado na publicação das DRAFTs comerciais. Opcional. */
  const [commercialPublishApprovedBy, setCommercialPublishApprovedBy] = useState("");
  /** versionId atualmente em publicação (loading discreto por card). */
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null);

  const [productionCostOpen, setProductionCostOpen] = useState(false);
  const [productionCostEffectiveDate, setProductionCostEffectiveDate] = useState("");
  const [productionCostNotes, setProductionCostNotes] = useState("");
  const [productionCostPublishedBy, setProductionCostPublishedBy] = useState("");
  const [productionCostIncludeAll, setProductionCostIncludeAll] = useState(false);
  const [productionCostRunning, setProductionCostRunning] = useState(false);
  const [publishingProductionCostVersionId, setPublishingProductionCostVersionId] = useState<string | null>(null);
  const [productionCostGenResult, setProductionCostGenResult] = useState<ProductionCostGenResult | null>(null);
  const [productionCostVersions, setProductionCostVersions] = useState<ProductionCostVersionLite[]>([]);
  const [productionCostVersionsLoading, setProductionCostVersionsLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [p, prod, tax, pt] = await Promise.all([
        fetchJsonOk("/api/pricing"),
        fetchJsonOk("/api/products"),
        fetchJsonOk("/api/tax-rules"),
        fetchJsonOk<PriceTableLite[]>("/api/price-tables").catch((e) => {
          console.warn("GET /api/price-tables (PricingModule):", e);
          return [] as PriceTableLite[];
        }),
      ]);
      setPricings(Array.isArray(p) ? p : []);
      setProducts(Array.isArray(prod) ? prod : []);
      setTaxRules(Array.isArray(tax) ? tax : []);
      setPriceTables(
        Array.isArray(pt) ? pt.filter((t) => String(t.status).toUpperCase() === "ACTIVE") : []
      );
    } catch (error) {
      console.error("Erro ao buscar dados de preço:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar precificação.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Garante que toda tabela comercial ativa tenha um valor default de comissão no estado,
  // sem sobrescrever digitação do usuário. Cobre tabelas futuras (ex.: VAREJO_4).
  useEffect(() => {
    if (priceTables.length === 0) return;
    setCommercialGenCommissionByCode((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      for (const t of priceTables) {
        if (!t?.code) continue;
        if (next[t.code] === undefined) {
          next[t.code] = String(getDefaultCommissionForCode(t.code));
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [priceTables]);

  useEffect(() => {
    if (!simulatorForm.productId) {
      setSimulatorCost(null);
      return;
    }
    const loadSnapshot = async () => {
      setSimulatorCostLoading(true);
      setSimulatorError(null);
      try {
        const qs = simulatorForm.taxRuleId ? `?taxRuleId=${encodeURIComponent(simulatorForm.taxRuleId)}` : "";
        const data = await fetchJsonOk<{ unitCost?: number | string }>(`/api/products/${simulatorForm.productId}/pricing-snapshot${qs}`);
        const n = Number(data?.unitCost);
        setSimulatorCost(Number.isFinite(n) ? n : null);
      } catch (error) {
        setSimulatorCost(null);
        setSimulatorError(error instanceof Error ? error.message : "Não foi possível carregar custo do item selecionado.");
      } finally {
        setSimulatorCostLoading(false);
      }
    };
    loadSnapshot();
  }, [simulatorForm.productId, simulatorForm.taxRuleId]);

  useEffect(() => {
    if (!isSimulatorModalOpen) return;
    document.body.classList.add("np-report-printing");
    return () => document.body.classList.remove("np-report-printing");
  }, [isSimulatorModalOpen]);

  const simulatorProductLabel = useMemo(() => {
    const p = products.find((x: { id: string }) => x.id === simulatorForm.productId) as
      | { sku: string; name: string }
      | undefined;
    return p ? `${p.sku} — ${p.name}` : "—";
  }, [products, simulatorForm.productId]);

  const simulatorTaxLabel = useMemo(() => {
    const r = taxRules.find((x: { id: string }) => x.id === simulatorForm.taxRuleId) as { name: string } | undefined;
    return r?.name ?? "—";
  }, [taxRules, simulatorForm.taxRuleId]);

  const filteredPricings = useMemo(
    () =>
      filterAndSortPricingRows(pricings, {
        search: pricingSearchTerm,
        taxRuleId: pricingTaxRuleFilter,
        marginBand: pricingMarginBand,
        commissionBand: pricingCommissionBand,
        sortBy: pricingSortBy,
      }),
    [pricings, pricingSearchTerm, pricingTaxRuleFilter, pricingMarginBand, pricingCommissionBand, pricingSortBy]
  );

  const hasActivePricingFilters =
    pricingSearchTerm.trim() !== "" ||
    pricingTaxRuleFilter !== "" ||
    pricingMarginBand !== "ALL" ||
    pricingCommissionBand !== "ALL" ||
    pricingSortBy !== "NAME_ASC";

  const clearPricingFilters = () => {
    setPricingSearchTerm("");
    setPricingTaxRuleFilter("");
    setPricingMarginBand("ALL");
    setPricingCommissionBand("ALL");
    setPricingSortBy("NAME_ASC");
  };

  const batchScopeProducts = useMemo(
    () => filterProductsForPricingBatchScope(products, batchItemScope),
    [products, batchItemScope]
  );

  const batchFilteredProducts = useMemo(
    () => filterProductsForPricingBatchSearch(batchScopeProducts, searchTermBatch),
    [batchScopeProducts, searchTermBatch]
  );

  useEffect(() => {
    setSelectedProductIds((prev) => {
      const next = pruneSelectedIdsForPricingBatchScope(prev, products, batchItemScope);
      return next.length === prev.length ? prev : next;
    });
  }, [batchItemScope, products]);

  const handleBatchItemScopeChange = (scope: PricingBatchItemScope) => {
    setBatchItemScope(scope);
    setBatchResults(null);
  };

  // --- UNITARY LOGIC ---
  const handleCalculateUnit = async (productId: string, taxRuleId: string) => {
    setCalculating(true);
    try {
      const data = await fetchJsonOk(`/api/pricing/${productId}/${taxRuleId}/calculate`);
      setCalculationResult(data);
      setResultTab("summary");
    } catch (error) {
      console.error("Erro no cálculo:", error);
      alert(error instanceof Error ? error.message : "Erro ao calcular preço.");
    } finally {
      setCalculating(false);
    }
  };

  const handleSubmitUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchJsonOk("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar premissas unitárias:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a formação de preço.");
    }
  };

  const handleDeleteUnit = async (pricing: any) => {
    if (!window.confirm(`Tem certeza que deseja excluir esta premissa de precificação do produto ${pricing.Product?.name}?`)) return;
    
    try {
      await fetchJsonOk(`/api/pricing/${pricing.id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro durante request de deleção:", error);
      window.alert(error instanceof Error ? error.message : "Falha ao excluir a formação de preço.");
    }
  };

  const togglePricingSelection = (id: string) => {
    setSelectedPricings(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const toggleAllPricings = () => {
    const filteredIds = filteredPricings.map((p: any) => p.id);
    const allFilteredSelected =
      filteredIds.length > 0 && filteredIds.every((id: string) => selectedPricings.includes(id));

    if (allFilteredSelected) {
      setSelectedPricings((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedPricings((prev) => [...new Set([...prev, ...filteredIds])]);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPricings.length === 0) return;
    if (!window.confirm(`Confirma a exclusão Múltipla de ${selectedPricings.length} formações de preço?`)) return;

    try {
      const data = await fetchJsonOk<{
        success?: number;
        error?: number;
        details?: Array<{ message?: string }>;
      }>("/api/pricing/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedPricings }),
      });

      if (data.error != null && data.error > 0) {
        window.alert(
          `${data.success ?? 0} apagados. Houveram ${data.error} falhas.\nExemplo de falha: ${data.details?.[0]?.message ?? "—"}`
        );
      }

      setSelectedPricings([]);
      fetchData();
    } catch (err) {
      console.error("Erro no bulk delete", err);
      window.alert(err instanceof Error ? err.message : "Falha de conexão ao excluir lote.");
    }
  };

  // --- BATCH LOGIC ---
  const handleToggleSelectAll = () => {
    const filteredIds = batchFilteredProducts.map((product) => product.id);

    if (
      filteredIds.length > 0 &&
      filteredIds.every((id) => selectedProductIds.includes(id))
    ) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredIds);
    }
  };

  const handleSimulateBatch = async () => {
    if (selectedProductIds.length === 0) return alert("Selecione ao menos 1 item.");
    if (!batchFormData.taxRuleId) return alert("Selecione uma Regra Fiscal.");

    setSimulatingBatch(true);
    try {
      const data = await fetchJsonOk<{ results: any[] }>("/api/pricing/simulate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          itemScope: batchItemScope,
          ...batchFormData,
        }),
      });
      setBatchResults(data.results ?? []);
    } catch (error) {
      console.error("Erro na simulação de lote:", error);
      alert(error instanceof Error ? error.message : "Erro na simulação em lote.");
    } finally {
      setSimulatingBatch(false);
    }
  };

  const handleApplyBatch = async () => {
    if (!batchResults) return;

    const validResults = batchResults.filter((row) => row.status === "SUCCESS");
    if (validResults.length === 0) return alert("Nenhum item válido para aplicar.");

    if (
      !window.confirm(
        `Tem certeza que deseja gravar as premissas de preço para ${validResults.length} item(ns)?`
      )
    ) {
      return;
    }

    try {
      const data = await fetchJsonOk<{ appliedCount?: number }>("/api/pricing/apply-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validResults,
          itemScope: batchItemScope,
          ...batchFormData,
        }),
      });
      alert(`${data.appliedCount ?? 0} item(ns) atualizado(s) com sucesso!`);
      setBatchResults(null);
      setSelectedProductIds([]);
      fetchData();
    } catch (err) {
      console.error("Apply batch error", err);
      alert(err instanceof Error ? err.message : "Falha ao aplicar lote.");
    }
  };

  const toggleCommercialTable = (code: string) => {
    setCommercialGenSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleGenerateCommercialDrafts = async () => {
    if (!commercialGenTaxRuleId) {
      alert("Selecione uma regra fiscal.");
      return;
    }
    const selectedTables = COMMERCIAL_TABLE_CODES
      .map((code) => priceTables.find((t) => t.code === code))
      .filter((t): t is PriceTableLite => !!t && commercialGenSelectedCodes.has(t.code));
    if (selectedTables.length === 0) {
      alert("Selecione pelo menos uma tabela disponível.");
      return;
    }

    // Comissão por tabela: cada tabela selecionada precisa ter um número válido entre 0 e 50.
    // Valida todas antes de gerar qualquer DRAFT. Aceita vírgula ou ponto como separador.
    const commissionParsedByCode: Record<string, number> = {};
    for (const table of selectedTables) {
      const raw = (commercialGenCommissionByCode[table.code] ?? "").trim().replace(",", ".");
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
        alert(`Comissão do vendedor da tabela ${table.code} deve estar entre 0% e 50%.`);
        return;
      }
      commissionParsedByCode[table.code] = parsed;
    }

    if (
      !window.confirm(
        `Gerar DRAFTs para ${selectedTables.length} tabela(s)? Nenhuma versão será publicada automaticamente.`
      )
    ) {
      return;
    }

    const taxRuleName = (taxRules.find((r: { id: string; name?: string }) => r.id === commercialGenTaxRuleId)?.name as string | undefined) ?? "Regra fiscal";
    const generatedAt = new Date().toLocaleString("pt-BR");
    const vig = commercialGenEffectiveFrom?.trim();
    const userNotes = commercialGenNotes?.trim();

    setCommercialGenRunning(true);
    setCommercialGenResults([]);
    try {
      const accumulated: CommercialGenResult[] = [];
      for (const table of selectedTables) {
        setCommercialGenCurrentCode(table.code);
        const tableCommissionParsed = commissionParsedByCode[table.code];
        const noteParts: string[] = [
          "Gerado pela Formação de Preço Comercial.",
          `Tabela: ${table.code}.`,
          `Regra fiscal: ${taxRuleName}.`,
          `Comissão vendedor da tabela ${table.code}: ${formatNumber(tableCommissionParsed, 2)}%.`,
        ];
        if (vig) noteParts.push(`Vigência desejada: ${vig}.`);
        if (userNotes) noteParts.push(`Observações: ${userNotes}`);
        noteParts.push(`Geração: ${generatedAt}.`);
        const consolidatedNotes = noteParts.join(" ");

        try {
          const payload = await fetchJsonOk<{
            version?: {
              id?: string;
              versionNumber?: number | string;
              status?: string;
              commissionPerc?: number | string | null;
            };
            summary?: {
              productsRead?: number | string;
              itemsCreated?: number | string;
              itemsSkipped?: number | string;
              errors?: Array<Record<string, unknown>>;
              warnings?: Array<Record<string, unknown>>;
              commissionOverridePerc?: number | string | null;
            };
          }>(`/api/price-tables/${table.id}/versions/generate-draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taxRuleId: commercialGenTaxRuleId,
              includeAllActiveProducts: true,
              commissionPerc: tableCommissionParsed,
              notes: consolidatedNotes,
            }),
          });

          const errors = Array.isArray(payload.summary?.errors) ? payload.summary?.errors ?? [] : [];
          const warnings = Array.isArray(payload.summary?.warnings) ? payload.summary?.warnings ?? [] : [];
          const vn = Number(payload.version?.versionNumber);
          const versionId = typeof payload.version?.id === "string" ? payload.version.id : null;

          // Comissão exibida no card: prefere version.commissionPerc, depois summary.commissionOverridePerc,
          // e usa a comissão enviada para esta tabela como fallback final (já validada acima).
          const versionCommission = Number(payload.version?.commissionPerc);
          const summaryCommission = Number(payload.summary?.commissionOverridePerc);
          let appliedCommissionPerc: number | null = null;
          if (Number.isFinite(versionCommission)) appliedCommissionPerc = versionCommission;
          else if (Number.isFinite(summaryCommission)) appliedCommissionPerc = summaryCommission;
          else appliedCommissionPerc = tableCommissionParsed;

          accumulated.push({
            priceTableId: table.id,
            priceTableCode: table.code,
            priceTableName: table.name,
            status: "SUCCESS",
            versionId,
            versionNumber: Number.isFinite(vn) ? vn : null,
            versionStatus: typeof payload.version?.status === "string" ? payload.version.status : "DRAFT",
            publishedAt: null,
            productsRead: Number(payload.summary?.productsRead) || 0,
            itemsCreated: Number(payload.summary?.itemsCreated) || 0,
            itemsSkipped: Number(payload.summary?.itemsSkipped) || 0,
            errorsCount: errors.length,
            warningsCount: warnings.length,
            errorsPreview: errors.slice(0, 3).map(extractIssuePreview),
            warningsPreview: warnings.slice(0, 3).map(extractIssuePreview),
            commissionPerc: appliedCommissionPerc,
          });
        } catch (error) {
          accumulated.push({
            priceTableId: table.id,
            priceTableCode: table.code,
            priceTableName: table.name,
            status: "ERROR",
            versionId: null,
            versionNumber: null,
            versionStatus: "—",
            publishedAt: null,
            productsRead: 0,
            itemsCreated: 0,
            itemsSkipped: 0,
            errorsCount: 0,
            warningsCount: 0,
            errorsPreview: [],
            warningsPreview: [],
            fatalErrorMessage: error instanceof Error ? error.message : "Falha ao gerar DRAFT.",
            commissionPerc: null,
          });
        }
        setCommercialGenResults([...accumulated]);
      }
    } finally {
      setCommercialGenRunning(false);
      setCommercialGenCurrentCode(null);
    }
  };

  /**
   * Publica uma DRAFT recém-gerada usando POST /api/price-table-versions/:id/publish.
   * - Exige vigência (commercialGenEffectiveFrom).
   * - Se a vigência for anterior à data de hoje, pede confirmação extra (evita 21/05/1986 acidental).
   * - Se há warnings, envia forcePublishWithWarnings=true após confirmação.
   * - Se há errors, envia forcePublishWithErrors=true após duas confirmações (publicação parcial).
   *   Publicação parcial NÃO cria itens novos; apenas publica os itens válidos já criados na DRAFT.
   * - Em sucesso, atualiza o card e recarrega priceTables para refletir latestPublishedVersion.
   */
  const handlePublishDraftVersion = async (result: CommercialGenResult) => {
    if (!result.versionId) return;
    if (publishingVersionId !== null) return;

    if (!commercialGenEffectiveFrom.trim()) {
      alert("Informe a vigência desejada antes de publicar.");
      return;
    }

    const versionLabel = result.versionNumber != null ? `v${result.versionNumber}` : "DRAFT";
    const vigParts = commercialGenEffectiveFrom.split("-");
    const vigPretty =
      vigParts.length === 3
        ? `${vigParts[2]}/${vigParts[1]}/${vigParts[0]}`
        : commercialGenEffectiveFrom;

    // Defesa contra datas absurdas (ex.: 21/05/1986). Permite backdate explícito se confirmado.
    if (vigParts.length === 3) {
      const [y, m, d] = vigParts.map((p) => Number(p));
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        const vigDate = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (vigDate.getTime() < today.getTime()) {
          if (
            !window.confirm(
              `A vigência informada (${vigPretty}) é anterior à data atual. Deseja publicar assim mesmo?`
            )
          ) {
            return;
          }
        }
      }
    }

    if (result.errorsCount > 0) {
      if (
        !window.confirm(
          `Esta versão possui ${result.errorsCount} erro(s) de custo e ${result.itemsSkipped} item(ns) ignorado(s). Os produtos com erro NÃO terão preço publicado nesta tabela. Deseja continuar?`
        )
      ) {
        return;
      }
      if (
        !window.confirm(
          `Confirma a publicação parcial da tabela ${result.priceTableCode} ${versionLabel}? Ela ficará disponível para propostas, mas alguns produtos entrarão somente como preço manual quando não houver preço na tabela.`
        )
      ) {
        return;
      }
    } else {
      if (
        !window.confirm(
          `Publicar a versão ${versionLabel} da tabela ${result.priceTableCode} com vigência a partir de ${vigPretty}? Esta tabela ficará disponível para propostas.`
        )
      ) {
        return;
      }
    }

    if (
      result.warningsCount > 0 &&
      !window.confirm(
        `Esta versão possui ${result.warningsCount} aviso(s) de custo parcial. Deseja publicar mesmo assim?`
      )
    ) {
      return;
    }

    setPublishingVersionId(result.versionId);
    try {
      const approvedBy = commercialPublishApprovedBy.trim();
      const body: Record<string, unknown> = {
        effectiveFrom: commercialGenEffectiveFrom,
        forcePublishWithWarnings: result.warningsCount > 0,
        forcePublishWithErrors: result.errorsCount > 0,
      };
      if (approvedBy) body.approvedBy = approvedBy;

      const resp = await fetchJsonOk<{
        version?: { id?: string; versionNumber?: number | string; status?: string; publishedAt?: string | null };
        published?: boolean;
        warningsAccepted?: boolean;
        errorsAccepted?: boolean;
        errorsCount?: number;
        warningsCount?: number;
      }>(`/api/price-table-versions/${result.versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const newStatus =
        typeof resp.version?.status === "string" && resp.version.status.trim().length > 0
          ? resp.version.status
          : "PUBLISHED";
      const newPublishedAt =
        typeof resp.version?.publishedAt === "string" ? resp.version.publishedAt : new Date().toISOString();
      const errorsAccepted = resp.errorsAccepted === true || result.errorsCount > 0;
      const warningsAccepted = resp.warningsAccepted === true || result.warningsCount > 0;

      setCommercialGenResults((prev) =>
        prev
          ? prev.map((r) =>
              r.versionId === result.versionId
                ? {
                    ...r,
                    versionStatus: newStatus,
                    publishedAt: newPublishedAt,
                    publishedWithErrors: errorsAccepted,
                    publishedWithWarnings: warningsAccepted,
                  }
                : r
            )
          : prev
      );

      if (errorsAccepted) {
        alert(
          `Tabela ${result.priceTableCode} ${versionLabel} publicada com pendências. Produtos sem preço publicado precisarão ser tratados como preço manual nas propostas.`
        );
      } else {
        alert(
          `Tabela ${result.priceTableCode} ${versionLabel} publicada com sucesso. Ela agora ficará disponível nas propostas.`
        );
      }

      try {
        const pt = await fetchJsonOk<PriceTableLite[]>("/api/price-tables");
        if (Array.isArray(pt)) {
          setPriceTables(pt.filter((t) => String(t.status).toUpperCase() === "ACTIVE"));
        }
      } catch (reloadErr) {
        console.warn("GET /api/price-tables after publish failed:", reloadErr);
      }
    } catch (error) {
      console.error("POST /api/price-table-versions/:id/publish", error);
      alert(error instanceof Error ? error.message : "Falha ao publicar a versão DRAFT.");
    } finally {
      setPublishingVersionId(null);
    }
  };

  const fetchProductionCostVersions = async () => {
    setProductionCostVersionsLoading(true);
    try {
      const rows = await fetchJsonOk<ProductionCostVersionLite[]>("/api/production-cost-tables/versions?limit=12");
      setProductionCostVersions(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.warn("GET /api/production-cost-tables/versions:", error);
      setProductionCostVersions([]);
    } finally {
      setProductionCostVersionsLoading(false);
    }
  };

  useEffect(() => {
    if (productionCostOpen && allowGenerateTables) {
      void fetchProductionCostVersions();
    }
  }, [productionCostOpen, allowGenerateTables]);

  const handleGenerateProductionCostDraft = async () => {
    if (!productionCostEffectiveDate.trim()) {
      alert("Informe a vigência desejada antes de gerar o custo de produção.");
      return;
    }
    if (!productionCostIncludeAll && selectedProductIds.length === 0) {
      alert("Selecione produtos no lote ou marque \"Todos os produtos ativos\".");
      return;
    }

    setProductionCostRunning(true);
    setProductionCostGenResult(null);
    try {
      const payload = await fetchJsonOk<{
        version?: {
          id?: string;
          code?: string;
          revision?: number;
          status?: string;
          itemsCount?: number;
        };
        summary?: {
          productsRead?: number;
          itemsCreated?: number;
          itemsSkipped?: number;
          errors?: unknown[];
          warnings?: unknown[];
        };
      }>("/api/production-cost-tables/versions/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveDate: productionCostEffectiveDate,
          productIds: productionCostIncludeAll ? [] : selectedProductIds,
          includeAllActiveProducts: productionCostIncludeAll,
          notes: productionCostNotes.trim() || undefined,
          createdBy: productionCostPublishedBy.trim() || undefined,
        }),
      });

      const version = payload.version;
      const summary = payload.summary ?? {};
      const errors = Array.isArray(summary.errors) ? summary.errors : [];
      const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];

      if (version?.id) {
        setProductionCostGenResult({
          versionId: version.id,
          code: version.code ?? "—",
          revision: Number(version.revision) || 1,
          status: version.status ?? "DRAFT",
          itemsCount: Number(version.itemsCount) || 0,
          productsRead: Number(summary.productsRead) || 0,
          itemsCreated: Number(summary.itemsCreated) || 0,
          itemsSkipped: Number(summary.itemsSkipped) || 0,
          errorsCount: errors.length,
          warningsCount: warnings.length,
        });
      }
      await fetchProductionCostVersions();
    } catch (error) {
      console.error("POST /api/production-cost-tables/versions/generate-draft", error);
      setProductionCostGenResult({
        versionId: "",
        code: "—",
        revision: 0,
        status: "ERROR",
        itemsCount: 0,
        productsRead: 0,
        itemsCreated: 0,
        itemsSkipped: 0,
        errorsCount: 1,
        warningsCount: 0,
        fatalErrorMessage: error instanceof Error ? error.message : "Falha ao gerar DRAFT de custo.",
      });
    } finally {
      setProductionCostRunning(false);
    }
  };

  const handlePublishProductionCostVersion = async (input: {
    versionId: string;
    code: string;
    revision: number;
  }) => {
    const { versionId, code, revision } = input;
    if (!versionId || publishingProductionCostVersionId) return;

    if (
      !window.confirm(
        `Publicar custo de produção ${code} rev.${revision}? Versões publicadas são imutáveis; correções geram nova revisão.`
      )
    ) {
      return;
    }

    setPublishingProductionCostVersionId(versionId);
    try {
      await fetchJsonOk(`/api/production-cost-table-versions/${versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishedBy: productionCostPublishedBy.trim() || undefined,
        }),
      });
      alert(`Custo de produção ${code} rev.${revision} publicado. Histórico anterior preservado quando aplicável.`);
      setProductionCostGenResult((prev) =>
        prev && prev.versionId === versionId ? { ...prev, status: "PUBLISHED" } : prev
      );
      await fetchProductionCostVersions();
    } catch (error) {
      console.error("POST /api/production-cost-table-versions/:id/publish", error);
      alert(error instanceof Error ? error.message : "Falha ao publicar versão de custo de produção.");
    } finally {
      setPublishingProductionCostVersionId(null);
    }
  };

  const handleRunSimulator = async () => {
    setSimulatorError(null);
    setSimulatorResult(null);
    if (!simulatorForm.productId) {
      setSimulatorError("Selecione um produto ou componente.");
      return;
    }
    if (!simulatorForm.taxRuleId) {
      setSimulatorError("Selecione a regra fiscal.");
      return;
    }
    const marginNumber = Number(simulatorForm.desiredMargin);
    if (!Number.isFinite(marginNumber) || marginNumber < 0) {
      setSimulatorError("Informe uma margem desejada válida.");
      return;
    }
    setSimulatorRunning(true);
    try {
      const data = await fetchJsonOk<any>("/api/pricing/simulate-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: simulatorForm.productId,
          taxRuleId: simulatorForm.taxRuleId,
          desiredMarginPerc: marginNumber,
        }),
      });
      setSimulatorResult(data);
    } catch (error) {
      setSimulatorError(error instanceof Error ? error.message : "Não foi possível calcular a simulação.");
    } finally {
      setSimulatorRunning(false);
    }
  };

  return (
    <div className="space-y-6" data-tour="pricing-root">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Formação de Preço</h2>
            <p className="text-xs text-muted-foreground">Estratégia e precificação do portfólio industrial.</p>
          </div>
          <TourHelpButton onClick={() => setTourOpen(true)} />
        </div>

        {/* Gerar Tabelas Comerciais (card colapsável) */}
        {allowGenerateTables ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setCommercialGenOpen((v) => !v)}
            aria-expanded={commercialGenOpen}
            aria-controls="pricing-generate-commercial-body"
            className="w-full flex items-start justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Gerar Tabelas Comerciais
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Crie versões DRAFT revisáveis para Atacado e Varejo. Nenhuma tabela será publicada automaticamente.
              </p>
            </div>
            <ChevronRight
              className={cn(
                "h-5 w-5 text-muted-foreground transition-transform shrink-0",
                commercialGenOpen && "rotate-90"
              )}
            />
          </button>

          {commercialGenOpen && (
            <div id="pricing-generate-commercial-body" className="mt-5 space-y-5">
              <div className="rounded-xl border border-border bg-accent/20 p-3 text-xs text-muted-foreground">
                Esta seção gera DRAFTs revisáveis. Depois da geração você pode publicar cada DRAFT
                diretamente nos cards abaixo (ação explícita). A revisão completa também continua
                disponível em
                {" "}<span className="font-bold text-foreground">Configurações &gt; Tabelas de Preço Comerciais</span>.
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Regra fiscal</label>
                  <SearchableSelect
                    placeholder="Selecione a regra fiscal..."
                    options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                      value: r.id,
                      label: r.name,
                      sublabel: r.description?.trim() || undefined,
                      searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                    }))}
                    value={commercialGenTaxRuleId}
                    onChange={(val) => setCommercialGenTaxRuleId(val)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Vigência desejada (referência)</label>
                  <input
                    type="date"
                    className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
                    value={commercialGenEffectiveFrom}
                    onChange={(e) => setCommercialGenEffectiveFrom(e.target.value)}
                    disabled={commercialGenRunning}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    A vigência será usada como referência para publicação. Nesta etapa serão geradas apenas DRAFTs para revisão.
                  </p>
                </div>
              </div>


              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Observações (opcional)</label>
                <textarea
                  className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none min-h-[72px]"
                  value={commercialGenNotes}
                  onChange={(e) => setCommercialGenNotes(e.target.value)}
                  placeholder="Detalhes para a equipe que vai revisar / publicar (opcional)."
                  disabled={commercialGenRunning}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">
                  Aprovado por (para publicação · opcional)
                </label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
                  value={commercialPublishApprovedBy}
                  onChange={(e) => setCommercialPublishApprovedBy(e.target.value)}
                  placeholder='Ex.: "Diretoria Comercial" ou nome do aprovador.'
                  disabled={publishingVersionId !== null}
                />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Este texto é registrado na versão publicada. Não tem efeito na geração de DRAFTs.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-muted-foreground">Tabelas a gerar</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Cada tabela pode ter uma comissão diferente. A comissão entra no cálculo do preço sugerido e
                  será levada para a proposta.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {COMMERCIAL_TABLE_CODES.map((code) => {
                    const table = priceTables.find((t) => t.code === code);
                    const available = !!table;
                    const checked = available && commercialGenSelectedCodes.has(code);
                    const margin = table ? Number(table.defaultMarginPct) : null;
                    const commissionValue =
                      commercialGenCommissionByCode[code] ??
                      String(getDefaultCommissionForCode(code));
                    return (
                      <div
                        key={code}
                        className={cn(
                          "flex flex-col gap-2 p-3 rounded-xl border bg-background",
                          available
                            ? "border-border"
                            : "border-dashed border-muted-foreground/30 opacity-60"
                        )}
                      >
                        <label
                          className={cn(
                            "flex items-center gap-3",
                            available ? "cursor-pointer" : "cursor-not-allowed"
                          )}
                        >
                          <input
                            type="checkbox"
                            disabled={!available || commercialGenRunning}
                            checked={checked}
                            onChange={() => available && toggleCommercialTable(code)}
                            className="rounded accent-primary w-4 h-4"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold">
                              {COMMERCIAL_TABLE_LABELS[code] ?? code}
                              <span className="ml-2 text-[10px] font-mono text-muted-foreground">({code})</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {available && margin != null && Number.isFinite(margin)
                                ? `Margem padrão: ${formatNumber(margin, 2)}%`
                                : "Tabela não encontrada ou inativa"}
                            </p>
                          </div>
                        </label>
                        <div className="flex items-center gap-2 pl-7">
                          <label className="text-[11px] font-bold uppercase text-muted-foreground shrink-0">
                            Comissão %
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={50}
                            step="0.01"
                            className="w-24 px-2 py-1.5 rounded-lg border border-border bg-background text-sm outline-none tabular-nums text-right disabled:opacity-50"
                            value={commissionValue}
                            onChange={(e) =>
                              setCommercialGenCommissionByCode((prev) => ({
                                ...prev,
                                [code]: e.target.value,
                              }))
                            }
                            disabled={!available || commercialGenRunning}
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Tabela personalizada será adicionada em uma próxima etapa.
              </div>

              {(() => {
                const availableSelectedCount = COMMERCIAL_TABLE_CODES.filter((code) =>
                  priceTables.some((t) => t.code === code) && commercialGenSelectedCodes.has(code)
                ).length;
                return (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-muted-foreground">
                      Selecionadas: <span className="font-bold text-foreground">{availableSelectedCount}</span> · serão geradas DRAFTs sequencialmente.
                    </p>
                    <button
                      type="button"
                      onClick={handleGenerateCommercialDrafts}
                      disabled={
                        !commercialGenTaxRuleId ||
                        availableSelectedCount === 0 ||
                        commercialGenRunning
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {commercialGenRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {commercialGenCurrentCode
                            ? `Gerando ${COMMERCIAL_TABLE_LABELS[commercialGenCurrentCode] ?? commercialGenCurrentCode}...`
                            : "Gerando..."}
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Gerar DRAFTs comerciais
                        </>
                      )}
                    </button>
                  </div>
                );
              })()}

              {commercialGenResults && commercialGenResults.length > 0 && (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold">Resultado da geração</h4>
                    <button
                      type="button"
                      onClick={() => setCommercialGenResults(null)}
                      disabled={commercialGenRunning}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Limpar resultados
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {commercialGenResults.map((r) => {
                      const cardBorder =
                        r.status === "ERROR"
                          ? "border-red-200 bg-red-50"
                          : r.errorsCount > 0
                            ? "border-orange-200 bg-orange-50"
                            : r.warningsCount > 0
                              ? "border-amber-200 bg-amber-50"
                              : "border-green-200 bg-green-50";
                      return (
                        <div key={r.priceTableCode} className={cn("rounded-xl border p-4 space-y-3", cardBorder)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold truncate">
                                {COMMERCIAL_TABLE_LABELS[r.priceTableCode] ?? r.priceTableName}
                                <span className="ml-2 text-[10px] font-mono text-muted-foreground">({r.priceTableCode})</span>
                              </p>
                              {r.status === "SUCCESS" && r.versionNumber != null && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Versão gerada:{" "}
                                  <span className="font-bold text-foreground">v{r.versionNumber}</span>
                                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-muted-foreground/10 text-[10px] font-bold uppercase tracking-wide">
                                    {r.versionStatus || "DRAFT"}
                                  </span>
                                </p>
                              )}
                            </div>
                            <div className="shrink-0">
                              {r.status === "ERROR" ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700">
                                  <AlertCircle className="h-4 w-4" /> Erro
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700">
                                  <CheckCircle2 className="h-4 w-4" /> Sucesso
                                </span>
                              )}
                            </div>
                          </div>

                          {r.status === "ERROR" && r.fatalErrorMessage && (
                            <p className="text-xs text-red-700">{r.fatalErrorMessage}</p>
                          )}

                          {r.status === "SUCCESS" && (
                            <>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                <div>Produtos lidos: <span className="font-bold">{r.productsRead}</span></div>
                                <div>Itens criados: <span className="font-bold">{r.itemsCreated}</span></div>
                                <div>Itens ignorados: <span className="font-bold">{r.itemsSkipped}</span></div>
                                <div>
                                  Warnings:{" "}
                                  <span className={cn("font-bold", r.warningsCount > 0 ? "text-orange-700" : "text-foreground")}>
                                    {r.warningsCount}
                                  </span>
                                </div>
                                <div className="col-span-2">
                                  Errors:{" "}
                                  <span className={cn("font-bold", r.errorsCount > 0 ? "text-red-700" : "text-foreground")}>
                                    {r.errorsCount}
                                  </span>
                                </div>
                                {r.commissionPerc != null && Number.isFinite(r.commissionPerc) && (
                                  <div className="col-span-2">
                                    Comissão:{" "}
                                    <span className="font-bold text-foreground">
                                      {formatNumber(r.commissionPerc, 2)}%
                                    </span>
                                  </div>
                                )}
                              </div>

                              {r.errorsCount > 0 && (
                                <div className="rounded-md border border-red-300 bg-red-100 p-2 space-y-1 text-[11px]">
                                  <p className="font-bold text-red-800">Existem erros de custo. Revise antes de publicar.</p>
                                  {r.errorsPreview.map((it, idx) => (
                                    <p key={idx} className="text-red-700">
                                      • <span className="font-mono">{it.sku ?? "—"}</span>
                                      {it.productName ? ` ${it.productName}` : ""}
                                      {it.code ? ` (${it.code})` : ""}
                                      {it.message ? ` — ${it.message}` : ""}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {r.warningsCount > 0 && (
                                <div className="rounded-md border border-orange-300 bg-orange-100 p-2 space-y-1 text-[11px]">
                                  <p className="font-bold text-orange-800">Existem avisos de custo parcial. Revise antes de publicar.</p>
                                  {r.warningsPreview.map((it, idx) => (
                                    <p key={idx} className="text-orange-700">
                                      • <span className="font-mono">{it.sku ?? "—"}</span>
                                      {it.productName ? ` ${it.productName}` : ""}
                                      {it.code ? ` (${it.code})` : ""}
                                      {it.message ? ` — ${it.message}` : ""}
                                    </p>
                                  ))}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
                                {r.versionStatus === "PUBLISHED" ? (
                                  r.publishedWithErrors ? (
                                    <div className="text-xs text-amber-900">
                                      <p className="font-bold inline-flex items-center gap-1">
                                        <AlertCircle className="h-3.5 w-3.5" /> Publicada com pendências
                                      </p>
                                      <p className="text-[10px] text-amber-800">
                                        Esta tabela está disponível para propostas. Produtos sem preço publicado
                                        precisarão ser tratados como preço manual.
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-green-800">
                                      <p className="font-bold inline-flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Publicada
                                      </p>
                                      <p className="text-[10px] text-green-700">
                                        Agora esta tabela poderá aparecer na Proposta Comercial.
                                      </p>
                                    </div>
                                  )
                                ) : (
                                  <div className="text-[11px] text-muted-foreground">
                                    {commercialGenEffectiveFrom.trim()
                                      ? `Vigência a partir de ${(() => {
                                          const parts = commercialGenEffectiveFrom.split("-");
                                          return parts.length === 3
                                            ? `${parts[2]}/${parts[1]}/${parts[0]}`
                                            : commercialGenEffectiveFrom;
                                        })()}.`
                                      : "Informe a vigência desejada acima para publicar."}
                                  </div>
                                )}
                                {allowPublishTables && r.versionStatus !== "PUBLISHED" && r.versionId && (
                                  <button
                                    type="button"
                                    onClick={() => void handlePublishDraftVersion(r)}
                                    disabled={
                                      publishingVersionId !== null ||
                                      commercialGenRunning ||
                                      !commercialGenEffectiveFrom.trim()
                                    }
                                    title={
                                      !commercialGenEffectiveFrom.trim()
                                        ? "Informe a vigência desejada antes de publicar."
                                        : r.errorsCount > 0
                                          ? "Publicar parcialmente (forcePublishWithErrors). Itens com erro não terão preço publicado."
                                          : r.warningsCount > 0
                                            ? "Publicar com avisos (forcePublishWithWarnings)."
                                            : "Publicar esta DRAFT."
                                    }
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                                      r.errorsCount > 0
                                        ? "bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
                                        : r.warningsCount > 0
                                          ? "bg-orange-600 text-white hover:opacity-90 disabled:opacity-50"
                                          : "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                                    )}
                                  >
                                    {publishingVersionId === r.versionId ? (
                                      <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publicando...
                                      </>
                                    ) : r.errorsCount > 0 ? (
                                      "Publicar parcialmente"
                                    ) : r.warningsCount > 0 ? (
                                      "Publicar com avisos"
                                    ) : (
                                      "Publicar DRAFT"
                                    )}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        ) : null}

        {canViewProductionCostTables ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setProductionCostOpen((v) => !v)}
            aria-expanded={productionCostOpen}
            aria-controls="pricing-production-cost-body"
            className="w-full flex items-start justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <h3 className="text-base font-bold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Custo oficial de produção (versionado)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allowGenerateTables
                  ? "Gera DRAFT revisável a partir do motor industrial (MP + HH + HM). Publicação explícita — versões publicadas são imutáveis."
                  : "Consulte tabelas publicadas, itens por versão e custo vigente por produto e data."}
              </p>
            </div>
            <ChevronRight
              className={cn(
                "h-5 w-5 text-muted-foreground transition-transform shrink-0",
                productionCostOpen && "rotate-90"
              )}
            />
          </button>

          {productionCostOpen && (
            <div id="pricing-production-cost-body" className="mt-5 space-y-5">
              {allowGenerateTables ? (
              <>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Publicado não é editado. Correção gera nova revisão por produto. Esta seção não altera preço comercial — apenas registra custo de produção vigente.
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Vigência desejada</label>
                  <input
                    type="date"
                    className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
                    value={productionCostEffectiveDate}
                    onChange={(e) => setProductionCostEffectiveDate(e.target.value)}
                    disabled={productionCostRunning}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Publicado por (opcional)</label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
                    value={productionCostPublishedBy}
                    onChange={(e) => setProductionCostPublishedBy(e.target.value)}
                    placeholder="Ex.: Engenharia de Produtos"
                    disabled={publishingProductionCostVersionId !== null}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Observações (opcional)</label>
                <textarea
                  className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none min-h-[72px]"
                  value={productionCostNotes}
                  onChange={(e) => setProductionCostNotes(e.target.value)}
                  disabled={productionCostRunning}
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-primary"
                    checked={productionCostIncludeAll}
                    onChange={(e) => setProductionCostIncludeAll(e.target.checked)}
                    disabled={productionCostRunning}
                  />
                  Todos os produtos ativos
                </label>
                {!productionCostIncludeAll && (
                  <span className="text-muted-foreground">
                    Produtos selecionados no lote:{" "}
                    <span className="font-bold text-primary">{selectedProductIds.length}</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleGenerateProductionCostDraft()}
                disabled={productionCostRunning}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {productionCostRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculando e gerando DRAFT...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Gerar DRAFT de custo com vigência
                  </>
                )}
              </button>

              {productionCostGenResult && (
                <div
                  className={cn(
                    "rounded-xl border p-4 space-y-2 text-sm",
                    productionCostGenResult.status === "ERROR"
                      ? "border-red-200 bg-red-50"
                      : "border-green-200 bg-green-50"
                  )}
                >
                  {productionCostGenResult.fatalErrorMessage ? (
                    <p className="text-red-700 text-xs">{productionCostGenResult.fatalErrorMessage}</p>
                  ) : (
                    <>
                      <p className="font-bold">
                        {productionCostGenResult.code} rev.{productionCostGenResult.revision}{" "}
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-muted-foreground/10 text-[10px] uppercase">
                          {productionCostGenResult.status}
                        </span>
                      </p>
                      <p className="text-xs">
                        Itens: {productionCostGenResult.itemsCreated}/{productionCostGenResult.productsRead} · Erros:{" "}
                        {productionCostGenResult.errorsCount} · Avisos: {productionCostGenResult.warningsCount}
                      </p>
                      {allowPublishTables &&
                        productionCostGenResult.versionId &&
                        productionCostGenResult.status === "DRAFT" && (
                          <button
                            type="button"
                            onClick={() =>
                              void handlePublishProductionCostVersion({
                                versionId: productionCostGenResult.versionId,
                                code: productionCostGenResult.code,
                                revision: productionCostGenResult.revision,
                              })
                            }
                            disabled={publishingProductionCostVersionId !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
                          >
                            {publishingProductionCostVersionId === productionCostGenResult.versionId ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publicando...
                              </>
                            ) : (
                              "Publicar revisão"
                            )}
                          </button>
                        )}
                    </>
                  )}
                </div>
              )}

              </>
              ) : null}

              <ProductionCostTablesPanel
                products={products.map((p: { id: string; sku: string; name: string }) => ({
                  id: p.id,
                  sku: p.sku,
                  name: p.name,
                }))}
                canManage={allowGenerateTables}
              />
            </div>
          )}
        </div>
        ) : null}

        {/* Toggle View Mode */}
        <div
          className="flex bg-accent/30 p-1 rounded-xl w-fit border border-border"
          data-tour="pricing-mode-toggle"
        >
          <button 
            onClick={() => setViewMode("UNIT")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              viewMode === "UNIT" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="h-4 w-4" /> Gestão Unitária
          </button>
          <button 
            onClick={() => setViewMode("BATCH")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              viewMode === "BATCH" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-4 w-4" /> Processamento em Lote
          </button>
        </div>
      </div>

      {loading && viewMode === "UNIT" ? (
        <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
      ) : viewMode === "UNIT" ? (
        // --- VIEW: UNIT ---
        <div className="space-y-6" data-tour="pricing-unit-panel">
          <div className="flex justify-end gap-2">
             {allowSimulate ? (
              <button
                onClick={() => setIsSimulatorModalOpen(true)}
                className="flex items-center gap-2 border border-border bg-card px-4 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
              >
                <Calculator className="h-4 w-4" /> Simular preço
              </button>
             ) : null}
             <button 
              onClick={() => {
                setFormData({ productId: "", taxRuleId: "", desiredMargin: 15, commission: 5, freightOut: 0, otherVariables: 0 });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" /> Nova Premissa
            </button>
          </div>

     <div className="space-y-4">
       {/* UI Header Customizado pro Lote selecionado */}
       {selectedPricings.length > 0 && (
         <div className="bg-red-50 text-red-900 border border-red-200 rounded-xl p-3 flex justify-between items-center animate-in fade-in slide-in-from-top-2">
           <span className="text-sm font-bold">{selectedPricings.length} Formação(ões) selecionada(s)</span>
           <button onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
              Excluir Selecionados
           </button>
         </div>
       )}

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por produto ou SKU..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={pricingSearchTerm}
                onChange={(e) => setPricingSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="min-w-[180px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
              value={pricingTaxRuleFilter}
              onChange={(e) => setPricingTaxRuleFilter(e.target.value)}
            >
              <option value="">Todas as regras fiscais</option>
              {taxRules.map((rule: any) => (
                <option key={rule.id} value={rule.id}>
                  {String(rule.name ?? "Regra fiscal")}
                </option>
              ))}
            </select>

            <select
              className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
              value={pricingMarginBand}
              onChange={(e) => setPricingMarginBand(e.target.value as PricingMarginBand)}
            >
              <option value="ALL">Todas as margens</option>
              <option value="NEGATIVE">Margem negativa</option>
              <option value="UP_TO_10">Margem 0% a 9,99%</option>
              <option value="FROM_10_TO_20">Margem 10% a 20%</option>
              <option value="ABOVE_20">Margem acima de 20%</option>
            </select>

            <select
              className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
              value={pricingCommissionBand}
              onChange={(e) => setPricingCommissionBand(e.target.value as PricingCommissionBand)}
            >
              <option value="ALL">Todas as comissões</option>
              <option value="ZERO">Comissão 0%</option>
              <option value="UP_TO_5">Comissão até 5%</option>
              <option value="FROM_5_TO_10">Comissão 5,01% a 10%</option>
              <option value="ABOVE_10">Comissão acima de 10%</option>
            </select>

            <select
              className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
              value={pricingSortBy}
              onChange={(e) => setPricingSortBy(e.target.value as PricingSortKey)}
            >
              <option value="NAME_ASC">Ordenar: nome</option>
              <option value="SKU_ASC">Ordenar: SKU</option>
              <option value="MARGIN_DESC">Ordenar: maior margem</option>
              <option value="MARGIN_ASC">Ordenar: menor margem</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Exibindo <span className="font-bold text-foreground">{filteredPricings.length}</span> de{" "}
              <span className="font-bold text-foreground">{pricings.length}</span> premissa(s).
            </p>
            <button
              type="button"
              onClick={clearPricingFilters}
              disabled={!hasActivePricingFilters}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
            >
              <X className="h-4 w-4" /> Limpar filtros
            </button>
          </div>
        </div>
      </div>

       {/* Tabela de Leitura */}
       <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-muted">
                 <tr>
                   <th className="p-4 w-10">
                      <input type="checkbox" className="rounded accent-primary w-4 h-4 cursor-pointer" 
                             checked={filteredPricings.length > 0 && filteredPricings.every((pricing: any) => selectedPricings.includes(pricing.id))} 
                             onChange={toggleAllPricings} />
                   </th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground w-1/4">Produto</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground">Inf. Trib</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-center">Precificação Base</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-right">Preço</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-center">Ações Lógicas</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pricings.length === 0 ? (
                  <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">Nenhuma premissa configurada.</td></tr>
                ) : filteredPricings.length === 0 ? (
                  <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">Nenhum resultado encontrado com os filtros aplicados.</td></tr>
                ) : (
                  filteredPricings.map((pricing: any) => (
                     <tr key={pricing.id} className="hover:bg-accent/20 cursor-pointer" onClick={(e) => {
                        if((e.target as HTMLElement).closest('.btn-acoes')) return;
                        togglePricingSelection(pricing.id);
                     }}>
                       <td className="p-4 text-center btn-acoes">
                         <input type="checkbox" className="rounded accent-primary w-4 h-4 cursor-pointer" 
                                checked={selectedPricings.includes(pricing.id)} 
                                onChange={() => togglePricingSelection(pricing.id)} />
                       </td>
                       <td className="p-4">
                         <p className="font-bold text-sm tracking-tight">{pricing.Product?.name ?? "—"}</p>
                         <p className="text-[10px] font-mono text-muted-foreground">SKU: {pricing.Product?.sku ?? "—"}</p>
                       </td>
                       <td className="p-4">
                         <span className="bg-primary/10 text-primary px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest">{pricing.TaxRule?.name ?? "—"}</span>
                       </td>
                       <td className="p-4 text-center">
                         <div className="flex flex-col items-center gap-1">
                           <span className="text-xs text-muted-foreground">Mg. <span className="font-bold text-green-600">{pricingListSafeNumber(pricing.desiredMargin) == null ? "—" : `${formatNumber(pricingListSafeNumber(pricing.desiredMargin) ?? 0, 2)}%`}</span></span>
                           <span className="text-xs text-muted-foreground">Comissão. <span className="font-bold text-orange-600">{pricingListSafeNumber(pricing.commission) == null ? "—" : `${formatNumber(pricingListSafeNumber(pricing.commission) ?? 0, 2)}%`}</span></span>
                         </div>
                       </td>
                       <td className="p-4 text-right">
                         {pricingListSafeNumber(pricing.suggestedPrice) == null ? (
                           <span className="text-muted-foreground">—</span>
                         ) : (
                           <span className="font-bold text-primary">
                             {formatCurrency(pricingListSafeNumber(pricing.suggestedPrice) ?? 0, 2)}
                           </span>
                         )}
                       </td>
                       <td className="p-4 btn-acoes">
                         <div className="flex gap-2 justify-center">
                           <button title="Calcular Simulação Unitária" onClick={() => handleCalculateUnit(pricing.productId, pricing.taxRuleId)} className="p-2 text-primary bg-primary/10 hover:bg-primary hover:text-white rounded-lg transition-colors"><Calculator className="h-4 w-4" /></button>
                           <button title="Editar Parametria" onClick={() => { 
                             setFormData({
                              productId: pricing.productId, taxRuleId: pricing.taxRuleId,
                              desiredMargin: Number(pricing.desiredMargin), commission: Number(pricing.commission),
                              freightOut: Number(pricing.freightOut), otherVariables: Number(pricing.otherVariables),
                             });
                             setIsModalOpen(true);
                            }} className="p-2 text-muted-foreground hover:bg-accent hover:text-primary rounded-lg transition-colors"><Edit2 className="h-4 w-4" /></button>
                           <button title="Excluir Restrito" onClick={() => handleDeleteUnit(pricing)} className="p-2 text-muted-foreground hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors"><Trash2 className="h-4 w-4" /></button>
                         </div>
                       </td>
                     </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
       </div>
     </div>
        </div>
      ) : (
        // --- VIEW: BATCH ---
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-tour="pricing-batch-panel">
          <div className="lg:col-span-2 space-y-4">
            {/* Esquerda: Seleção de Produtos ou Resultados em tabela */}

            {!batchResults ? (
              // BATCH TABELA SELEÇÃO
              <div className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col h-[600px] shadow-sm">
                <div className="p-4 border-b border-border bg-accent/20 flex gap-4 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text" placeholder="Filtrar por SKU, código ou nome..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      value={searchTermBatch} onChange={(e) => setSearchTermBatch(e.target.value)}
                    />
                  </div>
                  <div className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Selecionados: <span className="font-bold text-primary">{selectedProductIds.length}</span>{" "}
                    {selectedProductIds.length === 1 ? "item" : "itens"}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted sticky top-0 z-10 hidden sm:table-header-group">
                      <tr>
                        <th className="p-3 w-10 text-center">
                          <input 
                            type="checkbox" className="rounded accent-primary w-4 h-4"
                            checked={
                              batchFilteredProducts.length > 0 &&
                              batchFilteredProducts.every((product) =>
                                selectedProductIds.includes(product.id)
                              )
                            }
                            onChange={handleToggleSelectAll}
                          />
                        </th>
                        <th className="p-3 font-bold text-xs uppercase text-muted-foreground">SKU</th>
                        <th className="p-3 font-bold text-xs uppercase text-muted-foreground">Item</th>
                        {batchItemScope === "all" ? (
                          <th className="p-3 font-bold text-xs uppercase text-muted-foreground w-28">Tipo</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batchFilteredProducts.map((product) => (
                        <tr key={product.id} className="hover:bg-accent/20 cursor-pointer" onClick={() => {
                          setSelectedProductIds(prev => prev.includes(product.id) ? prev.filter(id => id !== product.id) : [...prev, product.id] )
                        }}>
                          <td className="p-3 text-center">
                            <input 
                              type="checkbox" className="rounded accent-primary w-4 h-4 pointer-events-none"
                              checked={selectedProductIds.includes(product.id)} readOnly
                            />
                          </td>
                          <td className="p-3 font-mono text-[10px] sm:text-xs text-muted-foreground">{product.sku}</td>
                          <td className="p-3 font-bold text-xs sm:text-sm">{product.name}</td>
                          {batchItemScope === "all" ? (
                            <td className="p-3">
                              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {pricingBatchItemTypeLabel(resolvePricingBatchItemType(product.type))}
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {batchFilteredProducts.length === 0 ? (
                        <tr>
                          <td
                            colSpan={batchItemScope === "all" ? 4 : 3}
                            className="p-8 text-center text-sm text-muted-foreground"
                          >
                            Nenhum item encontrado para o escopo e filtro atuais.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              // BATCH TABELA RESULTADOS DA SIMULAÇÃO
              <div className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col h-[600px] shadow-sm">
                <div className="p-4 border-b border-border bg-primary text-primary-foreground flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <h3 className="font-bold">Resultados da Simulação</h3>
                  </div>
                  <button 
                    onClick={() => setBatchResults(null)}
                    className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Voltar / Refazer
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted sticky top-0 z-10 hidden sm:table-header-group">
                      <tr>
                        <th className="p-3 font-bold text-[10px] uppercase text-muted-foreground">Status / SKU</th>
                        <th className="p-3 font-bold text-[10px] uppercase text-muted-foreground">Custo Ind.</th>
                        <th className="p-3 font-bold text-[10px] uppercase text-right text-muted-foreground">Preço Sugerido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batchResults.map((r, idx) => (
                        <tr key={idx} className={r.status === "ERROR" ? "bg-red-50/50" : "bg-green-50/30"}>
                          <td className="p-3">
                            {r.status === "SUCCESS" ? (
                              <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <div>
                                  <p className="font-bold text-xs text-foreground">{r.name}</p>
                                  <p className="text-[10px] opacity-80">
                                    {r.sku}
                                    {r.itemType ? ` · ${pricingBatchItemTypeLabel(r.itemType)}` : ""}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-red-600">
                                <AlertCircle className="h-4 w-4" />
                                <div>
                                  <p className="font-bold text-xs text-red-800">{r.name || r.productId}</p>
                                  <p className="text-[10px] leading-tight">
                                    {r.itemType ? `${pricingBatchItemTypeLabel(r.itemType)} · ` : ""}
                                    Erro: {r.message}
                                  </p>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-medium text-xs">
                            {r.status === "SUCCESS" ? formatCurrency(r.ciu, 5) : "-"}
                          </td>
                          <td className="p-3 font-black text-primary text-right text-base">
                            {r.status === "SUCCESS" ? formatCurrency(r.suggestedPrice, 5) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border-t border-border bg-accent/10 flex justify-end">
                   <button 
                    onClick={handleApplyBatch}
                    className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:opacity-90"
                   >
                     Gravar Lote Oficialmente
                   </button>
                </div>
              </div>
            )}
          </div>

          {/* Direita: Painel de Definições em Lote */}
          <div className="col-span-1 space-y-4">
             <div className="bg-card rounded-2xl border border-border p-6 shadow-sm flex flex-col gap-5 sticky top-6">
                <div className="border-b border-border pb-4">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-primary" /> Parâmetros em Lote
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Esses parâmetros serão injetados simultaneamente.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Simular</label>
                    <div className="grid grid-cols-1 gap-2">
                      {PRICING_BATCH_ITEM_SCOPE_OPTIONS.map((option) => {
                        const active = batchItemScope === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            data-testid={`pricing-batch-scope-${option.value}`}
                            onClick={() => handleBatchItemScopeChange(option.value)}
                            className={cn(
                              "rounded-xl border px-3 py-2.5 text-left transition-colors",
                              active
                                ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                                : "border-border bg-background hover:bg-accent/40"
                            )}
                          >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{option.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">Canal Fiscal</label>
                    <SearchableSelect
                      placeholder="Selecione a Regra..."
                      options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                        value: r.id,
                        label: r.name,
                        sublabel: r.description?.trim() || undefined,
                        searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                      }))}
                      value={batchFormData.taxRuleId}
                      onChange={(val) => setBatchFormData({...batchFormData, taxRuleId: val})}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Margem Líquida %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.desiredMargin} onChange={(e) => setBatchFormData({...batchFormData, desiredMargin: parseFloat(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Comissão %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.commission} onChange={(e) => setBatchFormData({...batchFormData, commission: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Frete Fixo (R$)</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.freightOut} onChange={(e) => setBatchFormData({...batchFormData, freightOut: parseFloat(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Outros Var %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.otherVariables} onChange={(e) => setBatchFormData({...batchFormData, otherVariables: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>
                </div>

                {!batchResults && (
                  <button 
                    onClick={handleSimulateBatch}
                    disabled={simulatingBatch}
                    className="w-full mt-2 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {simulatingBatch ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />} 
                    Simular {selectedProductIds.length > 0 ? selectedProductIds.length : ""} {selectedProductIds.length === 1 ? "Item" : "Itens"}
                  </button>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Modal Simulador de Preço (portal + np-report-printing para PDF limpo) */}
      {isSimulatorModalOpen &&
        createPortal(
          <div
            id="pricing-simulator-print-portal"
            className="new-product-report-print-shell fixed inset-0 z-[100] flex items-center justify-center p-4 pt-16 sm:pt-8"
          >
            <button
              type="button"
              aria-label="Fechar simulador"
              className="absolute inset-0 bg-black/50 reports-no-print"
              onClick={() => setIsSimulatorModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="new-product-report-print-panel relative flex w-full max-w-6xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-accent/30 p-6 reports-no-print">
                <div>
                  <h3 className="text-lg font-bold">Calculadora de Preço de Venda</h3>
                  <p className="text-xs text-muted-foreground">Simulação sem gravação de dados, usando o mesmo motor de cálculo.</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {simulatorResult ? (
                    <button
                      type="button"
                      onClick={() => setTimeout(() => window.print(), 150)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent transition-colors"
                    >
                      <Printer className="h-4 w-4" />
                      Imprimir resultado
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setIsSimulatorModalOpen(false)}
                    className="rounded-full p-2 transition-colors hover:bg-accent"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
                <div className="reports-no-print space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Produto/Componente</label>
                      <SearchableSelect
                        placeholder="Buscar por SKU ou nome..."
                        options={products.map((p: { id: string; sku: string; name: string; type?: string }) => ({
                          value: p.id,
                          label: `${p.sku} — ${p.name}`,
                          sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                          searchTerms: `${p.sku} ${p.name} ${p.type ?? ""}`,
                        }))}
                        value={simulatorForm.productId}
                        onChange={(value) => setSimulatorForm((prev) => ({ ...prev, productId: value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Regra fiscal</label>
                      <SearchableSelect
                        placeholder="Selecione..."
                        options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                          value: r.id,
                          label: r.name,
                          sublabel: r.description?.trim() || undefined,
                          searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                        }))}
                        value={simulatorForm.taxRuleId}
                        onChange={(value) => setSimulatorForm((prev) => ({ ...prev, taxRuleId: value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Margem desejada (%)</label>
                      <input
                        type="number"
                        step="0.00001"
                        min={0}
                        value={simulatorForm.desiredMargin}
                        onChange={(e) => setSimulatorForm((prev) => ({ ...prev, desiredMargin: Number(e.target.value) }))}
                        className="w-full rounded-xl border border-border bg-background p-3 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-accent/20 p-3">
                    <p className="text-sm text-muted-foreground">
                      Custo para produzir:{" "}
                      <span className="font-bold text-foreground">
                        {simulatorCostLoading ? "Carregando..." : simulatorCost == null ? "—" : formatCurrency(simulatorCost, 6)}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={handleRunSimulator}
                      disabled={simulatorRunning}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {simulatorRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                      Calcular simulação
                    </button>
                  </div>
                  {simulatorError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{simulatorError}</div>
                  ) : null}
                </div>
                {simulatorResult ? (
                  <div id="pricing-simulator-print-root" className="space-y-4 print:bg-white">
                    <div className="mb-4 hidden space-y-1 border-b border-black/20 pb-3 text-sm text-black print:block">
                      <p className="text-lg font-bold">Simulação de formação de preço</p>
                      <p>
                        <span className="font-semibold">Produto:</span> {simulatorProductLabel}
                      </p>
                      <p>
                        <span className="font-semibold">Regra fiscal:</span> {simulatorTaxLabel}
                      </p>
                      <p>
                        <span className="font-semibold">Margem informada (%):</span> {formatNumber(Number(simulatorForm.desiredMargin), 5)}
                      </p>
                      <p>
                        <span className="font-semibold">Custo para produzir (referência):</span>{" "}
                        {simulatorCost == null ? "—" : formatCurrency(simulatorCost, 6)}
                      </p>
                      <p className="pt-1 text-xs text-neutral-600">Emitido em {new Date().toLocaleString("pt-BR")}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div className="rounded-xl border border-border bg-card/40 p-4">
                        <p className="text-xs font-bold uppercase text-muted-foreground">Custo para produzir</p>
                        <p className="text-base font-bold">{formatCurrency(Number(simulatorResult.ciu ?? 0), 6)}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card/40 p-4">
                        <p className="text-xs font-bold uppercase text-muted-foreground">Impostos sobre venda</p>
                        <p className="text-base font-bold">{formatNumber(Number(simulatorResult.premissas?.taxRate ?? 0), 2)}%</p>
                        <p className="text-xs text-muted-foreground">{formatCurrency(Number(simulatorResult.resultados?.totalTaxes ?? 0), 6)}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card/40 p-4">
                        <p className="text-xs font-bold uppercase text-muted-foreground">Margem desejada</p>
                        <p className="text-base font-bold">{formatNumber(Number(simulatorResult.premissas?.marginRate ?? 0), 2)}%</p>
                      </div>
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                        <p className="text-xs font-bold uppercase text-primary">Preço sugerido</p>
                        <p className="text-lg font-black text-primary">
                          {formatCurrency(Number(simulatorResult.resultados?.suggestedPrice ?? 0), 6)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card/30 p-4">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-border">
                          <tr>
                            <td className="py-2 text-muted-foreground">Custo base de produção</td>
                            <td className="py-2 text-right font-semibold">{formatCurrency(Number(simulatorResult.ciu ?? 0), 6)}</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground">Percentual de impostos</td>
                            <td className="py-2 text-right font-semibold">{formatNumber(Number(simulatorResult.premissas?.taxRate ?? 0), 2)}%</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground">Valor dos impostos embutidos</td>
                            <td className="py-2 text-right font-semibold">{formatCurrency(Number(simulatorResult.resultados?.totalTaxes ?? 0), 6)}</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground">Percentual de margem</td>
                            <td className="py-2 text-right font-semibold">{formatNumber(Number(simulatorResult.premissas?.marginRate ?? 0), 2)}%</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground">Valor da margem planejada</td>
                            <td className="py-2 text-right font-semibold">{formatCurrency(Number(simulatorResult.resultados?.contributionMargin ?? 0), 6)}</td>
                          </tr>
                          <tr>
                            <td className="py-2 font-bold text-muted-foreground">Preço sugerido final</td>
                            <td className="py-2 text-right font-black text-primary">{formatCurrency(Number(simulatorResult.resultados?.suggestedPrice ?? 0), 6)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <PricingDetailedCompositionTab breakdown={simulatorResult.pricingBreakdown} />
                  </div>
                ) : null}
              </div>
            </motion.div>
          </div>,
          document.body
        )}

      {/* Modal Result Unitario - MANTIDO INTACTO DA ARQUITETURA ORIGINAL */}
      <AnimatePresence>
        {calculationResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
               className="bg-card w-full max-w-5xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
             >
                <div className="p-6 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
                  <div>
                    <h3 className="text-xl font-bold">Resultado da Formação de Preço</h3>
                    <p className="text-xs opacity-80">{calculationResult.product} • SKU: {calculationResult.sku}</p>
                  </div>
                  <button onClick={() => setCalculationResult(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="px-4 pt-3 border-b border-border bg-gradient-to-b from-accent/40 to-accent/10">
                  <div className="flex items-end gap-1 overflow-x-auto -mb-px">
                    {[
                      { id: "summary" as const, label: "Resumo da Formação", icon: BarChart3 },
                      { id: "composition" as const, label: "Composição do Preço", icon: BookOpen },
                      { id: "detailed" as const, label: "Composição Detalhada do Preço", icon: Layers },
                    ].map((tab) => {
                      const isActive = resultTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setResultTab(tab.id)}
                          className={cn(
                            "inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg border border-transparent border-b-0 whitespace-nowrap transition-all",
                            isActive
                              ? "bg-card border-border text-foreground -mb-px"
                              : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                          )}
                        >
                          <tab.icon className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "opacity-80")} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  {resultTab === "summary" && (
                    <>
                      <div className="relative p-8 rounded-3xl bg-primary/5 border-2 border-primary/20 flex flex-col items-center text-center overflow-hidden">
                     <div className="absolute top-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-black uppercase">
                       Preço Sugerido
                     </div>
                     <p className="text-5xl font-black text-primary mb-2">
                       {formatCurrency(calculationResult.resultados.suggestedPrice, 5)}
                     </p>
                     <div className="flex items-center gap-4 text-sm font-bold text-muted-foreground">
                       <span className="flex items-center gap-1">
                         <TrendingUp className="h-4 w-4 text-green-500" /> Markup: {formatNumber(calculationResult.resultados.markup)}x
                       </span>
                       <span className="h-4 w-px bg-border" />
                       <span className="flex items-center gap-1">
                         <ShieldCheck className="h-4 w-4 text-blue-500" /> Margem: {formatNumber(calculationResult.premissas.marginRate, 2)}%
                       </span>
                     </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                       <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                         <BarChart3 className="h-3 w-3" /> Estrutura de Custos
                       </h4>
                       <div className="space-y-3">
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Industrial (CIU)</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.ciu, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Fabril Completo</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.custoFabril, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Gerencial Total</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.custoGerencial, 5)}</span>
                         </div>
                       </div>
                     </div>

                     <div className="space-y-4">
                       <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                         <TrendingDown className="h-3 w-3" /> Deduções sobre Venda
                       </h4>
                       <div className="space-y-3">
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Impostos ({calculationResult.premissas.taxRate}%)</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalTaxes, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Comissão ({calculationResult.premissas.commRate}%)</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalCommission, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Frete Saída</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.premissas.freight, 5)}</span>
                         </div>
                         {calculationResult.pricingBreakdown?.deductions?.otherVariables != null && (
                           <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                             <span className="text-xs font-medium">
                               Outras variáveis (
                               {formatNumber(
                                 calculationResult.pricingBreakdown.deductions.otherVariables.percentageOnSale ?? 0,
                                 2
                               )}
                               %)
                             </span>
                             <span className="text-sm font-bold">
                               -
                               {formatCurrency(
                                 calculationResult.pricingBreakdown.deductions.otherVariables.amountOnSale ?? 0,
                                 5
                               )}
                             </span>
                           </div>
                         )}
                       </div>
                     </div>
                   </div>

                      <div className="p-6 rounded-2xl bg-accent/30 border border-border space-y-4">
                     <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Rentabilidade</h4>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       <div className="p-4 rounded-xl bg-white border border-border">
                         <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">M. Contribuição</p>
                         <p className="text-xl font-black text-primary">{formatCurrency(calculationResult.resultados.contributionMargin, 5)}</p>
                       </div>
                       <div className="p-4 rounded-xl bg-white border border-border">
                         <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">M. Operacional</p>
                         <p className="text-xl font-black text-green-600">{formatCurrency(calculationResult.resultados.operationalMargin, 5)}</p>
                       </div>
                     </div>
                      </div>
                    </>
                  )}

                  {resultTab === "composition" && (
                    <PricingOpenBookTab
                      openBook={(calculationResult.openBook as PricingOpenBookPayload | undefined) ?? null}
                      premissas={{
                        taxRate: Number(calculationResult.premissas?.taxRate ?? 0),
                        commRate: Number(calculationResult.premissas?.commRate ?? 0),
                        marginRate: Number(calculationResult.premissas?.marginRate ?? 0),
                        freight: Number(calculationResult.premissas?.freight ?? 0),
                      }}
                    />
                  )}

                  {resultTab === "detailed" && (
                    <PricingDetailedCompositionTab breakdown={calculationResult.pricingBreakdown} />
                  )}
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Criar Unitario */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
               className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden"
             >
                <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Calculator className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Premissas Comerciais (Unitária)</h3>
                      <p className="text-xs text-muted-foreground">Criação individual de premissa para 1 produto.</p>
                    </div>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors"><X className="h-5 w-5" /></button>
                </div>
                
                <form onSubmit={handleSubmitUnit} className="p-6 space-y-5">
                   <div className="space-y-1.5">
                     <label className="text-xs font-bold text-muted-foreground uppercase">Produto Alvo</label>
                     <SearchableSelect
                       placeholder="Selecione o produto..."
                       options={products.map((p: { id: string; sku: string; name: string; type?: string }) => ({
                         value: p.id,
                         label: `${p.sku} — ${p.name}`,
                         sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                         searchTerms: `${p.sku} ${p.name}`,
                       }))}
                       value={formData.productId}
                       onChange={(val) => setFormData({...formData, productId: val})}
                     />
                   </div>
                   <div className="space-y-1.5">
                     <label className="text-xs font-bold text-muted-foreground uppercase">Regra Fiscal</label>
                     <SearchableSelect
                       placeholder="Selecione a regra..."
                       options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                         value: r.id,
                         label: r.name,
                         sublabel: r.description?.trim() || undefined,
                         searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                       }))}
                       value={formData.taxRuleId}
                       onChange={(val) => setFormData({...formData, taxRuleId: val})}
                     />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Percent className="h-3 w-3" /> Margem Liq %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.desiredMargin} onChange={(e) => setFormData({...formData, desiredMargin: parseFloat(e.target.value)})} />
                     </div>
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Users className="h-3 w-3" /> Comissão %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.commission} onChange={(e) => setFormData({...formData, commission: parseFloat(e.target.value)})} />
                     </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Truck className="h-3 w-3" /> Frete Fixo R$</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.freightOut} onChange={(e) => setFormData({...formData, freightOut: parseFloat(e.target.value)})} />
                     </div>
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Percent className="h-3 w-3" /> Outros Var %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.otherVariables} onChange={(e) => setFormData({...formData, otherVariables: parseFloat(e.target.value)})} />
                     </div>
                   </div>
                   <div className="pt-4 flex gap-3">
                     <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-xl font-bold bg-accent hover:opacity-80">Cancelar</button>
                     <button type="submit" className="flex-1 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90">Salvar Premissa</button>
                   </div>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PRICING_TOUR_STEPS}
        tourName="Tour de Precificação"
      />
    </div>
  );
};
