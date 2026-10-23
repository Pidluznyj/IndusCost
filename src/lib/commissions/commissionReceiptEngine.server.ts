/**
 * Carga do motor de prévia por recebimento.
 * O universo do mês vem de `NomusReceivableReceipt.receiptDate`; a baixa
 * (`settlementDate`) segue lida e anexada às linhas apenas como auditoria.
 */
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  buildCommissionReceiptPreview,
  buildCommissionReceivableForecastPreview,
  filterOpenReceivablesForForecast,
  type CommissionReceiptPreviewResult,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
  resolveMaterializedItemExclusionMeta,
} from "./commissionReceiptEngine.js";
import type { CommissionReceiptCompetence } from "./commissionReceiptCompetence.js";
import {
  loadCommissionReceiptCompetenceForPeriod,
  loadCommissionReceiptCompetenceForScope,
  type CommissionReceiptEventScope,
} from "./commissionReceiptCompetence.server.js";
import type { CommissionReceiptSellerRecordInput } from "./commissionReceiptSeller.js";
import { commissionActiveSnapshotWhere } from "./commissionScheduleVigency.js";
import { loadActiveCommissionRules } from "./commission-rule-engine.js";
import { parseCommissionVisualAuditQuery } from "./commissionQuery.js";
import {
  indexUniqueOrderBundlesByNfeId,
  mapReceivableSource,
} from "./commission-source-resolver.js";
import { indexAllOrderBundlesByNfeId } from "./commissionSalesOrderNfeLinkResolution.js";
import type { VigentOrderSnapshotFact } from "./commissionReceivableOrderRights.js";
import type { CommissionOrderSourceBundle } from "./commission-types.js";
import {
  COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON,
} from "./commissionSalesOrderNfeLinkResolution.js";
import {
  loadCommissionOrderSourcesByNfeExternalIds,
  resolveCommissionPeriod,
} from "./commission-source-resolver.server.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import { ensureCommissionMaterializationForReceivableRefs } from "./commissionMaterializationOrchestrator.server.js";
import { decimalToNumber } from "./commission-money.js";
import { isCompetenceOfficialInIndusCost } from "./commissionCoverageCutover.js";
import type { CommissionReceivableScheduleStatusValue } from "./commissionReceivableScheduler.js";
import {
  enrichVisualAuditRowsWithSellerIdentity,
  filterRowsByAppraisalMode,
} from "./commissionVisualAudit.js";
import { listCommissionVisualAuditPage } from "./commissionVisualAudit.server.js";

/** Motivo gravado nos itens do snapshot retido (`ALOCACAO_PENDENTE: …`). */
function allocationPendingReasonOf(items: ReadonlyArray<{ exclusionReason: string | null }>): string | null {
  const prefix = "ALOCACAO_PENDENTE: ";
  const reason = items.find((item) => item.exclusionReason?.startsWith(prefix))?.exclusionReason;
  return reason ? reason.slice(prefix.length) : null;
}

/**
 * `NomusAccountsReceivable.status` é a BAIXA do título no Nomus (true = baixado,
 * false = em aberto), não cancelamento: o Financeiro o rotula "Baixado/Em aberto
 * (Nomus)", a sincronização grava `false` em título em aberto e a auditoria real de
 * 30/09/2026 achou 125 títulos `false` com saldo integral e sem recebimento.
 *
 * Competência oficial (a partir do cutover): o recebimento é o fato que libera a
 * comissão por parcela recebida — título ainda em aberto com recebimento parcial entra
 * na prévia; a baixa não seleciona nem exclui nada. Antes do cutover a regra histórica
 * fica idêntica (comparação com o Nomus). `COMMISSION_OPEN_RECEIVABLE_RELEASE_ENABLED=false`
 * volta à regra antiga em todas as competências (alavanca de rollback sem deploy).
 */
