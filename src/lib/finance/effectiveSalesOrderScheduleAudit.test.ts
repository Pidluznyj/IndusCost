/**
 * FIN-10 — testes do auditor read-only da agenda efetiva.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import {
  buildEffectiveSalesOrderScheduleAuditReport,
  detectEffectiveScheduleInconsistencies,
  formatEffectiveScheduleAuditMarkdown,
  parseEffectiveScheduleAuditArgs,
  resolveEffectiveScheduleAuditExitCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
  scanEffectiveScheduleAuditSource,
  serializeAuditJsonValue,
  stringifyEffectiveScheduleAuditReport,
} from "./effectiveSalesOrderScheduleAudit.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import {
  fixtureCut10000Doc9000,
  fixturePartialWithDoc9000Awaiting,
} from "./salesOrderEffectiveFinancialSchedule.fixtures.js";
import type { ProjectEffectiveScheduleForAuditResult } from "./effectiveScheduleAuditProjection.js";
import type { OrderFullAuditPayload } from "./orderFullAuditClient.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");

describe("FIN-10 — argumentos e exit code", () => {
  it("aceita --order com espaço e normaliza", () => {
    const args = parseEffectiveScheduleAuditArgs(['--order=PD 02596']);
    assert.equal(args.order, "PD02596");
  });

  it("aceita paths de saída opcionais", () => {
    const args = parseEffectiveScheduleAuditArgs([
      "--order=PD02596",
      "--json-output=tmp/a.json",
      "--markdown-output=tmp/a.md",
    ]);
    assert.equal(args.jsonOutput, "tmp/a.json");
    assert.equal(args.markdownOutput, "tmp/a.md");
  });

  it("rejeita order ausente e args desconhecidos", () => {
    assert.throws(() => parseEffectiveScheduleAuditArgs([]), /--order é obrigatório/);
    assert.throws(
      () => parseEffectiveScheduleAuditArgs(["--order=PD02596", "--apply"]),
      /desconhecido/
    );
  });

  it("exit code técnico != 0; pedido ausente = 0", () => {
    assert.equal(resolveEffectiveScheduleAuditExitCode("ok"), 0);
    assert.equal(resolveEffectiveScheduleAuditExitCode("order_not_found"), 0);
    assert.equal(resolveEffectiveScheduleAuditExitCode("technical_error"), 1);
  });

  it("não expõe senha na DATABASE_URL sanitizada", () => {
    const safe = sanitizeSalesOrderTaxesDatabaseUrl(
      "postgresql://user:s3cret@db.host:5432/induscost?sslmode=require"
    );
    assert.ok(safe);
    assert.equal(safe!.display, "postgresql://db.host:5432/induscost");
    assert.doesNotMatch(safe!.display, /s3cret|user|sslmode/i);
  });
});

describe("FIN-10 — Decimal e relatório", () => {
  it("serializa Prisma.Decimal como string", () => {
    const serialized = serializeAuditJsonValue({
      amount: new Prisma.Decimal("1234.5"),
      nested: { x: new Prisma.Decimal("0.1") },
    });
    assert.deepEqual(serialized, {
      amount: "1234.50",
      nested: { x: "0.10" },
    });
  });

  it("pedido ausente gera unavailable sem falha técnica", () => {
    const report = buildEffectiveSalesOrderScheduleAuditReport({
      requestedOrder: "PD02596",
      audit: null,
      projection: null,
    });
    assert.equal(report.orderFound, false);
    assert.equal(report.status, "unavailable");
    assert.equal(report.guarantees.databaseWrites, false);
    assert.equal(report.guarantees.nomusCalls, false);
    assert.equal(report.guarantees.passwordExposed, false);
    const md = formatEffectiveScheduleAuditMarkdown(report);
    assert.match(md, /não encontrado/i);
    const json = stringifyEffectiveScheduleAuditReport(report);
    assert.doesNotMatch(json, /s3cret|postgresql:\/\/[^"]+:[^"@]+@/i);
    assert.match(json, /"passwordExposed": false/);
  });

  it("monta seções do relatório a partir do motor FIN-05", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Awaiting()
    );
    const projection: ProjectEffectiveScheduleForAuditResult = {
      plannedReceivables: [],
      plannedReceivablesTotal: {
        totalCount: 0,
        totalExpected: 0,
        applicableExpected: 1000,
        openExpected: 1000,
        overdueExpected: 0,
        overdueCount: 0,
        dueTodayExpected: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueDate: null,
        replacedCount: 0,
        replacedAmount: 9000,
        netPlannedOpen: 1000,
      },
      schedule,
      effectiveAlerts: schedule.alerts,
      source: "salesOrderEffectiveFinancialSchedule (FIN-05)",
    };

    const audit = {
      ok: true as const,
      salesOrderId: schedule.salesOrderId,
      orderCode: schedule.orderCode,
      summary: { activeOrderValue: 10000, originalOrderValue: 10000 },
      salesOrder: {
        orderCode: schedule.orderCode,
        paymentTerms: "30/60",
        paymentMethod: null,
        issueDate: "2026-06-01",
      },
      items: [
        {
          salesOrderItemId: "item-1",
          itemSequence: "1",
          productCode: "SKU",
          quantity: 10,
          nomusQuantityFulfilled: 9,
          nomusItemStatusRaw: "3",
          nomusItemStatusNormalized: "PARTIAL",
        },
      ],
      stockDocuments: [
        {
          stockDocumentExternalId: 1,
          idNfe: 5001,
          allocatedValue: 9000,
          status: null,
        },
      ],
      stockDocumentItems: [
        {
          stockDocumentExternalId: 1,
          linkedSalesOrderItemId: "item-1",
          allocatedValue: 9000,
        },
      ],
      nfes: [{ nfeExternalId: 5001, numero: "100", isCanceled: false, allocatedValueToOrder: 9000 }],
      receivables: [],
    } as unknown as OrderFullAuditPayload;

    const report = buildEffectiveSalesOrderScheduleAuditReport({
      requestedOrder: "PD09999",
      audit,
      projection,
    });

    assert.equal(report.orderFound, true);
    assert.ok(report.coverage);
    assert.equal(report.coverage!.activeOrderResidualTotal, "1000.00");
    assert.equal(report.coverage!.cutAmount, "0.00");
    assert.ok(report.items.length >= 1);
    assert.ok(report.effectiveAgenda);
    assert.ok(
      report.alerts.some((a) => a.code === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE")
    );
    const md = formatEffectiveScheduleAuditMarkdown(report);
    assert.match(md, /Agenda efetiva final/);
    assert.match(md, /Parcelas originais/);
    assert.match(md, /Documentos de Saída/);
  });

  it("detecta item com corte e residual ativo", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureCut10000Doc9000()
    );
    // Força inconsistência artificial
    if (schedule.itemAmounts[0]) {
      schedule.itemAmounts[0]!.activeResidual = new Prisma.Decimal("100");
    }
    const issues = detectEffectiveScheduleInconsistencies({
      schedule,
      consumerAlertCodes: [],
    });
    assert.ok(issues.some((i) => i.code === "CUT_ITEM_WITH_ACTIVE_RESIDUAL"));
  });
});

describe("FIN-10 — script e server read-only", () => {
  it("script e server não contêm writes/Nomus HTTP", () => {
    const script = readFileSync(
      join(ROOT, "scripts/auditEffectiveSalesOrderSchedule.ts"),
      "utf8"
    );
    const server = readFileSync(
      join(ROOT, "src/lib/finance/effectiveSalesOrderScheduleAudit.server.ts"),
      "utf8"
    );
    assert.equal(scanEffectiveScheduleAuditSource(script).length, 0);
    assert.equal(scanEffectiveScheduleAuditSource(server).length, 0);
    assert.match(script, /READ_ONLY/);
    assert.match(script, /sanitizeSalesOrderTaxesDatabaseUrl/);
    assert.doesNotMatch(script, /console\.(?:log|warn|error).*password/i);
  });
});
