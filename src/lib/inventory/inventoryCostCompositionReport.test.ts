/**
 * Relatório de Estoque – Composição de Custo.
 *
 * O relatório não roda o motor: recebe a decomposição congelada (MP, HH, HM e
 * CIU do mesmo snapshot) e só deriva. Os cenários de engenharia (ciclo,
 * cavidades, eficiência, setup, perdas, BOM recursiva) entram aqui como
 * snapshots que o motor oficial teria produzido — o que se prova é que o
 * relatório reflete exatamente o que o motor entregou, sem recalcular nada.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  INVENTORY_COST_COMPOSITION_INCONSISTENT_NOTE,
  INVENTORY_COST_COMPOSITION_WAREHOUSE_LABEL,
  buildInventoryCostCompositionReport,
  type InventoryCostCompositionReport,
  type InventoryFrozenCostComposition,
} from "./inventoryCostCompositionReport.js";
import {
  INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS,
  INVENTORY_COST_COMPOSITION_SHEETS,
  INVENTORY_COST_COMPOSITION_SUMMARY_COLUMNS,
  buildInventoryCostCompositionWorkbook,
  buildInventoryCostCompositionXlsx,
  injectBoldHeaderStyles,
  inventoryCostCompositionFilename,
} from "./inventoryCostCompositionReportXlsx.js";
import {
  indexFrozenCostComposition,
  loadInventoryCostCompositionReport,
  readFrozenCostAnalysisPartial,
} from "./inventoryCostCompositionReport.server.js";
import { buildInventoryPositionReport, type InventoryPositionReportSourceLine } from "./inventoryPositionReport.js";

const D = (value: string | number) => new Prisma.Decimal(value);
const AT = new Date("2026-09-30T12:00:00.000Z");

function line(
  partial: Partial<Omit<InventoryPositionReportSourceLine, "physicalQuantity">> & {
    itemId: string;
    itemType: string;
    physicalQuantity: string | number;
  }
): InventoryPositionReportSourceLine {
  return {
    code: partial.itemId.toUpperCase(),
    description: `Item ${partial.itemId}`,
    unit: "UN",
    productId: partial.itemType === "RAW_MATERIAL" ? null : `prod-${partial.itemId}`,
    materialId: partial.itemType === "RAW_MATERIAL" ? `mat-${partial.itemId}` : null,
    ...partial,
    physicalQuantity: D(partial.physicalQuantity),
  };
}

/** Snapshot como o motor oficial congela: CIU = MP + HH + HM (arredondado a 6 casas como no banco). */
function frozen(material: number, hh: number, hm: number, extra: Partial<InventoryFrozenCostComposition> = {}): InventoryFrozenCostComposition {
  return {
    material: D(material),
    hh: D(hh),
    hm: D(hm),
    total: D(material).add(hh).add(hm),
    costAnalysisPartial: null,
    ...extra,
  };
}

function build(input: {
  lines: InventoryPositionReportSourceLine[];
  compositions?: Array<[string, InventoryFrozenCostComposition | null]> | null;
  materials?: Array<[string, string | number | null]> | null;
  factoryReason?: string | null;
  materialReason?: string | null;
}): InventoryCostCompositionReport {
  return buildInventoryCostCompositionReport({
    lines: input.lines,
    generatedAt: AT,
    compositionByProductId:
      input.compositions === null ? null : new Map(input.compositions ?? []),
    materialCostByMaterialId:
      input.materials === null
        ? null
        : new Map((input.materials ?? []).map(([id, v]) => [id, v == null ? null : D(v)])),
    factoryCostUnavailableReason: input.factoryReason ?? null,
    materialCostUnavailableReason: input.materialReason ?? null,
    sources: [{ label: "Versão da aplicação (commit)", value: "abc123" }],
  });
}

const row = (report: InventoryCostCompositionReport, code: string) => {
  const found = report.rows.find((r) => r.itemCode === code);
  assert.ok(found, `linha ${code}`);
  return found;
};

describe("composição de custo — tratamento por tipo", () => {
  it("1. matéria-prima pura: MP = custo posto congelado, HH = HM = 0, CIU = CIU sem HH = MP", () => {
    const report = build({
      lines: [line({ itemId: "mp1", itemType: "RAW_MATERIAL", physicalQuantity: 10, unit: "KG" })],
      materials: [["mat-mp1", "12.5"]],
    });
    const r = row(report, "MP1");
    assert.equal(r.itemTypeLabel, "Matéria-prima");
    assert.equal(r.materialUnitCost, 12.5);
    assert.equal(r.hhUnitCost, 0);
    assert.equal(r.hmUnitCost, 0);
    assert.equal(r.officialUnitCost, 12.5);
    assert.equal(r.unitCostWithoutHh, 12.5);
    assert.equal(r.officialStockValue, 125);
    assert.equal(r.hhStockValue, 0);
    assert.equal(r.stockValueWithoutHh, 125);
    assert.equal(r.status, "OK");
  });

  it("2. componente com MP + HH + HM: captura as quatro parcelas do snapshot", () => {
    const report = build({
      lines: [line({ itemId: "cp1", itemType: "COMPONENT", physicalQuantity: 3 })],
      compositions: [["prod-cp1", frozen(4, 1.5, 0.5)]],
    });
    const r = row(report, "CP1");
    assert.equal(r.itemTypeLabel, "Componente");
    assert.deepEqual(
      [r.materialUnitCost, r.hhUnitCost, r.hmUnitCost, r.officialUnitCost, r.unitCostWithoutHh, r.hhRemovedUnit],
      [4, 1.5, 0.5, 6, 4.5, 1.5]
    );
    assert.equal(r.status, "OK");
  });

  it("3. produto acabado: mesma decomposição completa (mesmo motor, mesma fonte)", () => {
    const report = build({
      lines: [line({ itemId: "pa1", itemType: "FINISHED_PRODUCT", physicalQuantity: 2 })],
      compositions: [["prod-pa1", frozen(10, 3, 2)]],
    });
    const r = row(report, "PA1");
    assert.equal(r.itemTypeLabel, "Produto acabado");
    assert.equal(r.officialUnitCost, 15);
    assert.equal(r.unitCostWithoutHh, 12);
    assert.equal(r.officialStockValue, 30);
    assert.equal(r.hhStockValue, 6);
    assert.equal(r.stockValueWithoutHh, 24);
  });
});

