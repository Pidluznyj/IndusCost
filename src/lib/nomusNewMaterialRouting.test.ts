/**
 * Roteamento de códigos NOVOS → Material (missão nomus-new-material-routing).
 * Caso real obrigatório: 210.30A- (CAIXA 258x248x560 Purificador, Embalagem).
 * Regressão obrigatória: 520.22-- (industrializado comprado → Product/COMPONENT).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  detectNomusMaterialRoutingCandidates,
  finalizeNomusMaterialCreates,
  planNomusNewMaterialRouting,
  NOMUS_NEW_MATERIAL_CATEGORY,
  type NomusMaterialRoutingDecision,
} from "./nomusNewMaterialRouting.js";
import {
  buildNomusProductFixture52022,
  mapNomusProductsFromApiRows,
  type NomusProductApiRow,
} from "./nomusProductsSyncMap.js";
import { buildCatalogEntityLookupMaps } from "./nomusCatalogEntityResolve.js";

/** Fixture REAL da missão — cadastro Nomus do 210.30A-. */
function fixture21030A(): NomusProductApiRow {
  return {
    id: 1385,
    codigo: "210.30A-",
    nome: "210.30A-",
    descricao: "CAIXA 258x248x560 Purificador",
    ativo: true,
    nomeTipoProduto: "Embalagem",
    nomeGrupoProduto: "Lista de materiais",
    nomeFamiliaProduto: "Embalagem",
    siglaUnidadeMedida: "UNID",
    template: false,
    servicoIndustrializacaoTerceiros: false,
  };
}

function rawMaterialRow(codigo = "310.10", tipo = "Matéria-prima"): NomusProductApiRow {
  return {
    id: 9001,
    codigo,
    nome: codigo,
    descricao: "Resina ABS Natural",
    ativo: true,
    nomeTipoProduto: tipo,
    nomeGrupoProduto: "Insumos de produção",
    nomeFamiliaProduto: "Plásticos",
    siglaUnidadeMedida: "KG",
    template: false,
    servicoIndustrializacaoTerceiros: false,
  };
}

function insumoRow(codigo = "410.55"): NomusProductApiRow {
  return {
    id: 9002,
    codigo,
    nome: codigo,
    descricao: "Fita adesiva industrial 48mm",
    ativo: true,
    nomeTipoProduto: "Insumo",
    nomeGrupoProduto: "Almoxarifado",
    nomeFamiliaProduto: "Consumíveis",
    siglaUnidadeMedida: "ROLO",
    template: false,
    servicoIndustrializacaoTerceiros: false,
  };
}

function finishedProductRow(codigo = "100.01AA"): NomusProductApiRow {
  return {
    id: 9003,
    codigo,
    nome: "Torneira Luxo Branca",
    descricao: "Torneira Luxo Branca",
    ativo: true,
    nomeTipoProduto: "Produto acabado",
    nomeGrupoProduto: "Produtos",
    nomeFamiliaProduto: "Torneiras",
    siglaUnidadeMedida: "UNID",
    template: false,
    servicoIndustrializacaoTerceiros: false,
  };
}

const NO_BLOCKED = new Map<string, string[]>();
const EMPTY_MAPS = buildCatalogEntityLookupMaps({ materials: [], products: [] });

function detect(rows: NomusProductApiRow[], blocked = NO_BLOCKED) {
  return detectNomusMaterialRoutingCandidates(rows, blocked);
}

function decisionFor(
  decisions: NomusMaterialRoutingDecision[],
  code: string
): NomusMaterialRoutingDecision | undefined {
  return decisions.find((d) => d.code === code);
}

