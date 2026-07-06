import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectivePricingBomLine } from "./nomusEffectivePricingBomTypes.js";
import { buildActions } from "./nomusBomControlledApply.js";
import type { ControlledApplyAction } from "./nomusBomControlledApplyTypes.js";
import {
  findProductBomRowsForNomusComponent,
  quantitiesMatchForNomusApply,
  resolveNomusIncludedComponentFromProductBom,
  type NomusApplyProductBomRowSnapshot,
} from "./nomusBomControlledApplyResolve.js";

function effectiveLine(componentCode: string, quantity: number): EffectivePricingBomLine {
  return {
    componentCode,
    quantity,
    source: "NOMUS_REQUIRED",
    decision: "INCLUDE",
    includedForPricing: true,
    reason: "Nomus obrigatório",
    flags: {
      hasOptionalNomusLines: false,
      hasAlternativeNomusLines: false,
      hasPreferredNomusLines: false,
      hasShipmentItemNomusLines: false,
    },
    nomusSourceLineIds: [1],
  };
}

function productBomRow(
  overrides: Partial<NomusApplyProductBomRowSnapshot> & {
    id: string;
    nomusComponentCode: string;
    materialId: string;
    quantity: number;
  }
): NomusApplyProductBomRowSnapshot {
  return {
    componentCode: overrides.componentCode ?? overrides.nomusComponentCode.replace(/--$/, ""),
    childProductId: null,
    isNomusControlled: true,
    ...overrides,
  };
}

const ROWS_301_11AA: NomusApplyProductBomRowSnapshot[] = [
  productBomRow({
    id: "bom-121",
    nomusComponentCode: "121.16--",
    materialId: "mat-121",
    quantity: 0.0118,
    componentCode: "121.16",
  }),
  productBomRow({
    id: "bom-160-08",
    nomusComponentCode: "160.08--",
    materialId: "mat-160-08",
    quantity: 0.2301,
    componentCode: "160.08",
  }),
  productBomRow({
    id: "bom-160-10",
    nomusComponentCode: "160.10--",
    materialId: "mat-160-10",
    quantity: 0.2301,
    componentCode: "160.10",
  }),
];

describe("nomusBomControlledApplyResolve", () => {
  it("encontra linha ProductBOM pelo nomusComponentCode mesmo com Material.code diferente", () => {
    const matches = findProductBomRowsForNomusComponent("160.08--", ROWS_301_11AA);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.id, "bom-160-08");
    assert.equal(matches[0]!.componentCode, "160.08");
  });

  it("301.11AA — 160.08-- resolve pela linha ProductBOM existente", () => {
    const resolved = resolveNomusIncludedComponentFromProductBom(
      "160.08--",
      0.2301,
      ROWS_301_11AA
    );
    assert.equal(resolved.resolutionKind, "MATERIAL");
    assert.equal(resolved.materialId, "mat-160-08");
    assert.equal(resolved.productBomLineId, "bom-160-08");
    assert.equal(resolved.quantityMatches, true);
  });

  it("bloqueia componente novo sem cadastro nem linha ProductBOM", () => {
    const resolved = resolveNomusIncludedComponentFromProductBom(
      "999.99--",
      1,
      ROWS_301_11AA
    );
    assert.equal(resolved.resolutionKind, "UNRESOLVED");
    assert.equal(resolved.hasExistingProductBomLine, false);
  });

  it("mantém bloqueio quando linha existe sem materialId nem childProductId", () => {
    const resolved = resolveNomusIncludedComponentFromProductBom("160.08--", 0.2301, [
      {
        id: "orphan",
        componentCode: "160.08",
        nomusComponentCode: "160.08--",
        materialId: null,
        childProductId: null,
        quantity: 0.2301,
        isNomusControlled: true,
      },
    ]);
    assert.equal(resolved.resolutionKind, "UNRESOLVED");
    assert.match(resolved.diagnostics ?? "", /sem materialId nem childProductId/i);
  });

  it("não usa linha existente quando isNomusControlled=false", () => {
    const resolved = resolveNomusIncludedComponentFromProductBom("160.08--", 0.2301, [
      {
        id: "local",
        componentCode: "160.08",
        nomusComponentCode: "160.08--",
        materialId: "mat-160-08",
        childProductId: null,
        quantity: 0.2301,
        isNomusControlled: false,
      },
    ]);
    assert.equal(resolved.resolutionKind, "UNRESOLVED");
  });

  it("quantidade divergente ainda resolve linha existente (update, não bloqueio)", () => {
    const resolved = resolveNomusIncludedComponentFromProductBom(
      "160.08--",
      0.5,
      ROWS_301_11AA
    );
    assert.equal(resolved.resolutionKind, "MATERIAL");
    assert.equal(resolved.quantityMatches, false);
  });

  it("quantitiesMatchForNomusApply tolera arredondamento Nomus", () => {
    assert.equal(quantitiesMatchForNomusApply(0.2301, 0.230100), true);
  });
});

