/**
 * Impressão em JPEG das telas de cenários — regressão.
 *
 * Trava: nome de arquivo determinístico; DPI/qualidade padrão do projeto;
 * fundo branco obrigatório (JPEG sem alfa); html2canvas SOB DEMANDA (nunca
 * import estático — nada entra no bundle inicial); botões presentes no modo
 * apresentação e na Visão Ampliada.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildTreasuryJpegFileName,
  TREASURY_JPEG_EXPORT_SCALE,
  TREASURY_JPEG_QUALITY,
} from "@/src/lib/treasury/treasuryChartJpegExport.js";

describe("impressão JPEG — utilitário", () => {
  it("nome do arquivo: prefixo saneado + data local", () => {
    const now = new Date(2026, 7, 26); // 26/08/2026 local
    assert.equal(
      buildTreasuryJpegFileName("Projeção do Caixa — Cenários!", now),
      "proje-o-do-caixa-cen-rios-2026-08-26.jpg"
    );
    assert.equal(
      buildTreasuryJpegFileName("projecao-caixa-cenarios", now),
      "projecao-caixa-cenarios-2026-08-26.jpg"
    );
    assert.equal(buildTreasuryJpegFileName("   ", now), "grafico-2026-08-26.jpg");
  });

  it("DPI e qualidade seguem o padrão do projeto (300/96; 0.95)", () => {
    assert.equal(TREASURY_JPEG_EXPORT_SCALE, 300 / 96);
    assert.equal(TREASURY_JPEG_QUALITY, 0.95);
  });
});

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("impressão JPEG — gates estruturais", () => {
  const util = readSource("./treasuryChartJpegExport.ts");
  const chart = readSource(
    "../../components/finance/treasury/TreasuryCaixaScenariosChart.tsx"
  );
  const modal = readSource(
    "../../components/finance/treasury/TreasuryCaixaScenariosExpandedModal.tsx"
  );
  const expand = readSource(
    "../../components/finance/bi/FinanceBiChartExpandModal.tsx"
  );

  it("html-to-image é carregado SOB DEMANDA — nunca import estático", () => {
    assert.ok(
      util.includes('await import("html-to-image")'),
      "utilitário deve importar html-to-image dinamicamente"
    );
    // REGRESSÃO oklch: html2canvas não entende as cores oklch() do tema
    // Tailwind e a captura falhava na homolog ("unsupported color function
    // oklch"). Este export NUNCA pode voltar a IMPORTAR html2canvas (o
    // docstring pode citá-lo para explicar o porquê).
    assert.ok(
      !util.includes('import("html2canvas")') &&
        !/^import[^\n]*html2canvas/m.test(util),
      "export de cenários não pode importar html2canvas (quebra com oklch)"
    );
    for (const [name, src] of [
      ["chart", chart],
      ["modal ampliado", modal],
      ["expand modal", expand],
    ] as const) {
      assert.ok(
        !/^import[^\n]*html-to-image/m.test(src) &&
          !/^import[^\n]*html2canvas/m.test(src),
        `${name} não pode importar a lib de captura estaticamente`
      );
    }
  });

  it("JPEG com fundo branco pintado (sem alfa) e mimetype image/jpeg", () => {
    assert.ok(util.includes('backgroundColor: "#ffffff"'), "fundo branco");
    assert.ok(util.includes("toJpeg"), "captura via toJpeg (formato JPEG)");
    assert.ok(
      util.includes('dataUrl.startsWith("data:image/jpeg")'),
      "valida o mimetype do resultado antes de baixar"
    );
  });

  it("modo apresentação tem o botão Imprimir (JPEG) capturando o card completo", () => {
    assert.ok(
      chart.includes('data-testid="caixa-scenarios-expand-print"'),
      "botão de imprimir do modo apresentação"
    );
    assert.ok(
      chart.includes("contentRef={presentationCardRef}"),
      "captura ancorada no card completo da apresentação"
    );
  });

  it("Visão Ampliada tem o botão Imprimir (JPEG) capturando KPIs+slicer+gráfico", () => {
    assert.ok(
      modal.includes('data-testid="caixa-scenarios-expanded-print"'),
      "botão de imprimir da visão ampliada"
    );
    assert.ok(
      modal.includes("printAreaRef"),
      "captura ancorada na área de conteúdo"
    );
  });

  it("props do FinanceBiChartExpandModal são opcionais — demais usos intactos", () => {
    assert.ok(expand.includes("headerAction?:"), "headerAction opcional");
    assert.ok(expand.includes("contentRef?:"), "contentRef opcional");
  });
});
