/**
 * Direitos econômicos de comissão por título — cardinalidade N:N.
 *
 * O direito canônico é o schedule VIGENTE de cada pedido no título
 * (`CommissionReceivableSchedule` do snapshot ACTIVE do pedido para a NF-e do
 * título). Uma NF-e pode ter N pedidos e um pedido pode estar em N NF-e: a
 * cardinalidade sozinha não é ambiguidade. O que impede é evidência
 * contraditória ou ausente, e isso continua virando exceção auditável:
 *
 *   - SCHEDULED: pedido vinculado à NF-e do título, com um schedule vigente;
 *   - MISSING_SCHEDULE: pedido vinculado à NF-e, sem schedule neste título;
 *   - CONTRADICTORY_LINK: schedule de pedido que não está vinculado à NF-e do
 *     título, ou com NF-e diferente da do título;
 *   - DUPLICATE_SCHEDULE: dois schedules vivos do MESMO pedido no título;
 *   - OVER_ALLOCATED_ACROSS_NFE: o pedido tem snapshots vigentes em mais de uma
 *     NF-e que, somados, reivindicam mais do que o valor do pedido (R1). Sem
 *     alocação por item × NF-e não há lastro para dividir — fica retido.
 *
 * Lógica pura. Não escolhe "o primeiro pedido", não infere vínculo por cliente,
 * valor ou produto, não multiplica recebimento.
 */
import { allocateProportional, roundMoney } from "./commission-money.shared.js";
import type { CommissionOrderSourceBundle } from "./commission-types.js";
import { keepSchedulesFromActiveSnapshot } from "./commissionScheduleVigency.js";
import type { CommissionReceivableScheduleStatusValue } from "./commissionReceivableScheduler.js";

/** Campos do schedule materializado usados aqui (subconjunto de MaterializedReceivableScheduleInput). */
export type ReceivableRightScheduleInput = {
  id: string;
  orderSnapshotId: string;
  salesOrderId: string;
  orderCode: string | null;
  nfeId: number | null;
  scheduleStatus: CommissionReceivableScheduleStatusValue;
  orderSnapshotStatus?: string | null;
  orderSnapshotSoldAmount?: number | null;
};

/** Snapshot vigente (ACTIVE) de um pedido, para lastro de atribuição e guarda R1. */
export type VigentOrderSnapshotFact = {
  snapshotId: string;
  nfeId: number | null;
  totalSoldAmount: number;
  totalFinalCommissionAmount: number;
  itemStatuses: string[];
  items: Array<{ salesOrderItemId: string; soldAmount: number }>;
};

export type ReceivableOrderRightResolution =
  | "SCHEDULED"
  | "MISSING_SCHEDULE"
  | "CONTRADICTORY_LINK"
  | "DUPLICATE_SCHEDULE"
  | "OVER_ALLOCATED_ACROSS_NFE";

export type ReceivableOrderRight<S extends ReceivableRightScheduleInput> = {
  salesOrderId: string;
  orderCode: string | null;
  /** Bundle do pedido quando ele está vinculado à NF-e do título. */
  order: CommissionOrderSourceBundle | null;
  /** Schedule escolhido (vigente) — null em MISSING_SCHEDULE. */
  schedule: S | null;
  /** Demais schedules vivos do mesmo pedido (DUPLICATE_SCHEDULE). */
  conflictingSchedules: S[];
  resolution: ReceivableOrderRightResolution;
  reason: string | null;
};

export const COMMISSION_RIGHT_CONTRADICTORY_LINK_REASON =
  "Schedule de pedido sem vínculo com a NF-e do título (SalesOrderNfeLink) — origem fiscal não comprovada; rematerializar antes de fechar.";
export const COMMISSION_RIGHT_NFE_MISMATCH_REASON =
  "Schedule aponta NF-e diferente da NF-e de origem do título — rematerializar antes de fechar.";
export const COMMISSION_RIGHT_UNVERIFIED_LINK_REASON =
  "NF-e ligada a mais de um pedido sem os vínculos carregados — vínculo do schedule não verificável.";
export const COMMISSION_RIGHT_DUPLICATE_SCHEDULE_REASON =
  "Mais de um schedule vigente do mesmo pedido no título — rematerializar antes de fechar.";
export const COMMISSION_RIGHT_OVER_ALLOCATED_REASON =
  "Pedido faturado em mais de uma NF-e com snapshot integral em cada uma (R1): sem alocação por item × NF-e não há lastro para dividir a comissão. Retido até a alocação por NF-e; o recebimento continua pendente.";
