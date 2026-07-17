import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildUnavailableSalesOrderFlowProductionAuditReport,
  formatSalesOrderFlowProductionAuditMarkdown,
  parseSalesOrderFlowProductionAuditArgs,
  resolveSalesOrderFlowProductionAuditExitCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
  scanSalesOrderFlowProductionAuditSource,
  serializeSalesOrderFlowAuditJsonValue,
  stringifySalesOrderFlowProductionAuditReport,
} from "./salesOrderFlowProductionAudit.js";
import { loadSalesOrderFlowProductionAudit } from "./salesOrderFlowProductionAudit.server.js";

describe("salesOrderFlowProductionAudit (OP-78)", () => {
  it("parseia --order e caminhos de saída", () => {
    const args = parseSalesOrderFlowProductionAuditArgs([
      '--order=PD 02596',
      "--json-output=/tmp/a.json",
      "--markdown-output=/tmp/a.md",
    ]);
    assert.equal(args.order, "PD02596");
    assert.equal(args.jsonOutput, "/tmp/a.json");
    assert.equal(args.markdownOutput, "/tmp/a.md");
  });

  it("rejeita --apply e argumentos desconhecidos", () => {
    assert.throws(
      () => parseSalesOrderFlowProductionAuditArgs(["--order=PD02596", "--apply"]),
      /somente leitura|--apply/
    );
    assert.throws(
      () => parseSalesOrderFlowProductionAuditArgs(["--order=PD02596", "--foo"]),
      /desconhecido/
    );
    assert.throws(
      () => parseSalesOrderFlowProductionAuditArgs([]),
      /--order é obrigatório/
    );
  });

  it("sanitiza DATABASE_URL sem expor senha", () => {
    const sanitized = sanitizeSalesOrderTaxesDatabaseUrl(
      "postgresql://user:supersecret@db.example:5432/induscost"
    );
    assert.ok(sanitized);
    assert.equal(
      sanitized!.display,
      "postgresql://db.example:5432/induscost"
    );
    assert.doesNotMatch(sanitized!.display, /supersecret|user:/);
  });

  it("exitCode: ok e pedido ausente = 0; técnico = 1", () => {
    assert.equal(resolveSalesOrderFlowProductionAuditExitCode("ok"), 0);
    assert.equal(
      resolveSalesOrderFlowProductionAuditExitCode("order_not_found"),
      0
    );
    assert.equal(
      resolveSalesOrderFlowProductionAuditExitCode("technical_error"),
      1
    );
  });

  it("serializa Decimal corretamente no JSON", () => {
    const report = buildUnavailableSalesOrderFlowProductionAuditReport({
      requestedOrder: "PD02596",
      generatedAt: new Date("2026-07-17T12:00:00.000Z"),
    });
    const withDecimal = {
      ...report,
      sample: new Prisma.Decimal("12.5"),
    };
    const serialized = serializeSalesOrderFlowAuditJsonValue(withDecimal) as {
      sample: string;
    };
    assert.equal(serialized.sample, "12.50");
    const json = stringifySalesOrderFlowProductionAuditReport(report);
    assert.match(json, /"mode": "READ_ONLY"/);
    assert.match(json, /"orderFound": false/);
    assert.match(json, /"passwordExposed": false/);
    assert.doesNotMatch(json, /DATABASE_URL|postgresql:\/\/[^:]+:[^@]+@/i);
  });

  it("markdown de pedido inexistente", () => {
    const report = buildUnavailableSalesOrderFlowProductionAuditReport({
      requestedOrder: "PD02596",
    });
    const md = formatSalesOrderFlowProductionAuditMarkdown(report);
    assert.match(md, /PD02596/);
    assert.match(md, /não encontrado/i);
    assert.match(md, /READ_ONLY/);
  });

  it("loader: pedido inexistente retorna unavailable sem throw", async () => {
    const prisma = {
      salesOrder: {
        findFirst: async () => null,
      },
    };
    const report = await loadSalesOrderFlowProductionAudit(
      prisma as never,
      "PD02596"
    );
    assert.equal(report.orderFound, false);
    assert.equal(report.status, "unavailable");
    assert.equal(report.mode, "READ_ONLY");
    assert.equal(report.guarantees.databaseWrites, false);
    assert.equal(report.guarantees.nomusCalls, false);
  });

  it("proteção contra escrita: fontes do auditor não usam writes/Nomus/recompute", () => {
    const roots = [
      "src/lib/sales/salesOrderFlowProductionAudit.ts",
      "src/lib/sales/salesOrderFlowProductionAudit.server.ts",
      "scripts/auditSalesOrderFlow.ts",
    ];
    for (const rel of roots) {
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      const violations = scanSalesOrderFlowProductionAuditSource(source);
      assert.deepEqual(
        violations,
        [],
        `${rel} violou read-only: ${JSON.stringify(violations)}`
      );
    }
    assert.equal(
      scanSalesOrderFlowProductionAuditSource(
        'await prisma.salesOrder.update({ where: { id: "x" }, data: {} });'
      ).length > 0,
      true
    );
    assert.equal(
      scanSalesOrderFlowProductionAuditSource(
        "await recomputeSalesOrderFlow(prisma, orderId);"
      ).length > 0,
      true
    );
  });
});