describe("nomusNewMaterialRouting — classificação de candidatos", () => {
  it("T1: código novo + Embalagem explícita (caso real 210.30A-) → CREATE Material, nunca Product", () => {
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "210.30A-");
    assert.equal(d?.kind, "CREATE_MATERIAL");
    if (d?.kind !== "CREATE_MATERIAL") return;
    assert.equal(d.reason, "EMBALAGEM");
    assert.equal(d.payload.code, "210.30A-");
    assert.equal(d.payload.description, "CAIXA 258x248x560 Purificador");
    assert.equal(d.payload.unit, "UNID");
    assert.equal(d.payload.status, "ACTIVE");
    assert.equal(plan.summary.materialCreateCount, 1);
  });

  it("T2: código novo + Matéria-prima explícita → CREATE Material", () => {
    const plan = planNomusNewMaterialRouting(detect([rawMaterialRow()]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "310.10");
    assert.equal(d?.kind, "CREATE_MATERIAL");
    if (d?.kind !== "CREATE_MATERIAL") return;
    assert.equal(d.reason, "MATERIA_PRIMA");
    assert.equal(d.payload.unit, "KG");
  });

  it("T3: código novo + Insumo explícito (tolerante a acento/caixa) → CREATE Material", () => {
    const plan = planNomusNewMaterialRouting(detect([insumoRow()]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "410.55");
    assert.equal(d?.kind, "CREATE_MATERIAL");
    if (d?.kind !== "CREATE_MATERIAL") return;
    assert.equal(d.reason, "INSUMO");

    const accented = { ...insumoRow("410.56"), nomeTipoProduto: "ÍNSUMOS" };
    const plan2 = planNomusNewMaterialRouting(detect([accented]), EMPTY_MAPS);
    assert.equal(decisionFor(plan2.decisions, "410.56")?.kind, "CREATE_MATERIAL");
  });

  it("T7: produto acabado novo NÃO é candidato a Material — segue o ciclo Product", () => {
    const candidates = detect([finishedProductRow()]);
    assert.equal(candidates.length, 0);
  });

  it("T8/regressão junho: 520.22-- (industrializado comprado, COMPONENT/HIGH) intacto", () => {
    const fixture = buildNomusProductFixture52022();
    // Não vira candidato a Material (nenhum texto de MP/embalagem/insumo).
    assert.equal(detect([fixture]).length, 0);
    // E o mapper continua produzindo COMPONENT/HIGH elegível.
    const { eligible, blocked } = mapNomusProductsFromApiRows([fixture], new Set());
    assert.equal(blocked.length, 0);
    assert.equal(eligible[0]?.type, "COMPONENT");
    assert.equal(eligible[0]?.typeInferenceConfidence, "HIGH");
  });

  it("T12a: contradição tipo 'Produto acabado' + família Embalagem → fail closed (sem escrita)", () => {
    const contradictory = {
      ...fixture21030A(),
      codigo: "210.99Z-",
      nomeTipoProduto: "Produto acabado",
    };
    const plan = planNomusNewMaterialRouting(detect([contradictory]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "210.99Z-");
    assert.equal(d?.kind, "SKIP_UNSAFE");
    if (d?.kind !== "SKIP_UNSAFE") return;
    assert.equal(d.guard, "TIPO_PRODUTO_CONTRADITORIO");
    assert.equal(plan.summary.materialCreateCount, 0);
  });

  it("T12b: inativo/template/serviço/sem descrição segura → fail closed", () => {
    const inactive = { ...fixture21030A(), codigo: "210.90A-", ativo: false };
    const template = { ...fixture21030A(), codigo: "210.91A-", template: true };
    const service = {
      ...fixture21030A(),
      codigo: "210.92A-",
      servicoIndustrializacaoTerceiros: true,
    };
    const noDescription = {
      ...fixture21030A(),
      codigo: "210.93A-",
      nome: "210.93A-",
      descricao: "210.93A-",
    };
    const plan = planNomusNewMaterialRouting(
      detect([inactive, template, service, noDescription]),
      EMPTY_MAPS
    );
    assert.equal(plan.summary.materialCreateCount, 0);
    assert.equal(plan.summary.materialUnsafeCount, 4);
    assert.equal(decisionFor(plan.decisions, "210.90A-")?.kind, "SKIP_UNSAFE");
    assert.equal(decisionFor(plan.decisions, "210.93A-")?.kind, "SKIP_UNSAFE");
  });

  it("T12c: blockedReasons inseguros do mapper (opcional/fantasma/MRO/revenda) → fail closed", () => {
    const blocked = new Map<string, string[]>([
      ["210.30A-", ["PACKAGING_NOT_PRODUCT", "OPTIONAL_PRODUCT"]],
    ]);
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()], blocked), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "210.30A-");
    assert.equal(d?.kind, "SKIP_UNSAFE");
    if (d?.kind !== "SKIP_UNSAFE") return;
    assert.equal(d.guard, "MAPPER_OPTIONAL_PRODUCT");
  });

  it("T12d: código 800.xx (montagem local) nunca vira Material automático", () => {
    const assembly = { ...rawMaterialRow("800.10") };
    const plan = planNomusNewMaterialRouting(detect([assembly]), EMPTY_MAPS);
    assert.equal(decisionFor(plan.decisions, "800.10")?.kind, "SKIP_UNSAFE");
  });
});