export const COMMISSION_RIGHT_MULTI_ORDER_WITHOUT_EVIDENCE_REASON =
  "NF-e ligada a mais de um pedido, sem schedule e sem vínculos carregados — direitos dos pedidos ainda não reconhecidos.";

export const COMMISSION_RIGHT_OVER_ALLOCATED_FLAG = "ORDER_COMMISSION_OVER_ALLOCATED_ACROSS_NFE";
export const COMMISSION_RIGHT_SHARED_ANCHOR_UNATTRIBUTED_FLAG = "SHARED_FINANCIAL_ANCHOR_UNATTRIBUTED";

/** Linhas que não estão substituídas dentro da versão vigente. */
const NON_LIVE_SCHEDULE_STATUSES = new Set<string>(["STALE", "SUPERSEDED"]);

function compareRights(
  a: { orderCode: string | null; salesOrderId: string },
  b: { orderCode: string | null; salesOrderId: string }
): number {
  return (
    (a.orderCode ?? "").localeCompare(b.orderCode ?? "", "pt-BR", { numeric: true }) ||
    a.salesOrderId.localeCompare(b.salesOrderId)
  );
}

/**
 * Escolhe o schedule vigente de UM pedido no título (mesma regra que valia por
 * título): versão vigente; ACTIVE vence; senão o desfecho vivo da versão (ex.:
 * CUSTOMER_EXCLUDED); senão a primeira linha da versão (vira STALE adiante).
 * Dois schedules vivos do mesmo pedido ⇒ duplicidade.
 */
export function selectVigentScheduleForOrder<S extends ReceivableRightScheduleInput>(
  schedules: readonly S[]
): { schedule: S | null; duplicates: S[] } {
  const current = keepSchedulesFromActiveSnapshot(schedules);
  if (current.length === 0) return { schedule: null, duplicates: [] };
  const live = current.filter((row) => !NON_LIVE_SCHEDULE_STATUSES.has(row.scheduleStatus));
  if (live.length > 1) {
    const ordered = [...live].sort(
      (a, b) =>
        Number(b.scheduleStatus === "ACTIVE") - Number(a.scheduleStatus === "ACTIVE") ||
        a.id.localeCompare(b.id)
    );
    return { schedule: ordered[0]!, duplicates: ordered.slice(1) };
  }
  if (live.length === 1) return { schedule: live[0]!, duplicates: [] };
  return { schedule: current[0] ?? null, duplicates: [] };
}

/**
 * Resolve os direitos econômicos de um título: um por pedido.
 *
 * `linkedOrders` = pedidos vinculados à NF-e do título (SalesOrderNfeLink).
 * `null` = o chamador não forneceu evidência de vínculo: os schedules valem como
 * estão (comportamento histórico), salvo quando a NF-e é sabidamente de vários
 * pedidos (`multiOrderNfe`) — aí o vínculo de cada schedule não é verificável.
 */
