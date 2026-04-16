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
} from "@/src/types/purchase";
import { SearchableSelect, SelectOption } from "@/src/components/shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PURCHASE_TOUR_STEPS } from "@/src/tours/purchaseTourSteps";
import { motion } from "motion/react";
import { filterPurchaseRequests } from "@/src/lib/operationalListFilters";

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  ABERTA: "Aberta",
  CANCELADA: "Cancelada",
  ENCERRADA: "Encerrada",
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
  const [priority, setPriority] = useState<PurchasePriority>("NORMAL");
  const [status, setStatus] = useState<PurchaseRequestStatus>("RASCUNHO");
  const [justification, setJustification] = useState("");
  const [defaultCostCenterId, setDefaultCostCenterId] = useState("");
  const [notes, setNotes] = useState("");
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
    () => costCenters.find((c) => c.id === defaultCostCenterId),
    [costCenters, defaultCostCenterId]
  );

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
      const [reqs, mats, ccs] = await Promise.all([
        fetchJsonOk<PurchaseRequestRow[]>("/api/purchase-requests"),
        fetchJsonOk<Material[]>("/api/materials"),
        fetchJsonOk<CostCenterRow[]>("/api/cost-centers"),
      ]);
      setRequests(Array.isArray(reqs) ? reqs : []);
      setMaterials(Array.isArray(mats) ? mats : []);
      setCostCenters(Array.isArray(ccs) ? ccs : []);
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

  const resetForm = () => {
    setRequester("");
    setDepartment("");
    setRequestCategory("");
    setPriority("NORMAL");
    setStatus("RASCUNHO");
    setJustification("");
    setDefaultCostCenterId("");
    setNotes("");
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
      setPriority(row.priority);
      setStatus(row.status);
      setJustification(row.justification);
      setDefaultCostCenterId(row.defaultCostCenterId);
      setNotes(row.notes || "");
      setItems(row.items.length ? row.items.map(itemFromApi) : [emptyPurchaseItemDraft()]);
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
      priority,
      status,
      justification,
      defaultCostCenterId,
      notes: notes.trim() || null,
      items: items.map((it) => {
        const isMp = it.lineType === "MATERIA_PRIMA";
        return {
          lineType: it.lineType,
          materialId: isMp ? it.materialId : null,
          description: it.description.trim(),
          quantity: it.quantity,
          unit: it.unit.trim(),
          costCenterId: it.costCenterId && it.costCenterId.length ? it.costCenterId : null,
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

  const validateClient = (): string | null => {
    if (!requester.trim()) return "Informe o solicitante.";
    if (!department.trim()) return "Informe o departamento / área.";
    if (!justification.trim()) return "Informe a justificativa.";
    if (!defaultCostCenterId) return "Selecione o centro de custo do cabeçalho.";
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
    return [inherit, ...costCenterOptions];
  }, [costCenterOptions]);

  const resolvedCcLabel = (item: PurchaseItemDraft) => {
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
              data-tour="purchases-new-request"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Nova solicitação
            </button>
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
                          <button
                            type="button"
                            title="Editar"
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
                            onClick={() => openEdit(r.id, "edit")}
                          >
                            <Edit2 className="h-4 w-4" />
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
          {!readOnly && (
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
            <input
              disabled={readOnly}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={requester}
              onChange={(e) => setRequester(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Departamento / área *</label>
            <input
              disabled={readOnly}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Tipo / categoria (opcional)</label>
            <input
              disabled={readOnly}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              placeholder="Ex.: reforma, projeto X, consumo geral"
              value={requestCategory}
              onChange={(e) => setRequestCategory(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Prioridade</label>
            <select
              disabled={readOnly}
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
            <select
              disabled={readOnly}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as PurchaseRequestStatus)}
            >
              {(Object.keys(STATUS_LABEL) as PurchaseRequestStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Justificativa *</label>
            <textarea
              disabled={readOnly}
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
                  options={costCenterOptions}
                  value={defaultCostCenterId}
                  onChange={setDefaultCostCenterId}
                  placeholder="Selecione o centro de custo..."
                  disabled={readOnly}
                  required
                />
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setCcModalOpen(true)}
                  className="text-sm text-primary hover:underline whitespace-nowrap px-2 py-2"
                >
                  + Novo centro de custo
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Observações</label>
            <textarea
              disabled={readOnly}
              rows={2}
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4" data-tour="purchases-items-block">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Itens</h4>
          {!readOnly && (
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
                {!readOnly && items.length > 1 && (
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
                    disabled={readOnly}
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
                    disabled={readOnly}
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
                            disabled={readOnly}
                          />
                        </div>
                        {!readOnly && (
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
                        <MaterialMpSummaryCard material={selectedMaterial} readOnly={readOnly} />
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
                        disabled={readOnly}
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
                        disabled={readOnly}
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
                        disabled={readOnly}
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
                    disabled={readOnly}
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
                    disabled={readOnly}
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
                    disabled={readOnly}
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
                    value={it.costCenterId}
                    onChange={(v) => updateItem(it.tempId, { costCenterId: v })}
                    placeholder="Herdar ou sobrescrever..."
                    disabled={readOnly}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    CC efetivo: <strong>{resolvedCcLabel(it)}</strong>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Data desejada</label>
                  <input
                    disabled={readOnly}
                    type="date"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.desiredDate}
                    onChange={(e) => updateItem(it.tempId, { desiredDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Prioridade do item</label>
                  <select
                    disabled={readOnly}
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
                    disabled={readOnly}
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={it.suggestedSupplier}
                    onChange={(e) => updateItem(it.tempId, { suggestedSupplier: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Observação do item</label>
                  <textarea
                    disabled={readOnly}
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
