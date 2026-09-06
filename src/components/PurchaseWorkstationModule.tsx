import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Handshake,
  Loader2,
  Package,
  Scale,
  ShoppingCart,
  Timer,
  TrendingDown,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";

type WorkstationCards = {
  solicitado: number;
  emCotacao: number;
  negociado: number;
  pedido: number;
  confirmado: number;
  recebido: number;
  pendente: number;
  ganhoNegociado: number;
  pipelineTotal: number;
};

type WorkstationRow = {
  id: string;
  kind: string;
  pipelineKey: string;
  pipelineStage?: string;
  status: string;
  title: string;
  responsible: string | null;
  supplierName: string | null;
  materialCode: string | null;
  priority: string | null;
  neededByDate: string | null;
  createdAt: string;
  href: string;
  isPendingApproval: boolean;
  negotiatedGain: number | null;
};

type WorkstationResponse = {
  cards: WorkstationCards;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  rows: WorkstationRow[];
  meta?: { pipelineExclusive?: boolean };
};

const KIND_LABEL: Record<string, string> = {
  REQUEST: "Solicitação",
  QUOTATION: "Cotação",
  NEGOTIATION: "Negociação",
  EVIDENCE: "Evidência",
  APPROVAL: "Aprovação",
  PURCHASE_ORDER: "Pedido",
};