export function resolveReceivableOrderRights<S extends ReceivableRightScheduleInput>(input: {
  receivableNfeId: number | null;
  schedules: readonly S[];
  linkedOrders: readonly CommissionOrderSourceBundle[] | null;
  multiOrderNfe?: boolean;
  overAllocatedOrderIds?: ReadonlySet<string>;
}): ReceivableOrderRight<S>[] {
  const current = keepSchedulesFromActiveSnapshot(input.schedules);
  const byOrder = new Map<string, S[]>();
  for (const row of current) {
    const list = byOrder.get(row.salesOrderId) ?? [];
    list.push(row);
    byOrder.set(row.salesOrderId, list);
  }

  const linkedById = new Map<string, CommissionOrderSourceBundle>();
  for (const order of input.linkedOrders ?? []) {
    if (!linkedById.has(order.localOrderId)) linkedById.set(order.localOrderId, order);
  }
  const evidence = input.linkedOrders != null;
  const orderIds = new Set<string>([...linkedById.keys(), ...byOrder.keys()]);

  const rights: ReceivableOrderRight<S>[] = [];
  for (const salesOrderId of orderIds) {
    const order = linkedById.get(salesOrderId) ?? null;
    const schedules = byOrder.get(salesOrderId) ?? [];
    const { schedule, duplicates } = selectVigentScheduleForOrder(schedules);
    const orderCode = order?.orderCode ?? schedule?.orderCode ?? null;
    const base = { salesOrderId, orderCode, order, schedule, conflictingSchedules: duplicates };

    if (!schedule) {
      rights.push({ ...base, resolution: "MISSING_SCHEDULE", reason: null });
      continue;
    }
    if (evidence && !order) {
      rights.push({ ...base, resolution: "CONTRADICTORY_LINK", reason: COMMISSION_RIGHT_CONTRADICTORY_LINK_REASON });
      continue;
    }
    if (!evidence && input.multiOrderNfe) {
      rights.push({ ...base, resolution: "CONTRADICTORY_LINK", reason: COMMISSION_RIGHT_UNVERIFIED_LINK_REASON });
      continue;
    }
    if (
      schedule.nfeId != null &&
      input.receivableNfeId != null &&
      schedule.nfeId !== input.receivableNfeId
    ) {
      rights.push({ ...base, resolution: "CONTRADICTORY_LINK", reason: COMMISSION_RIGHT_NFE_MISMATCH_REASON });
      continue;
    }
    if (duplicates.length > 0) {
      rights.push({ ...base, resolution: "DUPLICATE_SCHEDULE", reason: COMMISSION_RIGHT_DUPLICATE_SCHEDULE_REASON });
      continue;
    }
    if (input.overAllocatedOrderIds?.has(salesOrderId)) {
      rights.push({ ...base, resolution: "OVER_ALLOCATED_ACROSS_NFE", reason: COMMISSION_RIGHT_OVER_ALLOCATED_REASON });
      continue;
    }
    rights.push({ ...base, resolution: "SCHEDULED", reason: null });
  }

  return rights.sort(compareRights);
}

export type OrderOverAllocationAcrossNfes = {
  salesOrderId: string;
  nfeIds: number[];
  /** Base vendida reivindicada pelos snapshots vigentes (Σ por item). */
  claimedSoldAmount: number;
  /** Valor vendido do pedido (Σ itemNetAmount dos itens ativos). */
  orderSoldAmount: number;
};

/**
 * R1: a mesma venda reivindicada por mais de uma NF-e. Conta só snapshots
 * vigentes de NF-e de saída autorizadas e não canceladas vinculadas ao pedido —
 * a mesma definição de "NF-e de faturamento" do materializador
 * (`authorizedOutputNfes`): reemissão, devolução ou remessa não contam em dobro.
 * Por item: Σ base dos snapshots > valor do item ⇒ sobrealocação. Snapshots
 * parciais por NF-e (alocação por item, B5) passam naturalmente.
 */
export function detectOrdersOverAllocatedAcrossNfes(input: {
  orderIds: Iterable<string>;
  snapshotsByOrderId: ReadonlyMap<string, readonly VigentOrderSnapshotFact[]>;
  bundlesByOrderId: ReadonlyMap<string, CommissionOrderSourceBundle>;
}): Map<string, OrderOverAllocationAcrossNfes> {
  const out = new Map<string, OrderOverAllocationAcrossNfes>();
  for (const salesOrderId of new Set(input.orderIds)) {
    const bundle = input.bundlesByOrderId.get(salesOrderId) ?? null;
    const counted = (input.snapshotsByOrderId.get(salesOrderId) ?? []).filter((fact) => {
      if (fact.nfeId == null) return false;
      if (!bundle) return true;
      const link = bundle.linkedNfes.find((nfe) => nfe.nfeExternalId === fact.nfeId);
      return link != null && link.isAuthorized && link.isOutputOperation && !link.isCancelled;
    });
    const nfeIds = [...new Set(counted.map((fact) => fact.nfeId as number))].sort((a, b) => a - b);
    if (nfeIds.length < 2) continue;

    const itemValue = new Map<string, number>();
    for (const item of bundle?.items ?? []) itemValue.set(item.localItemId, roundMoney(item.itemNetAmount));
    const claimed = new Map<string, number>();
    const maxPerItem = new Map<string, number>();
    for (const fact of counted) {
      for (const item of fact.items) {
        claimed.set(item.salesOrderItemId, roundMoney((claimed.get(item.salesOrderItemId) ?? 0) + item.soldAmount));
        maxPerItem.set(item.salesOrderItemId, Math.max(maxPerItem.get(item.salesOrderItemId) ?? 0, item.soldAmount));
      }
    }

    let overAllocated = false;
    if (claimed.size > 0) {
      for (const [itemId, amount] of claimed) {
        const limit = itemValue.get(itemId) ?? maxPerItem.get(itemId) ?? 0;
        if (amount > roundMoney(limit) + 0.01) {
          overAllocated = true;
          break;
        }
      }
    } else {
      // Sem itens no fato: compara no nível do pedido.
      const claimedTotal = roundMoney(counted.reduce((sum, fact) => sum + fact.totalSoldAmount, 0));
      const limit = bundle
        ? roundMoney(bundle.items.reduce((sum, item) => sum + item.itemNetAmount, 0))
        : Math.max(...counted.map((fact) => fact.totalSoldAmount));
      overAllocated = claimedTotal > limit + 0.01;
    }
    if (!overAllocated) continue;

    out.set(salesOrderId, {
      salesOrderId,
      nfeIds,
      claimedSoldAmount: roundMoney([...claimed.values()].reduce((sum, value) => sum + value, 0)) ||
        roundMoney(counted.reduce((sum, fact) => sum + fact.totalSoldAmount, 0)),
      orderSoldAmount: roundMoney((bundle?.items ?? []).reduce((sum, item) => sum + item.itemNetAmount, 0)),
    });
  }
  return out;
}