function receivableStatusGateForCompetence(year: number, month: number): {
  where: { OR?: Array<{ status: boolean | null }> };
  excludes: (status: boolean | null | undefined) => boolean;
} {
  const enabled = (process.env.COMMISSION_OPEN_RECEIVABLE_RELEASE_ENABLED ?? "true").trim().toLowerCase() !== "false";
  if (enabled && isCompetenceOfficialInIndusCost(year, month)) return { where: {}, excludes: () => false };
  return { where: { OR: [{ status: null }, { status: true }] }, excludes: (status) => status === false };
}

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

export type LoadCommissionReceiptPreviewInput = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
  /** Fallback explícito: recalcular comissão por item (auditoria legada). */
  allowItemRecalculationFallback?: boolean;
  /**
   * Recorte por eventos de recebimento do período (cobertura/pendências). Ausente =
   * competência inteira do mês, exatamente como antes.
   */
  receiptScope?: CommissionReceiptEventScope | null;
};

function mapPrismaScheduleStatus(
  value: string
): CommissionReceivableScheduleStatusValue {
  const allowed: CommissionReceivableScheduleStatusValue[] = [
    "ACTIVE",
    "STALE",
    "SUPERSEDED",
    "ORPHAN",
    "CUSTOMER_EXCLUDED",
    "ERROR",
  ];
  return allowed.includes(value as CommissionReceivableScheduleStatusValue)
    ? (value as CommissionReceivableScheduleStatusValue)
    : "ERROR";
}

export async function loadMaterializedSchedulesByReceivableId(
  receivableIds: number[]
): Promise<Map<number, MaterializedReceivableScheduleInput[]>> {
  const map = new Map<number, MaterializedReceivableScheduleInput[]>();
  if (receivableIds.length === 0) return map;

  const rows = await prisma.commissionReceivableSchedule.findMany({
    // Só a versão VIGENTE do pedido. Schedule de snapshot substituído nunca
    // chega ao motor — antes disso, um schedule antigo ACTIVE e zerado
    // disputava a seleção com o correto e vencia (PD 02697).
    where: { receivableId: { in: receivableIds }, ...commissionActiveSnapshotWhere() },
    // Ordem determinística: sem isto a seleção seguia a ordem física do heap,
    // que na prática entrega os mais antigos primeiro.
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      orderSnapshot: {
        select: {
          status: true,
          rawSellerId: true,
          rawSellerName: true,
          canonicalSellerName: true,
          sellerResolutionStatus: true,
          totalFinalCommissionAmount: true,
          totalGrossCommissionAmount: true,
          totalSoldAmount: true,
          allocationBasis: true,
          items: {
            select: {
              exclusionReason: true,
              status: true,
              ruleSnapshotJson: true,
              finalCommissionAmount: true,
            },
          },
        },
      },
      salesOrder: { select: { orderCode: true, externalSalesOrderId: true } },
      canonicalSeller: { select: { id: true, name: true } },
    },
  });

  for (const row of rows) {
    const itemSnapshot = row.orderSnapshot.items[0];
    const exclusionMeta = resolveMaterializedItemExclusionMeta(itemSnapshot);
    const list = map.get(row.receivableId) ?? [];
    list.push({
      id: row.id,
      orderSnapshotId: row.orderSnapshotId,
      receivableId: row.receivableId,
      receivableCode: row.receivableCode,
      installmentNumber: row.installmentNumber,
      nfeId: row.nfeId,
      salesOrderId: row.salesOrderId,
      customerId: row.customerId,
      canonicalSellerId: row.canonicalSellerId,
      canonicalSellerName:
        row.canonicalSeller?.name ?? row.orderSnapshot.canonicalSellerName,
      rawSellerId: row.orderSnapshot.rawSellerId,
      rawSellerName: row.orderSnapshot.rawSellerName,
      orderCode: row.salesOrder.orderCode,
      receivableNominalAmount: decimalToNumber(row.receivableNominalAmount),
      receivableSharePercent: decimalToNumber(row.receivableSharePercent),
      scheduledCommissionAmount: decimalToNumber(row.scheduledCommissionAmount),
      scheduleStatus: mapPrismaScheduleStatus(row.status),
      sellerResolutionStatus: row.orderSnapshot.sellerResolutionStatus,
      exclusionRuleId: exclusionMeta.exclusionRuleId,
      exclusionReason:
        exclusionMeta.exclusionReason ??
        (mapPrismaScheduleStatus(row.status) === "CUSTOMER_EXCLUDED"
          ? "Cliente excluído de comissão"
          : null),
      itemSnapshotStatuses: row.orderSnapshot.items.map((item) => item.status),
      orderSnapshotFinalCommissionAmount: decimalToNumber(
        row.orderSnapshot.totalFinalCommissionAmount
      ),
      orderSnapshotStatus: row.orderSnapshot.status,
      orderSnapshotSoldAmount: decimalToNumber(row.orderSnapshot.totalSoldAmount),
      orderSnapshotAllocationBasis: row.orderSnapshot.allocationBasis,
      orderSnapshotAllocationReason: allocationPendingReasonOf(row.orderSnapshot.items),
      nomusOrderId: row.salesOrder.externalSalesOrderId ?? null,
    });
    map.set(row.receivableId, list);
  }

  return map;
}

