import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  Loader2,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  ExternalLink,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { Material } from "@/src/types/material";
import {
  CostCenterRow,
  PurchaseItemDraft,
  PurchasePriority,
  PurchaseRequestRow,
  PurchaseRequestStatus,
  emptyPurchaseItemDraft,
  PurchaseRequestQuoteRow,
  PurchaseRequestEmittedOrderRow,
} from "@/src/types/purchase";
import { SearchableSelect, SelectOption } from "@/src/components/shared/SearchableSelect";
import { AppAlert } from "@/src/components/shared/AppAlert";
import {
  OverlayBadge,
  OverlayField,
  OverlayFieldGrid,
  OverlaySection,
  OverlayTextarea,
  OVERLAY_CONTROL_CLASS,
  type OverlayBadgeTone,
} from "@/src/components/ui/overlay";
import {
  OVERLAY_EYEBROW,
  OVERLAY_LABEL_DENSE,
  OVERLAY_TABLE_HEAD,
} from "@/src/lib/overlay/overlayTypography";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PURCHASE_TOUR_STEPS } from "@/src/tours/purchaseTourSteps";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { PRINT_COMPANY_DOC_FALLBACK, resolvePrintLogoSrc } from "@/src/lib/printBranding";
import { motion } from "motion/react";
import { filterPurchaseRequests } from "@/src/lib/operationalListFilters";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { resolvePurchaseRequestGuidance } from "@/src/lib/purchasing/purchaseChainGuidance";

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando gestor",
  ABERTA: "Aguardando comprador",
  REJEITADA: "Rejeitada",
  EM_COTACAO: "Em orçamentação",
  CANCELADA: "Cancelada",
  ENCERRADA: "Pedido emitido",
};

/**
 * Tom por significado, mesma doutrina do Pedido de Compra (`purchaseOrderUi`):
 * âmbar = espera alguém agir, sky = em trânsito, violet = orçamentação,
 * emerald = deu certo, rose = morreu, slate = nem começou.
 */
const STATUS_TONE: Record<PurchaseRequestStatus, OverlayBadgeTone> = {
  RASCUNHO: "slate",
  AGUARDANDO_APROVACAO: "amber",
  ABERTA: "sky",
  REJEITADA: "amber",
  EM_COTACAO: "violet",
  CANCELADA: "rose",
  ENCERRADA: "emerald",
};

const PRIORITY_LABEL: Record<PurchasePriority, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

/** Prioridade só merece cor quando exige reação — o resto é ruído. */
const PRIORITY_TONE: Record<PurchasePriority, OverlayBadgeTone> = {
  BAIXA: "slate",
  NORMAL: "slate",
  ALTA: "amber",
  URGENTE: "rose",
};

const LINE_TYPE_LABEL = {
  MATERIA_PRIMA: "Matéria-prima",
  INDIRETO: "Indireto / insumo / uso geral",
} as const;

/** Rótulo curto para tabela/chip, onde o texto longo do tipo não cabe. */
const LINE_TYPE_SHORT = {
  MATERIA_PRIMA: "MP",
  INDIRETO: "Indireto",
} as const;

/** Numeração de linha do documento (00010, 00020, …) — igual à do PDF do pedido. */
function itemLineCode(index: number): string {
  return String((index + 1) * 10).padStart(5, "0");
}

/**
 * Campo somente-leitura no padrão do repositório (dl/dt/dd), como no Pedido de
 * Compra. Existe porque campo travado renderizado como `<input disabled>` custa
 * três vezes mais altura e ainda sugere que dá para editar.
 */
