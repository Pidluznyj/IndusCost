import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX,
  summarizePresidentialAuditMatrix,
} from "./financeExecutiveReportPresidentialAudit.js";

describe("financeExecutiveReportPresidentialAudit", () => {
  it("matriz cobre seções críticas do relatório", () => {
    const sections = new Set(PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX.map((r) => r.section));
    for (const required of [
      "Pedidos de Venda",
      "Faturamento",
      "Contas a Receber",
      "Contas a Pagar",
      "Fluxo de Caixa",
      "Centros de Custo",
    ]) {
      assert.ok(sections.has(required), required);
    }
  });

  it("nenhum indicador usa Proposal como fonte", () => {
    const report = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReport.ts"),
      "utf8"
    );
    assert.doesNotMatch(report, /\bProposal\b/);
    assert.doesNotMatch(report, /from ["'].*proposal/i);
    const proposalAsSource = PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX.filter(
      (r) => r.status === "ERRO_PROPOSTA_COMO_FONTE"
    );
    assert.equal(proposalAsSource.length, 0);
  });

  it("resumo destaca apenas itens que precisam atenção", () => {
    const summary = summarizePresidentialAuditMatrix();
    assert.ok(summary.total >= 10);
    assert.ok(summary.byStatus.OK_USA_MOTOR_OFICIAL >= 10);
    for (const row of summary.needsAttention) {
      assert.notEqual(row.status, "OK_USA_MOTOR_OFICIAL");
    }
  });

  it("script de auditoria presidencial existe", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/audit-executive-report-presidential.ts"),
      "utf8"
    );
    assert.match(script, /PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX/);
    assert.match(script, /auditExecutiveReportArParity/);
  });
});
