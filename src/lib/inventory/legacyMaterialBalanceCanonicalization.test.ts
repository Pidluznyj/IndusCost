import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  classifyLegacyMaterialBalance,
  summarizeLegacyMaterialBalanceClassifications,
  type LegacyMaterialBalanceCandidateInput,
} from "./legacyMaterialBalanceCanonicalization.js";

const CASE_115_CONFERENCE_ID = "81101f88-4cee-4631-b068-971a4f50f330";
const CASE_115_MATERIAL_ID = "956268d5-a9a3-42be-92da-5f4440e1390a";
const CASE_115_ITEM_ID = "3b3313f4-a333-4fc2-b5dc-0df497c6f5f0";

function eligible115(
  overrides: Partial<LegacyMaterialBalanceCandidateInput> = {}
): LegacyMaterialBalanceCandidateInput {
  return {
    materialId: CASE_115_MATERIAL_ID,
    materialCode: "115.01--",
    materialDescription: "*PP* Polipropileno H 503",
    materialStatus: "ACTIVE",
    materialQuantity: 1100,
    materialUnit: "KG",
    items: [
      {
        id: CASE_115_ITEM_ID,
        status: "ACTIVE",
        materialId: CASE_115_MATERIAL_ID,
        controlsStock: true,
        controlsLocation: false,
        unit: "KG",
        defaultWarehouseId: "wh-mp",
        defaultLocationId: null,
        createdAt: new Date("2026-09-02T12:00:00.000Z"),
        notes: "Collector cold-start link",
      },
    ],
    warehouse: { id: "wh-mp", status: "ACTIVE", allowsMovements: true },
    physicalQuantity: 0,
    movementCount: 0,
    hasActiveInitialBalance: false,
    latestConference: {
      id: CASE_115_CONFERENCE_ID,
      reportedQuantity: 1100,
      recordedAt: new Date("2026-09-01T12:26:00.000Z"),
      userId: "user-legacy",
    },
    laterCountedEvidence: false,
    ...overrides,
  };
}

describe("legacyMaterialBalanceCanonicalization", () => {
  it("5. candidato legado confiável 115.01-- aparece ELIGIBLE", () => {
    const row = classifyLegacyMaterialBalance(eligible115());
    assert.equal(row.code, "115.01--");
    assert.equal(row.legacyQuantity, 1100);
    assert.equal(row.inventoryPhysicalQuantity, 0);
    assert.equal(row.movementCount, 0);
    assert.equal(row.latestLegacyConferenceId, CASE_115_CONFERENCE_ID);
    assert.equal(row.latestReportedQuantity, 1100);
    assert.equal(row.classification, "ELIGIBLE");
    assert.equal(row.evidenceRef, `MaterialStockConference:${CASE_115_CONFERENCE_ID}`);
  });

  it("6. reportedQuantity diferente de Material.quantity → MANUAL_REVIEW", () => {
    const row = classifyLegacyMaterialBalance(
      eligible115({
        latestConference: {
          id: CASE_115_CONFERENCE_ID,
          reportedQuantity: 2650,
          recordedAt: new Date("2026-09-01T12:26:00.000Z"),
          userId: "user-legacy",
        },
      })
    );
    assert.equal(row.classification, "MANUAL_REVIEW");
    assert.equal(row.reason, "REPORTED_QTY_MISMATCH");
  });

  it("7. movimento canônico já existente não cria INITIAL_BALANCE", () => {
    const row = classifyLegacyMaterialBalance(eligible115({ movementCount: 1 }));
    assert.equal(row.classification, "HAS_CANONICAL_MOVEMENT");
    assert.equal(row.reason, "HAS_PHYSICAL_MOVEMENT");
  });

  it("8. INITIAL_BALANCE já existente → alreadyCanonical / idempotente", () => {
    const row = classifyLegacyMaterialBalance(eligible115({ hasActiveInitialBalance: true }));
    assert.equal(row.classification, "ALREADY_CANONICAL");
    assert.equal(row.reason, "ACTIVE_INITIAL_BALANCE");
  });

  it("9. vínculo ambíguo → MANUAL_REVIEW", () => {
    const base = eligible115();
    const row = classifyLegacyMaterialBalance({
      ...base,
      items: [
        base.items[0]!,
        {
          ...base.items[0]!,
          id: "item-duplicate",
        },
      ],
    });
    assert.equal(row.classification, "MANUAL_REVIEW");
    assert.equal(row.reason, "AMBIGUOUS_LINK");
  });

  it("10. unidade incompatível → MANUAL_REVIEW", () => {
    const row = classifyLegacyMaterialBalance(eligible115({ materialUnit: "UN" }));
    assert.equal(row.classification, "MANUAL_REVIEW");
    assert.equal(row.reason, "UNIT_INCOMPATIBLE");
  });

  it("sessões Collector posteriores sem contagem não são evidência conflitante", () => {
    const row = classifyLegacyMaterialBalance(eligible115({ laterCountedEvidence: false }));
    assert.equal(row.classification, "ELIGIBLE");
  });

  it("contagem posterior na linha é evidência conflitante", () => {
    const row = classifyLegacyMaterialBalance(eligible115({ laterCountedEvidence: true }));
    assert.equal(row.classification, "CONFLICTING_EVIDENCE");
    assert.equal(row.reason, "COUNTED_AFTER_CONFERENCE");
  });

  it("script e serviço não atualizam saldo diretamente; usam INITIAL_BALANCE canônico", () => {
    const root = process.cwd();
    const script = readFileSync(join(root, "scripts/legacyMaterialInventoryBalance.ts"), "utf8");
    const server = readFileSync(
      join(root, "src/lib/inventory/legacyMaterialBalanceCanonicalization.server.ts"),
      "utf8"
    );
    assert.match(script, /previewLegacyMaterialBalances/);
    assert.match(script, /--apply/);
    assert.match(server, /createInitialInventoryBalance/);
    assert.match(server, /INITIAL_BALANCE/);
    assert.doesNotMatch(server, /inventoryBalance\.update/);
    assert.doesNotMatch(server, /material\.update/);
    assert.match(script, /dry-run/i);
  });

  it("resumo global conta os buckets oficiais", () => {
    const summary = summarizeLegacyMaterialBalanceClassifications([
      { classification: "ELIGIBLE" },
      { classification: "ALREADY_CANONICAL" },
      { classification: "MANUAL_REVIEW" },
      { classification: "ZERO_LEGACY" },
      { classification: "NO_INVENTORY_LINK" },
      { classification: "HAS_CANONICAL_MOVEMENT" },
      { classification: "CONFLICTING_EVIDENCE" },
      { classification: "FAILED" },
    ]);
    assert.equal(summary.scanned, 8);
    assert.equal(summary.eligible, 1);
    assert.equal(summary.alreadyCanonical, 1);
    assert.equal(summary.manualReview, 3);
    assert.equal(summary.zeroLegacy, 1);
    assert.equal(summary.noInventoryLink, 1);
    assert.equal(summary.hasCanonicalMovement, 1);
    assert.equal(summary.conflictingEvidence, 1);
    assert.equal(summary.failed, 1);
  });
});
