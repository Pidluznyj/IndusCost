import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  abbreviateInventoryFamily,
  proposeInventoryItemCode,
  resolveInventoryItemCodeSequence,
  resolveInventoryItemTypeCodePrefix,
  suggestNextInventoryItemCode,
} from "./inventoryItemCodeSequence.js";
import {
  buildInventoryItemsOrderBy,
  parseInventoryItemsListQuery,
  sortInventoryItemsByTypeLabel,
} from "./inventoryListQuery.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryItemCodeSequence", () => {
  it("próximo código é o maior número + 1, preservando zeros à esquerda", () => {
    const s = suggestNextInventoryItemCode(["ADM-0001", "ADM-0041", "ADM-0007"]);
    assert.equal(s?.code, "ADM-0042");
    assert.equal(s?.lastCode, "ADM-0041");
  });

  it("não pula número: lacunas antigas não alteram a continuação da sequência", () => {
    assert.equal(suggestNextInventoryItemCode(["EPI-001", "EPI-003"])?.code, "EPI-004");
  });

  it("cresce a largura quando o número estoura o preenchimento", () => {
    assert.equal(suggestNextInventoryItemCode(["PA-98", "PA-99"])?.code, "PA-100");
  });

  it("usa a série com mais itens do tipo e ignora códigos fora do padrão", () => {
    const s = suggestNextInventoryItemCode(["FER-010", "FER-011", "X-900", "AVULSO", "fer-012"]);
    assert.equal(s?.code, "fer-013");
    assert.equal(s?.seriesCount, 3);
  });

  it("código só numérico continua a sequência sem prefixo", () => {
    assert.equal(suggestNextInventoryItemCode(["1001", "1002"])?.code, "1003");
  });

  it("desvia de código já usado por outro tipo (unicidade global, sem diferenciar caixa)", () => {
    const s = suggestNextInventoryItemCode(["MAN-001", "MAN-002"], ["man-003", "MAN-004"]);
    assert.equal(s?.code, "MAN-005");
  });

  it("sem sequência numérica no tipo não sugere nada", () => {
    assert.equal(suggestNextInventoryItemCode([]), null);
    assert.equal(suggestNextInventoryItemCode(["AVULSO", "PARAFUSO-M8-A"]), null);
    assert.equal(resolveInventoryItemCodeSequence(["7891234567890"]), null);
  });
});

describe("inventoryItemCodeSequence — tipo + família", () => {
  const adm = [
    { code: "ADM-0001", family: null },
    { code: "ADM-0002", family: null },
    { code: "ADM-INF-0001", family: "Informática" },
    { code: "ADM-INF-0002", family: "Informática" },
    { code: "ADM-0003", family: "Limpeza" },
  ];
  const propose = (family: string | null, typeItems = adm, extraCodes: string[] = []) =>
    proposeInventoryItemCode({
      itemType: "ADMINISTRATIVE_SUPPLY",
      family,
      typeItems,
      allCodes: [...typeItems.map((i) => i.code), ...extraCodes],
    });

  it("sigla da família: 3 primeiras letras, sem acento", () => {
    assert.equal(abbreviateInventoryFamily("Papelaria"), "PAP");
    assert.equal(abbreviateInventoryFamily(" informática "), "INF");
    assert.equal(abbreviateInventoryFamily("Água e café"), "AGU");
    assert.equal(abbreviateInventoryFamily("  "), "");
  });

  it("família com série própria continua a sequência dela (sem diferenciar caixa)", () => {
    const p = propose("informática");
    assert.equal(p.code, "ADM-INF-0003");
    assert.equal(p.lastCode, "ADM-INF-0002");
  });

  it("família nova inaugura TIPO-FAM-0001 com a sigla do tipo já em uso", () => {
    const p = propose("Papelaria");
    assert.equal(p.code, "ADM-PAP-0001");
    assert.equal(p.lastCode, null);
  });

  it("família com itens só no padrão antigo (TIPO-NNNN) passa a usar TIPO-FAM-NNNN", () => {
    assert.equal(propose("Limpeza").code, "ADM-LIM-0001");
  });

  it("sem família segue a série TIPO-NNNN, ignorando as séries por família", () => {
    const p = propose(null);
    assert.equal(p.code, "ADM-0004");
    assert.equal(p.lastCode, "ADM-0003");
  });

  it("tipo sem nenhum código usa a sigla padrão do tipo", () => {
    assert.equal(propose("Papelaria", []).code, "ADM-PAP-0001");
    assert.equal(propose(null, []).code, "ADM-0001");
    assert.equal(resolveInventoryItemTypeCodePrefix("PPE", []), "EPI");
    assert.equal(resolveInventoryItemTypeCodePrefix("PPE", ["SEG-001", "SEG-002", "X-1"]), "SEG");
  });

  it("sigla já usada por outra família/tipo continua a mesma numeração, sem duplicar código", () => {
    const p = propose("Papéis especiais", adm, ["ADM-PAP-0001", "adm-pap-0002"]);
    assert.equal(p.code, "adm-pap-0003");
  });
});