/**
 * Valor vendido oficial do pedido nesta NF-e — peso de atribuição do título.
 * Snapshot vigente (pedido, NF-e) ⇒ sua base vendida; sem snapshot ⇒ o mesmo
 * valor que o materializador usaria (Σ itemNetAmount dos itens ativos). Pedido
 * sobrealocado (R1) ⇒ sem lastro (a parte desta NF-e não é conhecida).
 */
export function resolveOrderAttributionWeight(input: {
  right: Pick<ReceivableOrderRight<ReceivableRightScheduleInput>, "salesOrderId" | "order" | "schedule" | "resolution">;
  receivableNfeId: number | null;
  snapshotsByOrderId?: ReadonlyMap<string, readonly VigentOrderSnapshotFact[]>;
}): number | null {
  if (input.right.resolution === "OVER_ALLOCATED_ACROSS_NFE") return null;
  if (input.right.resolution === "CONTRADICTORY_LINK") return null;
  const facts = input.snapshotsByOrderId?.get(input.right.salesOrderId) ?? [];
  const fact =
    (input.right.schedule && facts.find((row) => row.snapshotId === input.right.schedule!.orderSnapshotId)) ||
    (input.receivableNfeId != null ? facts.find((row) => row.nfeId === input.receivableNfeId) : undefined);
  if (fact) return fact.totalSoldAmount > 0 ? roundMoney(fact.totalSoldAmount) : null;
  const scheduled = input.right.schedule?.orderSnapshotSoldAmount;
  if (scheduled != null && scheduled > 0) return roundMoney(scheduled);
  if (input.right.order) {
    const net = roundMoney(input.right.order.items.reduce((sum, item) => sum + item.itemNetAmount, 0));
    return net > 0 ? net : null;
  }
  return null;
}

/**
 * Reparte um valor do título entre os direitos pelo peso, com resto exato no
 * último. Qualquer peso ausente ou não positivo ⇒ sem lastro (nada repartido):
 * nunca divide por igual nem inventa proporção.
 */
export function attributeFinancialAnchorAmount(input: {
  amount: number;
  weights: ReadonlyArray<{ key: string; weight: number | null }>;
}): { attribution: "ATTRIBUTED" | "UNATTRIBUTED"; amounts: Map<string, number> } {
  const amounts = new Map<string, number>();
  const valid = input.weights.every((row) => row.weight != null && Number.isFinite(row.weight) && row.weight > 0);
  if (!valid || input.weights.length === 0) {
    for (const row of input.weights) amounts.set(row.key, 0);
    return { attribution: "UNATTRIBUTED", amounts };
  }
  const allocations = allocateProportional(
    input.amount,
    input.weights.map((row) => ({ key: row.key, weight: row.weight as number }))
  );
  for (const row of allocations) amounts.set(row.key, row.amount);
  return { attribution: "ATTRIBUTED", amounts };
}

/* ------------------------------------------------------------------ */
/*  Guarda de cobertura: nenhum direito é consumido sem conciliação      */
/* ------------------------------------------------------------------ */

export type ReceiptRightConflictLine = {
  nomusReceivableId: number | null;
  status: string;
  receiptIds?: number[] | null;
  receiptExternalIds?: number[] | null;
  orderCode?: string | null;
  /** Pedido do direito (linha da prévia). */
  localOrderId?: string | null;
  /** Pedido do direito (linha do ledger). */
  salesOrderId?: string | null;
};

