import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Edit2,
  Eye,
  Loader2,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  ExternalLink,
  AlertTriangle,
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
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PURCHASE_TOUR_STEPS } from "@/src/tours/purchaseTourSteps";
import { motion } from "motion/react";
import { filterPurchaseRequests } from "@/src/lib/operationalListFilters";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando gestor",
  ABERTA: "Aguardando comprador",
  REJEITADA: "Rejeitada",
  EM_COTACAO: "Em orçamentação",
  CANCELADA: "Cancelada",
  ENCERRADA: "Pedido emitido",
};

const PRIORITY_LABEL: Record<PurchasePriority, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

const LINE_TYPE_LABEL = {
  MATERIA_PRIMA: "Matéria-prima",
  INDIRETO: "Indireto / insumo / uso geral",
} as const;

function MaterialMpSummaryCard({ material: m, readOnly: ro }: { material: Material; readOnly: boolean }) {
  const cat = m.category.replace(/_/g, " ");
  const active = m.status === "ACTIVE";
  return (
    <div
      className={cn(
        "rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3 text-sm",
        ro && "opacity-95"
      )}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Material vinculado (cadastro Suprimentos)</p>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">{m.code}</p>
          <p className="font-medium leading-snug">{m.description}</p>
        </div>
        <span
          className={cn(
            "text-[10px] font-bold uppercase px-2 py-1 rounded-full shrink-0",
            active ? "bg-green-500/15 text-green-800" : "bg-amber-500/15 text-amber-900"
          )}
        >
          {active ? "Ativo no cadastro" : "Inativo no cadastro"}
        </span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Unidade</dt>
          <dd className="font-medium">{m.unit}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Categoria</dt>
          <dd className="font-medium">{cat}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Custo atual</dt>
          <dd className="font-medium">{formatCurrency(m.currentCost)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Custo médio</dt>
          <dd className="font-medium">{formatCurrency(m.averageCost)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Custo padrão</dt>
          <dd className="font-medium">{formatCurrency(m.standardCost)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Frete (cadastro)</dt>
          <dd className="font-medium">{formatCurrency(m.freight ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fator de conversão</dt>
          <dd className="font-medium">{formatNumber(m.conversionFactor ?? 1, 4)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Perda padrão</dt>
          <dd className="font-medium">{formatNumber(m.standardLoss ?? 0, 2)}%</dd>
        </div>
        {m.supplier ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Fornecedor no cadastro</dt>
            <dd className="font-medium">{m.supplier}</dd>
          </div>
        ) : null}
        {m.calculations ? (
          <>
            <div>
              <dt className="text-muted-foreground">Posto fábrica (ref. cadastro)</dt>
              <dd className="font-medium">{formatCurrency(m.calculations.landedCost)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Efetivo c/ perda (ref. cadastro)</dt>
              <dd className="font-medium">{formatCurrency(m.calculations.effectiveCost)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-2">
        Valores acima vêm do cadastro de materiais. Esta solicitação <strong>não altera</strong> custos nem precificação automaticamente.
      </p>
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
  const [requestNumber, setRequestNumber] = useState<number | null>(null);
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
    const rowsHtml = items
      .map(
        (it, i) =>
          `<tr><td>${i + 1}</td><td>${it.description}</td><td style="text-align:right">${it.quantity}</td><td>${it.unit}</td></tr>`
      )
      .join("");
    const total = win ? formatCurrency(Number(win.totalValue)) : "—";
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${emittedOrder.code}</title>
<style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:20px;margin:0}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #999;padding:6px 8px;text-align:left}
th{background:#eee}.tot{font-size:16px;font-weight:bold;text-align:right;margin-top:8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:12px 0}.lbl{color:#555;font-size:11px;text-transform:uppercase}
footer{margin-top:32px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px}
@media print{button{display:none}}</style></head><body>
<div class="head"><div><h1>Pedido de Compra</h1><div>Grupo Lazarios</div></div>
<div style="text-align:right"><div style="font-size:18px;font-weight:bold">${emittedOrder.code}</div>
<div>${new Date(emittedOrder.createdAt).toLocaleDateString("pt-BR")}</div></div></div>
<div class="grid">
<div><div class="lbl">Fornecedor</div><div>${emittedOrder.supplierDisplayNameSnapshot}</div></div>
<div><div class="lbl">CNPJ</div><div>${win?.supplierDocumentSnapshot ?? "—"}</div></div>
<div><div class="lbl">Condição de pagamento</div><div>${win?.paymentTerms ?? "—"}</div></div>
<div><div class="lbl">Prazo de entrega</div><div>${win?.deliveryDays != null ? win.deliveryDays + " dias" : "—"}</div></div>
<div><div class="lbl">Solicitação</div><div>SC ${requestNumber ?? ""} — ${requester}</div></div>
<div><div class="lbl">Comprador</div><div>${buyerNameView ?? "—"}</div></div>
</div>
<table><thead><tr><th>#</th><th>Descrição</th><th style="text-align:right">Qtde</th><th>Un</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class="tot">Valor total do pedido: ${total}</div>
${win?.winnerReason ? `<p><span class="lbl">Justificativa da escolha:</span> ${win.winnerReason}</p>` : ""}
<footer>Documento gerado pelo IndusCost em ${new Date().toLocaleString("pt-BR")}. Use Ctrl+P para salvar em PDF.</footer>
<button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Imprimir / salvar PDF</button>
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
                        <span
                          className={cn(
                            "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                            r.status === "ABERTA" && "bg-blue-500/15 text-blue-700",
                            r.status === "RASCUNHO" && "bg-muted text-muted-foreground",
                            r.status === "AGUARDANDO_APROVACAO" && "bg-amber-500/15 text-amber-900",
                            r.status === "REJEITADA" && "bg-orange-500/15 text-orange-800",
                            r.status === "EM_COTACAO" && "bg-violet-500/15 text-violet-800",
                            r.status === "CANCELADA" && "bg-red-500/15 text-red-700",
                            r.status === "ENCERRADA" && "bg-green-500/15 text-green-800"
                          )}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
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

  return (
    <div className="space-y-6" data-tour="purchases-root">
      <div
        className="flex flex-col sm:flex-row sm:items-start justify-between gap-4"
        data-tour="purchases-toolbar"
      >
        <div>
          <button
            type="button"
            onClick={() => {
              setView("list");
              loadLists();
            }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar à lista
          </button>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {formMode === "create"
              ? "Nova solicitação de compra"
              : `Solicitação ${requestNumber != null ? `#${requestNumber}` : ""}`}
          </h3>
          {createdAt && (
            <p className="text-xs text-muted-foreground mt-1">Criada em {formatDt(createdAt)}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
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

      {headerCc?.code === "A-CLASS" && (
        <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
          <div>
            <p className="font-medium text-amber-900">Centro de custo &quot;A classificar&quot;</p>
            <p className="text-amber-900/90 mt-1">
              Esta solicitação usa o fallback controlado <strong>{headerCc.code}</strong>. O vínculo é explícito e
              rastreável — substitua por um centro definitivo quando souber a alocação.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6 space-y-6" data-tour="purchases-header-block">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cabeçalho</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Solicitante *</label>
            <SearchableSelect
              options={employeeOptions}
              value={requesterEmployeeId}
              onChange={handleRequesterSelect}
              placeholder="Selecione o funcionário..."
              disabled={fieldsDisabled}
              required
            />
            {!requesterEmployeeId && requester ? (
              <p className="text-[11px] text-muted-foreground">
                Registro antigo: {requester}. Selecione o funcionário para oficializar.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Departamento / área *</label>
            <input
              disabled
              readOnly
              className="w-full p-2 rounded-lg border border-border bg-muted/50 text-sm text-muted-foreground"
              value={department}
              placeholder="Definido pelo funcionário selecionado"
              title="Preenchido automaticamente a partir do setor do funcionário"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Tipo / categoria (opcional)</label>
            <select
              disabled={fieldsDisabled}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
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
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Prioridade</label>
            <select
              disabled={fieldsDisabled}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as PurchasePriority)}
            >
              {(Object.keys(PRIORITY_LABEL) as PurchasePriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Status</label>
            <div className="flex flex-wrap items-center gap-2 min-h-[40px]">
              <span
                className={cn(
                  "text-xs font-bold uppercase px-2.5 py-1 rounded-full",
                  status === "ABERTA" && "bg-blue-500/15 text-blue-700",
                  status === "RASCUNHO" && "bg-muted text-muted-foreground",
                  status === "AGUARDANDO_APROVACAO" && "bg-amber-500/15 text-amber-900",
                  status === "REJEITADA" && "bg-orange-500/15 text-orange-800",
                  status === "EM_COTACAO" && "bg-violet-500/15 text-violet-800",
                  status === "CANCELADA" && "bg-red-500/15 text-red-700",
                  status === "ENCERRADA" && "bg-green-500/15 text-green-800"
                )}
              >
                {STATUS_LABEL[status]}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Use as ações de workflow (não edite o status manualmente).
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Projeto (oficial, opcional)</label>
            <SearchableSelect
              options={[{ value: "", label: "— Sem projeto —" }, ...projectOptions]}
              value={projectId}
              onChange={setProjectId}
              placeholder="Buscar projeto oficial…"
              disabled={fieldsDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Referência externa (opcional)</label>
            <input
              disabled={fieldsDisabled}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              placeholder="OS, contrato, etc."
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Justificativa / motivo *</label>
            <textarea
              disabled={fieldsDisabled}
              rows={3}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div className="flex-1 w-full space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">
                  Centro de custo (cabeçalho) *
                </label>
                <SearchableSelect
                  options={financialCcOptions}
                  value={defaultFinancialCostCenterId}
                  onChange={setDefaultFinancialCostCenterId}
                  placeholder="Selecione o centro de custo..."
                  disabled={fieldsDisabled}
                  required
                />
              </div>
              {/* Cadastro de CC agora é exclusivo do módulo financeiro —
                  sem atalho que crie centro de custo fora da lista oficial. */}
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Observações</label>
            <textarea
              disabled={fieldsDisabled}
              rows={2}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      {editingId ? (
        <div
          className="rounded-2xl border border-border bg-card p-6 space-y-3"
          data-testid="purchase-request-workflow"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Workflow
          </h4>
          <div className="flex flex-wrap gap-2">
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
            {status === "ENCERRADA" && emittedOrder ? (
              <>
                <button
                  type="button"
                  onClick={openOrderPdf}
                  className="px-3 py-1.5 rounded-lg text-sm bg-emerald-700 text-white"
                >
                  Pedido {emittedOrder.code} (PDF)
                </button>
                <button
                  type="button"
                  onClick={emailOrder}
                  className="px-3 py-1.5 rounded-lg text-sm border border-border"
                >
                  Enviar por e-mail
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
        </div>
      ) : null}

      {editingId && ["EM_COTACAO", "AGUARDANDO_APROVACAO", "ENCERRADA", "REJEITADA"].includes(status) ? (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4" data-tour="purchases-quotes-block">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Orçamentos ({quotes.length})
          </h4>
          {quotes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
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
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end border-t border-border pt-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Fornecedor *</label>
                <SearchableSelect
                  options={supplierOptions}
                  value={quoteSupplierId}
                  onChange={setQuoteSupplierId}
                  placeholder="Buscar fornecedor…"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Valor total *</label>
                <input
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  placeholder="0,00"
                  value={quoteTotal}
                  onChange={(e) => setQuoteTotal(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Pagamento</label>
                <input
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  placeholder="Ex.: 30/60"
                  value={quotePaymentTerms}
                  onChange={(e) => setQuotePaymentTerms(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Entrega (dias)</label>
                <input
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  value={quoteDeliveryDays}
                  onChange={(e) => setQuoteDeliveryDays(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  disabled={quoteBusy}
                  onClick={() => void addQuote()}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-primary text-primary-foreground disabled:opacity-50"
                >
                  Adicionar orçamento
                </button>
              </div>
              <div className="md:col-span-6 space-y-1">
                <input
                  className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                  placeholder="Observações do orçamento (opcional)"
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {editingId && linkedQuotations.length > 0 ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-500/5 p-6 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Cotações vinculadas
          </h4>
          <ul className="space-y-1 text-sm">
            {linkedQuotations.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="text-primary hover:underline font-mono"
                  onClick={() => navigate(`/purchases/quotations/${q.id}`)}
                >
                  {q.code}
                </button>
                <span className="text-xs text-muted-foreground ml-2">{q.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editingId ? (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Anexos / evidências
            </h4>
            {allowEdit ? (
              <label className="text-sm text-primary hover:underline cursor-pointer">
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
            ) : null}
          </div>
          {evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {evidences.map((ev) => (
                <li key={ev.id}>
                  <a
                    className="text-primary hover:underline"
                    href={`/api/purchase-requests/${editingId}/evidences/${ev.id}/download`}
                  >
                    {ev.originalFileName}
                  </a>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({Math.round(ev.fileSize / 1024)} KB)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {historyEvents.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3" data-testid="purchase-request-history">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Histórico
          </h4>
          <ul className="space-y-2 text-sm">
            {historyEvents.map((h) => (
              <li key={h.id} className="border-b border-border/60 pb-2">
                <div className="font-medium">
                  {h.action}
                  {h.fromStatus || h.toStatus
                    ? ` · ${h.fromStatus ?? "—"} → ${h.toStatus ?? "—"}`
                    : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(h.createdAt).toLocaleString("pt-BR")}
                  {h.userName ? ` · ${h.userName}` : ""}
                  {h.reason ? ` · ${h.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4" data-tour="purchases-items-block">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Itens</h4>
          {!fieldsDisabled && (
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Plus className="h-4 w-4" />
              Adicionar item
            </button>
          )}
        </div>

        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum item. Adicione ao menos um item para registrar a demanda.</p>
        )}

        <div className="space-y-6">
          {items.map((it, idx) => {
            const selectedMaterial = it.materialId
              ? materials.find((m) => m.id === it.materialId)
              : undefined;
            return (
            <div
              key={it.tempId}
              className={cn(
                "rounded-xl border border-border/80 bg-accent/10 p-4 space-y-4",
                it.lineType === "MATERIA_PRIMA" && "border-l-4 border-l-primary/60"
              )}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold">Item {idx + 1}</span>
                {!fieldsDisabled && allowDelete && items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(it.tempId)}
                    className="p-2 rounded-md hover:bg-red-500/10 text-red-600"
                    title="Remover item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Tipo do item *</label>
                  <select
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.lineType}
                    onChange={(e) =>
                      updateItem(it.tempId, { lineType: e.target.value as PurchaseItemDraft["lineType"] })
                    }
                  >
                    <option value="MATERIA_PRIMA">{LINE_TYPE_LABEL.MATERIA_PRIMA}</option>
                    <option value="INDIRETO">{LINE_TYPE_LABEL.INDIRETO}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Status da linha</label>
                  <select
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
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
                </div>

                {it.lineType === "MATERIA_PRIMA" && (
                  <>
                    <div className="space-y-1.5 md:col-span-2">
                      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                        <div className="flex-1 w-full space-y-1.5 min-w-0">
                          <label className="text-xs font-bold text-muted-foreground uppercase">
                            Material (cadastro Suprimentos) *
                          </label>
                          <SearchableSelect
                            options={materialOptionsMp}
                            value={it.materialId}
                            onChange={(v) => updateItem(it.tempId, { materialId: v })}
                            placeholder="Pesquisar por código, descrição, unidade…"
                            disabled={fieldsDisabled}
                          />
                        </div>
                        {!fieldsDisabled && (
                          <div className="flex flex-wrap gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => refreshMaterials()}
                              className="inline-flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2 hover:bg-accent"
                              title="Recarrega a lista após cadastrar material em outra aba"
                            >
                              Atualizar lista
                            </button>
                            <button
                              type="button"
                              onClick={() => window.open("/materials", "_blank", "noopener,noreferrer")}
                              className="inline-flex items-center gap-2 text-sm text-primary border border-primary/30 rounded-lg px-3 py-2 hover:bg-primary/5"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Nova matéria-prima (nova aba)
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate("/materials")}
                              className="inline-flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-3 py-2 hover:bg-accent"
                            >
                              Ir em Suprimentos
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Dica: use <strong>Nova matéria-prima (nova aba)</strong> para não perder o rascunho desta solicitação; depois clique em{" "}
                        <strong>Atualizar lista</strong>.
                      </p>
                    </div>

                    {selectedMaterial ? (
                      <div className="md:col-span-2">
                        <MaterialMpSummaryCard material={selectedMaterial} readOnly={fieldsDisabled} />
                      </div>
                    ) : it.materialId ? (
                      <div className="md:col-span-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-950">
                        Material não encontrado na lista local. Salve a solicitação apenas após atualizar a lista ou verificar o cadastro.
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Referência no fornecedor (opcional)
                      </label>
                      <input
                        disabled={fieldsDisabled}
                        placeholder="Código / item na lista do fornecedor"
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={it.supplierReference}
                        onChange={(e) => updateItem(it.tempId, { supplierReference: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Embalagem / apresentação (opcional)
                      </label>
                      <input
                        disabled={fieldsDisabled}
                        placeholder="Ex.: fardo 25 kg, bobina, caixa"
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={it.packagingPresentation}
                        onChange={(e) => updateItem(it.tempId, { packagingPresentation: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Qtd. mínima sugerida — MOQ (opcional)
                      </label>
                      <input
                        disabled={fieldsDisabled}
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Somente referência de compra"
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={it.minOrderQtySuggested}
                        onChange={(e) => updateItem(it.tempId, { minOrderQtySuggested: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">
                    {it.lineType === "MATERIA_PRIMA" ? "Descrição na solicitação *" : "Descrição *"}
                  </label>
                  <input
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.description}
                    onChange={(e) => updateItem(it.tempId, { description: e.target.value })}
                  />
                  {it.lineType === "MATERIA_PRIMA" && (
                    <p className="text-[11px] text-muted-foreground">
                      Preenchida a partir do cadastro ao selecionar o material; ajuste se precisar detalhar especificação da compra.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Quantidade *</label>
                  <input
                    disabled={fieldsDisabled}
                    type="number"
                    min={0}
                    step="any"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.quantity}
                    onChange={(e) => updateItem(it.tempId, { quantity: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">
                    Unidade *{it.lineType === "MATERIA_PRIMA" ? " (alinhada ao cadastro)" : ""}
                  </label>
                  <input
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.unit}
                    onChange={(e) => updateItem(it.tempId, { unit: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">
                    Centro de custo do item
                  </label>
                  <SearchableSelect
                    options={itemCcOptions}
                    value={it.financialCostCenterId}
                    onChange={(v) => updateItem(it.tempId, { financialCostCenterId: v })}
                    placeholder="Herdar ou sobrescrever..."
                    disabled={fieldsDisabled}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    CC efetivo: <strong>{resolvedCcLabel(it)}</strong>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Data desejada</label>
                  <input
                    disabled={fieldsDisabled}
                    type="date"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.desiredDate}
                    onChange={(e) => updateItem(it.tempId, { desiredDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Prioridade do item</label>
                  <select
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.priority}
                    onChange={(e) =>
                      updateItem(it.tempId, {
                        priority: (e.target.value || "") as PurchaseItemDraft["priority"],
                      })
                    }
                  >
                    <option value="">(herdar / não definir)</option>
                    {(Object.keys(PRIORITY_LABEL) as PurchasePriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Fornecedor sugerido (opcional)</label>
                  <input
                    disabled={fieldsDisabled}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.suggestedSupplier}
                    onChange={(e) => updateItem(it.tempId, { suggestedSupplier: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Observação do item</label>
                  <textarea
                    disabled={fieldsDisabled}
                    rows={2}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.notes}
                    onChange={(e) => updateItem(it.tempId, { notes: e.target.value })}
                  />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

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