const STAGE_LABEL: Record<string, string> = {
  SOLICITADO: "Solicitado",
  EM_COTACAO: "Em cotação",
  NEGOCIADO: "Negociado",
  PEDIDO: "Pedido",
  CONFIRMADO: "Confirmado",
  RECEBIDO: "Recebido",
  PENDENTE: "Pendente",
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export function PurchaseWorkstationModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorkstationResponse | null>(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [responsible, setResponsible] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [priority, setPriority] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [neededByFrom, setNeededByFrom] = useState("");
  const [neededByTo, setNeededByTo] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({
    q: "",
    stage: "",
    status: "",
    responsible: "",
    supplierId: "",
    materialId: "",
    priority: "",
    periodFrom: "",
    periodTo: "",
    neededByFrom: "",
    neededByTo: "",
    kind: "",
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (applied.q.trim()) params.set("q", applied.q.trim());
    if (applied.stage) params.set("stage", applied.stage);
    if (applied.status.trim()) params.set("status", applied.status.trim());
    if (applied.responsible.trim()) params.set("responsible", applied.responsible.trim());
    if (applied.supplierId.trim()) params.set("supplierId", applied.supplierId.trim());
    if (applied.materialId.trim()) params.set("materialId", applied.materialId.trim());
    if (applied.priority) params.set("priority", applied.priority);
    if (applied.periodFrom) params.set("periodFrom", applied.periodFrom);
    if (applied.periodTo) params.set("periodTo", applied.periodTo);
    if (applied.neededByFrom) params.set("neededByFrom", applied.neededByFrom);
    if (applied.neededByTo) params.set("neededByTo", applied.neededByTo);
    if (applied.kind) params.set("kind", applied.kind);
    params.set("page", String(page));
    params.set("pageSize", "20");
    const res = await fetchJsonOk<WorkstationResponse>(
      `/api/purchase-workstation?${params.toString()}`
    );
    setData(res);
  }, [applied, page]);

  useEffect(() => {
    if (!allowView) return;
    setLoading(true);
    void load()
      .catch((e) => alert(e instanceof Error ? e.message : "Erro ao carregar estação."))
      .finally(() => setLoading(false));
  }, [allowView, load]);

  if (!allowView) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="purchase-workstation-denied">
        Sem permissão para ver a estação de compras.
      </p>
    );
  }

  const cards = data?.cards;
  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied({
      q,
      stage,
      status,
      responsible,
      supplierId,
      materialId,
      priority,
      periodFrom,
      periodTo,
      neededByFrom,
      neededByTo,
      kind,
    });
  };

  return (
    <div className="space-y-6" data-testid="purchase-workstation">
      <PurchaseChainViewNav current="workstation" variant="nomus" />
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Estação operacional de Compras
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Solicitações, cotações, negociações, evidências, aprovações e pedidos em um só painel.
            Cards de funil são exclusivos por solicitação — pendente e ganho negociado são ortogonais.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/purchases"
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
          >
            Solicitações
          </Link>
          <Link
            to="/purchases/quotations"
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
          >
            Cotações
          </Link>
          <Link
            to="/purchases/orders"
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
          >
            Pedidos
          </Link>
          <Link
            to="/purchases/shadow-planning"
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
          >
            Planejamento sombra
          </Link>
        </div>
      </div>

      <SummaryKpiGrid minColumnWidth={140} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-solicitado"
          label="Solicitado"
          amount={cards?.solicitado}
          amountFormat="number"
          tone="neutral"
          icon={FileText}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-em-cotacao"
          label="Em cotação"
          amount={cards?.emCotacao}
          amountFormat="number"
          tone="info"
          icon={Scale}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-negociado"
          label="Negociado"
          amount={cards?.negociado}
          amountFormat="number"
          tone="info"
          icon={Handshake}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-pedido"
          label="Pedido"
          amount={cards?.pedido}
          amountFormat="number"
          tone="warning"
          icon={ShoppingCart}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-confirmado"
          label="Confirmado"
          amount={cards?.confirmado}
          amountFormat="number"
          tone="success"
          icon={CheckCircle2}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-recebido"
          label="Recebido"
          amount={cards?.recebido}
          amountFormat="number"
          tone="success"
          icon={Package}
          helperText="Funil exclusivo"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-pendente"
          label="Pendente"
          amount={cards?.pendente}
          amountFormat="number"
          tone="warning"
          icon={Timer}
          helperText="Ortogonal ao funil"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="ws-card-ganho"
          label="Ganho negociado"
          amount={cards?.ganhoNegociado}
          amountFormat="currency"
          tone="money"
          icon={TrendingDown}
          helperText="Ortogonal — não soma no funil"
          loading={loading}
        />
      </SummaryKpiGrid>

      {cards ? (
        <p className="text-xs text-muted-foreground" data-testid="ws-pipeline-total">
          Funil exclusivo: {cards.pipelineTotal} grain(s) · pendente e ganho não entram na soma do
          funil
          {data?.meta?.pipelineExclusive ? " · anti-duplicação ativa" : ""}
        </p>
      ) : null}

      <form
        onSubmit={applyFilters}
        className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3"
        data-testid="purchase-workstation-filters"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            placeholder="Busca (título, fornecedor, MP, responsável)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">Todos os estágios</option>
            {Object.entries(STAGE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Todas as prioridades</option>
            <option value="BAIXA">Baixa</option>
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
            <option value="URGENTE">Urgente</option>
          </select>
          <input
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            placeholder="Status exato"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
          <input
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            placeholder="Responsável"
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
          />
          <input
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            placeholder="Fornecedor (UUID)"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          />
          <input
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            placeholder="Matéria-prima (UUID)"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
          />
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Período de
            <input
              type="date"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Período até
            <input
              type="date"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Necessário de
            <input
              type="date"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={neededByFrom}
              onChange={(e) => setNeededByFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Necessário até
            <input
              type="date"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={neededByTo}
              onChange={(e) => setNeededByTo(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-border text-sm"
            onClick={() => {
              setQ("");
              setStage("");
              setStatus("");
              setResponsible("");
              setSupplierId("");
              setMaterialId("");
              setPriority("");
              setPeriodFrom("");
              setPeriodTo("");
              setNeededByFrom("");
              setNeededByTo("");
              setKind("");
              setPage(1);
              setApplied({
                q: "",
                stage: "",
                status: "",
                responsible: "",
                supplierId: "",
                materialId: "",
                priority: "",
                periodFrom: "",
                periodTo: "",
                neededByFrom: "",
                neededByTo: "",
                kind: "",
              });
            }}
          >
            Limpar
          </button>
        </div>
      </form>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando estação…
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm" data-testid="purchase-workstation-table">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Tipo</th>
                <th className="p-3">Título</th>
                <th className="p-3">Estágio</th>
                <th className="p-3">Status</th>
                <th className="p-3">Responsável</th>
                <th className="p-3">Fornecedor</th>
                <th className="p-3">MP</th>
                <th className="p-3">Prioridade</th>
                <th className="p-3">Necessário</th>
                <th className="p-3">Ganho</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-muted-foreground text-center">
                    Nenhum item no filtro atual.
                  </td>
                </tr>
              ) : (
                (data?.rows ?? []).map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-t border-border hover:bg-muted/20">
                    <td className="p-3 whitespace-nowrap">{KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td className="p-3">
                      <Link to={row.href} className="text-primary hover:underline">
                        {row.title}
                      </Link>
                      {row.isPendingApproval ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700">
                          pendente
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {row.pipelineStage
                        ? STAGE_LABEL[row.pipelineStage] ?? row.pipelineStage
                        : "—"}
                    </td>
                    <td className="p-3 whitespace-nowrap">{row.status}</td>
                    <td className="p-3">{row.responsible ?? "—"}</td>
                    <td className="p-3">{row.supplierName ?? "—"}</td>
                    <td className="p-3">{row.materialCode ?? "—"}</td>
                    <td className="p-3">{row.priority ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap">{row.neededByDate ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap">{money(row.negotiatedGain)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {data?.pagination ? (
            <div className="flex items-center justify-between gap-2 p-3 border-t border-border text-sm">
              <span className="text-muted-foreground">
                Página {data.pagination.page} de {data.pagination.totalPages} ·{" "}
                {data.pagination.total} item(ns)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40"
                  disabled={data.pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40"
                  disabled={data.pagination.page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
