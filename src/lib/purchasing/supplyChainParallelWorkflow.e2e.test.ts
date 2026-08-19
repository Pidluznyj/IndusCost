/**
 * OP-28 — Matriz end-to-end local do fluxo paralelo SC (motores puros).
 * Sem Prisma / DB: orquestra regras oficiais de leitura + domínio SC dono.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMovementImpactToBalance,
  applyMovementToBalance,
  resolveReversalImpact,
} from "../inventory/inventoryBalanceMath.js";
import {
  assertNoActiveMaterialDuplicate,
  assertOfficialMaterialEligibleForStock,
  buildMaterialSnapshots,
} from "../inventory/inventoryMaterialLinkRules.js";
import {
  emptyInventoryBalance,
  InventoryValidationError,
} from "../inventory/inventoryTypes.js";
import { computeNegotiationSavings, NegotiationSavingsError } from "./negotiationSavingsEngine.js";
import { isAllowedPurchaseEvidenceUpload } from "./purchaseEvidenceRules.js";
import {
  resolvePurchaseQuotationTransition,
  PurchaseQuotationWorkflowError,
  type PurchaseQuotationCollectionStatus,
} from "./purchaseQuotationWorkflow.js";
import {
  resolvePurchaseRequestTransition,
  PurchaseRequestWorkflowError,
  type PurchaseRequestWorkflowStatus,
} from "./purchaseRequestWorkflow.js";
import {
  assertAwardApprovedForPo,
  PurchaseOrderWorkflowError,
  resolvePurchaseOrderTransition,
  type PurchaseOrderStatusName,
} from "./purchaseOrderWorkflow.js";
import {
  assertAcceptanceWithinOpenBalance,
  assertReceiptLineQuantities,
  computeQuantityPending,
  PurchaseReceiptError,
  resolvePurchaseOrderReceiptStatus,
} from "./purchaseReceiptWorkflow.js";
import {
  hasPurchasesApprovePermission,
  mimeMatchesPurchaseEvidenceExtension,
  PURCHASING_PERSONA_MATRIX,
  resolveEvidenceExceptionPermission,
} from "./purchasingSecurity.js";
import {
  QuotationAwardError,
  validateAwardPackage,
  type AwardValidationInput,
} from "./quotationAwardEngine.js";
import { computeSavingsComparison } from "./realizedSavingsEngine.js";
import { scanSupplyChainDomainForOfficialEngineBoundary } from "../supply-chain/officialEngineBoundaryScan.js";

const OFFICIAL_MP = {
  id: "mat-oficial-e2e-1",
  code: "MP-E2E-28",
  description: "Resina PP injeção E2E",
  unit: "KG",
  category: "POLIMERO",
  status: "ACTIVE",
};

function awardBase(overrides: Partial<AwardValidationInput> = {}): AwardValidationInput {
  return {
    quotationStatus: "EM_ANALISE",
    currency: "BRL",
    mode: "SINGLE",
    justification: "Melhor prazo e preço negociado após rodada.",
    finalRoundId: "round-final",
    hasClosedRound: true,
    openRoundExists: false,
    demandItems: [{ quotationItemId: "qi-1", quantityDemanded: 100 }],
    offerItems: [
      {
        offerId: "offer-a",
        offerItemId: "oi-a",
        quotationItemId: "qi-1",
        offerStatus: "RECEBIDA",
        unitPrice: 9.5,
        quantityOffered: 100,
        validityDate: "2026-12-31",
        currency: "BRL",
      },
      {
        offerId: "offer-b",
        offerItemId: "oi-b",
        quotationItemId: "qi-1",
        offerStatus: "RECEBIDA",
        unitPrice: 11,
        quantityOffered: 100,
        validityDate: "2026-12-31",
        currency: "BRL",
      },
    ],
    allocations: [{ offerId: "offer-a", quotationItemId: "qi-1", quantityAwarded: 100 }],
    rejections: [{ offerId: "offer-b", reason: "Preço superior após negociação." }],
    activeEvidenceCount: 1,
    todayIsoDate: "2026-07-17",
    existingPendingOrApprovedAward: false,
    ...overrides,
  };
}

describe("OP-28 — matriz E2E fluxo paralelo SC", () => {
  it("happy path: MP oficial → estoque → SC → cotação → negociação → evidência → aprovação → PC → recebimentos → ganho realizado", () => {
    // 1) Matéria-prima oficial (somente leitura / elegibilidade)
    const material = assertOfficialMaterialEligibleForStock(OFFICIAL_MP);
    const snapshots = buildMaterialSnapshots(material);
    assert.equal(snapshots.materialId, OFFICIAL_MP.id);
    assert.equal(snapshots.unit, "KG");
    assertNoActiveMaterialDuplicate(null);

    // 2–3) Item de estoque + saldo inicial
    let balance = emptyInventoryBalance();
    balance = applyMovementToBalance(balance, "INITIAL_BALANCE", 50);
    assert.equal(balance.physicalQuantity, 50);
    assert.equal(balance.availableQuantity, 50);

    // 4) Solicitação
    let pr: PurchaseRequestWorkflowStatus = "RASCUNHO";
    pr = resolvePurchaseRequestTransition(pr, "SUBMIT");
    assert.equal(pr, "ABERTA");
    pr = resolvePurchaseRequestTransition(pr, "FORWARD_TO_QUOTATION");
    assert.equal(pr, "EM_COTACAO");

    // 5) Cotação inicial
    let quote: PurchaseQuotationCollectionStatus = "RASCUNHO";
    quote = resolvePurchaseQuotationTransition(quote, "MARK_SENT");
    quote = resolvePurchaseQuotationTransition(quote, "MARK_IN_ANALYSIS");
    assert.equal(quote, "EM_ANALISE");

    // 6) Negociação (preço cai)
    const negotiated = computeNegotiationSavings({
      initial: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [{ quantity: 100, unitPrice: 12 }],
      },
      negotiated: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [{ quantity: 100, unitPrice: 9.5 }],
      },
      condition: { previousLeadTimeDays: 30, newLeadTimeDays: 21 },
    });
    assert.equal(negotiated.totalGain, 250);
    assert.equal(negotiated.costIncreased, false);

    // 7) Evidência
    assert.equal(isAllowedPurchaseEvidenceUpload("application/pdf", "proposta.pdf"), true);
    assert.equal(mimeMatchesPurchaseEvidenceExtension("application/pdf", "proposta.pdf"), true);

    // 8) Aprovação / adjudicação
    const award = validateAwardPackage(awardBase());
    assert.deepEqual(award.winnerOfferIds, ["offer-a"]);
    assert.equal(award.usedEvidenceException, false);
    assertAwardApprovedForPo("APROVADA");

    // 9) Pedido de compra
    let po: PurchaseOrderStatusName = "RASCUNHO";
    po = resolvePurchaseOrderTransition(po, "APPROVE");
    po = resolvePurchaseOrderTransition(po, "SEND");
    po = resolvePurchaseOrderTransition(po, "CONFIRM");
    assert.equal(po, "CONFIRMADO");

    const qtyOrdered = 100;
    let acceptedConfirmed = 0;

    // 10) Recebimento parcial + entrada estoque
    const partial = {
      purchaseOrderItemId: "poi-1",
      quantityOrdered: qtyOrdered,
      quantityReceived: 40,
      quantityAccepted: 40,
      quantityRejected: 0,
    };
    assertReceiptLineQuantities(partial);
    assertAcceptanceWithinOpenBalance(partial, acceptedConfirmed);
    acceptedConfirmed += 40;
    balance = applyMovementToBalance(balance, "PURCHASE_RECEIPT", 40);
    assert.equal(balance.physicalQuantity, 90);
    assert.equal(computeQuantityPending(qtyOrdered, acceptedConfirmed), 60);
    assert.equal(
      resolvePurchaseOrderReceiptStatus([
        {
          purchaseOrderItemId: "poi-1",
          quantityOrdered: qtyOrdered,
          quantityAcceptedConfirmed: acceptedConfirmed,
        },
      ]),
      "PARCIALMENTE_RECEBIDO"
    );
    po = resolvePurchaseOrderTransition(po, "MARK_PARTIAL_RECEIVED");
    assert.equal(po, "PARCIALMENTE_RECEBIDO");

    // 11–12) Recebimento final + saldo atualizado
    const finalRcpt = {
      purchaseOrderItemId: "poi-1",
      quantityOrdered: qtyOrdered,
      quantityReceived: 60,
      quantityAccepted: 60,
      quantityRejected: 0,
    };
    assertAcceptanceWithinOpenBalance(finalRcpt, acceptedConfirmed);
    acceptedConfirmed += 60;
    balance = applyMovementToBalance(balance, "PURCHASE_RECEIPT", 60);
    assert.equal(balance.physicalQuantity, 150);
    assert.equal(balance.availableQuantity, 150);
    assert.equal(computeQuantityPending(qtyOrdered, acceptedConfirmed), 0);
    assert.equal(
      resolvePurchaseOrderReceiptStatus([
        {
          purchaseOrderItemId: "poi-1",
          quantityOrdered: qtyOrdered,
          quantityAcceptedConfirmed: acceptedConfirmed,
        },
      ]),
      "RECEBIDO"
    );
    po = resolvePurchaseOrderTransition(po, "MARK_RECEIVED");
    assert.equal(po, "RECEBIDO");

    // 13) Ganho realizado
    const realized = computeSavingsComparison({
      currency: "BRL",
      initialComparableTotalSnapshot: negotiated.initialComparableCost,
      negotiatedComparableTotalSnapshot: negotiated.negotiatedComparableCost,
      totalGainSnapshot: negotiated.totalGain,
      orderFreightHeader: 0,
      orderTaxesHeader: 0,
      orderExpensesHeader: 0,
      orderDiscountsHeader: 0,
      freightIncoterm: "FOB",
      evidenceCount: 1,
      lines: [
        {
          purchaseOrderItemId: "poi-1",
          description: snapshots.materialDescriptionSnapshot,
          quantityOrdered: qtyOrdered,
          initialUnitPrice: 12,
          orderUnitPrice: 9.5,
          orderFreight: 0,
          orderTaxes: 0,
          orderExpenses: 0,
          orderDiscounts: 0,
          quantityAcceptedConfirmed: acceptedConfirmed,
          receivedUnitCost: 9.5,
          receivedFreight: 0,
          receivedTaxes: 0,
          receivedExpenses: 0,
          receivedDiscounts: 0,
        },
      ],
    });
    assert.equal(realized.gains.negotiatedGain, 250);
    assert.ok(realized.gains.realizedGain > 0);
    assert.equal(realized.meta.negotiationMeritImmutable, true);
  });

  it("erro: matéria-prima oficial inativa / incompleta", () => {
    assert.throws(
      () =>
        assertOfficialMaterialEligibleForStock({
          ...OFFICIAL_MP,
          status: "INACTIVE",
        }),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "OFFICIAL_MATERIAL_INACTIVE"
    );
    assert.throws(
      () =>
        assertOfficialMaterialEligibleForStock({
          ...OFFICIAL_MP,
          code: "  ",
        }),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "OFFICIAL_MATERIAL_INCOMPLETE"
    );
  });

  it("erro: duplicidade de vínculo ativo MP → item estoque", () => {
    assert.throws(
      () => assertNoActiveMaterialDuplicate("item-existente"),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "MATERIAL_ALREADY_LINKED_ACTIVE"
    );
  });

  it("erro: transição inválida de solicitação / cotação / pedido", () => {
    assert.throws(
      () => resolvePurchaseRequestTransition("RASCUNHO", "APPROVE"),
      (err: unknown) =>
        err instanceof PurchaseRequestWorkflowError && err.code === "INVALID_TRANSITION"
    );
    assert.throws(
      () => resolvePurchaseQuotationTransition("CANCELADA", "MARK_SENT"),
      (err: unknown) =>
        err instanceof PurchaseQuotationWorkflowError && err.code === "INVALID_TRANSITION"
    );
    assert.throws(
      () => resolvePurchaseOrderTransition("CANCELADO", "APPROVE"),
      (err: unknown) =>
        err instanceof PurchaseOrderWorkflowError && err.code === "INVALID_TRANSITION"
    );
  });

  it("erro: adjudicação duplicada", () => {
    assert.throws(
      () => validateAwardPackage(awardBase({ existingPendingOrApprovedAward: true })),
      (err: unknown) => err instanceof QuotationAwardError && err.code === "AWARD_EXISTS"
    );
  });

  it("erro: evidência ausente sem permissão de exceção", () => {
    assert.throws(
      () =>
        validateAwardPackage(
          awardBase({
            activeEvidenceCount: 0,
            hasExceptionPermission: false,
            exceptionJustification: null,
          })
        ),
      (err: unknown) => err instanceof QuotationAwardError && err.code === "EVIDENCE_REQUIRED"
    );
  });

  it("erro: body useException não concede permissão de evidência", () => {
    const analista = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "analista_compras")!;
    assert.equal(
      resolveEvidenceExceptionPermission({
        effectivePermissions: analista.effectivePermissions,
        clientClaimedUseException: true,
      }),
      false
    );
    assert.equal(hasPurchasesApprovePermission(analista.effectivePermissions), false);
  });

  it("erro: persona sem approve / sem movimento de estoque", () => {
    const viewer = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "viewer_compras")!;
    assert.equal(viewer.can.approvePurchases, false);
    assert.equal(viewer.can.confirmReceiptWithInventory, false);
    assert.equal(viewer.can.useEvidenceException, false);

    const aprovador = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "aprovador_compras")!;
    assert.equal(aprovador.can.approvePurchases, true);
    assert.equal(aprovador.can.confirmReceiptWithInventory, false);

    const recebedor = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "recebedor_estoque")!;
    assert.equal(recebedor.can.confirmReceiptWithInventory, true);
    assert.equal(recebedor.can.reverseReceipt, true);
  });

  it("cenário: fornecedor alternativo vence (offer-b)", () => {
    const award = validateAwardPackage(
      awardBase({
        allocations: [{ offerId: "offer-b", quotationItemId: "qi-1", quantityAwarded: 100 }],
        rejections: [{ offerId: "offer-a", reason: "Lead time maior que o necessário." }],
      })
    );
    assert.deepEqual(award.winnerOfferIds, ["offer-b"]);
  });

  it("cenário: preço maior após negociação (costIncreased)", () => {
    const worse = computeNegotiationSavings({
      initial: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [{ quantity: 100, unitPrice: 10 }],
      },
      negotiated: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [{ quantity: 100, unitPrice: 12 }],
      },
    });
    assert.equal(worse.costIncreased, true);
    assert.ok(worse.totalGain < 0);
  });

  it("erro: moedas incompatíveis na negociação", () => {
    assert.throws(
      () =>
        computeNegotiationSavings({
          initial: {
            currency: "BRL",
            freightIncoterm: "FOB",
            lines: [{ quantity: 1, unitPrice: 10 }],
          },
          negotiated: {
            currency: "USD",
            freightIncoterm: "FOB",
            lines: [{ quantity: 1, unitPrice: 10 }],
          },
        }),
      (err: unknown) => err instanceof NegotiationSavingsError && err.code === "CURRENCY_MISMATCH"
    );
  });

  it("erro: aceite excede pendente + MIME∩extensão inválidos", () => {
    assert.throws(
      () =>
        assertAcceptanceWithinOpenBalance(
          {
            purchaseOrderItemId: "poi-1",
            quantityOrdered: 100,
            quantityReceived: 80,
            quantityAccepted: 80,
            quantityRejected: 0,
          },
          50
        ),
      (err: unknown) =>
        err instanceof PurchaseReceiptError && err.code === "ACCEPTANCE_EXCEEDS_PENDING"
    );
    assert.equal(isAllowedPurchaseEvidenceUpload("application/pdf", "foto.png"), false);
    assert.equal(mimeMatchesPurchaseEvidenceExtension("image/png", "proposta.pdf"), false);
  });

  it("estorno: REVERSAL inverte PURCHASE_RECEIPT sem apagar o fato", () => {
    let balance = applyMovementToBalance(emptyInventoryBalance(), "INITIAL_BALANCE", 10);
    balance = applyMovementToBalance(balance, "PURCHASE_RECEIPT", 40);
    assert.equal(balance.physicalQuantity, 50);

    const reversal = resolveReversalImpact("PURCHASE_RECEIPT", 40);
    balance = applyMovementImpactToBalance(balance, reversal);
    assert.equal(balance.physicalQuantity, 10);
    assert.equal(balance.availableQuantity, 10);
  });

  it("erro: pedido sem adjudicação aprovada", () => {
    assert.throws(
      () => assertAwardApprovedForPo("PENDENTE"),
      (err: unknown) =>
        err instanceof PurchaseOrderWorkflowError && err.code === "AWARD_NOT_APPROVED"
    );
  });
});

describe("OP-28 — barreira SC vs motores oficiais (regressão estática)", () => {
  it("domínio SC continua sem writes em modelos protegidos", () => {
    const violations = scanSupplyChainDomainForOfficialEngineBoundary(process.cwd());
    assert.equal(violations.length, 0, JSON.stringify(violations, null, 2));
  });
});