/**
 * Snapshots ACTIVE de cada pedido, em TODAS as NF-e (não só as do mês): lastro
 * de atribuição do título entre pedidos e guarda R1 (mesma venda em N NF-e).
 */
export async function loadVigentOrderSnapshotsBySalesOrderId(
  salesOrderIds: Iterable<string>
): Promise<Map<string, VigentOrderSnapshotFact[]>> {
  const map = new Map<string, VigentOrderSnapshotFact[]>();
  const ids = [...new Set(salesOrderIds)].filter(Boolean);
  for (let index = 0; index < ids.length; index += 2000) {
    const chunk = ids.slice(index, index + 2000);
    const rows = await prisma.commissionOrderSnapshot.findMany({
      where: { salesOrderId: { in: chunk }, status: "ACTIVE" },
      select: {
        id: true,
        salesOrderId: true,
        nfeId: true,
        totalSoldAmount: true,
        totalFinalCommissionAmount: true,
        items: { select: { salesOrderItemId: true, soldAmount: true, status: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    for (const row of rows) {
      const list = map.get(row.salesOrderId) ?? [];
      list.push({
        snapshotId: row.id,
        nfeId: row.nfeId,
        totalSoldAmount: decimalToNumber(row.totalSoldAmount),
        totalFinalCommissionAmount: decimalToNumber(row.totalFinalCommissionAmount),
        itemStatuses: row.items.map((item) => item.status),
        items: row.items.map((item) => ({
          salesOrderItemId: item.salesOrderItemId,
          soldAmount: decimalToNumber(item.soldAmount),
        })),
      });
      map.set(row.salesOrderId, list);
    }
  }
  return map;
}

/** Contexto N:N da prévia: todos os pedidos de cada NF-e + snapshots vigentes dos pedidos. */
export async function loadReceivableOrderRightsContext(input: {
  orderBundles: CommissionOrderSourceBundle[];
  nfeIds: number[];
  materializedSchedulesByReceivableId: Map<number, MaterializedReceivableScheduleInput[]>;
}): Promise<{
  orderBundlesByNfeId: Map<number, CommissionOrderSourceBundle[]>;
  vigentOrderSnapshotsBySalesOrderId: Map<string, VigentOrderSnapshotFact[]>;
}> {
  const orderBundlesByNfeId = indexAllOrderBundlesByNfeId(input.orderBundles, input.nfeIds);
  const orderIds = new Set<string>(input.orderBundles.map((bundle) => bundle.localOrderId));
  for (const list of input.materializedSchedulesByReceivableId.values()) {
    for (const row of list) orderIds.add(row.salesOrderId);
  }
  const vigentOrderSnapshotsBySalesOrderId = await loadVigentOrderSnapshotsBySalesOrderId(orderIds);
  return { orderBundlesByNfeId, vigentOrderSnapshotsBySalesOrderId };
}

export async function loadCommissionRecordSellersByNfeId(
  nfeIds: number[]
): Promise<Map<number, CommissionReceiptSellerRecordInput>> {
  const map = new Map<number, CommissionReceiptSellerRecordInput>();
  const unique = [...new Set(nfeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return map;

  const rows = await prisma.commissionRecord.findMany({
    where: { nomusNfeId: { in: unique } },
    select: {
      nomusNfeId: true,
      commissionPersonId: true,
      nomusSellerId: true,
      commissionPerson: {
        select: { id: true, name: true, nomusPersonId: true },
      },
    },
    orderBy: { calculatedAt: "desc" },
  });

  for (const row of rows) {
    if (row.nomusNfeId == null || map.has(row.nomusNfeId)) continue;
    map.set(row.nomusNfeId, {
      commissionPersonId: row.commissionPersonId,
      commissionPersonName: row.commissionPerson.name,
      nomusSellerId: row.nomusSellerId,
      nomusPersonId: row.commissionPerson.nomusPersonId,
    });
  }

  return map;
}

export async function loadCommissionReceiptPreview(
  input: LoadCommissionReceiptPreviewInput
): Promise<CommissionReceiptPreviewResult> {
  const period = resolveCommissionPeriod({ year: input.year, month: input.month });

  // Universo temporal OFICIAL: títulos com recebimento real no mês.
  // A baixa (`settlementDate`) não seleciona nada — CR recebido em 31/07 e
  // baixado em 03/08 pertence a julho, e o inverso (baixa no mês sem
  // recebimento) vira inconsistência, nunca entrada silenciosa.
  const competenceByReceivable = input.receiptScope
    ? await loadCommissionReceiptCompetenceForScope(prisma, input.year, input.month, input.receiptScope)
    : await loadCommissionReceiptCompetenceForPeriod(prisma, input.year, input.month);
  const competenceReceivableIds = [...competenceByReceivable.keys()];
  // Cobertura por direito (B4): o motor recorta o evento por pedido e precisa do
  // valor de cada evento do período para isso.
  const coveredRightsByReceiptId = input.receiptScope?.coveredRightsByReceiptId ?? null;
  const receiptAmountsById = new Map<number, number>();
  if (coveredRightsByReceiptId && coveredRightsByReceiptId.size > 0) {
    const periodReceiptIds = [...competenceByReceivable.values()].flatMap((row) => row.receiptIds);
    const coveredIds = periodReceiptIds.filter((id) => coveredRightsByReceiptId.has(id));
    if (coveredIds.length > 0) {
      const rows = await prisma.nomusReceivableReceipt.findMany({
        where: { externalId: { in: periodReceiptIds } },
        select: { externalId: true, receivedAmount: true },
      });
      for (const row of rows) receiptAmountsById.set(row.externalId, decimalToNumber(row.receivedAmount));
    }
  }

  const statusGate = receivableStatusGateForCompetence(input.year, input.month);
  const arPrismaRows =
    competenceReceivableIds.length > 0
      ? await prisma.nomusAccountsReceivable.findMany({
          where: {
            externalId: { in: competenceReceivableIds },
            suspendCollection: { not: true },
            ...statusGate.where,
          },
          select: {
            externalId: true,
            personId: true,
            personName: true,
            personCnpj: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            dueDate: true,
            settlementDate: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            description: true,
            suspendCollection: true,
            status: true,
          },
        })
      : [];

  const receivables = arPrismaRows
    .map((row) => {
      const source = mapReceivableSource(row);
      if (statusGate.excludes(row.status) || row.suspendCollection === true) return null;
      const receiptCompetence = competenceByReceivable.get(source.nomusReceivableId);
      if (!receiptCompetence) return null;
      return {
        nomusReceivableId: source.nomusReceivableId,
        receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
        installmentNumber: source.installmentNumber,
        // Preservada como informação administrativa/auditável.
        settlementDate: source.settlementDate,
        receiptCompetence,
        dueDate: source.dueDate,
        amountReceivable: source.amountReceivable,
        amountReceived: source.amountReceived,
        balanceReceivable: source.balanceReceivable,
        nomusNfeId: source.nomusNfeId,
        nfeNumber: row.sourceInvoiceNumber,
        customerExternalId: row.personId,
        customerId: null,
        customerName: row.personName,
        customerCnpj: row.personCnpj,
        cancelled: statusGate.excludes(row.status),
        suspended: row.suspendCollection === true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const receivableIds = receivables.map((row) => row.nomusReceivableId);
  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.nomusNfeId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const useLegacyFallback = input.allowItemRecalculationFallback === true;

  const [
    materializedSchedulesByReceivableId,
    orderBundles,
    commissionRecordsByNfeId,
    snapshotRows,
    identityCtx,
    rules,
    exclusionRules,
    auditPayload,
  ] = await Promise.all([
    loadMaterializedSchedulesByReceivableId(receivableIds),
    loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds),
    loadCommissionRecordSellersByNfeId(nfeIds),
    nfeIds.length > 0
      ? prisma.commissionOrderSnapshot.findMany({
          where: { nfeId: { in: nfeIds }, status: "ACTIVE" },
          select: {
            nfeId: true,
            totalFinalCommissionAmount: true,
            items: { select: { status: true } },
          },
        })
      : Promise.resolve([]),
    loadCommissionSellerIdentityContext(prisma),
    useLegacyFallback ? loadActiveCommissionRules(prisma) : Promise.resolve([]),
    loadActiveCustomerExclusionRuleSnapshots(),
    useLegacyFallback
      ? listCommissionVisualAuditPage(
          parseCommissionVisualAuditQuery({
            year: input.year,
            month: input.month,
            appraisalMode: "payable",
            page: 1,
            pageSize: 500000,
            customer: input.customer,
            commissionPersonId: input.seller,
          }),
          GLOBAL_SCOPE
        )
      : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 0 }),
  ]);

  const { byNfeId: ordersByNfeId, ambiguousNfeIds } =
    indexUniqueOrderBundlesByNfeId(orderBundles);
  const rightsContext = await loadReceivableOrderRightsContext({
    orderBundles,
    nfeIds,
    materializedSchedulesByReceivableId,
  });
  const orderSnapshotDiagnosisByNfeId = new Map(
    snapshotRows
      .filter((row): row is typeof row & { nfeId: number } => row.nfeId != null)
      .map((row) => [
        row.nfeId,
        {
          exists: true,
          itemStatuses: row.items.map((item) => item.status),
          totalFinalCommissionAmount: decimalToNumber(row.totalFinalCommissionAmount),
        },
      ])
  );
  const persistedAuditRows = useLegacyFallback
    ? enrichVisualAuditRowsWithSellerIdentity(
        filterRowsByAppraisalMode(auditPayload.rows, "PAYABLE", period),
        identityCtx
      )
    : [];

  return buildCommissionReceiptPreview({
    year: input.year,
    month: input.month,
    seller: input.seller,
    customer: input.customer,
    includeExcluded: input.includeExcluded,
    includeExceptions: input.includeExceptions,
    receivables,
    ordersByNfeId,
    ambiguousNfeIds,
    orderBundlesByNfeId: rightsContext.orderBundlesByNfeId,
    vigentOrderSnapshotsBySalesOrderId: rightsContext.vigentOrderSnapshotsBySalesOrderId,
    ...(coveredRightsByReceiptId && coveredRightsByReceiptId.size > 0
      ? { coveredRightsByReceiptId, receiptAmountsById }
      : {}),
    materializedSchedulesByReceivableId,
    commissionRecordsByNfeId,
    orderSnapshotDiagnosisByNfeId,
    allowItemRecalculationFallback: useLegacyFallback,
    persistedAuditRows,
    rules,
    exclusionRules,
    identityCtx,
  });
}

/**
 * Converte linha Prisma AR para input do motor (uso em testes integrados).
 *
 * `receiptCompetence` é o que define a competência do mês. `settlementDate`
 * segue anexada apenas como baixa administrativa — sem ela o título continua
 * válido, desde que exista recebimento (TESTE 5).
 */
export function mapNomusArRowToReceiptReceivableInput(row: {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  description?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
}, receiptCompetence?: CommissionReceiptCompetence | null) {
  const source = mapReceivableSource(row);
  if (!receiptCompetence) return null;
  return {
    nomusReceivableId: source.nomusReceivableId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: source.installmentNumber,
    settlementDate: source.settlementDate,
    receiptCompetence,
    dueDate: source.dueDate,
    amountReceivable: source.amountReceivable,
    amountReceived: source.amountReceived,
    balanceReceivable: source.balanceReceivable,
    nomusNfeId: source.nomusNfeId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    customerCnpj: row.personCnpj ?? null,
    cancelled: row.status === false,
    suspended: row.suspendCollection === true,
  };
}

export function receivableReceivedTotal(
  rows: ReturnType<typeof mapNomusArRowToReceiptReceivableInput>[]
): number {
  const seen = new Set<number>();
  let total = 0;
  for (const row of rows) {
    if (!row || seen.has(row.nomusReceivableId)) continue;
    seen.add(row.nomusReceivableId);
    total += decimalToNumber(row.amountReceived);
  }
  return total;
}

export type LoadCommissionReceivableForecastPreviewInput = {
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
  horizonMonths?: number | null;
  customer?: string | null;
  seller?: string | null;
  commissionPersonId?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  applyMaterialization?: boolean;
};

function mapOpenNomusArRowToReceivableInput(row: {
  externalId: number;
  personId: number | null;
  personName: string | null;
  personCnpj?: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  description?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
}): CommissionReceiptReceivableInput | null {
  const source = mapReceivableSource(row);
  // Aberto = saldo > 0 e cobrança não suspensa; `status` é a baixa no Nomus (ver
  // receivableStatusGateForCompetence) — título em aberto tem status false.
  if (row.suspendCollection === true) return null;
  const balance = decimalToNumber(row.balanceReceivable) ?? 0;
  const open =
    balance > 0.009
      ? balance
      : Math.max(0, (decimalToNumber(row.amountReceivable) ?? 0) - (decimalToNumber(row.amountReceived) ?? 0));
  if (open <= 0.009) return null;
  return {
    nomusReceivableId: source.nomusReceivableId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: source.installmentNumber,
    settlementDate: source.settlementDate,
    dueDate: source.dueDate,
    amountReceivable: source.amountReceivable,
    amountReceived: source.amountReceived,
    balanceReceivable: open,
    nomusNfeId: source.nomusNfeId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    customerCnpj: row.personCnpj ?? null,
    cancelled: false,
    suspended: row.suspendCollection === true,
  };
}

export async function loadCommissionReceivableForecastPreview(
  input: LoadCommissionReceivableForecastPreviewInput
): Promise<CommissionReceiptPreviewResult> {
  const referenceDate = new Date();
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;

  const arPrismaRows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      balanceReceivable: { gt: 0 },
      suspendCollection: { not: true },
    },
    select: {
      externalId: true,
      personId: true,
      personName: true,
      personCnpj: true,
      sourceInvoiceId: true,
      sourceInvoiceNumber: true,
      dueDate: true,
      settlementDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
      description: true,
      suspendCollection: true,
      status: true,
    },
  });

  let receivables = arPrismaRows
    .map((row) => mapOpenNomusArRowToReceivableInput(row))
    .filter((row): row is CommissionReceiptReceivableInput => row != null);

  receivables = filterOpenReceivablesForForecast(
    receivables,
    {
      dueDateFrom: input.dueDateFrom ?? null,
      dueDateTo: input.dueDateTo ?? null,
      horizonMonths: input.horizonMonths ?? null,
    },
    referenceDate
  );

  if (input.nomusReceivableId != null) {
    receivables = receivables.filter((r) => r.nomusReceivableId === input.nomusReceivableId);
  }
  if (input.nfeNumber?.trim()) {
    const needle = input.nfeNumber.trim().toLowerCase();
    receivables = receivables.filter((r) => (r.nfeNumber ?? "").toLowerCase().includes(needle));
  }

  await ensureCommissionMaterializationForReceivableRefs(
    prisma,
    receivables.map((row) => ({
      receivableId: row.nomusReceivableId,
      sourceInvoiceId: row.nomusNfeId ?? null,
    })),
    { apply: input.applyMaterialization === true }
  );

  const receivableIds = receivables.map((row) => row.nomusReceivableId);
  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.nomusNfeId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const [materializedSchedulesByReceivableId, orderBundles, commissionRecordsByNfeId, snapshotRows, identityCtx, exclusionRules] =
    await Promise.all([
      loadMaterializedSchedulesByReceivableId(receivableIds),
      loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds),
      loadCommissionRecordSellersByNfeId(nfeIds),
      nfeIds.length > 0
        ? prisma.commissionOrderSnapshot.findMany({
            where: { nfeId: { in: nfeIds }, status: "ACTIVE" },
            select: {
              nfeId: true,
              totalFinalCommissionAmount: true,
              items: { select: { status: true } },
            },
          })
        : Promise.resolve([]),
      loadCommissionSellerIdentityContext(prisma),
      loadActiveCustomerExclusionRuleSnapshots(),
    ]);

  if (input.orderCode?.trim()) {
    const needle = input.orderCode.trim().toLowerCase();
    // NF-e de vários pedidos: o título entra se QUALQUER pedido vinculado bater.
    const allByNfeId = indexAllOrderBundlesByNfeId(orderBundles, nfeIds);
    receivables = receivables.filter((row) => {
      const nfeId = row.nomusNfeId ?? null;
      const orders = nfeId != null ? allByNfeId.get(nfeId) ?? [] : [];
      return orders.some((order) => (order.orderCode ?? "").toLowerCase().includes(needle));
    });
  }

  const { byNfeId: ordersByNfeId, ambiguousNfeIds } =
    indexUniqueOrderBundlesByNfeId(orderBundles);
  const rightsContext = await loadReceivableOrderRightsContext({
    orderBundles,
    nfeIds,
    materializedSchedulesByReceivableId,
  });
  const orderSnapshotDiagnosisByNfeId = new Map(
    snapshotRows
      .filter((row): row is typeof row & { nfeId: number } => row.nfeId != null)
      .map((row) => [
        row.nfeId,
        {
          exists: true,
          itemStatuses: row.items.map((item) => item.status),
          totalFinalCommissionAmount: decimalToNumber(row.totalFinalCommissionAmount),
        },
      ])
  );

  let preview = buildCommissionReceivableForecastPreview({
    year,
    month,
    seller: input.seller ?? null,
    customer: input.customer ?? null,
    receivables,
    ordersByNfeId,
    ambiguousNfeIds,
    orderBundlesByNfeId: rightsContext.orderBundlesByNfeId,
    vigentOrderSnapshotsBySalesOrderId: rightsContext.vigentOrderSnapshotsBySalesOrderId,
    materializedSchedulesByReceivableId,
    commissionRecordsByNfeId,
    orderSnapshotDiagnosisByNfeId,
    allowItemRecalculationFallback: false,
    rules: [],
    exclusionRules,
    identityCtx,
    openForecastFilters: {
      dueDateFrom: input.dueDateFrom ?? null,
      dueDateTo: input.dueDateTo ?? null,
      horizonMonths: input.horizonMonths ?? null,
    },
    referenceDate,
  });

  if (input.commissionPersonId?.trim()) {
    const personId = input.commissionPersonId.trim();
    preview = {
      ...preview,
      lines: preview.lines.filter((line) => line.canonicalSellerId === personId),
    };
  }

  return preview;
}
