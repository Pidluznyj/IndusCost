// src/components/ProposalModule.tsx
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  FileText,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Save,
  ArrowLeft,
  Package,
  PlusCircle,
  Calculator,
  DollarSign,
  Percent,
  Truck,
  Info,
  ExternalLink,
  Printer,
  LayoutDashboard,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { SearchableSelect, type SelectOption } from "./shared/SearchableSelect";
import { Proposal, Customer, ProposalItem, ProposalStatus } from "@/src/types/commercial";
import { Product } from "@/src/types/product";
import { motion, AnimatePresence } from "motion/react";
import { STORAGE_OPEN_PROPOSAL_KEY } from "@/src/lib/salesFunnel";
import { CalculatedValue } from "./shared/CalculatedValue";
import { buildProposalLineMarginExplanation } from "@/src/lib/proposalLineExplain";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PROPOSAL_TOUR_STEPS } from "@/src/tours/proposalTourSteps";
import { ProposalAnalysisModal } from "@/src/components/proposal/ProposalAnalysisModal";
import { ProposalIndicatorsTab } from "@/src/components/proposal/ProposalIndicatorsTab";
import { ProposalIndicatorsDetailModal } from "@/src/components/proposal/ProposalIndicatorsDetailModal";

const PAGE_SIZE = 20;

type ProposalListResponse = {
  data: Proposal[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function isPaginatedProposalResponse(value: unknown): value is ProposalListResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.data);
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string; icon: any }> = {
  DRAFT: { label: "Rascunho", color: "bg-slate-500/10 text-slate-600", icon: FileText },
  ANALYSIS: { label: "Em Análise", color: "bg-blue-500/10 text-blue-600", icon: Clock },
  SENT: { label: "Enviada", color: "bg-purple-500/10 text-purple-600", icon: ExternalLink },
  APPROVED: { label: "Aprovada", color: "bg-green-500/10 text-green-600", icon: CheckCircle2 },
  REJECTED: { label: "Rejeitada", color: "bg-red-500/10 text-red-600", icon: X },
  EXPIRED: { label: "Expirada", color: "bg-orange-500/10 text-orange-600", icon: AlertCircle },
  CANCELED: { label: "Cancelada", color: "bg-gray-500/10 text-gray-600", icon: Trash2 },
};

const PROPOSAL_STATUS_SELECT_OPTIONS = (Object.entries(STATUS_CONFIG) as [ProposalStatus, (typeof STATUS_CONFIG)["DRAFT"]][]).map(
  ([key, cfg]) => ({
    value: key,
    label: cfg.label,
    searchTerms: `${key} ${cfg.label}`,
  })
);

const FREIGHT_CONDITION_OPTIONS = [
  { value: "CIF", label: "CIF (Emitente)", searchTerms: "CIF emitente" },
  { value: "FOB", label: "FOB (Destinatário)", searchTerms: "FOB destinatario destinatário" },
];

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function safeOptionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function normalizeProposalItem(
  item: Partial<ProposalItem> & { productId: string }
): ProposalItem {
  return {
    ...item,
    productId: item.productId,
    Product: item.Product,
    id: item.id,
    proposalId: item.proposalId,
    quantity: safeNum(item.quantity, 1),
    unit: item.unit ?? "UN",
    unitCost: safeNum(item.unitCost),
    suggestedPrice: safeNum(item.suggestedPrice),
    negotiatedPrice: safeNum(item.negotiatedPrice),
    discountPerc: safeNum(item.discountPerc),
    discountValue: safeNum(item.discountValue),
    marginValue: safeNum(item.marginValue),
    marginPerc: safeNum(item.marginPerc),
    taxesPerc: safeNum(item.taxesPerc),
    taxesValue: safeNum(item.taxesValue),
    commissionPerc: safeNum(item.commissionPerc),
    commissionValue: safeNum(item.commissionValue),
    freightValue: safeNum(item.freightValue),
    notes: item.notes,
    calculationExplainability: item.calculationExplainability,
    priceTableItemId: item.priceTableItemId,
    priceSource: item.priceSource,
    pricingSnapshotJson: item.pricingSnapshotJson,
  };
}

type PriceTableListRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  defaultMarginPct: number;
  latestPublishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    publishedAt?: string | null;
  } | null;
};

type PublishedPriceDefaults = {
  unitCost: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  marginPerc: number;
  taxesValue: number;
  freightValue: number;
};

type PublishedPriceApiResponse = {
  priceSource: string;
  priceTable: { id: string; code: string; name: string; defaultMarginPct: number };
  version: { id: string; versionNumber: number; status: string };
  product: { id: string; sku: string; name: string };
  item: {
    priceTableItemId: string;
    salePrice: number;
    frozenTotalCost: number;
    marginPct: number;
  };
  proposalDefaults: PublishedPriceDefaults;
  warnings: Array<{ code: string; message: string }>;
};

function mapPublishedPriceHttpError(status: number, body: Record<string, unknown>): string {
  const code = typeof body.code === "string" ? body.code : "";
  if (code === "NO_PUBLISHED_PRICE_TABLE_VERSION") {
    return "A tabela selecionada não possui versão publicada vigente.";
  }
  if (code === "NO_PRICE_TABLE_ITEM") {
    return "Produto não encontrado na versão publicada da tabela selecionada.";
  }
  if (code === "PRODUCT_NOT_FOUND") {
    return "Produto não encontrado.";
  }
  const msg = typeof body.message === "string" ? body.message.trim() : "";
  if (msg) return msg;
  return "Não foi possível carregar o preço publicado deste produto.";
}

async function fetchPublishedPriceJson(
  priceTableId: string,
  productId: string
): Promise<PublishedPriceApiResponse> {
  const res = await fetch(`/api/price-tables/${priceTableId}/products/${productId}/published-price`);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw new Error(mapPublishedPriceHttpError(res.status, body));
  }
  return body as unknown as PublishedPriceApiResponse;
}