describe("composição de custo — engenharia vem inteira do snapshot, nunca recalculada", () => {
  // Pai: MP própria 2 + HH própria 1 + HM própria 0.5; filho fabricado (2 un): MP 3, HH 2, HM 1 cada.
  // O motor faz o rollup: MP 8, HH 5, HM 2.5 — e é isso que fica congelado.
  const parentWithChild = frozen(8, 5, 2.5);

  it("4. produto com componente filho: MP/HH/HM agregadas dos filhos + processo próprio", () => {
    const report = build({
      lines: [line({ itemId: "pai", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 })],
      compositions: [["prod-pai", parentWithChild]],
    });
    const r = row(report, "PAI");
    assert.equal(r.materialUnitCost, 8);
    assert.equal(r.hmUnitCost, 2.5);
    assert.equal(r.officialUnitCost, 15.5);
  });

  it("5. HH vindo de componente filho: retira TODA a mão de obra da estrutura (5), não só a própria (1)", () => {
    const report = build({
      lines: [line({ itemId: "pai", itemType: "FINISHED_PRODUCT", physicalQuantity: 4 })],
      compositions: [["prod-pai", parentWithChild]],
    });
    const r = row(report, "PAI");
    assert.equal(r.hhRemovedUnit, 5);
    assert.equal(r.unitCostWithoutHh, 10.5);
    assert.equal(r.hhStockValue, 20);
    assert.equal(r.stockValueWithoutHh, 42);
  });

  // Cenários de processo: o motor já converteu ciclo/cavidades/eficiência/setup/perdas em HH, HM e MP.
  // Dois snapshots que diferem só por um parâmetro devem aparecer com a diferença que o motor entregou.
  const cases: Array<[string, InventoryFrozenCostComposition, InventoryFrozenCostComposition, (a: ReturnType<typeof row>, b: ReturnType<typeof row>) => void]> = [
    [
      "6. ciclo diferente (ciclo 2× → HH e HM 2× no snapshot)",
      frozen(10, 2, 1),
      frozen(10, 4, 2),
      (a, b) => {
        assert.equal(b.hhUnitCost, a.hhUnitCost! * 2);
        assert.equal(b.hmUnitCost, a.hmUnitCost! * 2);
        assert.equal(a.materialUnitCost, b.materialUnitCost);
      },
    ],
    [
      "7. cavidades diferentes (2 cavidades → HH e HM pela metade)",
      frozen(10, 2, 1),
      frozen(10, 1, 0.5),
      (a, b) => {
        assert.equal(b.unitCostWithoutHh, 10.5);
        assert.equal(a.unitCostWithoutHh, 11);
      },
    ],
    [
      "8. eficiência diferente (80% → HH e HM /0.8)",
      frozen(10, 2, 1),
      frozen(10, 2.5, 1.25),
      (a, b) => {
        assert.equal(b.hhRemovedUnit, 2.5);
        assert.equal(b.officialUnitCost, 13.75);
        assert.equal(a.officialUnitCost, 13);
      },
    ],
    [
      "9. setup (setup rateado no lote entra em HH/HM do snapshot)",
      frozen(10, 2, 1),
      frozen(10, 2.2, 1.1),
      (a, b) => {
        assert.equal(b.hhUnitCost, 2.2);
        assert.equal(b.unitCostWithoutHh, 11.1);
        assert.equal(a.unitCostWithoutHh, 11);
      },
    ],
    [
      "10. perda de material (5% de perda → MP 10.5; HH/HM iguais)",
      frozen(10, 2, 1),
      frozen(10.5, 2, 1),
      (a, b) => {
        assert.equal(b.materialUnitCost, 10.5);
        assert.equal(b.hhUnitCost, a.hhUnitCost);
        assert.equal(b.unitCostWithoutHh, 11.5);
      },
    ],
  ];

  for (const [name, base, variant, check] of cases) {
    it(name, () => {
      const report = build({
        lines: [
          line({ itemId: "a", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
          line({ itemId: "b", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
        ],
        compositions: [
          ["prod-a", base],
          ["prod-b", variant],
        ],
      });
      const a = row(report, "A");
      const b = row(report, "B");
      assert.equal(a.status, "OK");
      assert.equal(b.status, "OK");
      check(a, b);
    });
  }

  it("o módulo puro e o XLSX não importam o motor de custo nem Prisma client de runtime", () => {
    const root = path.join(import.meta.dirname, "..", "..", "..");
    for (const rel of [
      "src/lib/inventory/inventoryCostCompositionReport.ts",
      "src/lib/inventory/inventoryCostCompositionReportXlsx.ts",
      "src/lib/inventory/inventoryCostCompositionReport.server.ts",
    ]) {
      const src = readFileSync(path.join(root, rel), "utf8");
      assert.doesNotMatch(src, /productCostAnalysisEngine|getProductCostAnalysis|productOfficialFinalCost|AnalysisCache/, rel);
      assert.doesNotMatch(src, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/, rel);
      assert.doesNotMatch(src, /\$transaction|\$executeRaw|\$queryRaw/, rel);
    }
  });
});

describe("composição de custo — invariantes e valores", () => {
  const lines = [
    line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: "3.5" }),
    line({ itemId: "cp", itemType: "COMPONENT", physicalQuantity: 7 }),
  ];
  const compositions: Array<[string, InventoryFrozenCostComposition]> = [
    ["prod-pa", frozen(12.345678, 3.210987, 1.111111)],
    ["prod-cp", frozen(0.5, 0.25, 0.125)],
  ];

  it("11. CIU = MP + HH + HM para todo item com custo", () => {
    const report = build({ lines, compositions });
    for (const r of report.rows) {
      assert.equal(r.status, "OK");
      assert.ok(Math.abs(r.officialUnitCost! - (r.materialUnitCost! + r.hhUnitCost! + r.hmUnitCost!)) < 1e-9, r.itemCode);
    }
  });

  it("12. CIU sem HH = MP + HM e = CIU − HH", () => {
    const report = build({ lines, compositions });
    for (const r of report.rows) {
      assert.ok(Math.abs(r.unitCostWithoutHh! - (r.materialUnitCost! + r.hmUnitCost!)) < 1e-9, r.itemCode);
      assert.ok(Math.abs(r.unitCostWithoutHh! - (r.officialUnitCost! - r.hhUnitCost!)) < 1e-9, r.itemCode);
      assert.equal(r.hhRemovedUnit, r.hhUnitCost);
    }
  });

  it("13. valor estoque = quantidade × custo, sem arredondar internamente", () => {
    const report = build({ lines, compositions });
    const pa = row(report, "PA");
    assert.equal(pa.officialStockValue, D("3.5").mul(D(12.345678).add(3.210987).add(1.111111)).toNumber());
    assert.equal(pa.hhStockValue, D("3.5").mul(D(3.210987)).toNumber());
    assert.equal(pa.stockValueWithoutHh, D("3.5").mul(D(12.345678).add(1.111111)).toNumber());
    assert.equal(pa.physicalQuantity, "3.5");
    // Resumo soma os valores sem arredondamento (precisão interna preservada).
    const total = report.summary.find((s) => s.itemType === "TOTAL")!;
    const cp = row(report, "CP");
    assert.equal(total.officialStockValue, D(pa.officialStockValue!).add(cp.officialStockValue!).toNumber());
    assert.equal(total.hhStockValue, D(pa.hhStockValue!).add(cp.hhStockValue!).toNumber());
    assert.equal(total.stockValueWithoutHh, D(pa.stockValueWithoutHh!).add(cp.stockValueWithoutHh!).toNumber());
    assert.equal(total.hhSharePercent, D(total.hhStockValue).div(total.officialStockValue).toNumber());
  });

  it("14. item sem custo: colunas vazias (null), nunca zero; status SEM_CUSTO e contado no resumo", () => {
    const report = build({
      lines: [
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: 2 }),
        line({ itemId: "semprod", itemType: "COMPONENT", physicalQuantity: 2, productId: null }),
        line({ itemId: "dup", itemType: "COMPONENT", physicalQuantity: 2 }),
        line({ itemId: "mp", itemType: "RAW_MATERIAL", physicalQuantity: 2 }),
      ],
      compositions: [["prod-dup", null]],
      materials: [],
    });
    for (const code of ["PA", "SEMPROD", "DUP", "MP"]) {
      const r = row(report, code);
      assert.equal(r.status, "SEM_CUSTO", code);
      for (const key of [
        "materialUnitCost",
        "hhUnitCost",
        "hmUnitCost",
        "officialUnitCost",
        "unitCostWithoutHh",
        "hhRemovedUnit",
        "officialStockValue",
        "hhStockValue",
        "stockValueWithoutHh",
      ] as const) {
        assert.equal(r[key], null, `${code}.${key}`);
      }
      assert.ok(r.observation.length > 0, code);
    }
    assert.match(row(report, "DUP").observation, /duplicado/);
    assert.match(row(report, "SEMPROD").observation, /sem vínculo/);
    const total = report.summary.find((s) => s.itemType === "TOTAL")!;
    assert.equal(total.itemsWithoutCost, 4);
    assert.equal(total.officialStockValue, 0);
    assert.equal(total.hhSharePercent, null);
  });

  it("14b. fonte indisponível (Varejo 1 ou tabela de MP não publicada): tudo SEM_CUSTO com o motivo", () => {
    const report = build({
      lines: [
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
        line({ itemId: "mp", itemType: "RAW_MATERIAL", physicalQuantity: 1 }),
      ],
      compositions: null,
      materials: null,
      factoryReason: "Varejo 1 não publicada",
      materialReason: "MP não publicada",
    });
    assert.equal(row(report, "PA").observation, "Varejo 1 não publicada");
    assert.equal(row(report, "MP").observation, "MP não publicada");
    assert.equal(report.factoryCostUnavailableReason, "Varejo 1 não publicada");
    assert.equal(report.materialCostUnavailableReason, "MP não publicada");
  });

  it("15. costAnalysisPartial congelado → CUSTO_PARCIAL, valores mantidos, nunca apresentado como pleno", () => {
    const report = build({
      lines: [line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 })],
      compositions: [["prod-pa", frozen(10, 2, 1, { costAnalysisPartial: true })]],
    });
    const r = row(report, "PA");
    assert.equal(r.status, "CUSTO_PARCIAL");
    assert.equal(r.officialUnitCost, 13);
    assert.match(r.observation, /parcial/);
    assert.equal(report.summary.find((s) => s.itemType === "FINISHED_PRODUCT")!.itemsPartialCost, 1);
  });

  it("16. decomposição inconsistente: INCONSISTENTE com a observação canônica; nada é corrigido", () => {
    const report = build({
      lines: [
        line({ itemId: "zerada", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
        line({ itemId: "torta", itemType: "COMPONENT", physicalQuantity: 2 }),
        line({ itemId: "ok", itemType: "COMPONENT", physicalQuantity: 2 }),
      ],
      compositions: [
        // Publicação antiga sem decomposição: parcelas 0 e total 20.
        ["prod-zerada", { total: D(20), material: D(0), hh: D(0), hm: D(0), costAnalysisPartial: null }],
        // Parcelas não fecham com o total.
        ["prod-torta", { total: D(10), material: D(5), hh: D(2), hm: D(2), costAnalysisPartial: null }],
        // Diferença de arredondamento na 6.ª casa fica dentro da tolerância.
        ["prod-ok", { total: D("10.000001"), material: D("5.000000"), hh: D("3.000000"), hm: D("2.000000"), costAnalysisPartial: null }],
      ],
    });
    const zerada = row(report, "ZERADA");
    assert.equal(zerada.status, "INCONSISTENTE");
    assert.ok(zerada.observation.startsWith(INVENTORY_COST_COMPOSITION_INCONSISTENT_NOTE));
    assert.equal(zerada.officialUnitCost, 20);
    assert.equal(zerada.unitCostWithoutHh, 20);
    const torta = row(report, "TORTA");
    assert.equal(torta.status, "INCONSISTENTE");
    assert.equal(torta.officialUnitCost, 10);
    assert.equal(torta.materialUnitCost, 5);
    assert.equal(torta.unitCostWithoutHh, 8);
    assert.match(torta.observation, /diferença 1\.000000/);
    assert.equal(row(report, "OK").status, "OK");
    assert.equal(report.summary.find((s) => s.itemType === "TOTAL")!.itemsInconsistent, 2);
  });

  it("17. saldo zero fica fora; saldo negativo fica fora e é contado; outros tipos ficam fora e são contados", () => {
    const report = build({
      lines: [
        line({ itemId: "zero", itemType: "FINISHED_PRODUCT", physicalQuantity: 0 }),
        line({ itemId: "neg", itemType: "COMPONENT", physicalQuantity: -3 }),
        line({ itemId: "emb", itemType: "PACKAGING", physicalQuantity: 5 }),
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
      ],
      compositions: [["prod-pa", frozen(1, 1, 1)]],
    });
    assert.deepEqual(report.rows.map((r) => r.itemCode), ["PA"]);
    assert.equal(report.negativeItems, 1);
    assert.equal(report.excludedOtherPositiveItems, 1);
  });

  it("18. saldo por almoxarifado: vários almoxarifados do mesmo item viram UMA linha consolidada (mesma regra do relatório atual)", () => {
    const report = build({
      lines: [
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: "2.5" }),
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: "1.5" }),
        line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: "-1" }),
      ],
      compositions: [["prod-pa", frozen(10, 2, 1)]],
    });
    assert.equal(report.rows.length, 1);
    const r = row(report, "PA");
    assert.equal(r.physicalQuantity, "3");
    assert.equal(r.warehouseLabel, INVENTORY_COST_COMPOSITION_WAREHOUSE_LABEL);
    assert.equal(r.officialStockValue, 39);
    assert.ok(report.methodology.some((m) => /somado por item em todos os almoxarifados/.test(m)));
  });

  it("resumo por tipo + TOTAL, ordenado MP → componentes → PA, códigos em ordem natural", () => {
    const report = build({
      lines: [
        line({ itemId: "pa10", itemType: "FINISHED_PRODUCT", physicalQuantity: 1, code: "PA-10" }),
        line({ itemId: "pa2", itemType: "FINISHED_PRODUCT", physicalQuantity: 1, code: "PA-2" }),
        line({ itemId: "cp", itemType: "COMPONENT", physicalQuantity: 2 }),
        line({ itemId: "mp", itemType: "RAW_MATERIAL", physicalQuantity: 4 }),
      ],
      compositions: [
        ["prod-pa10", frozen(10, 5, 5)],
        ["prod-pa2", frozen(10, 5, 5)],
        ["prod-cp", frozen(1, 1, 0)],
      ],
      materials: [["mat-mp", 2]],
    });
    assert.deepEqual(report.rows.map((r) => r.itemCode), ["MP", "CP", "PA-2", "PA-10"]);
    assert.deepEqual(
      report.summary.map((s) => [s.label, s.skuCount, s.physicalQuantity, s.officialStockValue, s.hhStockValue, s.stockValueWithoutHh, s.hhSharePercent]),
      [
        ["Matéria-prima", 1, "4", 8, 0, 8, 0],
        ["Componentes", 1, "2", 4, 2, 2, 0.5],
        ["Produtos acabados", 2, "2", 40, 10, 30, 0.25],
        ["TOTAL", 4, "8", 52, 12, 40, D(12).div(52).toNumber()],
      ]
    );
    assert.equal(report.title, "Relatório de Estoque – Composição de Custo");
    assert.ok(report.methodology.includes("CIU oficial = MP + HH + HM"));
    assert.ok(report.methodology.includes("CIU sem HH = CIU oficial - HH"));
    assert.ok(report.methodology.some((m) => /CIF e OPEX não fazem parte/.test(m)));
    assert.deepEqual(report.sources, [{ label: "Versão da aplicação (commit)", value: "abc123" }]);
  });
});

