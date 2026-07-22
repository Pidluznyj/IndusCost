/**
 * Estação operacional de Compras (OP-21) — motor puro.
 * Cards de pipeline são mutuamente exclusivos por solicitação (grain = purchaseRequestId).
 * "Pendente" e "Ganho negociado" são métricas ortogonais (não somam no funil).
 */

export const PURCHASING_PIPELINE_STAGES = [
  "SOLICITADO",
  "EM_COTACAO",
  "NEGOCIADO",
  "PEDIDO",
  "CONFIRMADO",
  "RECEBIDO",
] as const;

export type PurchasingPipelineStage = (typeof PURCHASING_PIPELINE_STAGES)[number];

export type PurchasingWorkstationEntityKind =
  | "REQUEST"
  | "QUOTATION"
  | "NEGOTIATION"
  | "EVIDENCE"
  | "APPROVAL"
  | "PURCHASE_ORDER";

export type PurchasingWorkstationRowInput = {
  id: string;
  kind: PurchasingWorkstationEntityKind;
  /** Grain de pipeline — preferencialmente SC id; fallback quotation/PO id. */
  pipelineKey: string;
  status: string;
  title: string;
  responsible: string | null;
  supplierId: string | null;
  supplierName: string | null;
  materialId: string | null;
  materialCode: string | null;
  priority: string | null;
  neededByDate: string | null; // YYYY-MM-DD
  createdAt: string; // ISO
  href: string;
  /** Ganho monetário associado (só em award/PO) — não usado no funil de contagem. */
  negotiatedGain: number | null;
  /** Se aprovação ainda pendente. */
  isPendingApproval: boolean;
  /** Sinais de progresso para classificar a SC. */
  signals: {
    hasQuotation: boolean;
    hasClosedRound: boolean;
    hasApprovedAward: boolean;
    purchaseOrderStatus: string | null;
  };
};

export type PurchasingWorkstationFilters = {
  q?: string;
  stage?: PurchasingPipelineStage | "PENDENTE" | "";
  status?: string;
  responsible?: string;
  supplierId?: string;
  materialId?: string;
  priority?: string;
  periodFrom?: string; // YYYY-MM-DD
  periodTo?: string;
  neededByFrom?: string;
  neededByTo?: string;
  kind?: PurchasingWorkstationEntityKind | "";
};

export type PurchasingWorkstationCards = {
  solicitado: number;
  emCotacao: number;
  negociado: number;
  pedido: number;
  confirmado: number;
  recebido: number;
  /** Atenção — não entra na soma do funil. */
  pendente: number;
  /** Moeda agregada — não é contagem. */
  ganhoNegociado: number;
  /** Soma exclusiva do funil (sem pendente). */
  pipelineTotal: number;
};

const STAGE_RANK: Record<PurchasingPipelineStage, number> = {
  SOLICITADO: 1,
  EM_COTACAO: 2,
  NEGOCIADO: 3,
  PEDIDO: 4,
  CONFIRMADO: 5,
  RECEBIDO: 6,
};

const ORDERED_PO = new Set(["RASCUNHO", "APROVADO", "ENVIADO", "EMITIDO"]);
const CONFIRMED_PO = new Set(["CONFIRMADO"]);
const RECEIVED_PO = new Set(["PARCIALMENTE_RECEBIDO", "RECEBIDO"]);

export function classifyPipelineStage(signals: PurchasingWorkstationRowInput["signals"]): PurchasingPipelineStage {
  const po = signals.purchaseOrderStatus;
  if (po && RECEIVED_PO.has(po)) return "RECEBIDO";
  if (po && CONFIRMED_PO.has(po)) return "CONFIRMADO";
  if (po && ORDERED_PO.has(po)) return "PEDIDO";
  if (signals.hasApprovedAward || signals.hasClosedRound) return "NEGOCIADO";
  if (signals.hasQuotation) return "EM_COTACAO";
  return "SOLICITADO";
}

/** Mantém o estágio mais avançado por pipelineKey (anti-duplicação). */
export function resolveExclusivePipelineStages(
  rows: PurchasingWorkstationRowInput[]
): Map<string, PurchasingPipelineStage> {
  const map = new Map<string, PurchasingPipelineStage>();
  for (const row of rows) {
    // Evidências são trilha — não criam grain de funil.
    if (row.kind === "EVIDENCE") continue;
    const stage = classifyPipelineStage(row.signals);
    const prev = map.get(row.pipelineKey);
    if (!prev || STAGE_RANK[stage] > STAGE_RANK[prev]) {
      map.set(row.pipelineKey, stage);
    }
  }
  return map;
}

