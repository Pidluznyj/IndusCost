import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  EXECUTIVE_REPORT_KPI_HINTS,
  EXECUTIVE_REPORT_MAX_LINE_CHARS,
  EXECUTIVE_REPORT_MAX_NARRATIVE_BULLETS,
  EXECUTIVE_REPORT_SECTION_INTROS,
  EXECUTIVE_REPORT_SECTION_SUBTITLES,
  getExecutiveReportKpiHint,
  presentExecutiveReportNarrativeBullets,
  simplifyExecutiveHighlight,
  translateExecutiveReportWarning,
  truncateExecutiveReportLine,
} from "./financeExecutiveReportUxCopy.js";

describe("financeExecutiveReportUxCopy", () => {
  it("intros das seções são curtas (1 frase)", () => {
    for (const [key, intro] of Object.entries(EXECUTIVE_REPORT_SECTION_INTROS)) {
      assert.ok(intro.length <= EXECUTIVE_REPORT_MAX_LINE_CHARS, key);
      assert.ok(!intro.includes("SalesOrder"), key);
      assert.ok(!intro.includes("Nomus"), key);
      assert.ok(!intro.includes("IndusCost"), key);
    }
  });

  it("subtítulos das seções existem e são objetivos", () => {
    for (const key of Object.keys(EXECUTIVE_REPORT_SECTION_INTROS)) {
      assert.ok(EXECUTIVE_REPORT_SECTION_SUBTITLES[key]?.length, key);
    }
  });

  it("KPI hints principais existem", () => {
    for (const label of [
      "A receber",
      "Atrasados",
      "A pagar total",
      "Saldo líquido",
      "Meta mês",
      "Atingimento",
      "Vendido no mês",
    ]) {
      assert.ok(EXECUTIVE_REPORT_KPI_HINTS[label], label);
    }
    assert.ok(getExecutiveReportKpiHint("Faturamento mês — 2026"));
  });

  it("traduz avisos técnicos para linguagem simples", () => {
    const translated = translateExecutiveReportWarning(
      "Base AR exclui títulos stale Nomus (freshness via syncCutoff)."
    );
    assert.ok(!translated.includes("stale"));
    assert.ok(!translated.includes("syncCutoff"));
    assert.match(translated, /desatualizados|atualizados/i);
  });

  it("não expõe targetsDerived no texto traduzido", () => {
    const translated = translateExecutiveReportWarning("targetsDerived: true");
    assert.ok(!translated.includes("targetsDerived"));
    assert.match(translated, /Meta estimada/i);
  });

  it("narrativa executiva limitada a 3 bullets", () => {
    const bullets = presentExecutiveReportNarrativeBullets({
      highlights: ["Linha 1", "Linha 2", "Linha 3", "Linha 4"],
      narrative: {
        sections: [
          { id: "a", title: "A", body: "Extra", sourceRefs: [] },
          { id: "b", title: "B", body: "Extra 2", sourceRefs: [] },
        ],
      },
      max: EXECUTIVE_REPORT_MAX_NARRATIVE_BULLETS,
    });
    assert.ok(bullets.length <= EXECUTIVE_REPORT_MAX_NARRATIVE_BULLETS);
  });

  it("simplifyExecutiveHighlight traduz leitura de caixa", () => {
    assert.match(
      simplifyExecutiveHighlight("Projeção indica déficit de caixa nos próximos meses."),
      /saídas previstas/i
    );
  });

  it("truncateExecutiveReportLine respeita limite", () => {
    const long = "a".repeat(200);
    assert.ok(truncateExecutiveReportLine(long).length <= EXECUTIVE_REPORT_MAX_LINE_CHARS);
  });
});

describe("financeExecutiveReportUx — componentes", () => {
  it("documento usa intros, hints e bullets simples", () => {
    const doc = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.ok(doc.includes("EXECUTIVE_REPORT_SECTION_INTROS"));
    assert.ok(doc.includes("getExecutiveReportKpiHint"));
    assert.ok(doc.includes("ExecutiveNarrativeBullets"));
    assert.ok(doc.includes("presentExecutiveReportNarrativeBullets"));
    assert.ok(!doc.includes("SalesOrder —"));
  });

  it("KPI card suporta tooltip/hint", () => {
    const card = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveKpiCard.tsx"),
      "utf8"
    );
    assert.ok(card.includes("hint"));
    assert.ok(card.includes("valueTitle={value}"));
    assert.ok(card.includes("FinanceBiKpiCard"));
  });

  it("dataQuality alert traduz warnings", () => {
    const alert = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveDataQualityAlert.tsx"),
      "utf8"
    );
    assert.ok(alert.includes("translateExecutiveReportWarning"));
    assert.ok(!alert.includes("freshness dos dados"));
    assert.ok(!alert.includes("Sync AR"));
  });

  it("print CSS mantém textos explicativos compactos", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/finance-executive-report-print.css"
      ),
      "utf8"
    );
    assert.ok(css.includes("executive-section-intro"));
    assert.ok(css.includes("finance-executive-kpi-hint"));
    assert.ok(css.includes("finance-executive-narrative-bullets"));
  });

  it("frontend continua consumindo endpoint consolidado", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("getFinanceExecutiveReportApiPath"));
    assert.ok(!page.includes('from "@/src/lib/financeExecutiveReport.js"'));
    assert.ok(!page.includes("buildFinanceExecutiveReport("));
  });
});
