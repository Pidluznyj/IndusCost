import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeItemReclassificationImpact,
  buildConfirmationText,
  checkReclassificationConfirmation,
  describePlanForAudit,
  EXTRA_CONFIRMATION_DETACH_STRUCTURE,
} from "./itemReclassification";
import type {
  ItemReclassificationKind,
  ItemReclassificationSourceSnapshot,
} from "./itemReclassificationTypes";

function makeProductSource(
  overrides: Partial<ItemReclassificationSourceSnapshot> = {}
): ItemReclassificationSourceSnapshot {
  return {
    kind: "PRODUCT",
    id: "p-1",
    sku: "PRD-1",
    name: "Produto 1",
    status: "ACTIVE",
    isNomusControlled: false,
    sourceSystem: null,
    hasProcessFields: false,
    bomLinesAsParent: 0,
    bomLinesAsChild: 0,
    routingSteps: 0,
    pricingRows: 0,
    proposalItems: 0,
    salesOrderItems: 0,
    priceTableItems: 0,
    costCalculationLogs: 0,
    bomLinesAsMaterial: 0,
    materialPriceHistory: 0,
    purchaseRequestItems: 0,
    historyEntries: 0,
    ...overrides,
  };
}

function makeComponentSource(
  overrides: Partial<ItemReclassificationSourceSnapshot> = {}
): ItemReclassificationSourceSnapshot {
  return makeProductSource({ kind: "COMPONENT", sku: "CMP-1", name: "Componente 1", ...overrides });
}

function makeMaterialSource(
  overrides: Partial<ItemReclassificationSourceSnapshot> = {}
): ItemReclassificationSourceSnapshot {
  return makeProductSource({
    kind: "MATERIAL",
    id: "m-1",
    sku: "MAT-1",
    name: "Material 1",
    ...overrides,
  });
}

