import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommercialPriceTierRow } from "./commission-commercial-tier.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  calculateCommissionForSalesOrderItems,
  type CommissionOrderCalculationContext,
} from "./commissionOrderCalculation.js";
import {
  buildCommissionOrderSnapshotDraft,
  resolveMaterializationAction,
} from "./commissionOrderMaterializer.js";
import { persistCommissionOrderMaterialization } from "./commissionOrderMaterializer.server.js";
import { resolveOrderCommissionSeller } from "./commissionNomusOrderSellerResolver.js";
import type {
  CommissionActiveRule,
  CommissionOrderSourceBundle,
} from "./commission-types.js";

const SELLER_PERSON_ID = "550e8400-e29b-41d4-a716-446655440001";
const CUSTOMER_ID = "aa0e8400-e29b-41d4-a716-446655440010";
const PRODUCT_ID = "660e8400-e29b-41d4-a716-446655440002";
const ITEM_ID = "770e8400-e29b-41d4-a716-446655440003";
const ORDER_ID = "880e8400-e29b-41d4-a716-446655440004";
const RULE_ID = "990e8400-e29b-41d4-a716-446655440005";

function sampleTiers(): CommercialPriceTierRow[] {
  return [
    { code: "ATACADO", name: "Atacado", salePrice: 10, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 12, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 14, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 16, commissionPercent: 4 },
  ];
}

function baseRule(overrides: Partial<CommissionActiveRule> = {}): CommissionActiveRule {
  return {
    id: RULE_ID,
    name: "Regra vendedor padrão",
    active: true,
    priority: 1,
    beneficiaryType: "SELLER",
    calculationType: "COMMERCIAL_PRICE_TIER",
    fixedCommissionPersonId: null,
    ratePercent: 0,
    baseType: "SALES_ORDER_ITEM_NET",
    releaseRule: "EACH_RECEIVABLE_PAID",
    validFrom: null,
    validTo: null,
    conditions: [],
    ...overrides,
  };
}

function orderBundle(overrides: {
  itemNetAmount?: number;
  quantity?: number;
  unitPrice?: number;
  customerExternalId?: number | null;
  sellerId?: number | null;
  sellerName?: string | null;
}): CommissionOrderSourceBundle {
  const quantity = overrides.quantity ?? 10;
  const unitPrice = overrides.unitPrice ?? 1.2;
  const itemNetAmount = overrides.itemNetAmount ?? quantity * unitPrice;

  return {
    localOrderId: ORDER_ID,
    nomusOrderId: 1001,
    orderCode: "PV-1001",
    issueDate: new Date("2026-06-15T00:00:00.000Z"),
    status: "ACTIVE",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: overrides.customerExternalId ?? 200,
    customerName: "Cliente Teste",
    seller: {
      nomusSellerId: overrides.sellerId ?? 42,
      responsibleName: overrides.sellerName ?? "Vendedor Teste",
    },
    representative: { nomusRepresentativeId: null, name: null },
    items: [
      {
        localItemId: ITEM_ID,
        localProductId: PRODUCT_ID,
        nomusOrderItemId: 501,
        nomusProductId: 901,
        productCode: "610.01AA",
        productName: "Produto Teste",
        quantity,
        unitPrice,
        discount: 0,
        surcharge: 0,
        itemNetAmount,
      },
    ],
    forecastInstallments: [],
    linkedNfes: [],
    authorizedOutputNfes: [],
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  };
}

function baseContext(overrides: {
  tiers?: CommercialPriceTierRow[];
  rules?: CommissionActiveRule[];
  exclusionRules?: CustomerExclusionRuleSnapshot[];
  unitCost?: number;
  sellerPersonId?: string;
  sellerNomusId?: number;
}): CommissionOrderCalculationContext {
  const tiers = overrides.tiers ?? sampleTiers();
  const unitCost = overrides.unitCost ?? 4;
  return {
    rules: overrides.rules ?? [baseRule()],
    exclusionRules: overrides.exclusionRules ?? [],
    sellerIdentity: {
      persons: [
        {
          id: overrides.sellerPersonId ?? SELLER_PERSON_ID,
          nomusPersonId: overrides.sellerNomusId ?? 42,
          name: "Vendedor Teste",
          type: "SELLER",
          source: "NOMUS",
          active: true,
        },
      ],
      aliases: [],
    },
    commercialTiersByProductId: new Map([[PRODUCT_ID, tiers]]),
    unitProductionCostByProductId: new Map([[PRODUCT_ID, unitCost]]),
  };
}

