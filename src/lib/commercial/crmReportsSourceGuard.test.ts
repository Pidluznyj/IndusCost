import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CRM_REPORTS_GUARDED_FILES,
  CRM_REPORTS_GUARD_RULES,
  scanCrmReportsSources,
  stripCrmReportsComments,
  type CrmReportsGuardRole,
} from "./crmReportsSourceGuard.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function rulesHit(role: CrmReportsGuardRole, source: string): string[] {
  return [
    ...new Set(
      scanCrmReportsSources([{ path: `fake.${role}.ts`, role, source }])
        .filter((v) => v.line > 0)
        .map((v) => v.rule)
    ),
  ];
}

/**
 * Trava arquitetural de CRM > Relatórios: os módulos novos só CONSOMEM o
 * canônico. Se alguém reintroduzir regra própria, este teste cai.
 */
describe("guard CRM > Relatórios — módulos reais", () => {
  it("nenhuma violação nos módulos protegidos", () => {
    const files = CRM_REPORTS_GUARDED_FILES.map((f) => ({ ...f, source: read(f.path) }));
    const violations = scanCrmReportsSources(files);
    assert.deepEqual(
      violations.map((v) => `${v.path}:${v.line} [${v.rule}] ${v.excerpt}`),
      [],
      "regra própria reintroduzida em CRM > Relatórios"
    );
  });

  it("todos os papéis estão cobertos (motor, núcleo, serviço, rota, verificador)", () => {
    const roles = new Set(CRM_REPORTS_GUARDED_FILES.map((f) => f.role));
    for (const role of ["types", "engine", "core", "service", "routes", "verifier", "verifier-cli"] as const) {
      assert.ok(roles.has(role), `papel sem arquivo protegido: ${role}`);
    }
  });
});