export type ReceiptRightConflict = {
  receiptExternalId: number;
  nomusReceivableId: number | null;
  finalOrderCodes: string[];
  pendingRights: Array<{ orderCode: string | null; status: string }>;
  kind: "EVENT_LINE_WITH_RIGHTS" | "MIXED_EVENT_LINES";
};

/** Pedido do direito da linha — nulo = linha do evento inteiro (sem pedido). */
export function rightOrderIdOf(line: { localOrderId?: string | null; salesOrderId?: string | null }): string | null {
  return line.salesOrderId ?? line.localOrderId ?? null;
}

/**
 * Eventos de recebimento que a cobertura não consegue representar sem perder ou
 * inventar direito. A cobertura é por (evento, pedido) — um pedido final ao lado de
 * outro pendente NÃO é conflito: cobre o final e o pendente segue pendente. Conflito é:
 *   - EVENT_LINE_WITH_RIGHTS: linha sem pedido (cobriria o evento inteiro, ex. "sem
 *     vínculo de venda") ao lado de direitos de pedido no mesmo evento;
 *   - MIXED_EVENT_LINES: linhas sem pedido, uma final e outra pendente (cobrir o evento
 *     perderia a pendente — situação de antes do N:N, ainda recusada).
 */
export function findReceiptRightConflicts(
  lines: readonly ReceiptRightConflictLine[],
  isFinal: (status: string) => boolean
): ReceiptRightConflict[] {
  const byReceipt = new Map<number, ReceiptRightConflictLine[]>();
  for (const line of lines) {
    for (const id of line.receiptExternalIds ?? line.receiptIds ?? []) {
      const list = byReceipt.get(id) ?? [];
      list.push(line);
      byReceipt.set(id, list);
    }
  }
  const out: ReceiptRightConflict[] = [];
  for (const [receiptExternalId, group] of byReceipt) {
    if (group.length < 2) continue;
    const eventLines = group.filter((line) => rightOrderIdOf(line) == null);
    const rightLines = group.filter((line) => rightOrderIdOf(line) != null);
    let kind: ReceiptRightConflict["kind"] | null = null;
    if (eventLines.length > 0 && rightLines.length > 0 && group.some((line) => isFinal(line.status))) {
      kind = "EVENT_LINE_WITH_RIGHTS";
    } else if (
      eventLines.length > 1 &&
      eventLines.some((line) => isFinal(line.status)) &&
      eventLines.some((line) => !isFinal(line.status))
    ) {
      kind = "MIXED_EVENT_LINES";
    }
    if (!kind) continue;
    const scope = kind === "MIXED_EVENT_LINES" ? eventLines : group;
    out.push({
      receiptExternalId,
      nomusReceivableId: group[0]?.nomusReceivableId ?? null,
      finalOrderCodes: scope.filter((line) => isFinal(line.status)).map((line) => line.orderCode ?? "—"),
      pendingRights: scope
        .filter((line) => (kind === "MIXED_EVENT_LINES" ? !isFinal(line.status) : true))
        .map((line) => ({ orderCode: line.orderCode ?? null, status: line.status })),
      kind,
    });
  }
  return out.sort((a, b) => a.receiptExternalId - b.receiptExternalId);
}

export function formatReceiptRightConflicts(conflicts: readonly ReceiptRightConflict[]): string {
  const detail = conflicts
    .slice(0, 5)
    .map((conflict) => {
      const rights = conflict.pendingRights
        .map((row) => `${row.orderCode ? `PD ${row.orderCode}` : "sem pedido"} (${row.status})`)
        .join(", ");
      return conflict.kind === "MIXED_EVENT_LINES"
        ? `recebimento ${conflict.receiptExternalId} (CR ${conflict.nomusReceivableId ?? "?"}): ${rights} ainda pendente(s) no mesmo evento`
        : `recebimento ${conflict.receiptExternalId} (CR ${conflict.nomusReceivableId ?? "?"}): linha sem pedido ao lado de direitos de pedido — ${rights}`;
    })
    .join("; ");
  const more = conflicts.length > 5 ? ` (+${conflicts.length - 5})` : "";
  return `Fechamento bloqueado: a cobertura destes recebimentos perderia ou inventaria direitos de comissão — ${detail}${more}. Resolva o vínculo de venda ou as pendências antes de fechar.`;
}