function Term({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: 2 | 4;
}) {
  const empty = value == null || value === "";
  return (
    <div
      className={cn(
        "min-w-0",
        span === 2 && "sm:col-span-2",
        span === 4 && "sm:col-span-2 lg:col-span-4"
      )}
    >
      <dt className={OVERLAY_LABEL_DENSE}>{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

/** Par rótulo/valor da faixa densa de contexto do material. */
function MaterialFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-xs font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Contexto do material vinculado, em faixa densa.
 *
 * Antes eram onze campos de custo empilhados em duas colunas dentro de cada
 * item — a maior fonte de altura da tela. Quem escreve uma solicitação decide
 * com unidade, categoria, custo de referência e fornecedor; custo médio,
 * padrão, frete, fator e perda são detalhe de custeio e ficam a um clique,
 * sem sair da tela e sem sumir do sistema.
 */
function MaterialMpSummaryCard({ material: m, readOnly: ro }: { material: Material; readOnly: boolean }) {
  const [showCosts, setShowCosts] = useState(false);
  const cat = m.category.replace(/_/g, " ");
  const active = m.status === "ACTIVE";
  return (
    <div
      className={cn(
        "rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 space-y-2",
        ro && "opacity-95"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-semibold text-primary">{m.code}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={m.description}>
          {m.description}
        </span>
        {active ? null : (
          <OverlayBadge tone="amber">Inativo no cadastro</OverlayBadge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
        <MaterialFact label="Unidade" value={m.unit} />
        <MaterialFact label="Categoria" value={cat} />
        <MaterialFact label="Custo atual" value={formatCurrency(m.currentCost)} />
        <MaterialFact label="Fornecedor" value={m.supplier || "—"} />
      </dl>

      {showCosts ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-primary/20 pt-2 sm:grid-cols-4">
          <MaterialFact label="Custo médio" value={formatCurrency(m.averageCost)} />
          <MaterialFact label="Custo padrão" value={formatCurrency(m.standardCost)} />
          <MaterialFact label="Frete (cadastro)" value={formatCurrency(m.freight ?? 0)} />
          <MaterialFact label="Fator de conversão" value={formatNumber(m.conversionFactor ?? 1, 4)} />
          <MaterialFact label="Perda padrão" value={`${formatNumber(m.standardLoss ?? 0, 2)}%`} />
          {m.calculations ? (
            <>
              <MaterialFact
                label="Posto fábrica (ref.)"
                value={formatCurrency(m.calculations.landedCost)}
              />
              <MaterialFact
                label="Efetivo c/ perda (ref.)"
                value={formatCurrency(m.calculations.effectiveCost)}
              />
            </>
          ) : null}
          <p className="col-span-2 text-[10px] leading-snug text-muted-foreground sm:col-span-4">
            Valores vêm do cadastro de materiais. Esta solicitação <strong>não altera</strong> custos
            nem precificação.
          </p>
        </dl>
      ) : null}

      <button
        type="button"
        onClick={() => setShowCosts((v) => !v)}
        aria-expanded={showCosts}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        {showCosts ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showCosts ? "Ocultar custos do cadastro" : "Custos do cadastro"}
      </button>
    </div>
  );
}

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/**
 * `YYYY-MM-DD` → `DD/MM/AAAA` sem passar por `Date`: a data desejada não tem
 * hora, e converter meia-noite UTC em horário de Brasília adiantaria o dia.
 */
function formatIsoDate(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : value;
}

function itemFromApi(row: PurchaseRequestRow["items"][0]): PurchaseItemDraft {
  const q = typeof row.quantity === "string" ? parseFloat(row.quantity) : Number(row.quantity);
  const mo = row.minOrderQtySuggested;
  let minOrderStr = "";
  if (mo != null && String(mo).trim() !== "") {
    const n = typeof mo === "string" ? parseFloat(mo) : Number(mo);
    if (Number.isFinite(n) && n > 0) minOrderStr = String(n);
  }
  return {
    tempId: row.id,
    lineType: row.lineType,
    materialId: row.materialId || "",
    description: row.description,
    quantity: Number.isFinite(q) ? q : 1,
    unit: row.unit,
    costCenterId: row.costCenterId || "",
    financialCostCenterId: row.financialCostCenterId || "",
    desiredDate: row.desiredDate ? row.desiredDate.slice(0, 10) : "",
    priority: row.priority || "",
    notes: row.notes || "",
    suggestedSupplier: row.suggestedSupplier || "",
    supplierReference: row.supplierReference || "",
    packagingPresentation: row.packagingPresentation || "",
    minOrderQtySuggested: minOrderStr,
    lineStatus: row.lineStatus,
  };
}

export const PurchaseModule = () => {
  const auth = useAuth();
  const permissions = usePermissions();
  const allowCreate =
    auth.hasPermission("purchases.create") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.create);
  const allowEdit =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowDelete =
    auth.hasPermission("purchases.delete") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.delete);
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit" | "view">("create");
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [requester, setRequester] = useState("");
  const [department, setDepartment] = useState("");
  const [requestCategory, setRequestCategory] = useState("");
  // Seleções OFICIAIS — o texto acima vira snapshot derivado no servidor.
  const [requesterEmployeeId, setRequesterEmployeeId] = useState("");
  const [requestCategoryId, setRequestCategoryId] = useState("");
  const [defaultFinancialCostCenterId, setDefaultFinancialCostCenterId] = useState("");
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; department: string }>>([]);
  const [financialCcs, setFinancialCcs] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [requestCategories, setRequestCategories] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [priority, setPriority] = useState<PurchasePriority>("NORMAL");
  const [status, setStatus] = useState<PurchaseRequestStatus>("RASCUNHO");
  const [justification, setJustification] = useState("");
  const [defaultCostCenterId, setDefaultCostCenterId] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [projectOptions, setProjectOptions] = useState<SelectOption[]>([]);
  const [historyEvents, setHistoryEvents] = useState<
    import("@/src/types/purchase").PurchaseRequestHistoryEventRow[]
  >([]);
  const [evidences, setEvidences] = useState<import("@/src/types/purchase").PurchaseEvidenceRow[]>([]);
  const [linkedQuotations, setLinkedQuotations] = useState<
    Array<{ id: string; code: string; status: string }>
  >([]);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [quotes, setQuotes] = useState<PurchaseRequestQuoteRow[]>([]);
  const [emittedOrder, setEmittedOrder] = useState<PurchaseRequestEmittedOrderRow | null>(null);
  const [buyerNameView, setBuyerNameView] = useState<string | null>(null);
  const [supplierOptions, setSupplierOptions] = useState<SelectOption[]>([]);
  const [quoteSupplierId, setQuoteSupplierId] = useState("");
  const [quoteTotal, setQuoteTotal] = useState("");
  const [quotePaymentTerms, setQuotePaymentTerms] = useState("");
  const [quoteDeliveryDays, setQuoteDeliveryDays] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [items, setItems] = useState<PurchaseItemDraft[]>([]);
  const [expandedItemIds, setExpandedItemIds] = useState<Record<string, boolean>>({});
  const [requestNumber, setRequestNumber] = useState<number | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  const [ccModalOpen, setCcModalOpen] = useState(false);
  const [ccCode, setCcCode] = useState("");
  const [ccName, setCcName] = useState("");
  const [ccDescription, setCcDescription] = useState("");
  const [ccSaving, setCcSaving] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const [listSearch, setListSearch] = useState("");
  const [listStatus, setListStatus] = useState<"" | PurchaseRequestStatus>("");
  const [listPriority, setListPriority] = useState<"" | PurchasePriority>("");
  const [listCostCenterId, setListCostCenterId] = useState("");

  const readOnly = formMode === "view";
  const contentLocked = status !== "RASCUNHO" && status !== "REJEITADA";
  const fieldsDisabled = readOnly || (formMode === "edit" && contentLocked);

  /**
   * Campo travado é dado, não formulário: nesse estado a tela vira documento
   * (dl/dt/dd + tabela de itens) em vez de uma pilha de inputs cinza.
   */
  const documentMode = fieldsDisabled;

  /** Espelha as condições dos botões de workflow, para não desenhar barra vazia. */
  const hasWorkflowActions =
    (status === "RASCUNHO" && allowCreate) ||
    (allowEdit &&
      ["ABERTA", "EM_COTACAO", "AGUARDANDO_APROVACAO", "REJEITADA"].includes(status)) ||
    (allowEdit && status !== "CANCELADA" && status !== "ENCERRADA");

  /** Inclui materiais inativos já vinculados à linha para o seletor não ficar “órfão” na edição */
  const mpSelectableMaterials = useMemo(() => {
    const linked = new Set(
      items.filter((i) => i.lineType === "MATERIA_PRIMA" && i.materialId).map((i) => i.materialId)
    );
    return materials.filter((m) => m.status === "ACTIVE" || linked.has(m.id));
  }, [materials, items]);

  const materialOptionsMp: SelectOption[] = useMemo(
    () =>
      mpSelectableMaterials.map((m) => ({
        value: m.id,
        label: `${m.code} — ${m.description}`,
        sublabel: `${m.category.replace(/_/g, " ")} · ${m.unit}`,
        searchTerms: `${m.code} ${m.description} ${m.unit} ${m.category} ${m.supplier ?? ""}`,
      })),
    [mpSelectableMaterials]
  );

  const costCenterOptions: SelectOption[] = useMemo(() => {
    const rows = [...costCenters].sort((a, b) => a.code.localeCompare(b.code));
    return rows.map((c) => ({
      value: c.id,
      label: `${c.code} — ${c.name}`,
      sublabel: c.isActive ? undefined : "Inativo",
      searchTerms: `${c.code} ${c.name}`,
    }));
  }, [costCenters]);

  const headerCc = useMemo(
    () => financialCcs.find((c) => c.id === defaultFinancialCostCenterId),
    [financialCcs, defaultFinancialCostCenterId]
  );

  const employeeOptions: SelectOption[] = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: e.name,
        sublabel: e.department,
        searchTerms: `${e.name} ${e.department}`,
      })),
    [employees]
  );

  const financialCcOptions: SelectOption[] = useMemo(
    () =>
      financialCcs.map((c) => ({
        value: c.id,
        label: `${c.code} — ${c.name}`,
        searchTerms: `${c.code} ${c.name}`,
      })),
    [financialCcs]
  );

  /** Selecionar o funcionário preenche solicitante e setor — sem digitação. */
  const handleRequesterSelect = (employeeId: string) => {
    setRequesterEmployeeId(employeeId);
    const emp = employees.find((e) => e.id === employeeId);
    setRequester(emp?.name ?? "");
    setDepartment(emp?.department ?? "");
  };

  const refreshMaterials = useCallback(async () => {
    try {
      const mats = await fetchJsonOk<Material[]>("/api/materials");
      setMaterials(Array.isArray(mats) ? mats : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao atualizar lista de materiais.");
    }
  }, []);

  const loadLists = useCallback(async () => {
    setLoadingList(true);
    try {
      const [reqs, mats, ccs, projectsRes, employeesRes, fccRes, categoriesRes] = await Promise.all([
        fetchJsonOk<PurchaseRequestRow[]>("/api/purchase-requests"),
        fetchJsonOk<Material[]>("/api/materials"),
        fetchJsonOk<CostCenterRow[]>("/api/cost-centers"),
        fetchJsonOk<{ rows?: Array<{ id: string; code: string; title: string }> }>(
          "/api/purchase-requests/official-refs/projects"
        ).catch(() => ({ rows: [] })),
        fetchJsonOk<{ rows?: Array<{ id: string; name: string; department: string }> }>(
          "/api/purchase-requests/official-refs/employees"
        ).catch(() => ({ rows: [] })),
        fetchJsonOk<{ rows?: Array<{ id: string; code: string; name: string }> }>(
          "/api/purchase-requests/official-refs/financial-cost-centers"
        ).catch(() => ({ rows: [] })),
        fetchJsonOk<{ rows?: Array<{ id: string; code: string; name: string }> }>(
          "/api/purchase-requests/official-refs/request-categories"
        ).catch(() => ({ rows: [] })),
      ]);
      setRequests(Array.isArray(reqs) ? reqs : []);
      setMaterials(Array.isArray(mats) ? mats : []);
      setCostCenters(Array.isArray(ccs) ? ccs : []);
      setProjectOptions(
        (projectsRes.rows ?? []).map((p) => ({
          value: p.id,
          label: `${p.code} — ${p.title}`,
          searchTerms: `${p.code} ${p.title}`,
        }))
      );
      setEmployees(employeesRes.rows ?? []);
      setFinancialCcs(fccRes.rows ?? []);
      setRequestCategories(categoriesRes.rows ?? []);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro ao carregar dados de compras.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    fetchJsonOk<{ rows?: Array<{ id: string; displayName: string; document: string | null }> }>(
      "/api/purchase-requests/official-refs/suppliers"
    )
      .then((res) =>
        setSupplierOptions(
          (res.rows ?? []).map((f) => ({
            value: f.id,
            label: f.displayName,
            sublabel: f.document ?? undefined,
            searchTerms: `${f.displayName} ${f.document ?? ""}`,
          }))
        )
      )
      .catch(() => setSupplierOptions([]));
  }, []);

  const resetForm = () => {
    setQuotes([]);
    setEmittedOrder(null);
    setBuyerNameView(null);
    setQuoteSupplierId("");
    setQuoteTotal("");
    setQuotePaymentTerms("");
    setQuoteDeliveryDays("");
    setQuoteNotes("");
    setRequester("");
    setDepartment("");
    setRequestCategory("");
    setPriority("NORMAL");
    setStatus("RASCUNHO");
    setJustification("");
    setDefaultCostCenterId("");
    setRequesterEmployeeId("");
    setRequestCategoryId("");
    setDefaultFinancialCostCenterId("");
    setNotes("");
    setProjectId("");
    setExternalReference("");
    setHistoryEvents([]);
    setEvidences([]);
    setLinkedQuotations([]);
    setItems([]);
    setEditingId(null);
    setRequestNumber(null);
    setCreatedAt(null);
  };

  const openCreate = () => {
    resetForm();
    setItems([emptyPurchaseItemDraft()]);
    setFormMode("create");
    setView("form");
  };

  const openEdit = async (id: string, mode: "edit" | "view") => {
    setLoadingForm(true);
    setFormMode(mode);
    setView("form");
    try {
      const row = await fetchJsonOk<PurchaseRequestRow>(`/api/purchase-requests/${id}`);
      setEditingId(row.id);
      setRequestNumber(row.number);
      setCreatedAt(row.createdAt);
      setRequester(row.requester);
      setDepartment(row.department);
      setRequestCategory(row.requestCategory || "");
      setRequesterEmployeeId(row.requesterEmployeeId || "");
      setRequestCategoryId(row.requestCategoryId || "");
      // Linha legada sem FK: tenta casar pelo code do CC espelhado.
      setDefaultFinancialCostCenterId(
        row.defaultFinancialCostCenterId ||
          financialCcs.find((f) => f.code === row.defaultCostCenter?.code)?.id ||
          ""
      );
      setPriority(row.priority);
      setStatus(row.status);
      setJustification(row.justification);
      setDefaultCostCenterId(row.defaultCostCenterId);
      setNotes(row.notes || "");
      setProjectId(row.projectId || "");
      setExternalReference(row.externalReference || "");
      setHistoryEvents(Array.isArray(row.historyEvents) ? row.historyEvents : []);
      setLinkedQuotations(Array.isArray(row.quotations) ? row.quotations : []);
      setQuotes(Array.isArray(row.quotes) ? row.quotes : []);
      setEmittedOrder(row.purchaseOrders?.[0] ?? null);
      setBuyerNameView(row.buyerName ?? null);
      setItems(row.items.length ? row.items.map(itemFromApi) : [emptyPurchaseItemDraft()]);
      try {
        const ev = await fetchJsonOk<{ rows?: import("@/src/types/purchase").PurchaseEvidenceRow[] }>(
          `/api/purchase-requests/${id}/evidences`
        );
        setEvidences(Array.isArray(ev.rows) ? ev.rows : []);
      } catch {
        setEvidences([]);
      }
      setMaterials((prev) => {
        const ids = new Set(prev.map((x) => x.id));
        const add: Material[] = [];
        for (const line of row.items) {
          if (line.material && !ids.has(line.material.id)) {
            add.push(line.material as Material);
            ids.add(line.material.id);
          }
        }
        return add.length ? [...prev, ...add] : prev;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao abrir solicitação.");
      setView("list");
    } finally {
      setLoadingForm(false);
    }
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyPurchaseItemDraft()]);
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((i) => i.tempId !== tempId)));
  };

  const toggleItemDetails = (tempId: string) => {
    setExpandedItemIds((prev) => ({ ...prev, [tempId]: !prev[tempId] }));
  };

  const updateItem = (tempId: string, patch: Partial<PurchaseItemDraft>) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.tempId !== tempId) return i;
        const next = { ...i, ...patch };
        if (patch.lineType === "INDIRETO") {
          next.materialId = "";
          next.supplierReference = "";
          next.packagingPresentation = "";
          next.minOrderQtySuggested = "";
        }
        if (patch.materialId != null && next.lineType === "MATERIA_PRIMA") {
          const m = materials.find((x) => x.id === patch.materialId);
          if (m) {
            next.description = m.description;
            next.unit = m.unit;
          }
        }
        return next;
      })
    );
  };

  const buildPayload = () => {
    const body = {
      requester,
      department,
      requestCategory: requestCategory.trim() || null,
      requesterEmployeeId: requesterEmployeeId || null,
      requestCategoryId: requestCategoryId || null,
      defaultFinancialCostCenterId: defaultFinancialCostCenterId || null,
      priority,
      justification,
      defaultCostCenterId,
      notes: notes.trim() || null,
      projectId: projectId || null,
      externalReference: externalReference.trim() || null,
      items: items.map((it) => {
        const isMp = it.lineType === "MATERIA_PRIMA";
        return {
          lineType: it.lineType,
          materialId: isMp ? it.materialId : null,
          description: it.description.trim(),
          quantity: it.quantity,
          unit: it.unit.trim(),
          costCenterId: it.costCenterId && it.costCenterId.length ? it.costCenterId : null,
          financialCostCenterId:
            it.financialCostCenterId && it.financialCostCenterId.length
              ? it.financialCostCenterId
              : null,
          desiredDate: it.desiredDate ? `${it.desiredDate}T12:00:00.000Z` : null,
          priority: it.priority || null,
          notes: it.notes.trim() || null,
          suggestedSupplier: it.suggestedSupplier.trim() || null,
          supplierReference: isMp ? it.supplierReference.trim() || null : null,
          packagingPresentation: isMp ? it.packagingPresentation.trim() || null : null,
          minOrderQtySuggested:
            isMp && it.minOrderQtySuggested.trim() ? Number(it.minOrderQtySuggested) : null,
          lineStatus: it.lineStatus,
        };
      }),
    };
    return body;
  };

  const addQuote = async () => {
    if (!editingId) return;
    if (!quoteSupplierId) return alert("Selecione o fornecedor do orçamento.");
    const total = Number(quoteTotal.replace(",", "."));
    if (!Number.isFinite(total) || total <= 0) return alert("Informe o valor total do orçamento.");
    setQuoteBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-requests/${editingId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: quoteSupplierId,
          totalValue: total,
          paymentTerms: quotePaymentTerms.trim() || null,
          deliveryDays: quoteDeliveryDays.trim() ? Number(quoteDeliveryDays) : null,
          notes: quoteNotes.trim() || null,
        }),
      });
      setQuoteSupplierId("");
      setQuoteTotal("");
      setQuotePaymentTerms("");
      setQuoteDeliveryDays("");
      setQuoteNotes("");
      await openEdit(editingId, "edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao registrar orçamento.");
    } finally {
      setQuoteBusy(false);
    }
  };

  const removeQuote = async (quoteId: string) => {
    if (!editingId) return;
    if (!window.confirm("Excluir este orçamento?")) return;
    setQuoteBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-requests/${editingId}/quotes/${quoteId}`, { method: "DELETE" });
      await openEdit(editingId, "edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir orçamento.");
    } finally {
      setQuoteBusy(false);
    }
  };

  const chooseWinner = async (quoteId: string) => {
    if (!editingId) return;
    const winnerReason = window.prompt("Por que este fornecedor foi escolhido?") ?? "";
    if (!winnerReason.trim()) return alert("Justificativa é obrigatória.");
    setQuoteBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-requests/${editingId}/quotes/${quoteId}/winner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerReason }),
      });
      await openEdit(editingId, "edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao marcar vencedor.");
    } finally {
      setQuoteBusy(false);
    }
  };

  const winnerQuote = quotes.find((q) => q.isWinner) ?? null;

  const openOrderPdf = () => {
    if (!emittedOrder) return;
    const win = winnerQuote;
    const esc = (value: unknown): string =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
      );
    const logoSrc = resolvePrintLogoSrc(branding);
    const accentTint = `${branding.primaryColor || DEFAULT_BRANDING.primaryColor}14`;
    const total = win ? formatCurrency(Number(win.totalValue)) : "—";
    const issuedAt = new Date(emittedOrder.createdAt).toLocaleDateString("pt-BR");
    const rowsHtml = items
      .map(
        (it, i) => `<tr class="${i % 2 === 1 ? "stripe" : ""}">
  <td class="num">${itemLineCode(i)}</td>
  <td>${esc(it.description)}</td>
  <td class="right">${formatNumber(it.quantity)}</td>
  <td class="center">${esc(it.unit)}</td>
</tr>`
      )
      .join("");

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido de Compra ${esc(emittedOrder.code)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 12px; line-height: 1.35; background: #f1f5f9; }
  .sheet { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; padding: 20px; }
  .no-print { max-width: 900px; margin: 0 auto 12px; text-align: right; }
  .no-print button { padding: 8px 16px; font-size: 13px; font-weight: 700; background: #0f172a; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  header.doc-header { display: grid; grid-template-columns: ${logoSrc ? "100px 1fr 220px" : "1fr 220px"}; gap: 10px; align-items: center; }
  .logo-wrap { display: flex; align-items: center; height: 100%; }
  .logo-wrap img { width: 100%; max-width: 100px; max-height: 110px; object-fit: contain; object-position: left center; }
  .company p { margin: 0 0 2px; }
  .company .name { font-size: 14px; font-weight: 700; color: #0f172a; }
  .company .slogan { color: #475569; font-style: italic; }
  .lbl { color: #475569; font-weight: 600; }
  .meta { text-align: right; }
  .meta .kind { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #475569; margin: 0 0 2px; }
  .meta .title { font-size: 15px; font-weight: 800; color: #0f172a; margin: 0 0 6px; }
  .meta p { margin: 0 0 2px; }
  .rule { height: 2px; background: #0f172a; margin: 10px 0 16px; }
  .section-title { margin: 16px 0 6px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #334155; }
  .section-title:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 8px 0; }
  .kv-grid p { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11px; }
  thead tr { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; }
  th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; color: #334155; padding: 6px 8px; border-right: 1px solid #e2e8f0; }
  th:last-child, td:last-child { border-right: none; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #f1f5f9; }
  tr.stripe { background: #f8fafc; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .no-print, footer, .note { break-inside: avoid; page-break-inside: avoid; }
  @media print { .no-print { display: none !important; } }
  td.num { font-family: "Courier New", monospace; color: #475569; }
  td.right, th.right { text-align: right; }
  td.center, th.center { text-align: center; }
  .totals { margin-top: 10px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 12px; }
  .totals .row { display: grid; grid-template-columns: 1fr auto; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  .totals .row.total { border-bottom: none; background: ${accentTint}; font-weight: 800; font-size: 14px; }
  ul.terms { list-style: none; margin: 6px 0 0; padding: 0; }
  ul.terms li { padding: 2px 0; }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }
  .note { margin-top: 8px; font-size: 9px; color: #94a3b8; }
</style></head><body>
<div class="no-print"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
<div class="sheet">
  <header class="doc-header">
    ${logoSrc ? `<div class="logo-wrap"><img src="${logoSrc}" alt="${esc(branding.companyName)}"></div>` : ""}
    <div class="company">
      <p class="name">${esc(branding.companyName || DEFAULT_BRANDING.companyName)}</p>
      ${branding.slogan ? `<p class="slogan">${esc(branding.slogan)}</p>` : ""}
      <p><span class="lbl">CNPJ:</span> ${esc(PRINT_COMPANY_DOC_FALLBACK.taxId)}</p>
      <p>${esc(PRINT_COMPANY_DOC_FALLBACK.addressLine)}</p>
      <p><span class="lbl">E-mail:</span> ${esc(PRINT_COMPANY_DOC_FALLBACK.email)}</p>
    </div>
    <div class="meta">
      <p class="kind">Pedido de compra</p>
      <p class="title">${esc(emittedOrder.code)}</p>
      <p><span class="lbl">Data:</span> ${issuedAt}</p>
      <p><span class="lbl">Comprador:</span> ${esc(buyerNameView ?? "—")}</p>
    </div>
  </header>
  <div class="rule"></div>

  <p class="section-title">Dados do fornecedor</p>
  <div class="kv-grid">
    <p><span class="lbl">Fornecedor:</span> ${esc(emittedOrder.supplierDisplayNameSnapshot)}</p>
    <p><span class="lbl">CNPJ:</span> ${esc(win?.supplierDocumentSnapshot ?? "—")}</p>
    <p><span class="lbl">Solicitação de origem:</span> SC ${esc(requestNumber ?? "")} — ${esc(requester)}</p>
  </div>

  <p class="section-title">Itens do pedido</p>
  <table>
    <thead><tr><th>Item</th><th>Descrição</th><th class="right">Qtde</th><th class="center">Un.</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Valor total do pedido</span><span></span></div>
    <div class="row total"><span>Total</span><span>${total}</span></div>
  </div>

  <p class="section-title">Condições comerciais</p>
  <ul class="terms">
    <li><span class="lbl">Pagamento:</span> ${esc(win?.paymentTerms ?? "—")}</li>
    <li><span class="lbl">Prazo de entrega:</span> ${win?.deliveryDays != null ? `${win.deliveryDays} dia(s)` : "—"}</li>
  </ul>

  ${win?.winnerReason
      ? `<p class="section-title">Justificativa da escolha do fornecedor</p><p>${esc(win.winnerReason)}</p>`
      : ""}

  <footer>
    <span>${esc(buyerNameView ?? "—")}</span>
    <span>${issuedAt}</span>
  </footer>
  <p class="note">Documento gerado pelo IndusCost em ${new Date().toLocaleString("pt-BR")}.</p>
</div>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return alert("Habilite pop-ups para visualizar o pedido.");
    w.document.write(html);
    w.document.close();
  };

  const emailOrder = () => {
    if (!emittedOrder) return;
    const win = winnerQuote;
    const subject = encodeURIComponent(`Pedido de compra ${emittedOrder.code} — Grupo Lazarios`);
    const body = encodeURIComponent(
      `Prezados,\n\nSegue pedido de compra ${emittedOrder.code}.\n\nFornecedor: ${emittedOrder.supplierDisplayNameSnapshot}\nValor total: ${win ? formatCurrency(Number(win.totalValue)) : ""}\nCondição de pagamento: ${win?.paymentTerms ?? "-"}\nPrazo de entrega: ${win?.deliveryDays != null ? win.deliveryDays + " dias" : "-"}\n\nO PDF do pedido segue anexo.\n\nAtenciosamente,\nGrupo Lazarios`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const runWorkflow = async (
    action:
      | "submit"
      | "validate"
      | "send-to-approval"
      | "approve"
      | "reject"
      | "cancel"
      | "reopen-draft"
      | "reopen-quoting"
  ) => {
    if (!editingId) return;
    let reason: string | undefined;
    if (action === "reject" || action === "cancel") {
      reason = window.prompt(action === "reject" ? "Motivo da rejeição:" : "Motivo do cancelamento:") ?? "";
      if (!reason.trim()) {
        alert("Motivo é obrigatório.");
        return;
      }
    }
    setWorkflowBusy(true);
    try {
      const path = `/api/purchase-requests/${editingId}/${action}`;
      const result = await fetchJsonOk<{ quotations?: Array<{ id: string; code: string }> }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      void result;
      await loadLists();
      await openEdit(editingId, "edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro na ação de workflow.");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const uploadEvidence = async (file: File) => {
    if (!editingId) return;
    const fd = new FormData();
    fd.append("file", file);
    setWorkflowBusy(true);
    try {
      await fetch(`/api/purchase-requests/${editingId}/evidences`, {
        method: "POST",
        body: fd,
        credentials: "include",
      }).then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Falha no upload.");
        }
      });
      const ev = await fetchJsonOk<{ rows?: import("@/src/types/purchase").PurchaseEvidenceRow[] }>(
        `/api/purchase-requests/${editingId}/evidences`
      );
      setEvidences(Array.isArray(ev.rows) ? ev.rows : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao anexar.");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const validateClient = (): string | null => {
    if (!requesterEmployeeId) return "Selecione o solicitante na lista de funcionários.";
    if (!justification.trim()) return "Informe a justificativa.";
    if (!defaultFinancialCostCenterId) return "Selecione o centro de custo do cabeçalho.";
    if (items.length === 0) return "Inclua ao menos um item na solicitação.";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.description.trim()) return `Item ${i + 1}: descrição é obrigatória.`;
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) return `Item ${i + 1}: quantidade inválida.`;
      if (!it.unit.trim()) return `Item ${i + 1}: unidade é obrigatória.`;
      if (it.lineType === "MATERIA_PRIMA" && !it.materialId) {
        return `Item ${i + 1}: matéria-prima exige material cadastrado (pesquise e selecione ou use "Nova matéria-prima").`;
      }
      if (it.lineType === "MATERIA_PRIMA" && it.minOrderQtySuggested.trim()) {
        const mq = parseFloat(it.minOrderQtySuggested);
        if (!Number.isFinite(mq) || mq <= 0) {
          return `Item ${i + 1}: quantidade mínima sugerida (MOQ) inválida.`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validateClient();
    if (err) {
      alert(err);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (formMode === "create") {
        const created = await fetchJsonOk<PurchaseRequestRow>("/api/purchase-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await loadLists();
        await openEdit(created.id, "edit");
      } else if (formMode === "edit" && editingId) {
        await fetchJsonOk<PurchaseRequestRow>(`/api/purchase-requests/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await loadLists();
        await openEdit(editingId, "edit");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const saveNewCostCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ccCode.trim() || !ccName.trim()) {
      alert("Código e nome do centro de custo são obrigatórios.");
      return;
    }
    setCcSaving(true);
    try {
      const row = await fetchJsonOk<CostCenterRow>("/api/cost-centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: ccCode.trim(),
          name: ccName.trim(),
          description: ccDescription.trim() || null,
          isActive: true,
        }),
      });
      setCostCenters((prev) => [...prev, row].sort((a, b) => a.code.localeCompare(b.code)));
      setDefaultCostCenterId(row.id);
      setCcModalOpen(false);
      setCcCode("");
      setCcName("");
      setCcDescription("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao criar centro de custo.");
    } finally {
      setCcSaving(false);
    }
  };

  const itemCcOptions = useMemo((): SelectOption[] => {
    const inherit: SelectOption = {
      value: "",
      label: "— Herdar do cabeçalho —",
      searchTerms: "herdar cabeçalho",
    };
    return [inherit, ...financialCcOptions];
  }, [financialCcOptions]);

  const mpLineCount = useMemo(
    () => items.filter((i) => i.lineType === "MATERIA_PRIMA").length,
    [items]
  );
  /** Ações do cadastro de materiais só fazem sentido se existe linha de MP. */
  const hasMpLine = mpLineCount > 0;

  const resolvedCcLabel = (item: PurchaseItemDraft) => {
    if (item.financialCostCenterId) {
      const f = financialCcs.find((x) => x.id === item.financialCostCenterId);
      return f ? `${f.code} — ${f.name}` : "—";
    }
    if (item.costCenterId) {
      const c = costCenters.find((x) => x.id === item.costCenterId);
      return c ? `${c.code} — ${c.name}` : "—";
    }
    return headerCc ? `${headerCc.code} — ${headerCc.name} (herdado)` : "—";
  };

  const filteredRequests = useMemo(() => {
    return filterPurchaseRequests(requests, {
      search: listSearch,
      status: listStatus,
      priority: listPriority,
      costCenterId: listCostCenterId,
    });
  }, [requests, listSearch, listStatus, listPriority, listCostCenterId]);

  const clearListFilters = () => {
    setListSearch("");
    setListStatus("");
    setListPriority("");
    setListCostCenterId("");
  };

  if (view === "list") {
    return (
      <div className="space-y-6" data-tour="purchases-root">
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          data-tour="purchases-toolbar"
        >
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Solicitações de compra
            </h3>
            <p className="text-sm text-muted-foreground">
              Demanda de compra classificada por tipo e centro de custo — sem pedido, recebimento ou financeiro nesta fase.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TourHelpButton onClick={() => setTourOpen(true)} />
            <button
              type="button"
              onClick={() => navigate("/purchases/receiving")}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
            >
              Recebimento
            </button>
            <button
              type="button"
              onClick={() => navigate("/purchases/workstation")}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
            >
              Estação
            </button>
            <button
              type="button"
              onClick={() => navigate("/purchases/quotations")}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
            >
              Cotações
            </button>
            <button
              type="button"
              onClick={() => navigate("/purchases/orders")}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
            >
              Pedidos
            </button>
            {allowCreate ? (
              <button
                type="button"
                data-tour="purchases-new-request"
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Nova solicitação
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar por nº, solicitante, área ou centro de custo..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                />
              </div>

              <select
                className="min-w-[180px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
                value={listStatus}
                onChange={(e) => setListStatus(e.target.value as any)}
              >
                <option value="">Todos os status</option>
                {(Object.keys(STATUS_LABEL) as PurchaseRequestStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>

              <select
                className="min-w-[220px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
                value={listCostCenterId}
                onChange={(e) => setListCostCenterId(e.target.value)}
              >
                <option value="">Todos os centros de custo</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>

              <select
                className="min-w-[180px] rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
                value={listPriority}
                onChange={(e) => setListPriority(e.target.value as any)}
              >
                <option value="">Todas as prioridades</option>
                {(Object.keys(PRIORITY_LABEL) as PurchasePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Exibindo <span className="font-bold text-foreground">{filteredRequests.length}</span> de{" "}
                <span className="font-bold text-foreground">{requests.length}</span> solicitação(ões).
              </p>
              <button
                type="button"
                onClick={clearListFilters}
                disabled={!listSearch.trim() && !listStatus && !listPriority && !listCostCenterId}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
              >
                <X className="h-4 w-4" />
                Limpar filtros
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden" data-tour="purchases-list">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-accent/40 border-b border-border">
                <tr>
                  <th className="p-4 font-semibold text-sm">Nº</th>
                  <th className="p-4 font-semibold text-sm">Status</th>
                  <th className="p-4 font-semibold text-sm">Solicitante</th>
                  <th className="p-4 font-semibold text-sm">Área</th>
                  <th className="p-4 font-semibold text-sm">Centro de custo</th>
                  <th className="p-4 font-semibold text-sm">Atualização</th>
                  <th className="p-4 font-semibold text-sm text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingList ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                      Nenhuma solicitação cadastrada.
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                      Nenhum resultado encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/20 transition-colors">
                      <td className="p-4 font-mono text-sm">#{r.number}</td>
                      <td className="p-4">
                        <OverlayBadge tone={STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </OverlayBadge>
                      </td>
                      <td className="p-4 text-sm">{r.requester}</td>
                      <td className="p-4 text-sm">{r.department}</td>
                      <td className="p-4 text-sm">
                        {r.defaultCostCenter.code} — {r.defaultCostCenter.name}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">{formatDt(r.updatedAt)}</td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Ver"
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
                            onClick={() => openEdit(r.id, "view")}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {allowEdit ? (
                            <button
                              type="button"
                              title="Editar"
                              className="p-2 rounded-md hover:bg-accent text-muted-foreground"
                              onClick={() => openEdit(r.id, "edit")}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <GuidedTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={PURCHASE_TOUR_STEPS}
          tourName="Tour de Compras"
        />
      </div>
    );
  }

  if (loadingForm && !requester) {
    return (
      <div className="space-y-4" data-tour="purchases-root">
        <div className="flex justify-end" data-tour="purchases-toolbar">
          <TourHelpButton onClick={() => setTourOpen(true)} />
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm">Carregando solicitação…</p>
        </div>
        <GuidedTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={PURCHASE_TOUR_STEPS}
          tourName="Tour de Compras"
        />
      </div>
    );
  }

  const guidance = resolvePurchaseRequestGuidance(status);

  return (
    <div className="space-y-4" data-tour="purchases-root">
      {/* Cabeçalho do documento: identidade, situação e metadados numa faixa só. */}
      <div
        className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between"
        data-tour="purchases-toolbar"
      >
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              setView("list");
              loadLists();
            }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar à lista
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Package className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="text-base font-semibold text-foreground">
              {formMode === "create"
                ? "Nova solicitação de compra"
                : `Solicitação ${requestNumber != null ? `#${requestNumber}` : ""}`}
            </h3>
            <OverlayBadge
              tone={STATUS_TONE[status]}
              emphasized
              title="Use as ações de workflow para mudar o status."
            >
              {STATUS_LABEL[status]}
            </OverlayBadge>
            {priority === "ALTA" || priority === "URGENTE" ? (
              <OverlayBadge tone={PRIORITY_TONE[priority]}>
                {PRIORITY_LABEL[priority]}
              </OverlayBadge>
            ) : null}
          </div>
          {/* Metadados do documento em uma linha, no lugar de parágrafos soltos. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {[
              createdAt ? `Criada em ${formatDt(createdAt)}` : null,
              requester || null,
              department || null,
              `${items.length} ${items.length === 1 ? "item" : "itens"}`,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {!fieldsDisabled && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </button>
          )}
        </div>
      </div>

      {/* O pedido emitido é o documento que o usuário vem buscar — fica no topo. */}
      {status === "ENCERRADA" && emittedOrder ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Pedido de compra emitido
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-mono font-semibold text-emerald-950">{emittedOrder.code}</span>
              <span className="text-emerald-900">{emittedOrder.supplierDisplayNameSnapshot}</span>
              {winnerQuote ? (
                <span className="font-semibold text-emerald-950">
                  {formatCurrency(Number(winnerQuote.totalValue))}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={openOrderPdf}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              <Printer className="h-4 w-4" />
              Abrir PDF
            </button>
            <button
              type="button"
              onClick={emailOrder}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-50"
            >
              Enviar por e-mail
            </button>
          </div>
        </div>
      ) : null}

      {headerCc?.code === "A-CLASS" && (
        <AppAlert variant="warning" density="compact" title={'Centro de custo "A classificar"'}>
          Esta solicitação usa o fallback controlado <strong>{headerCc.code}</strong>. O vínculo é
          explícito e rastreável — substitua por um centro definitivo quando souber a alocação.
        </AppAlert>
      )}

      {/* Uma decisão, um lugar: por que está parada, o que falta e os botões. */}
      {formMode !== "create" || editingId ? (
        <OverlaySection
          title="Próximo passo"
          className="border-primary/25 bg-primary/5"
        >
          {formMode !== "create" ? (
            <div className="space-y-1.5" data-testid="purchase-request-next-step">
              <p className="text-sm leading-snug text-foreground">
                <span className="font-medium text-muted-foreground">Aqui porque </span>
                {guidance.stayReason}
              </p>
              <p className="text-sm leading-snug text-foreground">
                <span className="font-medium text-sky-800">Para sair · </span>
                {guidance.nextAction}
              </p>
            </div>
          ) : null}
          {editingId ? (
            <div
              data-testid="purchase-request-workflow"
              className={cn(
                "flex flex-wrap gap-2",
                // Sem ação disponível o bloco não ocupa espaço, mas o nó
                // permanece para quem observa o workflow por este testid.
                hasWorkflowActions && "mt-3 border-t border-primary/20 pt-3"
              )}
            >
              {status === "RASCUNHO" && allowCreate ? (
                <button
                  type="button"
                  disabled={workflowBusy}
                  onClick={() => void runWorkflow("submit")}
                  className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-50"
                >
                  Enviar para compras
                </button>
              ) : null}
              {status === "ABERTA" && allowEdit ? (
                <button
                  type="button"
                  disabled={workflowBusy}
                  onClick={() => void runWorkflow("validate")}
                  className="px-3 py-1.5 rounded-lg text-sm bg-blue-700 text-white disabled:opacity-50"
                >
                  Validar e iniciar orçamentos
                </button>
              ) : null}
              {status === "EM_COTACAO" && allowEdit ? (
                <button
                  type="button"
                  disabled={workflowBusy || !quotes.some((q) => q.isWinner)}
                  onClick={() => void runWorkflow("send-to-approval")}
                  title={quotes.some((q) => q.isWinner) ? "" : "Marque um orçamento vencedor primeiro"}
                  className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-50"
                >
                  Enviar para aprovação
                </button>
              ) : null}
              {status === "AGUARDANDO_APROVACAO" && allowEdit ? (
                <>
                  <button
                    type="button"
                    disabled={workflowBusy}
                    onClick={() => void runWorkflow("approve")}
                    className="px-3 py-1.5 rounded-lg text-sm bg-emerald-700 text-white disabled:opacity-50"
                  >
                    Aprovar e emitir pedido
                  </button>
                  <button
                    type="button"
                    disabled={workflowBusy}
                    onClick={() => void runWorkflow("reject")}
                    className="px-3 py-1.5 rounded-lg text-sm border border-orange-300 text-orange-900 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </>
              ) : null}
              {status === "REJEITADA" && allowEdit ? (
                <>
                  <button
                    type="button"
                    disabled={workflowBusy}
                    onClick={() => void runWorkflow("reopen-quoting")}
                    className="px-3 py-1.5 rounded-lg text-sm bg-blue-700 text-white disabled:opacity-50"
                  >
                    Reabrir orçamentos
                  </button>
                  <button
                    type="button"
                    disabled={workflowBusy}
                    onClick={() => void runWorkflow("reopen-draft")}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border disabled:opacity-50"
                  >
                    Reabrir rascunho
                  </button>
                </>
              ) : null}
              {status !== "CANCELADA" && status !== "ENCERRADA" && allowEdit ? (
                <button
                  type="button"
                  disabled={workflowBusy}
                  onClick={() => void runWorkflow("cancel")}
                  className="px-3 py-1.5 rounded-lg text-sm border border-red-200 text-red-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          ) : null}
        </OverlaySection>
      ) : null}

      <OverlaySection
        title="Dados da solicitação"
        actions={
          documentMode ? (
            <span className={OVERLAY_EYEBROW}>Somente leitura</span>
          ) : null
        }
      >
        <div data-tour="purchases-header-block">
          {documentMode ? (
            /* Documento: quatro colunas densas de rótulo/valor, sem input morto. */
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Term label="Solicitante" value={requester} />
              <Term label="Departamento / área" value={department} />
              <Term label="Tipo / categoria" value={requestCategory} />
              <Term label="Prioridade" value={PRIORITY_LABEL[priority]} />
              <Term
                label="Centro de custo"
                span={2}
                value={headerCc ? `${headerCc.code} — ${headerCc.name}` : null}
              />
              <Term
                label="Projeto oficial"
                span={2}
                value={projectOptions.find((p) => p.value === projectId)?.label}
              />
              <Term label="Referência externa" value={externalReference} />
              <Term label="Comprador" value={buyerNameView} />
              <Term label="Criada em" value={createdAt ? formatDt(createdAt) : null} />
              <Term label="Justificativa" span={4} value={justification} />
              {notes ? <Term label="Observações" span={4} value={notes} /> : null}
            </dl>
          ) : (
            <OverlayFieldGrid columns={4}>
              <OverlayField
                label="Solicitante"
                required
                colSpan={2}
                density="dense"
                description={
                  !requesterEmployeeId && requester
                    ? `Registro antigo: ${requester}. Selecione o funcionário para oficializar.`
                    : undefined
                }
              >
                {() => (
                  <SearchableSelect
                    options={employeeOptions}
                    value={requesterEmployeeId}
                    onChange={handleRequesterSelect}
                    placeholder="Selecione o funcionário..."
                    disabled={fieldsDisabled}
                    required
                  />
                )}
              </OverlayField>
              <OverlayField
                label="Departamento / área"
                required
                colSpan={2}
                density="dense"
                description="Preenchido pelo setor do funcionário selecionado."
              >
                {(p) => (
                  <input
                    {...p}
                    disabled
                    readOnly
                    className={cn(OVERLAY_CONTROL_CLASS, "bg-slate-50 text-muted-foreground")}
                    value={department}
                    placeholder="Definido pelo funcionário selecionado"
                  />
                )}
              </OverlayField>

              <OverlayField label="Tipo / categoria" density="dense">
                {(p) => (
                  <select
                    {...p}
                    disabled={fieldsDisabled}
                    className={OVERLAY_CONTROL_CLASS}
                    value={requestCategoryId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setRequestCategoryId(id);
                      setRequestCategory(requestCategories.find((c) => c.id === id)?.name ?? "");
                    }}
                  >
                    <option value="">— Sem categoria —</option>
                    {requestCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </OverlayField>
              <OverlayField label="Prioridade" density="dense">
                {(p) => (
                  <select
                    {...p}
                    disabled={fieldsDisabled}
                    className={OVERLAY_CONTROL_CLASS}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as PurchasePriority)}
                  >
                    {(Object.keys(PRIORITY_LABEL) as PurchasePriority[]).map((p2) => (
                      <option key={p2} value={p2}>
                        {PRIORITY_LABEL[p2]}
                      </option>
                    ))}
                  </select>
                )}
              </OverlayField>
              <OverlayField label="Centro de custo" required colSpan={2} density="dense">
                {() => (
                  <SearchableSelect
                    options={financialCcOptions}
                    value={defaultFinancialCostCenterId}
                    onChange={setDefaultFinancialCostCenterId}
                    placeholder="Selecione o centro de custo..."
                    disabled={fieldsDisabled}
                    required
                  />
                )}
              </OverlayField>

              <OverlayField
                label="Por que essa compra é necessária?"
                required
                colSpan={4}
                density="dense"
              >
                {(p) => (
                  <OverlayTextarea
                    {...p}
                    disabled={fieldsDisabled}
                    rows={2}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                  />
                )}
              </OverlayField>

              <OverlayField label="Projeto oficial" colSpan={2} density="dense">
                {() => (
                  <SearchableSelect
                    options={[{ value: "", label: "— Sem projeto —" }, ...projectOptions]}
                    value={projectId}
                    onChange={setProjectId}
                    placeholder="Buscar projeto oficial…"
                    disabled={fieldsDisabled}
                  />
                )}
              </OverlayField>
              <OverlayField label="Referência externa" colSpan={2} density="dense">
                {(p) => (
                  <input
                    {...p}
                    disabled={fieldsDisabled}
                    className={OVERLAY_CONTROL_CLASS}
                    placeholder="OS, contrato, etc."
                    value={externalReference}
                    onChange={(e) => setExternalReference(e.target.value)}
                  />
                )}
              </OverlayField>
              <OverlayField label="Observações" colSpan={4} density="dense">
                {(p) => (
                  <OverlayTextarea
                    {...p}
                    disabled={fieldsDisabled}
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                )}
              </OverlayField>
            </OverlayFieldGrid>
          )}
        </div>
      </OverlaySection>

      <OverlaySection
        title={`Itens da solicitação (${items.length})`}
        padded={false}
        actions={
          fieldsDisabled ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Ações do cadastro de materiais são globais: uma vez, não por linha. */}
              {hasMpLine ? (
                <>
                  <button
                    type="button"
                    onClick={() => refreshMaterials()}
                    title="Recarrega a lista após cadastrar material em outra aba"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Atualizar lista
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open("/materials", "_blank", "noopener,noreferrer")}
                    title="Abre o cadastro em outra aba para não perder este rascunho"
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 px-2 py-1 text-[11px] text-primary hover:bg-primary/5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Nova matéria-prima
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/materials")}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    Ir em Suprimentos
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-3 w-3" />
                Adicionar item
              </button>
            </div>
          )
        }
      >
        <div data-tour="purchases-items-block">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Nenhum item. Adicione ao menos um item para registrar a demanda.</p>
        ) : documentMode ? (
          /* Solicitação travada é documento: linhas em tabela, como todo pedido. */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-[color:var(--color-overlay-border)] bg-muted/40">
                <tr className={OVERLAY_TABLE_HEAD}>
                  <th className="w-[76px] px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="w-[84px] px-3 py-2 text-left">Tipo</th>
                  <th className="w-[100px] px-3 py-2 text-right">Qtd.</th>
                  <th className="w-[64px] px-3 py-2 text-left">Un.</th>
                  <th className="px-3 py-2 text-left">Centro de custo</th>
                  <th className="w-[104px] px-3 py-2 text-left">Entrega</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const mat = it.materialId
                    ? materials.find((m) => m.id === it.materialId)
                    : undefined;
                  const cancelled = it.lineStatus === "CANCELADA";
                  // Detalhe da linha vira uma linha de metadados, não oito campos.
                  const meta = [
                    it.suggestedSupplier ? `Fornecedor sugerido: ${it.suggestedSupplier}` : null,
                    it.supplierReference ? `Ref. fornecedor: ${it.supplierReference}` : null,
                    it.packagingPresentation ? `Embalagem: ${it.packagingPresentation}` : null,
                    it.minOrderQtySuggested ? `MOQ: ${it.minOrderQtySuggested}` : null,
                    it.priority ? `Prioridade: ${PRIORITY_LABEL[it.priority as PurchasePriority]}` : null,
                    it.notes || null,
                  ].filter(Boolean);
                  return (
                    <tr
                      key={it.tempId}
                      className={cn("border-b border-border/60 align-top", cancelled && "opacity-60")}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {itemLineCode(idx)}
                      </td>
                      <td className="px-3 py-2">
                        <p className={cn("font-medium text-foreground", cancelled && "line-through")}>
                          {it.description || "—"}
                        </p>
                        {mat ? (
                          <p className="font-mono text-[11px] text-muted-foreground">{mat.code}</p>
                        ) : null}
                        {meta.length ? (
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {meta.join(" · ")}
                          </p>
                        ) : null}
                        {cancelled ? (
                          <OverlayBadge tone="rose" className="mt-1">
                            Linha cancelada
                          </OverlayBadge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {LINE_TYPE_SHORT[it.lineType]}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(it.quantity)}</td>
                      <td className="px-3 py-2 text-xs">{it.unit}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{resolvedCcLabel(it)}</td>
                      <td className="px-3 py-2 text-xs">
                        {it.desiredDate ? formatIsoDate(it.desiredDate) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-[color:var(--color-overlay-border)] bg-muted/30 text-xs font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>
                    {items.length} {items.length === 1 ? "linha" : "linhas"}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground" colSpan={4}>
                    {mpLineCount} matéria-prima · {items.length - mpLineCount} indireto
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
        <div className="space-y-3 px-3 py-3">
          {items.map((it, idx) => {
            const selectedMaterial = it.materialId
              ? materials.find((m) => m.id === it.materialId)
              : undefined;
            const hasAdvancedData = Boolean(
              it.financialCostCenterId ||
                it.desiredDate ||
                it.priority ||
                it.suggestedSupplier ||
                it.notes ||
                it.supplierReference ||
                it.packagingPresentation ||
                it.minOrderQtySuggested ||
                it.lineStatus !== "ABERTA"
            );
            const isExpanded = expandedItemIds[it.tempId] ?? hasAdvancedData;
            const itemTitle =
              it.lineType === "MATERIA_PRIMA"
                ? selectedMaterial?.description || it.description || `Item ${idx + 1}`
                : it.description || `Item ${idx + 1}`;
            return (
            <div
              key={it.tempId}
              className={cn(
                "overflow-hidden rounded-lg border border-border/80 bg-accent/10",
                it.lineType === "MATERIA_PRIMA" && "border-l-[3px] border-l-primary/60"
              )}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-background/60 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                    {itemLineCode(idx)}
                  </span>
                  <p className="truncate text-sm font-medium">{itemTitle}</p>
                  <OverlayBadge tone={it.lineType === "MATERIA_PRIMA" ? "primary" : "slate"}>
                    {LINE_TYPE_SHORT[it.lineType]}
                  </OverlayBadge>
                </div>
                {!fieldsDisabled && allowDelete && items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(it.tempId)}
                    className="shrink-0 rounded-md p-1.5 text-red-600 hover:bg-red-500/10"
                    title="Remover item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-3 px-3 py-3">
                {/* O material vem primeiro: é ele que preenche descrição e unidade. */}
                {it.lineType === "MATERIA_PRIMA" && (
                  <OverlayField
                    label="Material (cadastro Suprimentos)"
                    required
                    density="dense"
                    description={
                      it.materialId
                        ? undefined
                        : "Cadastrou agora em outra aba? Use Atualizar lista no topo desta seção."
                    }
                  >
                    {() => (
                      <SearchableSelect
                        options={materialOptionsMp}
                        value={it.materialId}
                        onChange={(v) => updateItem(it.tempId, { materialId: v })}
                        placeholder="Pesquisar por código, descrição, unidade…"
                        disabled={fieldsDisabled}
                      />
                    )}
                  </OverlayField>
                )}

                {it.lineType === "MATERIA_PRIMA" && selectedMaterial ? (
                  <MaterialMpSummaryCard material={selectedMaterial} readOnly={fieldsDisabled} />
                ) : it.lineType === "MATERIA_PRIMA" && it.materialId ? (
                  <AppAlert variant="warning" density="compact">
                    Material não encontrado na lista local. Salve a solicitação apenas após atualizar a
                    lista ou verificar o cadastro.
                  </AppAlert>
                ) : null}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <OverlayField
                    label="Tipo do item"
                    required
                    density="dense"
                    className="md:col-span-3"
                  >
                    {(p) => (
                      <select
                        {...p}
                        disabled={fieldsDisabled}
                        className={OVERLAY_CONTROL_CLASS}
                        value={it.lineType}
                        onChange={(e) =>
                          updateItem(it.tempId, { lineType: e.target.value as PurchaseItemDraft["lineType"] })
                        }
                      >
                        <option value="MATERIA_PRIMA">{LINE_TYPE_LABEL.MATERIA_PRIMA}</option>
                        <option value="INDIRETO">{LINE_TYPE_LABEL.INDIRETO}</option>
                      </select>
                    )}
                  </OverlayField>
                  <OverlayField
                    label="Quantidade"
                    required
                    density="dense"
                    className="md:col-span-2"
                  >
                    {(p) => (
                      <input
                        {...p}
                        disabled={fieldsDisabled}
                        type="number"
                        min={0}
                        step="any"
                        className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                        value={it.quantity}
                        onChange={(e) => updateItem(it.tempId, { quantity: parseFloat(e.target.value) || 0 })}
                      />
                    )}
                  </OverlayField>
                  <OverlayField
                    label={it.lineType === "MATERIA_PRIMA" ? "Unidade (cadastro)" : "Unidade"}
                    required
                    density="dense"
                    className="md:col-span-2"
                  >
                    {(p) => (
                      <input
                        {...p}
                        disabled={fieldsDisabled}
                        className={OVERLAY_CONTROL_CLASS}
                        value={it.unit}
                        onChange={(e) => updateItem(it.tempId, { unit: e.target.value })}
                      />
                    )}
                  </OverlayField>
                  <OverlayField
                    label={it.lineType === "MATERIA_PRIMA" ? "Descrição na solicitação" : "Descrição"}
                    required
                    density="dense"
                    className="md:col-span-5"
                    description={
                      it.lineType === "MATERIA_PRIMA"
                        ? "Vem do cadastro; ajuste para detalhar a especificação da compra."
                        : undefined
                    }
                  >
                    {(p) => (
                      <input
                        {...p}
                        disabled={fieldsDisabled}
                        className={OVERLAY_CONTROL_CLASS}
                        value={it.description}
                        onChange={(e) => updateItem(it.tempId, { description: e.target.value })}
                      />
                    )}
                  </OverlayField>
                </div>

                <button
                  type="button"
                  onClick={() => toggleItemDetails(it.tempId)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {isExpanded ? "Ocultar detalhes" : "Mais detalhes"}
                  {!isExpanded && hasAdvancedData ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-primary"
                      title="Há dados preenchidos nos detalhes avançados"
                    />
                  ) : null}
                </button>

                {isExpanded && (
                  <OverlayFieldGrid columns={4} className="border-t border-border/60 pt-3">
                    <OverlayField
                      label="Centro de custo do item"
                      colSpan={2}
                      density="dense"
                      description={`CC efetivo: ${resolvedCcLabel(it)}`}
                    >
                      {() => (
                        <SearchableSelect
                          options={itemCcOptions}
                          value={it.financialCostCenterId}
                          onChange={(v) => updateItem(it.tempId, { financialCostCenterId: v })}
                          placeholder="Herdar ou sobrescrever..."
                          disabled={fieldsDisabled}
                        />
                      )}
                    </OverlayField>
                    <OverlayField label="Data desejada" density="dense">
                      {(p) => (
                        <input
                          {...p}
                          disabled={fieldsDisabled}
                          type="date"
                          className={OVERLAY_CONTROL_CLASS}
                          value={it.desiredDate}
                          onChange={(e) => updateItem(it.tempId, { desiredDate: e.target.value })}
                        />
                      )}
                    </OverlayField>
                    <OverlayField label="Prioridade do item" density="dense">
                      {(p) => (
                        <select
                          {...p}
                          disabled={fieldsDisabled}
                          className={OVERLAY_CONTROL_CLASS}
                          value={it.priority}
                          onChange={(e) =>
                            updateItem(it.tempId, {
                              priority: (e.target.value || "") as PurchaseItemDraft["priority"],
                            })
                          }
                        >
                          <option value="">(herdar / não definir)</option>
                          {(Object.keys(PRIORITY_LABEL) as PurchasePriority[]).map((p2) => (
                            <option key={p2} value={p2}>
                              {PRIORITY_LABEL[p2]}
                            </option>
                          ))}
                        </select>
                      )}
                    </OverlayField>

                    <OverlayField label="Status da linha" density="dense">
                      {(p) => (
                        <select
                          {...p}
                          disabled={fieldsDisabled}
                          className={OVERLAY_CONTROL_CLASS}
                          value={it.lineStatus}
                          onChange={(e) =>
                            updateItem(it.tempId, {
                              lineStatus: e.target.value as PurchaseItemDraft["lineStatus"],
                            })
                          }
                        >
                          <option value="ABERTA">Aberta</option>
                          <option value="CANCELADA">Cancelada</option>
                        </select>
                      )}
                    </OverlayField>
                    <OverlayField label="Fornecedor sugerido" density="dense">
                      {(p) => (
                        <input
                          {...p}
                          disabled={fieldsDisabled}
                          className={OVERLAY_CONTROL_CLASS}
                          value={it.suggestedSupplier}
                          onChange={(e) => updateItem(it.tempId, { suggestedSupplier: e.target.value })}
                        />
                      )}
                    </OverlayField>

                    {it.lineType === "MATERIA_PRIMA" && (
                      <>
                        <OverlayField label="Referência no fornecedor" density="dense">
                          {(p) => (
                            <input
                              {...p}
                              disabled={fieldsDisabled}
                              placeholder="Código / item na lista do fornecedor"
                              className={OVERLAY_CONTROL_CLASS}
                              value={it.supplierReference}
                              onChange={(e) => updateItem(it.tempId, { supplierReference: e.target.value })}
                            />
                          )}
                        </OverlayField>
                        <OverlayField label="Embalagem / apresentação" density="dense">
                          {(p) => (
                            <input
                              {...p}
                              disabled={fieldsDisabled}
                              placeholder="Ex.: fardo 25 kg, bobina, caixa"
                              className={OVERLAY_CONTROL_CLASS}
                              value={it.packagingPresentation}
                              onChange={(e) =>
                                updateItem(it.tempId, { packagingPresentation: e.target.value })
                              }
                            />
                          )}
                        </OverlayField>
                        <OverlayField
                          label="Qtd. mínima sugerida — MOQ"
                          density="dense"
                          description="Somente referência de compra."
                        >
                          {(p) => (
                            <input
                              {...p}
                              disabled={fieldsDisabled}
                              type="number"
                              min={0}
                              step="any"
                              className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                              value={it.minOrderQtySuggested}
                              onChange={(e) =>
                                updateItem(it.tempId, { minOrderQtySuggested: e.target.value })
                              }
                            />
                          )}
                        </OverlayField>
                      </>
                    )}

                    <OverlayField label="Observação do item" colSpan={4} density="dense">
                      {(p) => (
                        <OverlayTextarea
                          {...p}
                          disabled={fieldsDisabled}
                          rows={2}
                          value={it.notes}
                          onChange={(e) => updateItem(it.tempId, { notes: e.target.value })}
                        />
                      )}
                    </OverlayField>
                  </OverlayFieldGrid>
                )}
              </div>
            </div>
            );
          })}
        </div>
        )}
        </div>
      </OverlaySection>

      {editingId && ["EM_COTACAO", "AGUARDANDO_APROVACAO", "ENCERRADA", "REJEITADA"].includes(status) ? (
        <OverlaySection title={`Orçamentos (${quotes.length})`}>
        <div className="space-y-3" data-tour="purchases-quotes-block">
          {quotes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={cn(OVERLAY_TABLE_HEAD, "border-b border-border text-left")}>
                    <th className="py-2 pr-3">Fornecedor</th>
                    <th className="py-2 pr-3 text-right">Valor total</th>
                    <th className="py-2 pr-3">Pagamento</th>
                    <th className="py-2 pr-3">Entrega</th>
                    <th className="py-2 pr-3">Obs.</th>
                    <th className="py-2 pr-3">Vencedor</th>
                    {status === "EM_COTACAO" ? <th className="py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} className={cn("border-b border-border/60", q.isWinner && "bg-emerald-500/10")}>
                      <td className="py-2 pr-3 font-medium">{q.supplierNameSnapshot}</td>
                      <td className="py-2 pr-3 text-right">{formatCurrency(Number(q.totalValue))}</td>
                      <td className="py-2 pr-3">{q.paymentTerms || "—"}</td>
                      <td className="py-2 pr-3">{q.deliveryDays != null ? `${q.deliveryDays} dias` : "—"}</td>
                      <td className="py-2 pr-3 max-w-[220px] truncate" title={q.notes ?? ""}>{q.notes || "—"}</td>
                      <td className="py-2 pr-3">
                        {q.isWinner ? (
                          <span className="text-xs font-bold text-emerald-700" title={q.winnerReason ?? ""}>
                            ✔ Escolhido
                          </span>
                        ) : status === "EM_COTACAO" ? (
                          <button
                            type="button"
                            disabled={quoteBusy}
                            onClick={() => void chooseWinner(q.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            Marcar vencedor
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      {status === "EM_COTACAO" ? (
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            disabled={quoteBusy}
                            onClick={() => void removeQuote(q.id)}
                            className="text-xs text-red-700 hover:underline"
                          >
                            Excluir
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {winnerQuote?.winnerReason ? (
                <p className="text-xs text-muted-foreground mt-2">
                  Justificativa: {winnerQuote.winnerReason}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum orçamento registrado ainda.</p>
          )}
          {status === "EM_COTACAO" ? (
            <div className="grid grid-cols-1 items-end gap-3 border-t border-border pt-3 md:grid-cols-6">
              <OverlayField label="Fornecedor" required density="dense" className="md:col-span-2">
                {() => (
                  <SearchableSelect
                    options={supplierOptions}
                    value={quoteSupplierId}
                    onChange={setQuoteSupplierId}
                    placeholder="Buscar fornecedor…"
                  />
                )}
              </OverlayField>
              <OverlayField label="Valor total" required density="dense">
                {(p) => (
                  <input
                    {...p}
                    className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                    placeholder="0,00"
                    value={quoteTotal}
                    onChange={(e) => setQuoteTotal(e.target.value)}
                  />
                )}
              </OverlayField>
              <OverlayField label="Pagamento" density="dense">
                {(p) => (
                  <input
                    {...p}
                    className={OVERLAY_CONTROL_CLASS}
                    placeholder="Ex.: 30/60"
                    value={quotePaymentTerms}
                    onChange={(e) => setQuotePaymentTerms(e.target.value)}
                  />
                )}
              </OverlayField>
              <OverlayField label="Entrega (dias)" density="dense">
                {(p) => (
                  <input
                    {...p}
                    className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                    value={quoteDeliveryDays}
                    onChange={(e) => setQuoteDeliveryDays(e.target.value.replace(/\D/g, ""))}
                  />
                )}
              </OverlayField>
              <button
                type="button"
                disabled={quoteBusy}
                onClick={() => void addQuote()}
                className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Adicionar
              </button>
              <div className="md:col-span-6">
                <input
                  className={OVERLAY_CONTROL_CLASS}
                  placeholder="Observações do orçamento (opcional)"
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
        </OverlaySection>
      ) : null}

      {editingId && linkedQuotations.length > 0 ? (
        <OverlaySection title="Cotações vinculadas" className="border-violet-200 bg-violet-500/5">
          <ul className="flex flex-wrap gap-2 text-sm">
            {linkedQuotations.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-2 py-1 font-mono text-xs text-primary hover:bg-violet-50"
                  onClick={() => navigate(`/purchases/quotations/${q.id}`)}
                >
                  {q.code}
                  <span className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                    {q.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </OverlaySection>
      ) : null}

      {editingId ? (
        <OverlaySection
          title={`Anexos / evidências (${evidences.length})`}
          actions={
            allowEdit ? (
              <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent">
                + Anexar arquivo
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadEvidence(f);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null
          }
        >
          {evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {evidences.map((ev) => (
                <li key={ev.id} className="flex items-baseline gap-2">
                  <a
                    className="truncate text-primary hover:underline"
                    href={`/api/purchase-requests/${editingId}/evidences/${ev.id}/download`}
                  >
                    {ev.originalFileName}
                  </a>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {Math.round(ev.fileSize / 1024)} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </OverlaySection>
      ) : null}

      {historyEvents.length > 0 ? (
        <OverlaySection title={`Histórico (${historyEvents.length})`}>
          <ol className="space-y-2 text-sm" data-testid="purchase-request-history">
            {historyEvents.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3">
                <div className="font-medium">
                  {h.action}
                  {h.fromStatus || h.toStatus
                    ? ` · ${h.fromStatus ?? "—"} → ${h.toStatus ?? "—"}`
                    : ""}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(h.createdAt).toLocaleString("pt-BR")}
                  {h.userName ? ` · ${h.userName}` : ""}
                  {h.reason ? ` · ${h.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </OverlaySection>
      ) : null}
      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PURCHASE_TOUR_STEPS}
        tourName="Tour de Compras"
      />

      {ccModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden"
          >
            <form onSubmit={saveNewCostCenter} className="p-6 space-y-4">
              <h4 className="font-bold text-lg">Novo centro de custo</h4>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Código *</label>
                <input
                  required
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  value={ccCode}
                  onChange={(e) => setCcCode(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Nome *</label>
                <input
                  required
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  value={ccName}
                  onChange={(e) => setCcName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Descrição</label>
                <textarea
                  rows={2}
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  value={ccDescription}
                  onChange={(e) => setCcDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm border border-border"
                  onClick={() => setCcModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={ccSaving}
                  className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {ccSaving ? "Salvando…" : "Criar"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