export function buildWorkstationCards(
  rows: PurchasingWorkstationRowInput[],
  exclusiveStages: Map<string, PurchasingPipelineStage>
): PurchasingWorkstationCards {
  const cards: PurchasingWorkstationCards = {
    solicitado: 0,
    emCotacao: 0,
    negociado: 0,
    pedido: 0,
    confirmado: 0,
    recebido: 0,
    pendente: 0,
    ganhoNegociado: 0,
    pipelineTotal: 0,
  };

  for (const stage of exclusiveStages.values()) {
    switch (stage) {
      case "SOLICITADO":
        cards.solicitado += 1;
        break;
      case "EM_COTACAO":
        cards.emCotacao += 1;
        break;
      case "NEGOCIADO":
        cards.negociado += 1;
        break;
      case "PEDIDO":
        cards.pedido += 1;
        break;
      case "CONFIRMADO":
        cards.confirmado += 1;
        break;
      case "RECEBIDO":
        cards.recebido += 1;
        break;
    }
  }
  cards.pipelineTotal =
    cards.solicitado +
    cards.emCotacao +
    cards.negociado +
    cards.pedido +
    cards.confirmado +
    cards.recebido;

  // Pendente é ortogonal ao funil — dedupe por pipelineKey para não inflar.
  cards.pendente = new Set(
    rows.filter((r) => r.isPendingApproval).map((r) => r.pipelineKey)
  ).size;

  // Ganho: dedupe por pipelineKey — usa o maior valor absoluto por grain.
  const gainByKey = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === "EVIDENCE") continue;
    if (row.negotiatedGain == null || !Number.isFinite(row.negotiatedGain)) continue;
    const prev = gainByKey.get(row.pipelineKey);
    if (prev == null || Math.abs(row.negotiatedGain) > Math.abs(prev)) {
      gainByKey.set(row.pipelineKey, row.negotiatedGain);
    }
  }
  cards.ganhoNegociado = [...gainByKey.values()].reduce((s, v) => s + v, 0);

  return cards;
}

export function rowMatchesFilters(
  row: PurchasingWorkstationRowInput,
  stageByKey: Map<string, PurchasingPipelineStage>,
  filters: PurchasingWorkstationFilters
): boolean {
  if (filters.kind && row.kind !== filters.kind) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.supplierId && row.supplierId !== filters.supplierId) return false;
  if (filters.materialId && row.materialId !== filters.materialId) return false;
  if (filters.priority && (row.priority || "").toUpperCase() !== filters.priority.toUpperCase()) {
    return false;
  }
  if (filters.responsible) {
    const needle = filters.responsible.trim().toLowerCase();
    if (!(row.responsible || "").toLowerCase().includes(needle)) return false;
  }
  if (filters.q) {
    const needle = filters.q.trim().toLowerCase();
    const hay = `${row.title} ${row.supplierName ?? ""} ${row.materialCode ?? ""} ${row.responsible ?? ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (filters.periodFrom && row.createdAt.slice(0, 10) < filters.periodFrom) return false;
  if (filters.periodTo && row.createdAt.slice(0, 10) > filters.periodTo) return false;
  if (filters.neededByFrom && (!row.neededByDate || row.neededByDate < filters.neededByFrom)) return false;
  if (filters.neededByTo && (!row.neededByDate || row.neededByDate > filters.neededByTo)) return false;

  if (filters.stage === "PENDENTE") {
    return row.isPendingApproval;
  }
  if (filters.stage) {
    return stageByKey.get(row.pipelineKey) === filters.stage;
  }
  return true;
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.min(100, Math.floor(pageSize)) : 20;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const start = (safePage - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages,
  };
}

export function assertCardsDoNotDoubleCountPipeline(cards: PurchasingWorkstationCards): void {
  const sum =
    cards.solicitado +
    cards.emCotacao +
    cards.negociado +
    cards.pedido +
    cards.confirmado +
    cards.recebido;
  if (sum !== cards.pipelineTotal) {
    throw new Error("PIPELINE_CARD_MISMATCH");
  }
}