describe("composição de custo — XLSX", () => {
  const report = build({
    lines: [
      line({ itemId: "mp", itemType: "RAW_MATERIAL", physicalQuantity: 4, code: "00123", unit: "KG" }),
      line({ itemId: "cp", itemType: "COMPONENT", physicalQuantity: 2, code: "=CP-1" }),
      line({ itemId: "pa", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
      line({ itemId: "sem", itemType: "FINISHED_PRODUCT", physicalQuantity: 1 }),
    ],
    compositions: [
      ["prod-cp", frozen(1, 1, 0)],
      ["prod-pa", frozen(10, 5, 5)],
    ],
    materials: [["mat-mp", "2.5"]],
  });

  it("19. três abas com as colunas pedidas, autofilter, larguras, formatos, código como texto e vazio sem custo", () => {
    const wb = buildInventoryCostCompositionWorkbook(report);
    assert.deepEqual(wb.SheetNames, [...INVENTORY_COST_COMPOSITION_SHEETS]);
    const detail = wb.Sheets["Estoque Detalhado"]!;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(detail, { header: 1, raw: true });
    assert.deepEqual(rows[0], [...INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS]);
    assert.equal(rows.length, 1 + 4);
    // Código com zero à esquerda continua texto; fórmula neutralizada.
    assert.equal((detail["A2"] as XLSX.CellObject).t, "s");
    assert.equal((detail["A2"] as XLSX.CellObject).v, "00123");
    assert.equal((detail["A3"] as XLSX.CellObject).v, "'=CP-1");
    // Quantidade e custos numéricos com formato; sem custo = célula ausente/vazia (não zero).
    assert.equal((detail["F2"] as XLSX.CellObject).t, "n");
    assert.equal((detail["F2"] as XLSX.CellObject).z, "#,##0.000000");
    assert.equal((detail["G2"] as XLSX.CellObject).z, '"R$" #,##0.000000');
    assert.equal((detail["M2"] as XLSX.CellObject).z, '"R$" #,##0.00');
    assert.equal((detail["M2"] as XLSX.CellObject).v, 10);
    const semRow = rows.findIndex((r) => r[0] === "SEM") + 1;
    assert.ok(semRow > 1);
    for (const col of ["G", "H", "I", "J", "K", "L", "M", "N", "O"]) {
      const cell = detail[`${col}${semRow}`] as XLSX.CellObject | undefined;
      assert.ok(cell == null || cell.v === "", `${col}${semRow} deve ficar vazio`);
    }
    assert.equal(detail[`P${semRow}`]!.v, "SEM_CUSTO");
    assert.equal(detail["!autofilter"]?.ref, "A1:Q5");
    assert.equal(detail["!cols"]?.length, INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS.length);
    assert.equal(detail["!merges"], undefined);

    const summary = wb.Sheets["Resumo"]!;
    const summaryRows = XLSX.utils.sheet_to_json<(string | number)[]>(summary, { header: 1, raw: true });
    assert.deepEqual(summaryRows[0], [...INVENTORY_COST_COMPOSITION_SUMMARY_COLUMNS]);
    assert.deepEqual(summaryRows.map((r) => r[0]), ["Tipo", "Matéria-prima", "Componentes", "Produtos acabados", "TOTAL"]);
    assert.equal((summary["G3"] as XLSX.CellObject).z, "0.00%");
    assert.equal((summary["D5"] as XLSX.CellObject).v, 34); // MP 4×2,5 + CP 2×2 + PA 1×20
    assert.equal(summary["!autofilter"]?.ref, "A1:J5");

    const methodology = wb.Sheets["Metodologia"]!;
    const text = XLSX.utils.sheet_to_csv(methodology);
    assert.match(text, /Fonte de custo: IndusCost/);
    assert.match(text, /CIU oficial = MP \+ HH \+ HM/);
    assert.match(text, /CIU sem HH = CIU oficial - HH/);
    assert.match(text, /Ciclo, cavidades, eficiência, setup, lote e perdas permanecem considerados pelo motor oficial\./);
    assert.match(text, /O relatório não altera nem recalcula a engenharia do produto\./);
    assert.match(text, /Apenas destaca e exclui a parcela de mão de obra HH da visão ajustada\./);
    assert.match(text, /Versão da aplicação \(commit\),abc123/);
    assert.equal(inventoryCostCompositionFilename(report.generatedAt), "estoque-composicao-custo-2026-09-30.xlsx");
  });

  it("19b. arquivo final: freeze da primeira linha e cabeçalho em negrito injetados no OOXML", async () => {
    const buffer = await buildInventoryCostCompositionXlsx(report);
    const zip = await JSZip.loadAsync(buffer);
    const styles = await zip.file("xl/styles.xml")!.async("string");
    assert.match(styles, /<font><b\/>/);
    const sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    assert.match(sheet1, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    const boldXfCount = (styles.match(/applyFont="1"/g) ?? []).length;
    assert.ok(boldXfCount > 0);
    const header = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheet1)![1]!;
    const headerCells = header.match(/<c r="[A-Z]+1"[^>]*>/g) ?? [];
    assert.equal(headerCells.length, INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS.length);
    const originalXfCount = Number(/<cellXfs count="(\d+)"/.exec(styles)![1]) / 2;
    for (const cell of headerCells) {
      const s = Number(/\bs="(\d+)"/.exec(cell)?.[1] ?? "-1");
      assert.ok(s >= originalXfCount, `cabeçalho ${cell} deve usar xf em negrito`);
    }
    // Linha 2 (corpo) continua com os xfs originais.
    const body = /<row r="2"[^>]*>([\s\S]*?)<\/row>/.exec(sheet1)![1]!;
    for (const cell of body.match(/<c r="[A-Z]+2"[^>]*>/g) ?? []) {
      const s = Number(/\bs="(\d+)"/.exec(cell)?.[1] ?? "0");
      assert.ok(s < originalXfCount, `corpo ${cell} não pode ficar em negrito`);
    }
    // A planilha reabre com os mesmos dados.
    const reread = XLSX.read(buffer, { type: "buffer" });
    assert.deepEqual(reread.SheetNames, [...INVENTORY_COST_COMPOSITION_SHEETS]);
    assert.equal((reread.Sheets["Estoque Detalhado"]!["A2"] as XLSX.CellObject).v, "00123");
    const sheet3 = await zip.file("xl/worksheets/sheet3.xml")!.async("string");
    assert.doesNotMatch(sheet3, /state="frozen"/);
  });

  it("injeção de negrito é idempotente em estrutura mínima de styles.xml", () => {
    const xml =
      '<styleSheet><fonts count="1"><font><sz val="11"/></font></fonts><cellXfs count="2"><xf numFmtId="0" fontId="0" xfId="0"/><xf numFmtId="164" fontId="0" applyNumberFormat="1" xfId="0"/></cellXfs></styleSheet>';
    const out = injectBoldHeaderStyles(xml);
    assert.match(out.xml, /<fonts count="2">/);
    assert.match(out.xml, /<cellXfs count="4">/);
    assert.deepEqual([...out.boldXfByXf.entries()], [[0, 2], [1, 3]]);
    assert.match(out.xml, /<xf applyFont="1" numFmtId="164" fontId="1" applyNumberFormat="1" xfId="0"\/>/);
  });
});

describe("composição de custo — carga somente leitura e reconciliação", () => {
  function fakeDb(state: {
    balances: Array<{ physicalQuantity: string; item: Record<string, unknown> }>;
    priceTable: { id: string; status: string } | null;
    priceVersion: Record<string, unknown> | null;
    priceItems: Array<Record<string, unknown>>;
    materialVersion: Record<string, unknown> | null;
    materialItems: Array<Record<string, unknown>>;
    productionVersion: Record<string, unknown> | null;
  }) {
    const calls: string[] = [];
    const reading =
      (name: string, fn: (args: unknown) => unknown) =>
      (args: unknown) => {
        calls.push(name);
        return Promise.resolve(fn(args));
      };
    const forbid = (model: string) =>
      new Proxy(
        {},
        {
          get(_target, prop: string) {
            return () => {
              throw new Error(`escrita proibida: ${model}.${prop}`);
            };
          },
        }
      );
    const model = (name: string, reads: Record<string, (args: unknown) => unknown>) =>
      new Proxy(forbid(name), {
        get(target, prop: string) {
          return prop in reads ? reading(`${name}.${prop}`, reads[prop]!) : Reflect.get(target, prop);
        },
      });
    const db = {
      inventoryBalance: model("inventoryBalance", { findMany: () => state.balances }),
      priceTable: model("priceTable", { findUnique: () => state.priceTable }),
      priceTableVersion: model("priceTableVersion", { findFirst: () => state.priceVersion }),
      priceTableItem: model("priceTableItem", {
        findMany: (args) => {
          const ids = ((args as { where: { productId: { in: string[] } } }).where.productId.in ?? []) as string[];
          return state.priceItems.filter((item) => ids.includes(item.productId as string));
        },
      }),
      materialCostTableVersion: model("materialCostTableVersion", { findFirst: () => state.materialVersion }),
      materialCostTableItem: model("materialCostTableItem", { findMany: () => state.materialItems }),
      productionCostTableVersion: model("productionCostTableVersion", { findUnique: () => state.productionVersion }),
    };
    return { db: db as unknown as Parameters<typeof loadInventoryCostCompositionReport>[0], calls };
  }

  const item = (id: string, itemType: string, extra: Record<string, unknown> = {}) => ({
    id,
    code: id.toUpperCase(),
    description: `Item ${id}`,
    unit: "UN",
    itemType,
    productId: itemType === "RAW_MATERIAL" ? null : `prod-${id}`,
    materialId: itemType === "RAW_MATERIAL" ? `mat-${id}` : null,
    ...extra,
  });

  const state = {
    balances: [
      { physicalQuantity: "10", item: item("mp1", "RAW_MATERIAL") },
      { physicalQuantity: "5", item: item("mp1", "RAW_MATERIAL") },
      { physicalQuantity: "20", item: item("mp2", "RAW_MATERIAL") },
      { physicalQuantity: "7.25", item: item("mp3", "RAW_MATERIAL") },
      { physicalQuantity: "3", item: item("cp1", "COMPONENT") },
      { physicalQuantity: "4", item: item("cp2", "COMPONENT") },
      { physicalQuantity: "1", item: item("cp3", "COMPONENT") },
      { physicalQuantity: "2", item: item("pa1", "FINISHED_PRODUCT") },
      { physicalQuantity: "6", item: item("pa2", "FINISHED_PRODUCT") },
      { physicalQuantity: "0.5", item: item("pa3", "FINISHED_PRODUCT") },
      { physicalQuantity: "0", item: item("pa0", "FINISHED_PRODUCT") },
      { physicalQuantity: "-2", item: item("cpn", "COMPONENT") },
      { physicalQuantity: "9", item: item("emb", "PACKAGING") },
    ],
    priceTable: { id: "pt", status: "ACTIVE" },
    priceVersion: {
      id: "ptv",
      versionNumber: 7,
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      effectiveFrom: new Date("2026-09-01T03:00:00.000Z"),
      effectiveTo: null,
      productionCostTableVersionId: "pcv",
    },
    priceItems: [
      { productId: "prod-cp1", frozenTotalCost: "6.000000", frozenMaterialCost: "4.000000", frozenHhCost: "1.500000", frozenHmCost: "0.500000", costSnapshotJson: { calculationSnapshot: { costAnalysisPartial: false } } },
      { productId: "prod-cp2", frozenTotalCost: "1.333333", frozenMaterialCost: "1.000000", frozenHhCost: "0.222222", frozenHmCost: "0.111111", costSnapshotJson: null },
      { productId: "prod-cp3", frozenTotalCost: "9.000000", frozenMaterialCost: "3.000000", frozenHhCost: "3.000000", frozenHmCost: "3.000000", costSnapshotJson: { calculationSnapshot: { costAnalysisPartial: true } } },
      { productId: "prod-pa1", frozenTotalCost: "15.500000", frozenMaterialCost: "8.000000", frozenHhCost: "5.000000", frozenHmCost: "2.500000", costSnapshotJson: null },
      { productId: "prod-pa2", frozenTotalCost: "100.123456", frozenMaterialCost: "60.123456", frozenHhCost: "25.000000", frozenHmCost: "15.000000", costSnapshotJson: null },
      // Publicação sem decomposição: só o total.
      { productId: "prod-pa3", frozenTotalCost: "20.000000", frozenMaterialCost: "0", frozenHhCost: "0", frozenHmCost: "0", costSnapshotJson: null },
    ],
    materialVersion: { code: "MP-2026-09", revision: 2, effectiveDate: new Date("2026-09-01T00:00:00.000Z"), publishedAt: new Date("2026-09-01T09:00:00.000Z"), id: "mcv" },
    materialItems: [
      { materialId: "mat-mp1", landedCostSnapshot: "12.500000" },
      { materialId: "mat-mp2", landedCostSnapshot: "0.987654" },
      { materialId: "mat-mp3", landedCostSnapshot: "3.000000" },
    ],
    productionVersion: { code: "2026-09", revision: 1, effectiveDate: new Date("2026-09-01T00:00:00.000Z"), publishedAt: new Date("2026-08-31T18:00:00.000Z") },
  };

  it("20. exportação sem escrita em banco: só findMany/findUnique/findFirst; qualquer escrita lançaria", async () => {
    const { db, calls } = fakeDb(state);
    const report = await loadInventoryCostCompositionReport(db, AT);
    assert.ok(calls.every((c) => /\.(findMany|findUnique|findFirst)$/.test(c)), calls.join(", "));
    assert.equal(calls.filter((c) => c === "inventoryBalance.findMany").length, 1);
    assert.equal(calls.filter((c) => c === "priceTableItem.findMany").length, 1, "custos em lote, sem N+1");
    assert.equal(calls.filter((c) => c === "materialCostTableItem.findMany").length, 1, "MP em lote, sem N+1");
    assert.equal(report.rows.length, 9);
    assert.equal(report.negativeItems, 1);
    assert.equal(report.excludedOtherPositiveItems, 1);
    const sources = Object.fromEntries(report.sources.map((s) => [s.label, s.value]));
    assert.equal(sources["Data/hora da geração"], AT.toISOString());
    assert.match(sources["Versão da Tabela Comercial Varejo 1"]!, /versão 7 · vigência desde 2026-09-01T03:00:00\.000Z · publicada em 2026-09-01T10:00:00\.000Z/);
    assert.match(sources["Tabela oficial de custo de produção que originou o custo congelado"]!, /2026-09 rev\. 1/);
    assert.match(sources["Versão da tabela oficial de matéria-prima"]!, /MP-2026-09 rev\. 2 · vigência 2026-09-01/);
    assert.ok(typeof sources["Versão da aplicação (commit)"] === "string" && sources["Versão da aplicação (commit)"]!.length > 0);
    assert.equal(report.rows.find((r) => r.itemCode === "CP3")!.status, "CUSTO_PARCIAL");
    assert.equal(report.rows.find((r) => r.itemCode === "PA3")!.status, "INCONSISTENTE");
  });

  it("reconciliação com o relatório atual: 3 MP, 3 componentes, 3 PA — código, quantidade, CIU e valor oficial batem", async () => {
    const { db } = fakeDb(state);
    const composition = await loadInventoryCostCompositionReport(db, AT);
    // Relatório atual, com as MESMAS entradas (mesma população, saldo e maps de custo congelado).
    const lines: InventoryPositionReportSourceLine[] = state.balances.map((b) => ({
      itemId: b.item.id as string,
      itemType: b.item.itemType as string,
      code: b.item.code as string,
      description: b.item.description as string,
      unit: b.item.unit as string,
      productId: (b.item.productId as string | null) ?? null,
      materialId: (b.item.materialId as string | null) ?? null,
      physicalQuantity: D(b.physicalQuantity),
    }));
    const position = buildInventoryPositionReport({
      lines,
      generatedAt: AT,
      retailPriceByProductId: new Map(),
      factoryCostByProductId: new Map(state.priceItems.map((i) => [i.productId as string, D(i.frozenTotalCost as string)])),
      materialCostByMaterialId: new Map(state.materialItems.map((i) => [i.materialId as string, D(i.landedCostSnapshot as string)])),
    });
    const positionRows = position.sections.flatMap((s) => s.rows.map((r) => ({ ...r, itemType: s.itemType })));
    assert.equal(positionRows.length, 9);
    assert.equal(composition.rows.length, 9);
    const cents = (v: number | null) => (v == null ? null : D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber());
    for (const current of positionRows) {
      const next = composition.rows.find((r) => r.itemCode === current.itemCode)!;
      assert.ok(next, current.itemCode);
      assert.equal(next.itemType, current.itemType, `${current.itemCode} tipo`);
      assert.equal(next.physicalQuantity, current.physicalQuantity, `${current.itemCode} quantidade`);
      assert.equal(next.warehouseLabel, INVENTORY_COST_COMPOSITION_WAREHOUSE_LABEL, `${current.itemCode} almoxarifado consolidado, como no atual`);
      assert.equal(cents(next.officialUnitCost), current.unitCost, `${current.itemCode} CIU oficial`);
      assert.equal(cents(next.officialStockValue), current.totalCost, `${current.itemCode} valor estoque oficial`);
    }
    // Totais por seção: o relatório atual soma linhas já arredondadas a centavos; o novo soma sem arredondar.
    // A diferença fica limitada ao arredondamento (≤ 0,005 × linhas).
    for (const section of position.sections) {
      const summary = composition.summary.find((s) => s.itemType === section.itemType)!;
      assert.ok(Math.abs(summary.officialStockValue - section.costTotal!) <= 0.005 * section.rows.length, section.title);
    }
    // Depois: HH retirado, CIU sem HH e valor sem HH derivados do MESMO snapshot.
    for (const next of composition.rows) {
      if (next.status === "SEM_CUSTO") continue;
      assert.equal(next.hhRemovedUnit, next.hhUnitCost, next.itemCode);
      assert.ok(Math.abs(next.unitCostWithoutHh! - (next.officialUnitCost! - next.hhUnitCost!)) < 1e-9, next.itemCode);
      assert.ok(Math.abs(next.stockValueWithoutHh! - (next.officialStockValue! - next.hhStockValue!)) < 1e-6, next.itemCode);
    }
    const pa2 = composition.rows.find((r) => r.itemCode === "PA2")!;
    assert.equal(pa2.hhRemovedUnit, 25);
    assert.equal(pa2.unitCostWithoutHh, 75.123456);
    assert.equal(pa2.stockValueWithoutHh, D("6").mul("75.123456").toNumber());
  });

  it("indexação congelada: duplicado → null (fail-closed); costAnalysisPartial lido do snapshot", () => {
    const map = indexFrozenCostComposition([
      { productId: "a", frozenTotalCost: "1", frozenMaterialCost: "1", frozenHhCost: "0", frozenHmCost: "0" },
      { productId: "a", frozenTotalCost: "2", frozenMaterialCost: "2", frozenHhCost: "0", frozenHmCost: "0" },
      { productId: "b", frozenTotalCost: null, frozenMaterialCost: "0", frozenHhCost: "0", frozenHmCost: "0" },
      { productId: "c", frozenTotalCost: "3", frozenMaterialCost: "1", frozenHhCost: "1", frozenHmCost: "1", costSnapshotJson: { calculationSnapshot: { costAnalysisPartial: true } } },
    ]);
    assert.equal(map.get("a"), null);
    assert.equal(map.get("b"), null);
    assert.equal(map.get("c")!.costAnalysisPartial, true);
    assert.equal(readFrozenCostAnalysisPartial(null), null);
    assert.equal(readFrozenCostAnalysisPartial({ calculationSnapshot: {} }), null);
    assert.equal(readFrozenCostAnalysisPartial({ calculationSnapshot: { costAnalysisPartial: false } }), false);
  });
});