describe("nomusBomControlledApply — plano 301.11AA", () => {
  function buildTargetsFromExisting() {
    const specs = [
      { code: "121.16--", qty: 0.0118 },
      { code: "160.08--", qty: 0.2301 },
      { code: "160.10--", qty: 0.2301 },
    ];
    return specs.map(({ code, qty }) => {
      const resolved = resolveNomusIncludedComponentFromProductBom(code, qty, ROWS_301_11AA);
      assert.notEqual(resolved.resolutionKind, "UNRESOLVED");
      return {
        componentCode: code,
        componentDescription: null,
        componentKind: "Material" as const,
        materialId: resolved.materialId,
        childProductId: resolved.childProductId,
        productBomLineId: resolved.productBomLineId,
        quantity: qty,
        effectiveLine: effectiveLine(code, qty),
      };
    });
  }

  it("não gera SKIP_UNRESOLVED para 160.08-- quando ProductBOM já reflete a BOM efetiva", () => {
    const syncedAt = new Date("2026-06-01T12:00:00.000Z");
    const currentRows = ROWS_301_11AA.map((row) => ({
      id: row.id,
      productId: "prod-301",
      materialId: row.materialId,
      childProductId: row.childProductId,
      quantity: row.quantity,
      lossPercentage: 0,
      notes: null,
      componentCode: row.componentCode,
      componentKind: "Material" as const,
      componentDescription: null,
      sourceSystem: "NOMUS",
      isNomusControlled: true,
      localException: false,
      lastNomusSyncAt: syncedAt,
      nomusComponentCode: row.nomusComponentCode,
    }));

    const actions = buildActions(
      currentRows,
      buildTargetsFromExisting(),
      [],
      new Set()
    );

    const unresolved = actions.filter((a) => a.actionType === "SKIP_UNRESOLVED");
    assert.equal(unresolved.length, 0);

    const keep = actions.filter((a) => a.actionType === "KEEP_PRODUCT_BOM_LINE");
    assert.equal(keep.length, 3);

    const structural = actions.filter(
      (a) =>
        a.actionType === "CREATE_PRODUCT_BOM_LINE" ||
        a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" ||
        a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES" ||
        a.actionType === "REMOVE_PRODUCT_BOM_LINE"
    );
    assert.equal(structural.length, 0);

    const blocked160 = actions.find(
      (a) =>
        a.componentCode === "160.08--" &&
        (a.actionType === "SKIP_UNRESOLVED" || a.actionType === "BLOCKED")
    );
    assert.equal(blocked160, undefined);
  });

  it("componente novo sem cadastro continua SKIP_UNRESOLVED", () => {
    const actions = buildActions(
      [],
      [],
      [effectiveLine("888.88--", 1)],
      new Set()
    );
    const unresolved = actions.filter((a) => a.actionType === "SKIP_UNRESOLVED");
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0]!.componentCode, "888.88--");
  });

  it("update de quantidade quando linha existente tem materialId", () => {
    const currentRows = [
      {
        id: "bom-160-08",
        productId: "prod-301",
        materialId: "mat-160-08",
        childProductId: null,
        quantity: 0.1,
        lossPercentage: 0,
        notes: null,
        componentCode: "160.08",
        componentKind: "Material" as const,
        componentDescription: null,
        sourceSystem: "NOMUS",
        isNomusControlled: true,
        localException: false,
        lastNomusSyncAt: null,
        nomusComponentCode: "160.08--",
      },
    ];
    const resolved = resolveNomusIncludedComponentFromProductBom("160.08--", 0.2301, ROWS_301_11AA);
    const actions = buildActions(
      currentRows,
      [
        {
          componentCode: "160.08--",
          componentDescription: null,
          componentKind: "Material",
          materialId: resolved.materialId,
          childProductId: null,
          productBomLineId: resolved.productBomLineId,
          quantity: 0.2301,
          effectiveLine: effectiveLine("160.08--", 0.2301),
        },
      ],
      [],
      new Set()
    );
    const update = actions.find((a) => a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY");
    assert.ok(update);
    assert.equal(update!.componentCode, "160.08--");
    assert.notEqual(update!.riskLevel, "BLOCKED");
  });

  it("ações não retornam NaN/Infinity", () => {
    const actions: ControlledApplyAction[] = buildActions(
      [],
      buildTargetsFromExisting(),
      [],
      new Set()
    );
    for (const action of actions) {
      if (action.currentQuantity != null) assert.ok(Number.isFinite(action.currentQuantity));
      if (action.effectiveQuantity != null) assert.ok(Number.isFinite(action.effectiveQuantity));
    }
  });
});
