import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegistryCleanupPlanHash,
  classifyCleanupBomLine,
  generateProductBomBackupSql,
} from "./nomusComponentRegistryCleanup";
import { confirmationTextForRegistryCleanup } from "./nomusComponentRegistryConflictShared";
import { componentCodeMatchesBasePrefix } from "./nomusComponentRegistryConflictShared";
import {
  isRegistryActiveStatus,
  pickRegistryRecordForAutoResolve,
} from "./nomusComponentRegistryResolve";

describe("nomusComponentRegistryCleanup", () => {
  it("confirmationText por parent", () => {
    assert.equal(
      confirmationTextForRegistryCleanup("420.01", "ONE_PARENT", "610.04AA"),
      "LIMPAR CADASTRO DIVERGENTE 420.01 610.04AA"
    );
  });

  it("confirmationText global", () => {
    assert.equal(
      confirmationTextForRegistryCleanup("420.01", "ALL_PARENTS"),
      "LIMPAR CADASTRO DIVERGENTE 420.01 TODOS"
    );
  });

  it("componentCodeMatchesBasePrefix — 420.01A- e 420.01AX", () => {
    assert.equal(componentCodeMatchesBasePrefix("420.01", "420.01A-"), true);
    assert.equal(componentCodeMatchesBasePrefix("420.01", "420.01AX"), true);
    assert.equal(componentCodeMatchesBasePrefix("420.01", "421.01A"), false);
  });

  it("classify — Material inativo Nomus-controlled → ALLOWED", () => {
    const r = classifyCleanupBomLine({
      codeBase: "420.01",
      expectedNomusComponentCodes: ["420.01A-"],
      localException: false,
      isNomusControlled: true,
      linkKind: "MATERIAL",
      linkedCode: "420.01A-",
      linkedActive: false,
    });
    assert.equal(r.eligibility, "ALLOWED");
  });

  it("classify — localException bloqueia", () => {
    const r = classifyCleanupBomLine({
      codeBase: "420.01",
      expectedNomusComponentCodes: ["420.01A-"],
      localException: true,
      isNomusControlled: true,
      linkKind: "MATERIAL",
      linkedCode: "420.01A-",
      linkedActive: false,
    });
    assert.equal(r.eligibility, "BLOCKED");
    assert.equal(r.blockReason, "LOCAL_EXCEPTION");
  });

  it("classify — manual inativo bloqueia", () => {
    const r = classifyCleanupBomLine({
      codeBase: "420.01",
      expectedNomusComponentCodes: [],
      localException: false,
      isNomusControlled: false,
      linkKind: "MATERIAL",
      linkedCode: "420.01A-",
      linkedActive: false,
    });
    assert.equal(r.eligibility, "BLOCKED");
    assert.equal(r.blockReason, "MANUAL_BOM_LINE_INACTIVE_REGISTRY");
  });

  it("classify — Product divergente ativo Nomus → ALLOWED", () => {
    const r = classifyCleanupBomLine({
      codeBase: "420.01",
      expectedNomusComponentCodes: ["420.01A-"],
      localException: false,
      isNomusControlled: true,
      linkKind: "PRODUCT",
      linkedCode: "420.01A",
      linkedActive: true,
    });
    assert.equal(r.eligibility, "ALLOWED");
  });

  it("planHash estável", () => {
    const h1 = buildRegistryCleanupPlanHash({
      code: "420.01",
      scope: "ONE_PARENT",
      parentCode: "610.04AA",
      allowedLineIds: ["b", "a"],
    });
    const h2 = buildRegistryCleanupPlanHash({
      code: "420.01",
      scope: "ONE_PARENT",
      parentCode: "610.04AA",
      allowedLineIds: ["a", "b"],
    });
    assert.equal(h1, h2);
  });

  it("backup SQL contém INSERT", () => {
    const sql = generateProductBomBackupSql([
      {
        id: "line-1",
        productId: "prod-1",
        materialId: "mat-1",
        childProductId: null,
        quantity: "1",
        lossPercentage: "0",
        notes: null,
        sourceSystem: "NOMUS",
        isNomusControlled: true,
        localException: false,
        nomusComponentCode: "420.01A-",
      },
    ]);
    assert.ok(sql.includes('INSERT INTO "ProductBOM"'));
    assert.ok(sql.includes("line-1"));
  });
});

describe("resolver — Material inativo ignorado", () => {
  it("pickRegistryRecordForAutoResolve ignora inativo", () => {
    const picked = pickRegistryRecordForAutoResolve({
      records: [
        { id: "m-inactive", status: "INACTIVE" },
        { id: "p-active", status: "ACTIVE" },
      ],
      isActive: (r) => isRegistryActiveStatus(r.status),
    });
    assert.equal(picked?.id, "p-active");
  });
});