export const ProposalModule = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "form">("list");
  const [tourOpen, setTourOpen] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listStatusFilter, setListStatusFilter] = useState<"" | ProposalStatus>("");
  const [listResponsibleFilter, setListResponsibleFilter] = useState("");
  const [responsibleOptions, setResponsibleOptions] = useState<string[]>([]);
  const [listCustomerIdFilter, setListCustomerIdFilter] = useState("");
  const [listStartDate, setListStartDate] = useState("");
  const [listEndDate, setListEndDate] = useState("");
  const [listMinValue, setListMinValue] = useState("");
  const [listMaxValue, setListMaxValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalProposals, setTotalProposals] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [analysisProposalId, setAnalysisProposalId] = useState<string | null>(null);
  const [formTab, setFormTab] = useState<"items" | "indicators">("items");
  const [proposalIndicatorsDetailOpen, setProposalIndicatorsDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [salesOrderActionId, setSalesOrderActionId] = useState<string | null>(null);
  const [priceTables, setPriceTables] = useState<PriceTableListRow[]>([]);
  /** Avisos de preço publicado (piloto etc.) nesta sessão de edição; limpa ao mudar tabela. */
  const [tablePriceSessionAlerts, setTablePriceSessionAlerts] = useState<string[]>([]);
  /** Aviso discreto ao trocar a tabela padrão com itens já na proposta. */
  const [defaultTableChangedNotice, setDefaultTableChangedNotice] = useState<string | null>(null);

  // Form State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState<Partial<Proposal>>({
    title: "",
    customerId: "",
    status: "DRAFT",
    responsible: "",
    validityDays: 15,
    paymentTerms: "",
    paymentMethod: "",
    deliveryTimeDays: 7,
    freightCondition: "CIF",
    deliveryLocation: "",
    notes: "",
    items: []
  });

  const fetchReferenceData = useCallback(async () => {
    try {
      const [c, pr, r] = await Promise.all([
        fetchJsonOk<Customer[]>("/api/customers"),
        fetchJsonOk<Product[]>("/api/products"),
        fetchJsonOk<string[]>("/api/proposals/responsibles"),
      ]);
      setCustomers(Array.isArray(c) ? c : []);
      setProducts(Array.isArray(pr) ? pr : []);
      setResponsibleOptions(Array.isArray(r) ? r : []);
      let pt: PriceTableListRow[] = [];
      try {
        pt = await fetchJsonOk<PriceTableListRow[]>("/api/price-tables");
      } catch (e) {
        console.warn("GET /api/price-tables (propostas):", e);
      }
      setPriceTables(Array.isArray(pt) ? pt.filter((t) => String(t.status).toUpperCase() === "ACTIVE") : []);
    } catch (error) {
      console.error("Erro ao buscar cadastros:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar cadastros.");
    }
  }, []);

  const priceTableSelectOptions = useMemo((): SelectOption[] => {
    const opts: SelectOption[] = [
      {
        value: "",
        label: "Sem tabela / preço manual",
        searchTerms: "sem tabela manual legado pricing snapshot",
      },
    ];
    for (const t of priceTables) {
      const pub = t.latestPublishedVersion;
      if (!pub) continue;
      opts.push({
        value: t.id,
        label: `${t.name} (${t.code})`,
        sublabel: `Versão publicada v${pub.versionNumber}`,
        searchTerms: `${t.name} ${t.code} atacado varejo`,
      });
    }
    return opts;
  }, [priceTables]);

  const warningsFromItemSnapshots = useMemo(() => {
    const lines = new Set<string>();
    for (const it of formData.items || []) {
      const raw = it.pricingSnapshotJson?.warnings;
      if (!Array.isArray(raw)) continue;
      for (const w of raw) {
        if (w && typeof w === "object" && "message" in w && typeof (w as { message?: unknown }).message === "string") {
          const m = String((w as { message: string }).message).trim();
          if (m) lines.add(m);
        }
        if (typeof w === "string" && w.trim()) lines.add(w.trim());
      }
    }
    return Array.from(lines);
  }, [formData.items]);

  const mergedTablePriceAlerts = useMemo(() => {
    return Array.from(new Set([...warningsFromItemSnapshots, ...tablePriceSessionAlerts]));
  }, [warningsFromItemSnapshots, tablePriceSessionAlerts]);

  useEffect(() => {
    if (!defaultTableChangedNotice) return;
    const id = window.setTimeout(() => setDefaultTableChangedNotice(null), 10000);
    return () => window.clearTimeout(id);
  }, [defaultTableChangedNotice]);

  const handlePriceTableSelectionChange = useCallback(
    (nextTableId: string) => {
      const hasItems = (formData.items?.length ?? 0) > 0;
      const prevTrim = (formData.priceTableId ?? "").trim();
      const nextTrim = nextTableId.trim();
      const selectionChanged = prevTrim !== nextTrim;

      setTablePriceSessionAlerts([]);
      if (!nextTrim) {
        setFormData((prev) => ({
          ...prev,
          priceTableId: null,
          priceTableVersionId: null,
          priceTableCode: null,
          priceTableVersionNumber: null,
          priceSource: null,
        }));
        if (hasItems && selectionChanged) {
          setDefaultTableChangedNotice(
            "A tabela padrão foi alterada. Os itens já adicionados não foram recalculados; a nova tabela será usada apenas para os próximos itens."
          );
        }
        return;
      }
      const table = priceTables.find((t) => t.id === nextTrim);
      if (!table?.latestPublishedVersion) {
        alert("A tabela selecionada não possui versão publicada vigente.");
        return;
      }
      setFormData((prev) => ({
        ...prev,
        priceTableId: table.id,
        priceTableVersionId: table.latestPublishedVersion.id,
        priceTableCode: table.code,
        priceTableVersionNumber: table.latestPublishedVersion.versionNumber,
        priceSource: "PRICE_TABLE",
      }));
      if (hasItems && selectionChanged) {
        setDefaultTableChangedNotice(
          "A tabela padrão foi alterada. Os itens já adicionados não foram recalculados; a nova tabela será usada apenas para os próximos itens."
        );
      }
    },
    [formData.items, formData.priceTableId, priceTables]
  );

  const listFiltersKey = useMemo(
    () =>
      JSON.stringify({
        searchTerm,
        listStatusFilter,
        listResponsibleFilter,
        listCustomerIdFilter,
        listStartDate,
        listEndDate,
        listMinValue,
        listMaxValue,
      }),
    [
      searchTerm,
      listStatusFilter,
      listResponsibleFilter,
      listCustomerIdFilter,
      listStartDate,
      listEndDate,
      listMinValue,
      listMaxValue,
    ]
  );

  const listCustomerFilterOptions = useMemo((): SelectOption[] => {
    const sorted = customers
      .slice()
      .sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
    return [
      { value: "", label: "Todos os clientes", searchTerms: "todos todos os clientes" },
      ...sorted.map((c) => {
        const label = (c.companyName || c.tradeName || "Cliente").trim();
        const tax = (c.taxId || "").trim();
        const stateTax = (c.stateTaxId || "").trim();
        return {
          value: c.id,
          label,
          sublabel: tax ? `CNPJ/CPF: ${tax}` : undefined,
          searchTerms: [label, c.tradeName, c.companyName, tax, stateTax].filter(Boolean).join(" "),
        };
      }),
    ];
  }, [customers]);

  const listResponsibleFilterOptions = useMemo((): SelectOption[] => {
    return [
      { value: "", label: "Todos os responsáveis", searchTerms: "todos todos os responsáveis" },
      ...responsibleOptions.map((r) => ({
        value: r,
        label: r,
        searchTerms: r,
      })),
    ];
  }, [responsibleOptions]);

  const prevListFiltersKeyRef = useRef<string | null>(null);

  const loadProposalListPage = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        if (listStatusFilter) params.set("status", listStatusFilter);
        if (listResponsibleFilter.trim()) params.set("responsible", listResponsibleFilter.trim());
        if (listCustomerIdFilter) params.set("customerId", listCustomerIdFilter);
        if (listStartDate) params.set("startDate", listStartDate);
        if (listEndDate) params.set("endDate", listEndDate);
        if (listMinValue.trim()) params.set("minNetValue", listMinValue.trim());
        if (listMaxValue.trim()) params.set("maxNetValue", listMaxValue.trim());

        const response = await fetchJsonOk<ProposalListResponse | Proposal[]>(
          `/api/proposals?${params.toString()}`,
          { signal }
        );
        if (signal?.aborted) return;

        if (Array.isArray(response)) {
          const fallbackTotal = response.length;
          const safePage = Math.max(1, page);
          const start = (safePage - 1) * PAGE_SIZE;
          const raw = response.slice(start, start + PAGE_SIZE);
          setProposals(raw.slice(0, PAGE_SIZE));
          setCurrentPage(safePage);
          setTotalPages(Math.max(1, Math.ceil(fallbackTotal / PAGE_SIZE)));
          setTotalProposals(fallbackTotal);
        } else if (isPaginatedProposalResponse(response)) {
          const raw = response.data;
          setProposals(raw.slice(0, PAGE_SIZE));
          setCurrentPage(Number.isFinite(Number(response.page)) ? Number(response.page) : 1);
          setTotalPages(Number.isFinite(Number(response.totalPages)) ? Math.max(1, Number(response.totalPages)) : 1);
          setTotalProposals(Number.isFinite(Number(response.total)) ? Number(response.total) : 0);
        } else {
          setProposals([]);
          setCurrentPage(1);
          setTotalPages(1);
          setTotalProposals(0);
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        console.error("Erro ao buscar propostas:", error);
        alert(error instanceof Error ? error.message : "Não foi possível carregar propostas.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [
      searchTerm,
      listStatusFilter,
      listResponsibleFilter,
      listCustomerIdFilter,
      listStartDate,
      listEndDate,
      listMinValue,
      listMaxValue,
    ]
  );

  useEffect(() => {
    void fetchReferenceData();
  }, [fetchReferenceData]);

  useEffect(() => {
    const ac = new AbortController();
    const prevKey = prevListFiltersKeyRef.current;
    const filtersChanged = prevKey !== null && prevKey !== listFiltersKey;
    prevListFiltersKeyRef.current = listFiltersKey;

    const pageToFetch = filtersChanged ? 1 : currentPage;
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
    }

    void loadProposalListPage(pageToFetch, ac.signal);

    return () => ac.abort();
  }, [currentPage, listFiltersKey, loadProposalListPage]);

  const handleCreateNew = () => {
    setEditingProposal(null);
    setFormTab("items");
    setProposalIndicatorsDetailOpen(false);
    setTablePriceSessionAlerts([]);
    setDefaultTableChangedNotice(null);
    setFormData({
      title: "",
      customerId: "",
      status: "DRAFT",
      responsible: "",
      validityDays: 15,
      paymentTerms: "",
      paymentMethod: "",
      deliveryTimeDays: 7,
      freightCondition: "CIF",
      deliveryLocation: "",
      notes: "",
      items: [],
    });
    setAnalysisProposalId(null);
    setView("form");
  };

  const handleEdit = useCallback(async (id: string) => {
    setAnalysisProposalId(null);
    setLoading(true);
    try {
      const data = await fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${id}`);
      const items = Array.isArray(data.items)
        ? data.items.map((it: ProposalItem) => normalizeProposalItem(it))
        : [];
      setEditingProposal(data);
      setTablePriceSessionAlerts([]);
      setDefaultTableChangedNotice(null);
      setFormData({ ...data, items });
      setFormTab("items");
    setProposalIndicatorsDetailOpen(false);
      setView("form");
    } catch (error) {
      console.error("Erro ao buscar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível abrir a proposta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      return;
    }
    if (!id) return;
    try {
      sessionStorage.removeItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      /* ignore */
    }
    void handleEdit(id);
  }, [loading, handleEdit]);

  const buildSavePayload = useCallback(() => {
    const status =
      typeof formData.status === "string" &&
      PROPOSAL_STATUS_SELECT_OPTIONS.some((o) => o.value === formData.status)
        ? (formData.status as ProposalStatus)
        : "DRAFT";

    const items = (formData.items || []).map((raw) => {
      const item = normalizeProposalItem(raw as ProposalItem);
      const row: Record<string, unknown> = {
        productId: item.productId,
        quantity: safeNum(item.quantity, 1),
        unit: item.unit ?? "UN",
        unitCost: safeNum(item.unitCost),
        suggestedPrice: safeNum(item.suggestedPrice),
        negotiatedPrice: safeNum(item.negotiatedPrice),
        discountPerc: safeNum(item.discountPerc),
        discountValue: safeNum(item.discountValue),
        marginValue: safeNum(item.marginValue),
        marginPerc: safeNum(item.marginPerc),
        taxesPerc: safeNum(item.taxesPerc),
        taxesValue: safeNum(item.taxesValue),
        commissionPerc: safeNum(item.commissionPerc),
        commissionValue: safeNum(item.commissionValue),
        freightValue: safeNum(item.freightValue),
        notes: item.notes ?? null,
      };
      if (item.priceTableItemId !== undefined) row.priceTableItemId = item.priceTableItemId;
      if (item.priceSource !== undefined) row.priceSource = item.priceSource;
      if (item.pricingSnapshotJson !== undefined) row.pricingSnapshotJson = item.pricingSnapshotJson;
      return row;
    });

    const payload: Record<string, unknown> = {
      title: formData.title?.trim() || null,
      customerId: formData.customerId,
      status,
      responsible: formData.responsible?.trim() || null,
      companyIssuer: formData.companyIssuer?.trim() || null,
      validityDays: safeInt(formData.validityDays, 15),
      paymentTerms: formData.paymentTerms?.trim() || null,
      paymentMethod: formData.paymentMethod?.trim() || null,
      deliveryTimeDays: safeOptionalInt(formData.deliveryTimeDays),
      freightCondition: formData.freightCondition || "CIF",
      deliveryLocation: formData.deliveryLocation?.trim() || null,
      notes: formData.notes?.trim() || null,
      internalNotes: formData.internalNotes?.trim() || null,
      totalItems: safeInt(formData.totalItems, 0),
      totalGrossValue: safeNum(formData.totalGrossValue),
      totalDiscount: safeNum(formData.totalDiscount),
      totalNetValue: safeNum(formData.totalNetValue),
      totalCost: safeNum(formData.totalCost),
      totalMarginValue: safeNum(formData.totalMarginValue),
      totalMarginPerc: safeNum(formData.totalMarginPerc),
      totalTaxes: safeNum(formData.totalTaxes),
      totalCommission: safeNum(formData.totalCommission),
      totalFreight: safeNum(formData.totalFreight),
      items,
    };
    if (formData.priceTableId !== undefined) payload.priceTableId = formData.priceTableId;
    if (formData.priceTableVersionId !== undefined) payload.priceTableVersionId = formData.priceTableVersionId;
    if (formData.priceTableCode !== undefined) payload.priceTableCode = formData.priceTableCode;
    if (formData.priceTableVersionNumber !== undefined) payload.priceTableVersionNumber = formData.priceTableVersionNumber;
    if (formData.priceSource !== undefined) payload.priceSource = formData.priceSource;
    return payload;
  }, [formData]);

  const handleSave = async () => {
    if (saving) return;
    if (!formData.customerId) {
      alert("Selecione um cliente.");
      return;
    }
    if (!formData.items || formData.items.length === 0) {
      alert("Adicione pelo menos um item à proposta.");
      return;
    }

    const method = editingProposal ? "PUT" : "POST";
    const url = editingProposal ? `/api/proposals/${editingProposal.id}` : "/api/proposals";

    try {
      setSaving(true);
      const payload = buildSavePayload();
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadProposalListPage(currentPage);
      setView("list");
    } catch (error) {
      console.error("Erro ao salvar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a proposta.");
    } finally {
      setSaving(false);
    }
  };

  const handleSalesOrderFromProposal = useCallback(
    async (p: Proposal) => {
      if (p.salesOrder?.id) {
        navigate(`/sales-orders/${p.salesOrder.id}`);
        return;
      }
      setSalesOrderActionId(p.id);
      try {
        const res = await fetchJsonOk<{ salesOrder: { id: string } }>(`/api/proposals/${p.id}/generate-sales-order`, {
          method: "POST",
        });
        navigate(`/sales-orders/${res.salesOrder.id}`);
        void loadProposalListPage(currentPage);
      } catch (error) {
        console.error("Erro ao gerar pedido de venda:", error);
        alert(error instanceof Error ? error.message : "Não foi possível gerar o pedido de venda.");
      } finally {
        setSalesOrderActionId(null);
      }
    },
    [navigate, loadProposalListPage, currentPage]
  );

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta proposta permanentemente?")) return;
    try {
      await fetchOk(`/api/proposals/${id}`, { method: "DELETE" });
      void loadProposalListPage(currentPage);
    } catch (error) {
      console.error("Erro ao excluir proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir a proposta.");
    }
  };

  const addItem = async (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const selectedTableId = formData.priceTableId?.trim() || "";

    try {
      const qty = 1;

      if (selectedTableId) {
        const data = await fetchPublishedPriceJson(selectedTableId, productId);
        const df = data.proposalDefaults;
        const unitCost = safeNum(df.unitCost);
        const suggestedPrice = safeNum(df.suggestedPrice);
        const negotiatedPrice = safeNum(df.negotiatedPrice);
        const taxesValueFixed = safeNum(df.taxesValue);
        const freightVal = safeNum(df.freightValue);
        const marginPercFromTable = safeNum(df.marginPerc);
        const gross = qty * suggestedPrice;
        const totalCost = qty * unitCost;
        const taxesPerc = gross > 0 ? safeNum((taxesValueFixed / gross) * 100) : 0;
        const commissionPerc = 0;
        const commissionValue = 0;
        const marginValue = safeNum(
          gross - taxesValueFixed - commissionValue - freightVal - totalCost
        );

        const snapshotPayload: Record<string, unknown> = {
          ...(data as unknown as Record<string, unknown>),
          capturedAt: new Date().toISOString(),
        };

        const newItem = normalizeProposalItem({
          productId,
          Product: product,
          quantity: qty,
          unit: "UN",
          unitCost,
          suggestedPrice,
          negotiatedPrice,
          discountPerc: 0,
          discountValue: 0,
          marginValue,
          marginPerc: marginPercFromTable,
          taxesPerc,
          taxesValue: taxesValueFixed,
          commissionPerc,
          commissionValue,
          freightValue: freightVal,
          priceTableItemId: data.item.priceTableItemId,
          priceSource: "PRICE_TABLE",
          pricingSnapshotJson: snapshotPayload,
        });

        const warnMsgs = (data.warnings ?? [])
          .map((w) => (typeof w?.message === "string" ? w.message.trim() : ""))
          .filter(Boolean);
        if (warnMsgs.length) {
          setTablePriceSessionAlerts((prev) => Array.from(new Set([...prev, ...warnMsgs])));
        }

        setFormData((prev) => ({
          ...prev,
          items: [...(prev.items || []), newItem],
        }));
        return;
      }

      const snapshot = await fetchJsonOk<{
        unitCost?: unknown;
        suggestedPrice?: unknown;
        taxesPerc?: unknown;
        commissionPerc?: unknown;
        freightValue?: unknown;
        calculationExplainability?: ProposalItem["calculationExplainability"];
      }>(`/api/products/${productId}/pricing-snapshot`);

      const unitCost = safeNum(snapshot.unitCost);
      const suggestedPrice = safeNum(snapshot.suggestedPrice);
      const taxesPerc = safeNum(snapshot.taxesPerc);
      const commissionPerc = safeNum(snapshot.commissionPerc);
      const freightVal = safeNum(snapshot.freightValue);

      const gross = qty * suggestedPrice;
      const totalCost = qty * unitCost;
      const taxesValue = gross * (taxesPerc / 100);
      const commissionValue = gross * (commissionPerc / 100);
      const marginValue = safeNum(
        gross - taxesValue - commissionValue - freightVal - totalCost
      );
      const marginPerc = gross > 0 ? safeNum((marginValue / gross) * 100) : 0;

      const newItem = normalizeProposalItem({
        productId,
        Product: product,
        quantity: qty,
        unit: "UN",
        unitCost,
        suggestedPrice,
        negotiatedPrice: suggestedPrice,
        discountPerc: 0,
        discountValue: 0,
        marginValue,
        marginPerc,
        taxesPerc,
        taxesValue,
        commissionPerc,
        commissionValue,
        freightValue: freightVal,
        calculationExplainability: snapshot.calculationExplainability,
      });

      setFormData((prev) => ({
        ...prev,
        items: [...(prev.items || []), newItem],
      }));
    } catch (error) {
      console.error("Erro ao adicionar item:", error);
      alert(error instanceof Error ? error.message : "Não foi possível obter preço/custo do produto.");
    }
  };

  const updateItem = (index: number, updates: Partial<ProposalItem>) => {
    const newItems = [...(formData.items || [])];
    const merged = { ...newItems[index], ...updates };
    if (updates.unitCost !== undefined || updates.suggestedPrice !== undefined) {
      (merged as ProposalItem).calculationExplainability = undefined;
    }
    let item = normalizeProposalItem(merged);

    const qty = safeNum(item.quantity);
    const negotiated = safeNum(item.negotiatedPrice);
    const unitCost = safeNum(item.unitCost);
    const gross = qty * negotiated;

    if (updates.discountPerc !== undefined) {
      item.discountValue = safeNum(gross * (safeNum(item.discountPerc) / 100));
    } else if (updates.discountValue !== undefined) {
      const dv = safeNum(item.discountValue);
      item.discountPerc = gross > 0 ? safeNum((dv / gross) * 100) : 0;
      item.discountValue = dv;
    }

    const discountVal = safeNum(item.discountValue);
    const net = gross - discountVal;
    const totalCost = qty * unitCost;

    item.taxesValue = safeNum(net * (safeNum(item.taxesPerc) / 100));
    item.commissionValue = safeNum(net * (safeNum(item.commissionPerc) / 100));

    const freight = safeNum(item.freightValue);
    item.marginValue = safeNum(
      net - item.taxesValue - item.commissionValue - freight - totalCost
    );
    item.marginPerc = net > 0 ? safeNum((item.marginValue / net) * 100) : 0;

    newItems[index] = normalizeProposalItem(item);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const removeItem = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  // Totais Consolidados
  const totals = useMemo(() => {
    const items = formData.items || [];
    const totalGross = items.reduce(
      (acc, i) => acc + safeNum(i.quantity) * safeNum(i.negotiatedPrice),
      0
    );
    const totalDiscount = items.reduce((acc, i) => acc + safeNum(i.discountValue), 0);
    const totalNet = totalGross - totalDiscount;
    const totalCost = items.reduce(
      (acc, i) => acc + safeNum(i.quantity) * safeNum(i.unitCost),
      0
    );
    const totalTaxes = items.reduce((acc, i) => acc + safeNum(i.taxesValue), 0);
    const totalComm = items.reduce((acc, i) => acc + safeNum(i.commissionValue), 0);
    const totalFreight = items.reduce((acc, i) => acc + safeNum(i.freightValue), 0);
    
    const totalMarginValue = totalNet - totalTaxes - totalComm - totalFreight - totalCost;
    const totalMarginPerc = totalNet > 0 ? (totalMarginValue / totalNet) * 100 : 0;

    return {
      totalItems: items.length,
      totalGross,
      totalDiscount,
      totalNet,
      totalCost,
      totalTaxes,
      totalComm,
      totalFreight,
      totalMarginValue,
      totalMarginPerc
    };
  }, [formData.items]);

  // Sincronizar totais com o formData para salvar
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      totalItems: totals.totalItems,
      totalGrossValue: totals.totalGross,
      totalDiscount: totals.totalDiscount,
      totalNetValue: totals.totalNet,
      totalCost: totals.totalCost,
      totalTaxes: totals.totalTaxes,
      totalCommission: totals.totalComm,
      totalFreight: totals.totalFreight,
      totalMarginValue: totals.totalMarginValue,
      totalMarginPerc: totals.totalMarginPerc
    }));
  }, [totals]);

  const filteredProposals = proposals;
  const pagedProposals = useMemo(() => filteredProposals.slice(0, PAGE_SIZE), [filteredProposals]);

  const listShownRange = useMemo(() => {
    if (totalProposals === 0 || pagedProposals.length === 0) return { from: 0, to: 0 };
    const from = (currentPage - 1) * PAGE_SIZE + 1;
    const to = from + pagedProposals.length - 1;
    return { from, to };
  }, [totalProposals, currentPage, pagedProposals.length]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListStatusFilter("");
    setListResponsibleFilter("");
    setListCustomerIdFilter("");
    setListStartDate("");
    setListEndDate("");
    setListMinValue("");
    setListMaxValue("");
  };

  if (view === "form") {
    return (
      <div className="space-y-6 pb-20" data-tour="proposals-root">
        {/* Form Header */}
        <div className="flex items-center justify-between" data-tour="proposals-form-actions">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("list")}
              className="p-2 rounded-full hover:bg-accent transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h3 className="text-2xl font-bold">
                {editingProposal ? `Editar Proposta #${editingProposal.number}` : "Nova Proposta Comercial"}
              </h3>
              <p className="text-sm text-muted-foreground">Preencha os dados e configure os itens para gerar a proposta.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TourHelpButton onClick={() => setTourOpen(true)} />
            <div className={cn("min-w-[200px]", STATUS_CONFIG[formData.status as ProposalStatus]?.color, "rounded-lg border border-border p-0.5")}>
              <SearchableSelect
                className="border-0 bg-transparent"
                placeholder="Status..."
                options={PROPOSAL_STATUS_SELECT_OPTIONS}
                value={formData.status || "DRAFT"}
                onChange={(v) => setFormData({ ...formData, status: v as ProposalStatus })}
              />
            </div>
            <button 
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity shadow-lg"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar Proposta"}
            </button>
          </div>
        </div>

        {(formData.priceSource === "PRICE_TABLE" && formData.priceTableCode && formData.priceTableVersionNumber != null) ||
        mergedTablePriceAlerts.length > 0 ||
        defaultTableChangedNotice ? (
          <div className="space-y-2">
            {formData.priceSource === "PRICE_TABLE" &&
              formData.priceTableCode &&
              formData.priceTableVersionNumber != null && (
                <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-900 dark:border-emerald-700 dark:bg-emerald-50">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" aria-hidden />
                  <div className="text-slate-900">
                    Tabela padrão para novos itens:{" "}
                    <span className="font-semibold text-emerald-950">
                      {formData.priceTableCode} v{formData.priceTableVersionNumber}
                    </span>
                    .
                  </div>
                </div>
              )}
            {defaultTableChangedNotice && (
              <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-900 dark:border-slate-600 dark:bg-slate-100 dark:text-slate-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" aria-hidden />
                <p>{defaultTableChangedNotice}</p>
              </div>
            )}
            {mergedTablePriceAlerts.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-slate-900 dark:border-amber-700 dark:bg-amber-50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-900" aria-hidden />
                <div className="min-w-0 flex-1 text-slate-900">
                  <p className="font-semibold text-amber-950">
                    A tabela publicada possui avisos. Revise antes de enviar a proposta.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-900">
                    {mergedTablePriceAlerts.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Client & Conditions */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Cliente e Cabeçalho
              </h4>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Título da Proposta</label>
                  <input
                    type="text"
                    placeholder="Ex: Fornecimento de Peças - Projeto X"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Cliente</label>
                  <SearchableSelect
                    required
                    placeholder="Selecione um cliente..."
                    options={customers.map((c) => {
                      const primary = (c.companyName || c.tradeName || "").trim() || "Cliente";
                      const sub =
                        c.tradeName && c.companyName && c.tradeName !== c.companyName
                          ? c.tradeName
                          : c.taxId || undefined;
                      return {
                        value: c.id,
                        label: primary,
                        sublabel: sub,
                        searchTerms: [c.companyName, c.tradeName, c.taxId].filter(Boolean).join(" "),
                      };
                    })}
                    value={formData.customerId || ""}
                    onChange={(val) => setFormData({...formData, customerId: val})}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">
                    Tabela padrão para novos itens
                  </label>
                  <SearchableSelect
                    placeholder="Sem tabela / preço manual"
                    options={priceTableSelectOptions}
                    value={formData.priceTableId ?? ""}
                    unknownSelectionLabel="Tabela não listada (verifique cadastro ou publicação)"
                    onChange={(val) => handlePriceTableSelectionChange(val ?? "")}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Esta tabela será usada apenas para novos itens. Itens já adicionados mantêm a origem de preço em
                    que foram criados. Só aparecem tabelas ativas com versão publicada.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Responsável</label>
                    <input
                      type="text"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.responsible}
                      onChange={(e) => setFormData({...formData, responsible: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Validade (Dias)</label>
                    <input
                      type="number"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.validityDays}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          validityDays: safeInt(e.target.value, 15),
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Truck className="h-4 w-4" /> Condições Comerciais
              </h4>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Condição de Pagamento</label>
                  <input
                    type="text"
                    placeholder="Ex: 30/60/90 dias"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({...formData, paymentTerms: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Frete</label>
                    <SearchableSelect
                      placeholder="Condição de frete..."
                      options={FREIGHT_CONDITION_OPTIONS}
                      value={formData.freightCondition || "CIF"}
                      onChange={(v) => setFormData({ ...formData, freightCondition: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Prazo Entrega (Dias)</label>
                    <input
                      type="number"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.deliveryTimeDays}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          deliveryTimeDays: safeOptionalInt(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Local de Entrega</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.deliveryLocation}
                    onChange={(e) => setFormData({...formData, deliveryLocation: e.target.value})}
                  />
                </div>
              </div>
            </div>

            {/* Internal Notes */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Notas Internas</h4>
              <textarea
                rows={4}
                placeholder="Observações que não aparecem no PDF da proposta..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.internalNotes}
                onChange={(e) => setFormData({...formData, internalNotes: e.target.value})}
              />
            </div>
          </div>

          {/* Right Column: Items Grid */}
          <div className="lg:col-span-2 space-y-6">
            <div
              className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[600px]"
              data-tour="proposals-form-items"
            >
              <div className="p-4 border-b border-border bg-accent/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold flex items-center gap-2">
                    <Package className="h-4 w-4" /> Proposta — Edição
                  </h4>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-card/40 p-1">
                    <button
                      type="button"
                      onClick={() => setFormTab("items")}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-bold transition-colors",
                        formTab === "items"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      Itens
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormTab("indicators")}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-bold transition-colors",
                        formTab === "indicators"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      Indicadores
                    </button>
                  </div>
                </div>
                {formTab === "items" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-64">
                      <SearchableSelect
                        placeholder="+ Adicionar Produto..."
                        options={products.map((p) => ({
                          value: p.id,
                          label: `${p.sku} — ${p.name}`,
                          sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                          searchTerms: `${p.sku} ${p.name}`,
                        }))}
                        value=""
                        onChange={(val) => val && addItem(val)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {formTab === "items" ? (
                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-accent/20 border-b border-border">
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Produto</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground w-20">Qtd</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Custo Unit.</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Sugerido</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Negociado</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground w-20">Desc %</th>
                        <th
                          className="p-3 text-[10px] font-bold uppercase text-muted-foreground max-w-[120px]"
                          title="Margem líquida sobre faturamento bruto da linha, após impostos, comissão, frete e custo industrial (CIU do motor)."
                        >
                          Margem líq. %
                        </th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-right">Total Líq.</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {formData.items?.map((item, idx) => (
                        <tr key={idx} className="hover:bg-accent/10 transition-colors group">
                          <td className="p-3">
                            <div className="max-w-[200px]">
                              <p className="text-xs font-bold truncate">{item.Product?.sku}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{item.Product?.name}</p>
                              {item.priceSource === "PRICE_TABLE" && (
                                <span
                                  className="mt-1 inline-block rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
                                  title="Preço congelado da tabela publicada"
                                >
                                  Preço da tabela
                                  {(() => {
                                    const s = item.pricingSnapshotJson as Record<string, unknown> | null | undefined;
                                    const pt = s?.priceTable as { code?: string } | undefined;
                                    const ver = s?.version as { versionNumber?: unknown } | undefined;
                                    const vn = Number(ver?.versionNumber);
                                    if (pt?.code && Number.isFinite(vn)) {
                                      return ` · ${pt.code} v${vn}`;
                                    }
                                    return "";
                                  })()}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs outline-none"
                              value={item.quantity}
                              onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3 text-xs font-mono text-muted-foreground">
                            <CalculatedValue meta={item.calculationExplainability?.unitCost ?? null} hideIcon>
                              <span>
                                {safeNum(item.unitCost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 5 })}
                              </span>
                            </CalculatedValue>
                          </td>
                          <td className="p-3 text-xs font-mono text-blue-600 font-medium">
                            <CalculatedValue meta={item.calculationExplainability?.suggestedPrice ?? null} hideIcon>
                              <span>
                                {safeNum(item.suggestedPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 5 })}
                              </span>
                            </CalculatedValue>
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-primary"
                              value={item.negotiatedPrice}
                              onChange={(e) => updateItem(idx, { negotiatedPrice: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs outline-none"
                              value={item.discountPerc}
                              onChange={(e) => updateItem(idx, { discountPerc: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3">
                            <CalculatedValue
                              hideIcon
                              meta={buildProposalLineMarginExplanation({
                                quantity: safeNum(item.quantity),
                                negotiatedPrice: safeNum(item.negotiatedPrice),
                                discountValue: safeNum(item.discountValue),
                                taxesValue: safeNum(item.taxesValue),
                                commissionValue: safeNum(item.commissionValue),
                                freightValue: safeNum(item.freightValue),
                                unitCost: safeNum(item.unitCost),
                                marginValue: safeNum(item.marginValue),
                                marginPerc: safeNum(item.marginPerc),
                              })}
                            >
                              <div
                                className={cn(
                                  "text-xs font-bold",
                                  safeNum(item.marginPerc) >= 20
                                    ? "text-green-600"
                                    : safeNum(item.marginPerc) >= 10
                                      ? "text-orange-600"
                                      : "text-red-600"
                                )}
                              >
                                {safeNum(item.marginPerc).toFixed(3)}%
                              </div>
                            </CalculatedValue>
                          </td>
                          <td className="p-3 text-right text-xs font-bold font-mono">
                            {(safeNum(item.quantity) * safeNum(item.negotiatedPrice) - safeNum(item.discountValue)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3 text-center">
                            <button 
                              onClick={() => removeItem(idx)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(!formData.items || formData.items.length === 0) && (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-muted-foreground italic text-sm">
                            Nenhum produto adicionado. Use o seletor acima para começar.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4">
                  <ProposalIndicatorsTab
                    proposalNumber={editingProposal?.number ?? null}
                    proposalTitle={formData.title ?? null}
                    proposalId={editingProposal?.id ?? null}
                    onOpenDetailed={() => setProposalIndicatorsDetailOpen(true)}
                    items={formData.items || []}
                    totals={{
                      totalGrossValue: totals.totalGross,
                      totalDiscount: totals.totalDiscount,
                      totalNetValue: totals.totalNet,
                      totalTaxes: totals.totalTaxes,
                      totalCommission: totals.totalComm,
                      totalFreight: totals.totalFreight,
                      totalMarginValue: totals.totalMarginValue,
                      totalMarginPerc: totals.totalMarginPerc,
                    }}
                  />
                </div>
              )}

              {/* Summary Footer */}
              <div className="p-6 bg-accent/30 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Valor Bruto Total</p>
                  <p className="text-lg font-bold font-mono">{totals.totalGross.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Descontos Concedidos</p>
                  <p className="text-lg font-bold font-mono text-red-600">-{totals.totalDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Receita Líquida</p>
                  <p className="text-lg font-bold font-mono text-primary">{totals.totalNet.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1 border-l border-border pl-6">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Margem de Contribuição</p>
                  <div className="flex items-baseline gap-2">
                    <p className={cn(
                      "text-lg font-bold font-mono",
                      totals.totalMarginPerc >= 20 ? "text-green-600" : totals.totalMarginPerc >= 10 ? "text-orange-600" : "text-red-600"
                    )}>
                      {totals.totalMarginPerc.toFixed(3)}%
                    </p>
                    <span className="text-xs text-muted-foreground">({totals.totalMarginValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</span>
                  </div>
                </div>
              </div>
            </div>

            <ProposalIndicatorsDetailModal
              open={proposalIndicatorsDetailOpen}
              onClose={() => setProposalIndicatorsDetailOpen(false)}
              proposalNumber={editingProposal?.number ?? null}
              proposalTitle={formData.title ?? null}
              proposalId={editingProposal?.id ?? null}
              items={formData.items || []}
              totals={{
                totalGrossValue: totals.totalGross,
                totalDiscount: totals.totalDiscount,
                totalNetValue: totals.totalNet,
                totalTaxes: totals.totalTaxes,
                totalCommission: totals.totalComm,
                totalFreight: totals.totalFreight,
                totalMarginValue: totals.totalMarginValue,
                totalMarginPerc: totals.totalMarginPerc,
              }}
            />

            {/* General Notes for PDF */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4" /> Observações da Proposta (PDF)
              </h4>
              <textarea
                rows={4}
                placeholder="Condições especiais, validade, observações técnicas..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
              />
            </div>
          </div>
        </div>

        <GuidedTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={PROPOSAL_TOUR_STEPS}
          tourName="Tour de Propostas"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-tour="proposals-root">
      {/* List Header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="proposals-toolbar"
      >
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-col xl:flex-row xl:items-center gap-2">
            <div className="relative w-full xl:flex-1 xl:min-w-[260px] xl:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por número, cliente ou título..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="w-full xl:w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value as any)}
            >
              <option value="">Todos os status</option>
              {(Object.keys(STATUS_CONFIG) as ProposalStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s]?.label ?? s}
                </option>
              ))}
            </select>

            <SearchableSelect
              className="w-full xl:w-[200px]"
              options={listResponsibleFilterOptions}
              value={listResponsibleFilter}
              onChange={(v) => setListResponsibleFilter(v)}
              placeholder="Todos os responsáveis"
              searchInputPlaceholder="Buscar responsável..."
              emptyMessage="Nenhum responsável encontrado"
              pinOptionValues={[""]}
              listMaxHeight={320}
            />

            <SearchableSelect
              className="w-full xl:w-[220px]"
              options={listCustomerFilterOptions}
              value={listCustomerIdFilter}
              onChange={(v) => setListCustomerIdFilter(v)}
              placeholder="Todos os clientes"
              searchInputPlaceholder="Buscar cliente..."
              emptyMessage="Nenhum cliente encontrado"
              pinOptionValues={[""]}
              listMaxHeight={320}
            />
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Período</label>
              <input
                type="date"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                value={listStartDate}
                onChange={(e) => setListStartDate(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="date"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                value={listEndDate}
                onChange={(e) => setListEndDate(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Valor líquido</label>
              <input
                type="number"
                inputMode="decimal"
                className="w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="mín."
                value={listMinValue}
                onChange={(e) => setListMinValue(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="number"
                inputMode="decimal"
                className="w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="máx."
                value={listMaxValue}
                onChange={(e) => setListMaxValue(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {totalProposals === 0 ? (
                <>Nenhuma proposta no filtro atual.</>
              ) : (
                <>
                  Exibindo{" "}
                  <span className="font-bold text-foreground">
                    {listShownRange.from}–{listShownRange.to}
                  </span>{" "}
                  de <span className="font-bold text-foreground">{totalProposals}</span> proposta(s).
                </>
              )}
            </p>
            <button
              type="button"
              onClick={clearListFilters}
              disabled={
                !searchTerm.trim() &&
                !listStatusFilter &&
                !listResponsibleFilter.trim() &&
                !listCustomerIdFilter &&
                !listStartDate &&
                !listEndDate &&
                !listMinValue.trim() &&
                !listMaxValue.trim()
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
            >
              <X className="h-4 w-4" />
              Limpar filtros
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Nova Proposta
          </button>
        </div>
      </div>

      {/* Proposals List */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="proposals-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Nº / Título</th>
                <th className="p-4 font-semibold text-sm">Cliente</th>
                <th className="p-4 font-semibold text-sm">Data</th>
                <th className="p-4 font-semibold text-sm">Valor Líquido</th>
                <th className="p-4 font-semibold text-sm">Margem</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando propostas...</p>
                  </td>
                </tr>
              ) : pagedProposals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhuma proposta encontrada.
                  </td>
                </tr>
              ) : (
                pagedProposals.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">#{p.number}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">{p.title || "Sem título"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{p.Customer?.companyName}</p>
                      <p className="text-[10px] text-muted-foreground">{p.Customer?.taxId}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" /> {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-sm font-bold">
                      {Number.isFinite(Number(p.totalNetValue))
                        ? Number(p.totalNetValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "—"}
                    </td>
                    <td className="p-4">
                      {Number.isFinite(Number(p.totalMarginPerc)) ? (
                      <div className={cn(
                        "text-xs font-bold",
                        Number(p.totalMarginPerc) >= 20 ? "text-green-600" : Number(p.totalMarginPerc) >= 10 ? "text-orange-600" : "text-red-600"
                      )}>
                        {Number(p.totalMarginPerc).toFixed(3)}%
                      </div>
                      ) : (
                        <div className="text-xs font-bold text-muted-foreground">—</div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        STATUS_CONFIG[p.status]?.color
                      )}>
                        {STATUS_CONFIG[p.status]?.label}
                      </div>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap align-middle">
                      <div className="inline-flex flex-shrink-0 items-center justify-end gap-1.5">
                        {p.status === "APPROVED" ? (
                          <button
                            type="button"
                            onClick={() => void handleSalesOrderFromProposal(p)}
                            disabled={salesOrderActionId === p.id}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-violet-600 transition-all disabled:opacity-50"
                            title={p.salesOrder ? "Abrir pedido de venda" : "Gerar pedido de venda"}
                          >
                            {salesOrderActionId === p.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setAnalysisProposalId(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-emerald-600 transition-all"
                          title="Análise (dashboard)"
                        >
                          <LayoutDashboard className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleEdit(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => window.open(`/proposals/${p.id}/print`, "_blank", "noopener,noreferrer")}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-blue-500 transition-all"
                          title="Imprimir proposta"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Página <span className="font-semibold text-foreground">{currentPage}</span> de{" "}
          <span className="font-semibold text-foreground">{totalPages}</span> · {PAGE_SIZE} por página
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            <ArrowLeft className="h-4 w-4" />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PROPOSAL_TOUR_STEPS}
        tourName="Tour de Propostas"
      />

      <ProposalAnalysisModal
        open={analysisProposalId !== null}
        proposalId={analysisProposalId}
        onClose={() => setAnalysisProposalId(null)}
        onEdit={handleEdit}
      />
    </div>
  );
};