describe("nomusNewMaterialRouting — preservação de registros existentes", () => {
  it("T4: Material já existe → não duplica, não cria Product, NENHUM update (custos intocados)", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-1", code: "210.30A-", status: "ACTIVE" }],
      products: [],
    });
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), maps);
    const d = decisionFor(plan.decisions, "210.30A-");
    assert.equal(d?.kind, "ALREADY_MATERIAL");
    assert.equal(plan.summary.materialCreateCount, 0);
    // Prova estrutural da proteção de custos manuais: o plano NÃO possui
    // nenhum tipo de decisão de UPDATE — só CREATE existe no contrato.
    assert.ok(plan.decisions.every((x) => x.kind !== ("UPDATE_MATERIAL" as never)));
  });

  it("T5: Product já existe (mesmo que Nomus diga Matéria-prima/Embalagem) → preserva Product, sem Material", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [],
      products: [{ id: "prod-1", sku: "111.22", status: "ACTIVE", type: "COMPONENT" }],
    });
    const nowRawMaterial = rawMaterialRow("111.22");
    const plan = planNomusNewMaterialRouting(detect([nowRawMaterial]), maps);
    const d = decisionFor(plan.decisions, "111.22");
    assert.equal(d?.kind, "SKIP_EXISTING_PRODUCT");
    if (d?.kind !== "SKIP_EXISTING_PRODUCT") return;
    assert.equal(d.productId, "prod-1");
    assert.equal(plan.summary.materialCreateCount, 0);
  });

  it("T6: Product E Material existem → nenhuma conversão/exclusão, só diagnóstico", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-1", code: "111.22", status: "ACTIVE" }],
      products: [{ id: "prod-1", sku: "111.22", status: "ACTIVE", type: "COMPONENT" }],
    });
    const plan = planNomusNewMaterialRouting(detect([rawMaterialRow("111.22")]), maps);
    const d = decisionFor(plan.decisions, "111.22");
    assert.equal(d?.kind, "SKIP_BOTH_EXIST");
    if (d?.kind !== "SKIP_BOTH_EXIST") return;
    assert.deepEqual(d.conflictProductIds, ["prod-1"]);
    assert.equal(plan.summary.materialCreateCount, 0);
  });

  it("T4b: Material inativo também bloqueia novo create (revisão manual, sem duplicar)", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-1", code: "210.30A-", status: "INACTIVE" }],
      products: [],
    });
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), maps);
    assert.equal(decisionFor(plan.decisions, "210.30A-")?.kind, "ALREADY_MATERIAL");
    assert.equal(plan.summary.materialCreateCount, 0);
  });
});

describe("nomusNewMaterialRouting — payload e custos", () => {
  it("T9: Material novo nasce com custos 0/0/0, categoria NOMUS_IMPORT e defaults seguros", () => {
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "210.30A-");
    assert.equal(d?.kind, "CREATE_MATERIAL");
    if (d?.kind !== "CREATE_MATERIAL") return;
    assert.strictEqual(d.payload.currentCost, 0);
    assert.strictEqual(d.payload.averageCost, 0);
    assert.strictEqual(d.payload.standardCost, 0);
    assert.strictEqual(d.payload.freight, 0);
    assert.strictEqual(d.payload.standardLoss, 0);
    assert.strictEqual(d.payload.conversionFactor, 1);
    // Compat: isMaterialNomusControlled reconhece origem por NOMUS_IMPORT.
    assert.equal(d.payload.category, NOMUS_NEW_MATERIAL_CATEGORY);
    assert.equal(NOMUS_NEW_MATERIAL_CATEGORY, "NOMUS_IMPORT");
  });

  it("T10: segundo sync com Material existente (custos manuais 4.35) → nenhuma mutação; custos preservados", () => {
    // Sync 1 criou; usuário ajustou currentCost=4.35; sync 2 roda de novo.
    const mapsAfterManualEdit = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-1", code: "210.30A-", status: "ACTIVE" }],
      products: [],
    });
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), mapsAfterManualEdit);
    // Nenhum CREATE, e o contrato do plano não tem update — custo 4.35 não
    // pode ser tocado porque não existe caminho de escrita além do create.
    assert.equal(plan.summary.materialCreateCount, 0);
    assert.equal(plan.summary.materialAlreadyExistingCount, 1);
    const hasAnyWriteForCode = plan.decisions.some(
      (x) => x.code === "210.30A-" && x.kind === "CREATE_MATERIAL"
    );
    assert.equal(hasAnyWriteForCode, false);
  });

  it("T1b: idempotência — mesmo payload duas vezes no mesmo plano gera um único candidato", () => {
    const plan = planNomusNewMaterialRouting(
      detect([fixture21030A(), fixture21030A()]),
      EMPTY_MAPS
    );
    assert.equal(plan.summary.materialCandidatesCount, 1);
    assert.equal(plan.summary.materialCreateCount, 1);
  });
});

