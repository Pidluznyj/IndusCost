import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, KanbanSquare, Loader2, Plus, Search, TriangleAlert, Wrench, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type {
  MaintenanceCategory,
  MaintenanceListResponse,
  MaintenancePriority,
  MaintenanceRequestDetail,
  MaintenanceRequestRow,
  MaintenanceStatus,
} from "@/src/types/maintenance";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canManageMaintenance } from "@/src/lib/operationsAdminPermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  NOVA_SOLICITACAO: "Nova solicitação",
  EM_ANALISE: "Em análise",
  AGUARDANDO_MATERIAL: "Aguardando material",
  AGUARDANDO_COMPRA: "Aguardando compra",
  PROGRAMADO: "Programado",
  EM_EXECUCAO: "Em execução",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  ELETRICA: "Elétrica",
  HIDRAULICA: "Hidráulica",
  PINTURA: "Pintura",
  CIVIL_ALVENARIA: "Civil / Alvenaria",
  TELHADO_CALHA: "Telhado / Calha",
  INFRAESTRUTURA: "Infraestrutura",
  SEGURANCA: "Segurança",
  LIMPEZA_CORRETIVA: "Limpeza corretiva",
  OUTRO: "Outro",
};

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as MaintenanceStatus[];
const PRIORITY_OPTIONS = Object.keys(PRIORITY_LABEL) as MaintenancePriority[];
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as MaintenanceCategory[];
const PAGE_SIZE = 20;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function isOverdue(row: MaintenanceRequestRow) {
  if (!row.desiredDate) return false;
  if (row.status === "CONCLUIDO" || row.status === "CANCELADO") return false;
  const d = new Date(row.desiredDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

type FormState = {
  title: string;
  description: string;
  requester: string;
  areaSector: string;
  location: string;
  category: MaintenanceCategory | "";
  priority: MaintenancePriority;
  responsible: string;
  desiredDate: string;
  notes: string;
  needsMaterial: boolean;
  materialNotes: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  requester: "",
  areaSector: "",
  location: "",
  category: "",
  priority: "MEDIA",
  responsible: "",
  desiredDate: "",
  notes: "",
  needsMaterial: false,
  materialNotes: "",
};

export function MaintenanceModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const allowManage =
    canManageMaintenance(auth) ||
    permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.maintenance,
      OPERATIONS_ACTIONS.manage
    );
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [rows, setRows] = useState<MaintenanceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MaintenanceStatus | "">("");
  const [priority, setPriority] = useState<MaintenancePriority | "">("");
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [areaSector, setAreaSector] = useState("");
  const [responsible, setResponsible] = useState("");
  const [lateOnly, setLateOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<MaintenanceRequestDetail | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [nextStatus, setNextStatus] = useState<MaintenanceStatus | "">("");
  const [statusComment, setStatusComment] = useState("");
  const [statusChangedBy, setStatusChangedBy] = useState("");
  const [kanbanMoveTo, setKanbanMoveTo] = useState<Record<string, MaintenanceStatus>>({});

  const filtersKey = useMemo(
    () => JSON.stringify({ search, status, priority, category, areaSector, responsible, lateOnly }),
    [search, status, priority, category, areaSector, responsible, lateOnly]
  );

  const loadList = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      if (category) params.set("category", category);
      if (areaSector.trim()) params.set("areaSector", areaSector.trim());
      if (responsible.trim()) params.set("responsible", responsible.trim());
      if (lateOnly) params.set("lateOnly", "true");

      const data = await fetchJsonOk<MaintenanceListResponse>(`/api/maintenance-requests?${params.toString()}`);
      const safeRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(safeRows);
      setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : safeRows.length);
      setPage(Number.isFinite(Number(data.page)) ? Number(data.page) : targetPage);
      setTotalPages(Number.isFinite(Number(data.totalPages)) ? Math.max(1, Number(data.totalPages)) : 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar solicitações.");
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [search, status, priority, category, areaSector, responsible, lateOnly]);

  useEffect(() => {
    setPage(1);
  }, [filtersKey]);

  useEffect(() => {
    void loadList(page);
  }, [page, loadList]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setNextStatus("");
    setStatusComment("");
    setStatusChangedBy("");
    try {
      const row = await fetchJsonOk<MaintenanceRequestDetail>(`/api/maintenance-requests/${id}`);
      setDetail(row);
      setNextStatus(row.status);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao carregar detalhe da solicitação.");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return alert("Título é obrigatório.");
    if (!form.description.trim()) return alert("Descrição é obrigatória.");
    if (!form.requester.trim()) return alert("Solicitante é obrigatório.");
    if (!form.areaSector.trim()) return alert("Área/setor é obrigatório.");
    if (!form.location.trim()) return alert("Local é obrigatório.");
    if (!form.category) return alert("Categoria é obrigatória.");
    setSaving(true);
    try {
      await fetchJsonOk("/api/maintenance-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          requester: form.requester.trim(),
          areaSector: form.areaSector.trim(),
          location: form.location.trim(),
          category: form.category,
          priority: form.priority,
          responsible: form.responsible.trim() || null,
          desiredDate: form.desiredDate ? `${form.desiredDate}T12:00:00.000Z` : null,
          notes: form.notes.trim() || null,
          needsMaterial: form.needsMaterial,
          materialNotes: form.needsMaterial ? form.materialNotes.trim() || null : null,
        }),
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      alert("Solicitação criada com sucesso.");
      void loadList(1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível criar a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  const loadDetailById = useCallback(async (id: string) => {
    const updated = await fetchJsonOk<MaintenanceRequestDetail>(`/api/maintenance-requests/${id}`);
    setDetail(updated);
    setNextStatus(updated.status);
  }, []);

  const changeStatus = useCallback(async (args: {
    id: string;
    status: MaintenanceStatus;
    comment?: string | null;
    changedBy?: string | null;
  }) => {
    setStatusSaving(true);
    try {
      await fetchJsonOk(`/api/maintenance-requests/${args.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: args.status,
          comment: args.comment ?? null,
          changedBy: args.changedBy ?? null,
        }),
      });
      void loadList(page);
      if (detailOpen && detail?.id === args.id) {
        await loadDetailById(args.id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível alterar o status.");
    } finally {
      setStatusSaving(false);
    }
  }, [detail?.id, detailOpen, loadDetailById, loadList, page]);

  const handleChangeStatus = async () => {
    if (!detail?.id || !nextStatus) return;
    await changeStatus({
      id: detail.id,
      status: nextStatus,
      comment: statusComment.trim() || null,
      changedBy: statusChangedBy.trim() || null,
    });
    setStatusComment("");
    setStatusChangedBy("");
  };

  const summary = useMemo(() => {
    const totalRows = rows.length;
    const openCount = rows.filter((r) => !["CONCLUIDO", "CANCELADO"].includes(r.status)).length;
    const waitingCount = rows.filter((r) => ["AGUARDANDO_MATERIAL", "AGUARDANDO_COMPRA"].includes(r.status)).length;
    const doneCount = rows.filter((r) => r.status === "CONCLUIDO").length;
    return { totalRows, openCount, waitingCount, doneCount };
  }, [rows]);

  const listRange = useMemo(() => {
    if (!rows.length) return "0–0";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + rows.length - 1;
    return `${from}–${to}`;
  }, [rows.length, page]);

  const kanbanColumns = useMemo(
    () => STATUS_OPTIONS.map((s) => ({ status: s, label: STATUS_LABEL[s], rows: rows.filter((r) => r.status === s) })),
    [rows]
  );

  const handleKanbanMove = async (row: MaintenanceRequestRow) => {
    const target = kanbanMoveTo[row.id] ?? row.status;
    if (!target || target === row.status) return;
    await changeStatus({
      id: row.id,
      status: target,
      comment: "Status alterado pelo Kanban",
      changedBy: null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            Manutenção Predial
          </h3>
          <p className="text-sm text-muted-foreground">
            Controle de solicitações, responsáveis, status e materiais necessários.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKanbanOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-accent"
          >
            <KanbanSquare className="h-4 w-4" />
            Abrir Kanban
          </button>
          {allowManage ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nova solicitação
          </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase font-bold">Total de solicitações</p>
          <p className="text-2xl font-bold mt-1">{summary.totalRows}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase font-bold">Em aberto</p>
          <p className="text-2xl font-bold mt-1">{summary.openCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase font-bold">Aguardando material/compra</p>
          <p className="text-2xl font-bold mt-1">{summary.waitingCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase font-bold">Concluídas</p>
          <p className="text-2xl font-bold mt-1">{summary.doneCount}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          <div className="xl:col-span-2">
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Busca</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Título, descrição, local, solicitante..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Status</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
              value={status}
              onChange={(e) => setStatus((e.target.value || "") as MaintenanceStatus | "")}
            >
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Prioridade</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
              value={priority}
              onChange={(e) => setPriority((e.target.value || "") as MaintenancePriority | "")}
            >
              <option value="">Todas</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Categoria</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
              value={category}
              onChange={(e) => setCategory((e.target.value || "") as MaintenanceCategory | "")}
            >
              <option value="">Todas</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Área / setor</label>
            <input
              value={areaSector}
              onChange={(e) => setAreaSector(e.target.value)}
              placeholder="Filtrar área"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Responsável</label>
            <input
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              placeholder="Filtrar responsável"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} />
              Somente atrasadas
            </label>
          </div>
          <div className="flex items-end justify-end">
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              onClick={() => {
                setSearch("");
                setStatus("");
                setPriority("");
                setCategory("");
                setAreaSector("");
                setResponsible("");
                setLateOnly(false);
              }}
            >
              Limpar filtros
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border text-xs text-muted-foreground">
          Exibindo <strong className="text-foreground">{listRange}</strong> de{" "}
          <strong className="text-foreground">{total}</strong> solicitação(ões)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-accent/40 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Nº</th>
                <th className="p-3 font-semibold">Título</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Prioridade</th>
                <th className="p-3 font-semibold">Categoria</th>
                <th className="p-3 font-semibold">Área / Local</th>
                <th className="p-3 font-semibold">Solicitante</th>
                <th className="p-3 font-semibold">Responsável</th>
                <th className="p-3 font-semibold">Abertura</th>
                <th className="p-3 font-semibold">Data desejada</th>
                <th className="p-3 font-semibold">Material</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    Nenhuma solicitação encontrada. Clique em "Nova solicitação" para começar.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-accent/30 cursor-pointer"
                    onClick={() => void openDetail(r.id)}
                  >
                    <td className="p-3 font-mono">#{Number.isFinite(Number(r.number)) ? r.number : "—"}</td>
                    <td className="p-3">
                      <p className="font-medium">{r.title || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[280px]">{r.description || "—"}</p>
                    </td>
                    <td className="p-3">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase">
                        {STATUS_LABEL[r.status] ?? "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          r.priority === "CRITICA" && "bg-red-100 text-red-700",
                          r.priority === "ALTA" && "bg-orange-100 text-orange-700",
                          r.priority === "MEDIA" && "bg-blue-100 text-blue-700",
                          r.priority === "BAIXA" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {PRIORITY_LABEL[r.priority] ?? "—"}
                      </span>
                    </td>
                    <td className="p-3">{CATEGORY_LABEL[r.category] ?? "—"}</td>
                    <td className="p-3">
                      <p>{r.areaSector || "—"}</p>
                      <p className="text-xs text-muted-foreground">{r.location || "—"}</p>
                    </td>
                    <td className="p-3">{r.requester || "—"}</td>
                    <td className="p-3">{r.responsible || "—"}</td>
                    <td className="p-3">{formatDate(r.createdAt)}</td>
                    <td className="p-3">{formatDate(r.desiredDate)}</td>
                    <td className="p-3">
                      {r.needsMaterial ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Sim
                        </span>
                      ) : (
                        "Não"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Página <strong className="text-foreground">{page}</strong> de{" "}
          <strong className="text-foreground">{totalPages}</strong>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-3xl rounded-2xl border border-border shadow-2xl overflow-hidden">
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-bold">Nova solicitação de manutenção</h4>
                <button type="button" onClick={() => setCreateOpen(false)} className="p-2 rounded-md hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Título *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Descrição *</label>
                  <textarea rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Solicitante *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.requester} onChange={(e) => setForm((f) => ({ ...f, requester: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Área / setor *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.areaSector} onChange={(e) => setForm((f) => ({ ...f, areaSector: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Local *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Categoria *</label>
                  <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: (e.target.value || "") as MaintenanceCategory | "" }))}>
                    <option value="">Selecione</option>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Prioridade</label>
                  <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as MaintenancePriority }))}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Responsável</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.responsible} onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Data desejada</label>
                  <input type="date" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.desiredDate} onChange={(e) => setForm((f) => ({ ...f, desiredDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Observações</label>
                  <textarea rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.needsMaterial} onChange={(e) => setForm((f) => ({ ...f, needsMaterial: e.target.checked }))} />
                    Precisa de material
                  </label>
                </div>
                {form.needsMaterial && (
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Descrição de materiais</label>
                    <textarea rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.materialNotes} onChange={(e) => setForm((f) => ({ ...f, materialNotes: e.target.value }))} />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="px-4 py-2 rounded-lg border border-border text-sm" onClick={() => setCreateOpen(false)}>Cancelar</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-60">
                  {saving ? "Salvando..." : "Criar solicitação"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {kanbanOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-[95vw] h-[90vh] rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h4 className="text-lg font-bold">Kanban de Manutenção Predial</h4>
                <p className="text-sm text-muted-foreground">
                  Acompanhamento operacional por status com os filtros atuais aplicados.
                </p>
              </div>
              <button type="button" onClick={() => setKanbanOpen(false)} className="p-2 rounded-md hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-x-auto p-4">
              <div className="min-w-max h-full flex gap-3">
                {kanbanColumns.map((col) => (
                  <div
                    key={col.status}
                    className="w-[320px] xl:w-[340px] h-full rounded-xl border border-border bg-background/30 flex flex-col"
                  >
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <p className="text-sm font-semibold">{col.label}</p>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold">{col.rows.length}</span>
                    </div>
                    <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                      {col.rows.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2">Sem solicitações nesta coluna.</p>
                      ) : (
                        col.rows.map((r) => {
                          const overdue = isOverdue(r);
                          return (
                            <div
                              key={r.id}
                              className="rounded-lg border border-border bg-card p-3 space-y-2 cursor-pointer hover:bg-accent/20"
                              onClick={() => void openDetail(r.id)}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-mono text-muted-foreground">
                                  #{Number.isFinite(Number(r.number)) ? r.number : "—"}
                                </p>
                                <span
                                  className={cn(
                                    "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                                    r.priority === "CRITICA" && "bg-red-100 text-red-700",
                                    r.priority === "ALTA" && "bg-orange-100 text-orange-700",
                                    r.priority === "MEDIA" && "bg-blue-100 text-blue-700",
                                    r.priority === "BAIXA" && "bg-muted text-muted-foreground"
                                  )}
                                >
                                  {PRIORITY_LABEL[r.priority] ?? "—"}
                                </span>
                              </div>
                              <p className="font-medium leading-snug">{r.title || "—"}</p>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <p>{CATEGORY_LABEL[r.category] ?? "—"}</p>
                                <p>{r.areaSector || "—"} · {r.location || "—"}</p>
                                <p>Resp.: {r.responsible || "—"}</p>
                                <p>Desejada: {formatDate(r.desiredDate)}</p>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {r.needsMaterial ? (
                                  <span
                                    className="text-[10px] rounded-full bg-amber-100 text-amber-700 px-2 py-0.5"
                                    title={r.materialNotes || "Precisa de material"}
                                  >
                                    Precisa material
                                  </span>
                                ) : null}
                                {overdue ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] rounded-full bg-red-100 text-red-700 px-2 py-0.5">
                                    <TriangleAlert className="h-3 w-3" />
                                    Atrasado
                                  </span>
                                ) : null}
                              </div>
                              <div className="pt-1 border-t border-border/60 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <select
                                  className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                                  value={kanbanMoveTo[r.id] ?? r.status}
                                  onChange={(e) =>
                                    setKanbanMoveTo((prev) => ({ ...prev, [r.id]: e.target.value as MaintenanceStatus }))
                                  }
                                >
                                  {STATUS_OPTIONS.map((s) => (
                                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={statusSaving || (kanbanMoveTo[r.id] ?? r.status) === r.status}
                                  onClick={() => void handleKanbanMove(r)}
                                  className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium disabled:opacity-50"
                                >
                                  Mover
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h4 className="text-lg font-bold">Detalhe da solicitação</h4>
              <button type="button" onClick={() => setDetailOpen(false)} className="p-2 rounded-md hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {detailLoading || !detail ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div><strong>Número:</strong> #{Number.isFinite(Number(detail.number)) ? detail.number : "—"}</div>
                    <div><strong>Status:</strong> {STATUS_LABEL[detail.status] ?? "—"}</div>
                    <div><strong>Título:</strong> {detail.title || "—"}</div>
                    <div><strong>Prioridade:</strong> {PRIORITY_LABEL[detail.priority] ?? "—"}</div>
                    <div><strong>Categoria:</strong> {CATEGORY_LABEL[detail.category] ?? "—"}</div>
                    <div><strong>Solicitante:</strong> {detail.requester || "—"}</div>
                    <div><strong>Área / Setor:</strong> {detail.areaSector || "—"}</div>
                    <div><strong>Local:</strong> {detail.location || "—"}</div>
                    <div><strong>Responsável:</strong> {detail.responsible || "—"}</div>
                    <div><strong>Data desejada:</strong> {formatDate(detail.desiredDate)}</div>
                    <div><strong>Criada em:</strong> {formatDateTime(detail.createdAt)}</div>
                    <div><strong>Atualizada em:</strong> {formatDateTime(detail.updatedAt)}</div>
                    <div className="md:col-span-2"><strong>Descrição:</strong> {detail.description || "—"}</div>
                    <div className="md:col-span-2"><strong>Observações:</strong> {detail.notes || "—"}</div>
                    <div className="md:col-span-2"><strong>Precisa de material:</strong> {detail.needsMaterial ? "Sim" : "Não"}</div>
                    <div className="md:col-span-2"><strong>Materiais:</strong> {detail.materialNotes || "—"}</div>
                  </div>

                  <div className="rounded-xl border border-border p-4 space-y-3">
                    <h5 className="font-semibold flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Alterar status
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as MaintenanceStatus)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="">Selecione</option>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                      <input value={statusChangedBy} onChange={(e) => setStatusChangedBy(e.target.value)} placeholder="Alterado por (opcional)" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                      <button type="button" onClick={() => void handleChangeStatus()} disabled={statusSaving || !nextStatus} className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-60">
                        {statusSaving ? "Salvando..." : "Atualizar status"}
                      </button>
                    </div>
                    <textarea value={statusComment} onChange={(e) => setStatusComment(e.target.value)} placeholder="Comentário (opcional)" rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  </div>

                  <div className="rounded-xl border border-border p-4 space-y-3">
                    <h5 className="font-semibold">Histórico de status</h5>
                    {!detail.statusHistory || detail.statusHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem histórico registrado.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.statusHistory.map((h) => (
                          <div key={h.id} className="rounded-lg border border-border/60 p-3 text-sm">
                            <p className="font-medium">
                              {h.fromStatus ? STATUS_LABEL[h.fromStatus] : "—"} → {STATUS_LABEL[h.toStatus] ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(h.changedAt)} · {h.changedBy || "—"}
                            </p>
                            <p className="text-sm mt-1">{h.comment || "—"}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