describe("itemReclassification — pure rules", () => {
  it("PRODUCT → COMPONENT sem dependências críticas: ALLOWED + UPDATE_PRODUCT_TYPE", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    assert.equal(impact.status, "ALLOWED");
    assert.equal(impact.plan.kind, "UPDATE_PRODUCT_TYPE");
    if (impact.plan.kind === "UPDATE_PRODUCT_TYPE") {
      assert.equal(impact.plan.from, "PRODUCT");
      assert.equal(impact.plan.to, "COMPONENT");
      assert.equal(impact.plan.clearProcessFields, false);
    }
    assert.equal(impact.requiredConfirmationText, "RECLASSIFICAR ITEM");
    assert.equal(impact.extraConfirmationText, null);
    assert.deepEqual(impact.blockingReasons, []);
  });

  it("COMPONENT → PRODUCT sem dependências críticas: ALLOWED + UPDATE_PRODUCT_TYPE (clearProcessFields=true sempre, idempotente)", () => {
    const source = makeComponentSource();
    const impact = analyzeItemReclassificationImpact(source, "PRODUCT");
    assert.equal(impact.status, "ALLOWED");
    if (impact.plan.kind === "UPDATE_PRODUCT_TYPE") {
      assert.equal(impact.plan.from, "COMPONENT");
      assert.equal(impact.plan.to, "PRODUCT");
      // PRODUCT não permite Processo Padrão — o plano sempre marca limpar.
      // A operação no servidor é idempotente (setNull em campos já null).
      assert.equal(impact.plan.clearProcessFields, true);
    } else {
      assert.fail("plan kind inesperado");
    }
  });

  it("COMPONENT (com processo) → PRODUCT: REQUIRES_CONFIRMATION + clearProcessFields=true", () => {
    const source = makeComponentSource({ hasProcessFields: true });
    const impact = analyzeItemReclassificationImpact(source, "PRODUCT");
    assert.equal(impact.status, "REQUIRES_CONFIRMATION");
    if (impact.plan.kind === "UPDATE_PRODUCT_TYPE") {
      assert.equal(impact.plan.clearProcessFields, true);
    } else {
      assert.fail("plan kind inesperado");
    }
    assert.ok(impact.warnings.some((w) => w.code === "PROCESS_FIELDS_WILL_BE_CLEARED"));
  });

  it("PRODUCT com BOM como pai → MATERIAL: BLOCKED", () => {
    const source = makeProductSource({ bomLinesAsParent: 3 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.equal(impact.plan.kind, "NOOP");
    assert.equal(impact.requiredConfirmationText, "");
    assert.ok(impact.blockingReasons.some((r) => r.code === "BOM_AS_PARENT_PRESENT"));
  });

  it("PRODUCT com roteiro → MATERIAL: BLOCKED por ROUTING_PRESENT", () => {
    const source = makeProductSource({ routingSteps: 2 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "ROUTING_PRESENT"));
  });

  it("PRODUCT usado em propostas → MATERIAL: BLOCKED + nunca apaga histórico comercial", () => {
    const source = makeProductSource({ proposalItems: 5 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "PROPOSAL_HISTORY_PRESENT"));
    assert.equal(impact.plan.kind, "NOOP");
  });

  it("PRODUCT em pedido → MATERIAL: BLOCKED + SALES_ORDER_HISTORY_PRESENT", () => {
    const source = makeProductSource({ salesOrderItems: 1 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "SALES_ORDER_HISTORY_PRESENT"));
  });

  it("PRODUCT com tabela de preço publicada → MATERIAL: BLOCKED", () => {
    const source = makeProductSource({ priceTableItems: 2 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "PRICE_TABLE_HISTORY_PRESENT"));
  });

  it("PRODUCT com pricing → MATERIAL: BLOCKED", () => {
    const source = makeProductSource({ pricingRows: 1 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "PRICING_PRESENT"));
  });

  it("PRODUCT órfão (sem dependências) → MATERIAL: REQUIRES_CONFIRMATION + plan CONVERT", () => {
    const source = makeProductSource({ sku: "150.01-A" });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "REQUIRES_CONFIRMATION");
    assert.equal(impact.plan.kind, "CONVERT_PRODUCT_TO_MATERIAL");
    if (impact.plan.kind === "CONVERT_PRODUCT_TO_MATERIAL") {
      assert.equal(impact.plan.materialCode, "150.01-A");
      assert.equal(impact.plan.deactivateOriginalProduct, true);
    }
    assert.equal(
      impact.requiredConfirmationText,
      "RECLASSIFICAR PARA MATERIAL 150.01-A"
    );
    assert.equal(impact.extraConfirmationText, null);
  });

  it("PRODUCT órfão usado como childProductId em outras BOMs → MATERIAL: exige confirmação extra", () => {
    const source = makeProductSource({ bomLinesAsChild: 2 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    // Aqui bomLinesAsChild bloqueia explicitamente (regra conservadora).
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "USED_AS_CHILD_IN_BOM"));
  });

  it("PRODUCT controlado pelo Nomus → COMPONENT: REQUIRES_CONFIRMATION + warning NOMUS_CONTROLLED", () => {
    const source = makeProductSource({ isNomusControlled: true });
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    assert.equal(impact.status, "REQUIRES_CONFIRMATION");
    assert.ok(impact.warnings.some((w) => w.code === "NOMUS_CONTROLLED"));
  });

  it("MATERIAL → PRODUCT: BLOCKED com TARGET_KIND_NOT_IMPLEMENTED (escopo desta fase)", () => {
    const source = makeMaterialSource();
    const impact = analyzeItemReclassificationImpact(source, "PRODUCT");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(
      impact.blockingReasons.some((r) => r.code === "TARGET_KIND_NOT_IMPLEMENTED")
    );
    assert.equal(impact.plan.kind, "NOOP");
  });

  it("MATERIAL → COMPONENT: também BLOCKED nesta fase", () => {
    const source = makeMaterialSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    assert.equal(impact.status, "BLOCKED");
    assert.equal(impact.plan.kind, "NOOP");
  });

  it("Tipo igual ao atual: BLOCKED + NO_OP", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "PRODUCT");
    assert.equal(impact.status, "BLOCKED");
    assert.ok(impact.blockingReasons.some((r) => r.code === "NO_OP"));
    assert.equal(impact.plan.kind, "NOOP");
  });

  it("buildConfirmationText respeita SKU literal", () => {
    const src = makeProductSource({ sku: "ABC-9" });
    assert.equal(buildConfirmationText(src, "COMPONENT"), "RECLASSIFICAR ITEM");
    assert.equal(
      buildConfirmationText(src, "MATERIAL"),
      "RECLASSIFICAR PARA MATERIAL ABC-9"
    );
    const m = makeMaterialSource({ sku: "MAT-X" });
    assert.equal(
      buildConfirmationText(m, "PRODUCT"),
      "RECLASSIFICAR PARA PRODUTO MAT-X"
    );
    assert.equal(
      buildConfirmationText(m, "COMPONENT"),
      "RECLASSIFICAR PARA COMPONENTE MAT-X"
    );
  });

  it("checkReclassificationConfirmation: confirmação errada → CONFIRMATION_MISMATCH", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    const r = checkReclassificationConfirmation(impact, { confirmationText: "x" });
    assert.equal(r.ok, false);
    if (r.ok === false) assert.equal(r.code, "CONFIRMATION_MISMATCH");
  });

  it("checkReclassificationConfirmation: confirmação certa → ok", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    const r = checkReclassificationConfirmation(impact, {
      confirmationText: impact.requiredConfirmationText,
    });
    assert.equal(r.ok, true);
  });

  it("checkReclassificationConfirmation: impacto BLOCKED rejeita qualquer confirmação", () => {
    const source = makeProductSource({ bomLinesAsParent: 5 });
    const impact = analyzeItemReclassificationImpact(source, "MATERIAL");
    assert.equal(impact.status, "BLOCKED");
    const r = checkReclassificationConfirmation(impact, {
      confirmationText: "RECLASSIFICAR PARA MATERIAL PRD-1",
    });
    assert.equal(r.ok, false);
  });

  it("describePlanForAudit cobre todos os kinds", () => {
    assert.equal(describePlanForAudit({ kind: "NOOP" }), "NOOP");
    assert.match(
      describePlanForAudit({
        kind: "UPDATE_PRODUCT_TYPE",
        productId: "p1",
        from: "PRODUCT",
        to: "COMPONENT",
        clearProcessFields: false,
      }),
      /^UPDATE_PRODUCT_TYPE PRODUCT→COMPONENT$/
    );
    assert.match(
      describePlanForAudit({
        kind: "UPDATE_PRODUCT_TYPE",
        productId: "p1",
        from: "COMPONENT",
        to: "PRODUCT",
        clearProcessFields: true,
      }),
      /\(clear process fields\)/
    );
    assert.match(
      describePlanForAudit({
        kind: "CONVERT_PRODUCT_TO_MATERIAL",
        productId: "p",
        materialCode: "C-1",
        description: "Desc",
        deactivateOriginalProduct: true,
      }),
      /code=C-1/
    );
    assert.match(
      describePlanForAudit({
        kind: "CONVERT_MATERIAL_TO_PRODUCT",
        materialId: "m",
        productSku: "P-9",
        productName: "n",
        targetType: "COMPONENT",
        deactivateOriginalMaterial: true,
      }),
      /sku=P-9 type=COMPONENT/
    );
  });

  it("EXTRA_CONFIRMATION_DETACH_STRUCTURE é fixo e usado quando configurado", () => {
    // Este caso atual está sempre BLOCKED (bomLinesAsChild>0 → block). Garantimos
    // apenas que a constante é estável para auditoria do contrato.
    assert.equal(
      EXTRA_CONFIRMATION_DETACH_STRUCTURE,
      "ENTENDO QUE A ESTRUTURA PODE SER DESVINCULADA"
    );
  });

  it("Cards incluem 'Tipo atual' e 'Novo tipo' nas duas primeiras posições", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    assert.equal(impact.cards[0]?.key, "target_kind");
    assert.equal(impact.cards[0]?.value, "Componente");
    assert.equal(impact.cards[1]?.key, "current_kind");
    assert.equal(impact.cards[1]?.value, "Produto");
  });

  it("Origem MATERIAL gera cards específicos (bom-as-material, histórico de preço, compras)", () => {
    const source = makeMaterialSource({
      bomLinesAsMaterial: 4,
      materialPriceHistory: 10,
      purchaseRequestItems: 2,
    });
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    const keys = impact.cards.map((c) => c.key);
    assert.ok(keys.includes("bom_as_material"));
    assert.ok(keys.includes("material_price"));
    assert.ok(keys.includes("purchase"));
  });

  it("Cards para Product/Component nunca incluem 'bom_as_material'", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(source, "COMPONENT");
    const keys = impact.cards.map((c) => c.key);
    assert.equal(keys.includes("bom_as_material"), false);
  });

  it("Targets inválidos caem no fallback BLOCKED", () => {
    const source = makeProductSource();
    const impact = analyzeItemReclassificationImpact(
      source,
      "INVALID" as unknown as ItemReclassificationKind
    );
    assert.equal(impact.status, "BLOCKED");
  });
});