describe("nomusNewMaterialRouting — gate final anti-TOCTOU", () => {
  function createsOf(rows: NomusProductApiRow[]) {
    const plan = planNomusNewMaterialRouting(detect(rows), EMPTY_MAPS);
    return plan.decisions.filter(
      (d): d is Extract<NomusMaterialRoutingDecision, { kind: "CREATE_MATERIAL" }> =>
        d.kind === "CREATE_MATERIAL"
    );
  }

  it("T13: Material criado entre plano e aplicação → gate final cancela o create", () => {
    const creates = createsOf([fixture21030A()]);
    assert.equal(creates.length, 1);
    const freshMaps = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-concurrent", code: "210.30A-", status: "ACTIVE" }],
      products: [],
    });
    const { toCreate, lateSkips } = finalizeNomusMaterialCreates(creates, freshMaps);
    assert.equal(toCreate.length, 0);
    assert.equal(lateSkips.length, 1);
    assert.equal(lateSkips[0]?.code, "210.30A-");
  });

  it("T14: Product criado entre plano e aplicação → gate final cancela o Material", () => {
    const creates = createsOf([fixture21030A()]);
    const freshMaps = buildCatalogEntityLookupMaps({
      materials: [],
      products: [{ id: "prod-concurrent", sku: "210.30A-", status: "ACTIVE", type: "PRODUCT" }],
    });
    const { toCreate, lateSkips } = finalizeNomusMaterialCreates(creates, freshMaps);
    assert.equal(toCreate.length, 0);
    assert.equal(lateSkips.length, 1);
  });

  it("gate final sem concorrência → mantém o create", () => {
    const creates = createsOf([fixture21030A()]);
    const { toCreate, lateSkips } = finalizeNomusMaterialCreates(creates, EMPTY_MAPS);
    assert.equal(toCreate.length, 1);
    assert.equal(lateSkips.length, 0);
  });
});