describe("guard CRM > Relatórios — autoteste (pega o que deve pegar)", () => {
  it("status próprio de SalesOrder", () => {
    assert.ok(rulesHit("service", `const w = { status: { not: "CANCELLED" } };`).includes("OWN_SALES_ORDER_STATUS_RULE"));
    assert.ok(rulesHit("core", `if (order.status === "ERROR") return;`).includes("OWN_SALES_ORDER_STATUS_RULE"));
    assert.ok(rulesHit("service", `isCancelledSalesOrderStatus(o.status)`).includes("OWN_SALES_ORDER_STATUS_RULE"));
  });

  it("NOT IN ('CANCELLED','ERROR') e notIn", () => {
    const hits = rulesHit("service", `AND so.status::text NOT IN ('CANCELLED', 'ERROR')`);
    assert.ok(hits.includes("NOT_IN_CANCELLED_ERROR"));
    assert.ok(hits.includes("OWN_SALES_ORDER_STATUS_RULE"));
    assert.ok(rulesHit("service", `where: { status: { notIn: ["CANCELLED", "ERROR"] } }`).includes("NOT_IN_CANCELLED_ERROR"));
  });

  it("SQL cru", () => {
    assert.ok(rulesHit("service", "await prisma.$queryRaw(Prisma.sql`SELECT 1`)").includes("RAW_SQL"));
    assert.ok(rulesHit("verifier", `const q = 'SELECT * FROM "SalesOrder"';`).includes("RAW_SQL"));
  });

  it("proposta como compra", () => {
    assert.ok(rulesHit("service", `await prisma.proposal.findMany({})`).includes("PROPOSAL_AS_PURCHASE"));
    assert.ok(rulesHit("core", `type P = Proposal;`).includes("PROPOSAL_AS_PURCHASE"));
  });

  it("settlementDate / receiptDate", () => {
    assert.ok(rulesHit("core", `const d = title.settlementDate;`).includes("SETTLEMENT_OR_RECEIPT_DATE"));
    assert.ok(rulesHit("engine", `const d = r.receiptDate;`).includes("SETTLEMENT_OR_RECEIPT_DATE"));
  });

  it("NF como compra", () => {
    assert.ok(rulesHit("service", `where: { nfeLinks: { some: {} } }`).includes("INVOICE_AS_PURCHASE"));
    assert.ok(rulesHit("service", `crmCanonicalSalesOrderWhere(p, { hasInvoice: true })`).includes("INVOICE_AS_PURCHASE"));
  });

  it("comissão como compra", () => {
    assert.ok(rulesHit("service", `await prisma.commissionRecord.findMany()`).includes("COMMISSION_AS_PURCHASE"));
  });

  it("vendedor Nomus / SalesOrder.responsible como escopo de carteira", () => {
    assert.ok(rulesHit("service", `buildCrmSellerFilterSql("so", filter)`).includes("NOMUS_SELLER_AS_PORTFOLIO_SCOPE"));
    assert.ok(rulesHit("service", `fetchCrmSellerScopeCustomerIds(prisma, f)`).includes("NOMUS_SELLER_AS_PORTFOLIO_SCOPE"));
    assert.ok(rulesHit("service", `const owner = order.responsible;`).includes("NOMUS_SELLER_AS_PORTFOLIO_SCOPE"));
    assert.ok(rulesHit("service", `select: { responsible: true }`).includes("NOMUS_SELLER_AS_PORTFOLIO_SCOPE"));
  });

  it("dias por milissegundo", () => {
    assert.ok(rulesHit("engine", `Math.floor(diff / 86400000)`).includes("MS_PER_DAY"));
    assert.ok(rulesHit("core", `const day = 24 * 60 * 60 * 1000;`).includes("MS_PER_DAY"));
  });

  it("teto de 24 meses no histórico", () => {
    assert.ok(
      rulesHit("service", `crmCanonicalSalesOrderWhere(p, { issuedFrom: start })`).includes("HISTORY_HORIZON_CAP")
    );
    assert.ok(rulesHit("service", `crmRelationshipHorizonStart(now)`).includes("HISTORY_HORIZON_CAP"));
  });

  it("escrita / cache persistente", () => {
    assert.ok(rulesHit("service", `await prisma.salesOrder.update({ where, data })`).includes("WRITE_OR_PERSISTENT_CACHE"));
    assert.ok(rulesHit("verifier", `await prisma.$transaction([])`).includes("WRITE_OR_PERSISTENT_CACHE"));
    assert.ok(rulesHit("verifier-cli", `await prisma.x.upsert({})`).includes("WRITE_OR_PERSISTENT_CACHE"));
  });

  it("Prisma/Express/React nos módulos puros", () => {
    assert.ok(rulesHit("engine", `import { PrismaClient } from "@prisma/client";`).includes("PURE_MODULE_IMPORT"));
    assert.ok(rulesHit("core", `import { prisma } from "@/src/lib/prisma.js";`).includes("PURE_MODULE_IMPORT"));
    assert.ok(rulesHit("types", `import x from "./crmReportsOperationalService.server.js";`).includes("PURE_MODULE_IMPORT"));
    assert.deepEqual(rulesHit("service", `import type { PrismaClient } from "@prisma/client";`), []);
  });

  it("CommercialActivity fora do cálculo", () => {
    assert.ok(rulesHit("engine", `if (activity.nextActionAt) {}`).includes("ACTIVITY_IN_CALCULATION"));
    assert.deepEqual(rulesHit("service", `prisma.commercialActivity.findMany({})`), []);
  });

  it("comentário não conta; string conta", () => {
    assert.deepEqual(rulesHit("service", `// NOT IN ('CANCELLED','ERROR') é proibido aqui\nconst ok = 1;`), []);
    assert.deepEqual(rulesHit("service", `/* status: { not: "CANCELLED" } */ const ok = 1;`), []);
    assert.ok(rulesHit("service", `const s = "CANCELLED";`).includes("OWN_SALES_ORDER_STATUS_RULE"));
    assert.equal(stripCrmReportsComments(`const url = "a//b"; // x`), `const url = "a//b"; `);
  });

  it("presenças obrigatórias", () => {
    const violations = scanCrmReportsSources([
      { path: "svc.ts", role: "service", source: "export const x = 1;" },
      { path: "verifier.ts", role: "verifier", source: "export const y = 2;" },
    ]);
    const required = violations.filter((v) => v.line === 0).map((v) => v.rule);
    assert.ok(required.includes("USES_CANONICAL_SALES_ORDER_WHERE"));
    assert.ok(required.includes("USES_PORTFOLIO_OWNER_SCOPE"));
    assert.ok(required.includes("USES_MANUAL_OWNER_IDS"));
    assert.ok(required.includes("VERIFIER_USES_OFFICIAL_BUILDER"));
  });

  it("cada regra tem descrição e ao menos um papel", () => {
    for (const rule of CRM_REPORTS_GUARD_RULES) {
      assert.ok(rule.description.length > 10, rule.id);
      assert.ok(rule.roles.length > 0, rule.id);
    }
  });
});