describe("inventory items — ordenação da listagem", () => {
  it("padrão é código crescente e parâmetros inválidos caem no padrão", () => {
    const q = parseInventoryItemsListQuery({ sortBy: "password", sortDir: "sideways" });
    assert.equal(q.sortBy, "code");
    assert.equal(q.sortDir, "asc");
    assert.deepEqual(buildInventoryItemsOrderBy(q.sortBy, q.sortDir), [{ code: "asc" }]);
  });

  it("coluna escolhida ordena com código como desempate", () => {
    const q = parseInventoryItemsListQuery({ sortBy: "description", sortDir: "desc" });
    assert.deepEqual(buildInventoryItemsOrderBy(q.sortBy, q.sortDir), [
      { description: "desc" },
      { code: "asc" },
    ]);
    assert.deepEqual(buildInventoryItemsOrderBy("code", "desc"), [{ code: "desc" }]);
  });

  it("família vazia fica no fim nas duas direções", () => {
    assert.deepEqual(buildInventoryItemsOrderBy("family", "desc"), [
      { family: { sort: "desc", nulls: "last" } },
      { code: "asc" },
    ]);
  });

  it("tipo ordena pelo rótulo exibido, mantendo a ordem de código dentro do tipo", () => {
    const rows = [
      { code: "A1", itemType: "OTHER" },
      { code: "B1", itemType: "PPE" },
      { code: "B2", itemType: "PPE" },
      { code: "C1", itemType: "COMPONENT" },
    ];
    assert.deepEqual(
      sortInventoryItemsByTypeLabel(rows, "asc").map((r) => r.code),
      ["C1", "B1", "B2", "A1"]
    );
    assert.deepEqual(
      sortInventoryItemsByTypeLabel(rows, "desc").map((r) => r.code),
      ["A1", "B1", "B2", "C1"]
    );
  });

  it("rota next-code é registrada antes de /items/:id e exige permissão de cadastro", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    const nextCode = routes.indexOf('app.get("/api/inventory/items/next-code", ...itemManage');
    const byId = routes.indexOf('app.get("/api/inventory/items/:id"');
    assert.ok(nextCode > 0, "rota next-code ausente");
    assert.ok(nextCode < byId, "next-code deve vir antes de /items/:id");
    const families = routes.indexOf('app.get("/api/inventory/items/families", ...view');
    assert.ok(families > 0 && families < byId, "families deve vir antes de /items/:id");
  });

  it("grid envia a ordenação e a ficha consulta o próximo código ao escolher o tipo", () => {
    const tab = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(tab, /q\.set\("sortBy", sortBy\)/);
    assert.match(tab, /aria-sort/);
    const sheet = read("src/components/inventory/InventoryItemDetailSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/items\/next-code\?/);
    assert.match(sheet, /query\.set\("family", debouncedFamily\)/);
    assert.match(sheet, /\/api\/inventory\/items\/families/);
  });
});