describe("GATE 2 — cadastro Nomus INATIVO nunca nasce como Material", () => {
  it("TEST-INACTIVE-MATERIAL (Embalagem, ativo=false, sem Product/Material) → zero writes, motivo explícito", () => {
    const inactivePackaging = {
      id: 9100,
      codigo: "TEST-INACTIVE-MATERIAL",
      nome: "TEST-INACTIVE-MATERIAL",
      descricao: "Caixa de teste inativa",
      ativo: false,
      nomeTipoProduto: "Embalagem",
      nomeGrupoProduto: "Lista de materiais",
      nomeFamiliaProduto: "Embalagem",
      siglaUnidadeMedida: "UNID",
      template: false,
      servicoIndustrializacaoTerceiros: false,
    };
    const plan = planNomusNewMaterialRouting(detect([inactivePackaging]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "TEST-INACTIVE-MATERIAL");
    assert.equal(d?.kind, "SKIP_UNSAFE");
    if (d?.kind !== "SKIP_UNSAFE") return;
    assert.equal(d.guard, "INATIVO_NO_NOMUS");
    assert.equal(plan.summary.materialCreateCount, 0);
    // Fica só como diagnóstico (target SKIP no preview) — catálogo intacto.
    const entry = plan.preview.find((p) => p.code === "TEST-INACTIVE-MATERIAL");
    assert.equal(entry?.target, "SKIP");
    assert.match(entry?.reason ?? "", /INATIVO_NO_NOMUS/);
  });

  it("matéria-prima explícita inativa → mesmo comportamento (nunca Material INACTIVE automático)", () => {
    const inactiveRaw = { ...rawMaterialRow("310.99"), ativo: false };
    const plan = planNomusNewMaterialRouting(detect([inactiveRaw]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "310.99");
    assert.equal(d?.kind, "SKIP_UNSAFE");
    if (d?.kind !== "SKIP_UNSAFE") return;
    assert.equal(d.guard, "INATIVO_NO_NOMUS");
    // Prova estrutural: o único payload possível no contrato nasce ACTIVE —
    // inativo jamais chega ao CREATE, logo não existe Material INACTIVE
    // criado por esta feature.
    const creates = plan.decisions.filter((x) => x.kind === "CREATE_MATERIAL");
    assert.equal(creates.length, 0);
  });
});

describe("GATE 3 — Material NOMUS_IMPORT aparece em Suprimentos (wiring)", () => {
  it("GET /api/materials não filtra category/status e a tela lista com 'Todas as categorias' por default", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const apiStart = server.indexOf('app.get("/api/materials"');
    assert.ok(apiStart > 0, "handler GET /api/materials existe");
    const handler = server.slice(apiStart, apiStart + 1200);
    // findMany sem where — nenhuma categoria/status é excluída na API.
    assert.match(handler, /prisma\.material\.findMany\(\{\s*include:/);
    assert.doesNotMatch(handler, /where:/);

    const page = readFileSync(
      join(process.cwd(), "src", "components", "MaterialModule.tsx"),
      "utf8"
    );
    // Default do filtro é "" (Todas as categorias) — NOMUS_IMPORT aparece; e
    // a categoria não alimenta nenhum lookup de label em linha da listagem
    // (único uso fora de filtro/form é popular o formulário de edição).
    assert.match(page, /useState<"" \| Material\["category"\]>\(""\)/);
    assert.match(page, /Todas as categorias/);
    assert.match(page, /mat\.code\.toLowerCase\(\)\.includes\(q\)/);
  });
});

describe("GATE 4 — 210.30A- completo (payload final + segundo sync)", () => {
  it("payload final exato do CREATE e zero Product (mapper bloqueia PACKAGING_NOT_PRODUCT)", () => {
    const fixture = fixture21030A();
    // Lado Product: mapper continua bloqueando — 0 novos Products.
    const { eligible, blocked } = mapNomusProductsFromApiRows([fixture], new Set());
    assert.equal(eligible.length, 0);
    assert.ok(
      blocked.some(
        (b) => b.sku === "210.30A-" && b.reasons.includes("PACKAGING_NOT_PRODUCT")
      )
    );

    // Lado Material: CREATE com payload completo.
    const plan = planNomusNewMaterialRouting(detect([fixture]), EMPTY_MAPS);
    const d = decisionFor(plan.decisions, "210.30A-");
    assert.equal(d?.kind, "CREATE_MATERIAL");
    if (d?.kind !== "CREATE_MATERIAL") return;
    assert.deepEqual(d.payload, {
      code: "210.30A-",
      description: "CAIXA 258x248x560 Purificador",
      unit: "UNID",
      category: "NOMUS_IMPORT",
      currentCost: 0,
      averageCost: 0,
      standardCost: 0,
      freight: 0,
      standardLoss: 0,
      conversionFactor: 1,
      status: "ACTIVE",
    });
  });

  it("segundo sync (Material já criado): 0 novos Materials, 0 novos Products, 0 updates", () => {
    const afterFirstSync = buildCatalogEntityLookupMaps({
      materials: [{ id: "mat-21030a", code: "210.30A-", status: "ACTIVE" }],
      products: [],
    });
    const plan = planNomusNewMaterialRouting(detect([fixture21030A()]), afterFirstSync);
    assert.equal(plan.summary.materialCreateCount, 0);
    assert.equal(plan.summary.materialAlreadyExistingCount, 1);
    // Product: mapper segue bloqueando (nunca cria) — e o contrato do plano
    // não possui nenhuma decisão de UPDATE: custos manuais intocados.
    const { eligible } = mapNomusProductsFromApiRows([fixture21030A()], new Set());
    assert.equal(eligible.length, 0);
    assert.ok(plan.decisions.every((x) => x.kind !== ("UPDATE_MATERIAL" as never)));
  });
});

describe("nomusNewMaterialRouting — catálogo e observabilidade (T11)", () => {
  it("roteamento não interfere no catálogo: preview limitado e resumo com contadores", () => {
    const rows = [fixture21030A(), rawMaterialRow(), insumoRow(), finishedProductRow()];
    const plan = planNomusNewMaterialRouting(detect(rows), EMPTY_MAPS);
    assert.equal(plan.summary.materialCandidatesCount, 3); // acabado fica de fora
    assert.equal(plan.summary.materialCreateCount, 3);
    assert.ok(plan.preview.length <= 50);
    assert.ok(plan.preview.every((p) => p.target === "MATERIAL" || p.target === "SKIP"));
    const entry = plan.preview.find((p) => p.code === "210.30A-");
    assert.equal(entry?.description, "CAIXA 258x248x560 Purificador");
    assert.equal(entry?.target, "MATERIAL");
  });
});