function buildDraft(overrides: {
  order?: CommissionOrderSourceBundle;
  context?: CommissionOrderCalculationContext;
}) {
  const order = overrides.order ?? orderBundle({ quantity: 1, unitPrice: 12, itemNetAmount: 12 });
  const context = overrides.context ?? baseContext({});
  const lines = calculateCommissionForSalesOrderItems({ orders: [order], context });
  const { identity: sellerResolution } = resolveOrderCommissionSeller({
    externalSellerId: order.seller.nomusSellerId,
    issueDate: order.issueDate,
    nomusSellerName: order.seller.responsibleName,
    aliasSource: "NOMUS_ORDER",
    identityCtx: context.sellerIdentity,
  });
  return buildCommissionOrderSnapshotDraft({
    order,
    customerId: CUSTOMER_ID,
    customerNameSnapshot: order.customerName,
    lines,
    sellerResolution,
  });
}

type MockSnapshot = {
  id: string;
  salesOrderId: string;
  nfeId: number | null;
  sourceHash: string;
  status: string;
  items: unknown[];
};

function createMockMaterializerDb() {
  const snapshots = new Map<string, MockSnapshot>();
  let idCounter = 1;

  const db = {
    snapshots,
    commissionOrderSnapshot: {
      findFirst: async ({
        where,
      }: {
        where: { salesOrderId: string; nfeId: number | null; status: string };
      }) => {
        for (const snap of snapshots.values()) {
          if (
            snap.salesOrderId === where.salesOrderId &&
            snap.nfeId === where.nfeId &&
            snap.status === where.status
          ) {
            return { id: snap.id, sourceHash: snap.sourceHash };
          }
        }
        return null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { salesOrderId: string; nfeId: number | null; status: string };
        data: { status: string };
      }) => {
        let count = 0;
        for (const snap of snapshots.values()) {
          if (
            snap.salesOrderId === where.salesOrderId &&
            snap.nfeId === where.nfeId &&
            snap.status === where.status
          ) {
            snap.status = data.status;
            count++;
          }
        }
        return { count };
      },
      create: async ({
        data,
        select,
      }: {
        data: {
          sourceHash: string;
          salesOrder: { connect: { id: string } };
          nfeId: number | null;
          status: string;
          items: { create: unknown[] };
        };
        select: { id: true };
      }) => {
        const id = `snap-${idCounter++}`;
        snapshots.set(id, {
          id,
          salesOrderId: data.salesOrder.connect.id,
          nfeId: data.nfeId,
          sourceHash: data.sourceHash,
          status: data.status,
          items: data.items.create,
        });
        return select ? { id } : { id };
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
  };

  return db;
}

describe("commissionOrderMaterializer", () => {
  it("pedido novo cria snapshot", async () => {
    const db = createMockMaterializerDb();
    const draft = buildDraft({});

    const result = await persistCommissionOrderMaterialization(db as never, {
      draft,
      existingActive: null,
      dryRun: false,
    });

    assert.equal(result.action, "created");
    assert.ok(result.snapshotId);
    assert.equal(db.snapshots.size, 1);
    const snap = [...db.snapshots.values()][0];
    assert.equal(snap.status, "ACTIVE");
    assert.equal(snap.sourceHash, draft.sourceHash);
    assert.equal(snap.items.length, 1);
  });

  it("rodar duas vezes não duplica", async () => {
    const db = createMockMaterializerDb();
    const draft = buildDraft({});

    const first = await persistCommissionOrderMaterialization(db as never, {
      draft,
      existingActive: null,
      dryRun: false,
    });

    const existing = await db.commissionOrderSnapshot.findFirst({
      where: {
        salesOrderId: draft.salesOrderId,
        nfeId: draft.nfeId,
        status: "ACTIVE",
      },
    });

    const second = await persistCommissionOrderMaterialization(db as never, {
      draft,
      existingActive: existing,
      dryRun: false,
    });

    assert.equal(first.action, "created");
    assert.equal(second.action, "unchanged");
    assert.equal(second.snapshotId, first.snapshotId);
    assert.equal(db.snapshots.size, 1);
    assert.equal([...db.snapshots.values()].filter((s) => s.status === "ACTIVE").length, 1);
  });

  it("alterar item muda hash e atualiza snapshot", async () => {
    const db = createMockMaterializerDb();
    const draftV1 = buildDraft({ order: orderBundle({ quantity: 1, unitPrice: 12, itemNetAmount: 12 }) });

    const first = await persistCommissionOrderMaterialization(db as never, {
      draft: draftV1,
      existingActive: null,
      dryRun: false,
    });

    const draftV2 = buildDraft({ order: orderBundle({ quantity: 1, unitPrice: 14, itemNetAmount: 14 }) });
    assert.notEqual(draftV1.sourceHash, draftV2.sourceHash);

    const existing = await db.commissionOrderSnapshot.findFirst({
      where: {
        salesOrderId: draftV2.salesOrderId,
        nfeId: draftV2.nfeId,
        status: "ACTIVE",
      },
    });

    const second = await persistCommissionOrderMaterialization(db as never, {
      draft: draftV2,
      existingActive: existing,
      dryRun: false,
    });

    assert.equal(first.action, "created");
    assert.equal(second.action, "superseded");
    assert.notEqual(second.snapshotId, first.snapshotId);
    assert.equal(second.previousSnapshotId, first.snapshotId);
    assert.equal(db.snapshots.size, 2);

    const oldSnap = db.snapshots.get(first.snapshotId!);
    const newSnap = db.snapshots.get(second.snapshotId!);
    assert.equal(oldSnap?.status, "SUPERSEDED");
    assert.equal(newSnap?.status, "ACTIVE");
    assert.equal(newSnap?.sourceHash, draftV2.sourceHash);
  });

  it("cliente excluído fica registrado", () => {
    const exclusionRules: CustomerExclusionRuleSnapshot[] = [
      {
        id: "excl-1",
        customerExternalId: 200,
        customerId: null,
        customerNameSnapshot: "Cliente Teste",
        normalizedCustomerName: "cliente teste",
        reason: "Cliente bloqueado",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        status: "ACTIVE",
        notes: null,
      },
    ];
    const draft = buildDraft({
      context: baseContext({ exclusionRules }),
    });

    assert.equal(draft.items[0].status, "CUSTOMER_EXCLUDED");
    assert.ok(draft.items[0].exclusionReason?.includes("bloqueado"));
    assert.equal(draft.items[0].finalCommissionAmount, 0);
    assert.ok(draft.items[0].grossCommissionAmount > 0);
  });

  it("sem vendedor gera status de exceção", () => {
    const draft = buildDraft({
      order: orderBundle({ sellerId: 777, sellerName: "Desconhecido" }),
      context: baseContext({
        sellerIdentity: {
          persons: [],
          aliases: [],
        },
      }),
    });

    assert.equal(draft.items[0].status, "SELLER_UNRESOLVED");
    assert.equal(draft.canonicalSellerId, null);
    assert.equal(draft.sellerResolutionStatus, "UNRESOLVED");
  });

  it("sem regra gera status de exceção", () => {
    const draft = buildDraft({
      context: baseContext({ rules: [] }),
    });

    assert.equal(draft.items[0].status, "NO_RULE");
    assert.equal(draft.items[0].ruleId, null);
  });

  it("resolveMaterializationAction classifica ações", () => {
    assert.equal(resolveMaterializationAction(null, "hash-a"), "created");
    assert.equal(resolveMaterializationAction({ id: "1", sourceHash: "hash-a" }, "hash-a"), "unchanged");
    assert.equal(resolveMaterializationAction({ id: "1", sourceHash: "hash-a" }, "hash-b"), "superseded");
  });
});
