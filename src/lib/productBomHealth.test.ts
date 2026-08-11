/**
 * BOM_INACTIVE_COMPONENT — testes de domínio (1–13), integração de custo
 * (14–28, por wiring de código) e UI (29–36, por wiring de markup).
 * Caso motivador: 620.01 ACTIVE → 314.19AA INACTIVE.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  analyzeProductBomHealthFromGraph,
  buildBomHealthBlockMessage,
  formatBomHealthPath,
  matchesEngineeringHealthFilter,
  summarizeProductBomHealth,
  BOM_INACTIVE_COMPONENT_CODE,
  BOM_INACTIVE_COMPONENT_TITLE,
  type ProductBomGraphNode,
  type ProductBomHealthIssue,
} from "./productBomHealth.js";
import { filterProductEngineeringListItems } from "./productEngineeringListFilters.js";

function node(
  id: string,
  sku: string,
  status: string | null,
  childProductIds: string[] = [],
  name = `Produto ${sku}`
): [string, ProductBomGraphNode] {
  return [id, { id, sku, name, status, childProductIds }];
}

function graphOf(...nodes: Array<[string, ProductBomGraphNode]>) {
  return new Map(nodes);
}

describe("productBomHealth — domínio (T1–T13)", () => {
  it("T1: Product ACTIVE sem componente inativo → saudável", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]),
      node("b", "314.20AA", "ACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
  });

  it("T2: componente direto INACTIVE (caso real 620.01 → 314.19AA) → BOM_INACTIVE_COMPONENT", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE", [], "Boia Inferior")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 1);
    const issue = result.issues[0]!;
    assert.equal(issue.code, BOM_INACTIVE_COMPONENT_CODE);
    assert.equal(issue.severity, "BLOCKING");
    assert.equal(issue.productSku, "620.01");
    assert.equal(issue.componentSku, "314.19AA");
    assert.equal(issue.componentName, "Boia Inferior");
    assert.equal(issue.componentStatus, "INACTIVE");
    assert.equal(issue.level, 1);
  });

  it("T3: A → B ACTIVE → C INACTIVE → A recebe a pendência (recursivo)", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]),
      node("b", "314.20AA", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.componentSku, "314.19AA");
    assert.equal(result.issues[0]?.level, 2);
  });

  it("T4: path correto A → B → C", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]),
      node("b", "314.20AA", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(
      formatBomHealthPath(result.issues[0]!.path),
      "620.01 → 314.20AA → 314.19AA"
    );
  });

  it("T5: análise NUNCA altera status — pai continua ACTIVE no grafo (regra é diagnóstico puro)", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(graph.get("a")?.status, "ACTIVE");
    assert.equal(graph.get("c")?.status, "INACTIVE");
    // E o módulo puro não tem NENHUMA capacidade de escrita: sem import de
    // Prisma e sem chamadas .update(/.create( — diagnóstico é read-only.
    const src = readFileSync(join(process.cwd(), "src", "lib", "productBomHealth.ts"), "utf8");
    assert.doesNotMatch(src, /from "@prisma\/client"/);
    assert.doesNotMatch(src, /\.update\(|\.create\(/);
  });

  it("T6: dois componentes INACTIVE → ambos aparecem", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["c1", "c2"]),
      node("c1", "314.19AA", "INACTIVE"),
      node("c2", "315.77BB", "INACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.issues.length, 2);
    assert.deepEqual(
      result.issues.map((i) => i.componentSku).sort(),
      ["314.19AA", "315.77BB"]
    );
  });

  it("T7: componente INACTIVE alcançável por dois caminhos → determinístico, caminhos distintos reportados", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b1", "b2"]),
      node("b1", "400.01", "ACTIVE", ["c"]),
      node("b2", "400.02", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    const r1 = analyzeProductBomHealthFromGraph("a", graph);
    const r2 = analyzeProductBomHealthFromGraph("a", graph);
    assert.deepEqual(r1, r2); // determinístico
    assert.equal(r1.issues.length, 2); // dois caminhos reais e distintos
    const paths = r1.issues.map((i) => formatBomHealthPath(i.path)).sort();
    assert.deepEqual(paths, [
      "620.01 → 400.01 → 314.19AA",
      "620.01 → 400.02 → 314.19AA",
    ]);
  });

  it("T8: ciclo A → B → C → A não trava e ainda detecta inativo no ciclo", () => {
    const graph = graphOf(
      node("a", "A", "ACTIVE", ["b"]),
      node("b", "B", "ACTIVE", ["c"]),
      node("c", "C", "INACTIVE", ["a"])
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.componentSku, "C");
  });

  it("T8b: auto-ciclo direto não trava", () => {
    const graph = graphOf(node("a", "A", "ACTIVE", ["a"]));
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, true);
  });

  it("T9/T10/T11/T12/T13: linha fora da BOM efetiva não gera falso positivo (grafo espelha só o que o motor percorre)", () => {
    // CODE_CONFIRMED: ProductBOM local não tem versão/vigência/linha
    // inativa/opcional/substituto — a BOM efetiva do motor é o conjunto das
    // linhas ProductBOM. O grafo é montado EXATAMENTE dessas linhas
    // (loadProductBomGraph); nós não referenciados (histórico externo,
    // opcional não selecionado em outro domínio) simplesmente não entram.
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]), // "z" inativo existe mas NÃO está na BOM efetiva
      node("b", "314.20AA", "ACTIVE"),
      node("z", "999.99ZZ", "INACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
  });

  it("mensagem de bloqueio: componente + caminho quando indireto", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]),
      node("b", "314.20AA", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    const msg = buildBomHealthBlockMessage(analyzeProductBomHealthFromGraph("a", graph));
    assert.match(msg, /Composição contém componente inativo/);
    assert.match(msg, /314\.19AA/);
    assert.match(msg, /620\.01 → 314\.20AA → 314\.19AA/);
  });

  it("status null/legado conta como ATIVO (não inventa pendência)", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["b"]),
      node("b", "314.20AA", null)
    );
    assert.equal(analyzeProductBomHealthFromGraph("a", graph).ok, true);
  });
});

function issueFixture(overrides: Partial<ProductBomHealthIssue> = {}): ProductBomHealthIssue {
  return {
    code: BOM_INACTIVE_COMPONENT_CODE,
    severity: "BLOCKING",
    productId: "a",
    productSku: "620.01",
    componentId: "c",
    componentSku: "314.19AA",
    componentName: "Boia Inferior",
    componentStatus: "INACTIVE",
    level: 1,
    path: [
      { productId: "a", sku: "620.01" },
      { productId: "c", sku: "314.19AA" },
    ],
    ...overrides,
  };
}

describe("engineeringHealth — resumo para o grid (backend resolve, UI apresenta)", () => {
  it("G1: produto saudável → status OK, contadores zerados", () => {
    const s = summarizeProductBomHealth([]);
    assert.deepEqual(s, {
      status: "OK",
      issueCount: 0,
      blockingCount: 0,
      warningCount: 0,
      primaryIssueCode: null,
    });
  });

  it("G2/G3/G4/G6: BOM_INACTIVE_COMPONENT → BLOCKED com counts e primaryIssue coerentes", () => {
    const s = summarizeProductBomHealth([issueFixture()]);
    assert.equal(s.status, "BLOCKED");
    assert.equal(s.issueCount, 1);
    assert.equal(s.blockingCount, 1);
    assert.equal(s.warningCount, 0);
    assert.equal(s.primaryIssueCode, BOM_INACTIVE_COMPONENT_CODE);
  });

  it("G5/G7: múltiplos issues (BLOCKING + futuro WARNING) → BLOCKED tem prioridade; todos contados", () => {
    const warning = issueFixture({
      componentId: "w",
      componentSku: "999.01",
      severity: "WARNING" as ProductBomHealthIssue["severity"],
      code: "FUTURE_WARNING" as typeof BOM_INACTIVE_COMPONENT_CODE,
    });
    const s = summarizeProductBomHealth([warning, issueFixture()]);
    assert.equal(s.status, "BLOCKED"); // BLOCKED > WARNING > OK
    assert.equal(s.issueCount, 2);
    assert.equal(s.blockingCount, 1);
    assert.equal(s.warningCount, 1);
    assert.equal(s.primaryIssueCode, BOM_INACTIVE_COMPONENT_CODE); // BLOCKING primeiro

    const onlyWarning = summarizeProductBomHealth([warning]);
    assert.equal(onlyWarning.status, "WARNING");
  });

  it("summary embutido no resultado da análise (single e batch compartilham a mesma fonte)", () => {
    const graph = graphOf(
      node("a", "620.01", "ACTIVE", ["c"]),
      node("c", "314.19AA", "INACTIVE")
    );
    const result = analyzeProductBomHealthFromGraph("a", graph);
    assert.equal(result.summary.status, "BLOCKED");
    assert.equal(result.summary.issueCount, 1);
    const healthy = analyzeProductBomHealthFromGraph(
      "a",
      graphOf(node("a", "620.01", "ACTIVE", []))
    );
    assert.equal(healthy.summary.status, "OK");
  });

  it("G12–G15: filtros OK/HAS_ISSUES/BLOCKED/WARNING", () => {
    const ok = summarizeProductBomHealth([]);
    const blocked = summarizeProductBomHealth([issueFixture()]);
    assert.equal(matchesEngineeringHealthFilter(ok, "OK"), true);
    assert.equal(matchesEngineeringHealthFilter(blocked, "OK"), false);
    assert.equal(matchesEngineeringHealthFilter(blocked, "HAS_ISSUES"), true);
    assert.equal(matchesEngineeringHealthFilter(ok, "HAS_ISSUES"), false);
    assert.equal(matchesEngineeringHealthFilter(blocked, "BLOCKED"), true);
    assert.equal(matchesEngineeringHealthFilter(blocked, "WARNING"), false);
    assert.equal(matchesEngineeringHealthFilter(ok, ""), true);
  });

  it("G17: health indisponível NUNCA vira OK — só passa em 'Todos' (erro não mascara pendência)", () => {
    assert.equal(matchesEngineeringHealthFilter(null, ""), true);
    assert.equal(matchesEngineeringHealthFilter(undefined, ""), true);
    assert.equal(matchesEngineeringHealthFilter(null, "OK"), false);
    assert.equal(matchesEngineeringHealthFilter(null, "HAS_ISSUES"), false);
    assert.equal(matchesEngineeringHealthFilter(null, "BLOCKED"), false);
  });

  it("G16: filtro combinado com busca por SKU no pipeline real da lista", () => {
    const blocked = summarizeProductBomHealth([issueFixture()]);
    const ok = summarizeProductBomHealth([]);
    const items = [
      { name: "Produto A", sku: "620.01", status: "ACTIVE", engineeringHealth: blocked },
      { name: "Produto B", sku: "620.02", status: "ACTIVE", engineeringHealth: ok },
      { name: "Outro", sku: "700.01", status: "ACTIVE", engineeringHealth: blocked },
    ];
    const out = filterProductEngineeringListItems(items, {
      search: "620",
      status: "",
      engineering: "BLOCKED",
    });
    assert.deepEqual(out.map((i) => i.sku), ["620.01"]);
    // G9/G10/G11: busca e status continuam funcionando com o filtro novo vazio.
    const plain = filterProductEngineeringListItems(items, { search: "620", status: "ACTIVE" });
    assert.equal(plain.length, 2);
  });
});

describe("productBomHealth — integração custo (T14–T28, wiring)", () => {
  const snapshotSrc = () =>
    readFileSync(
      join(process.cwd(), "src", "lib", "productEngineeringCostSnapshot.server.ts"),
      "utf8"
    );
  const publicationSrc = () =>
    readFileSync(
      join(process.cwd(), "src", "lib", "productionCostPublication.server.ts"),
      "utf8"
    );

  it("T15/T16/T17: snapshot individual valida a BOM ANTES de criar rascunho e retorna código estruturado", () => {
    const src = snapshotSrc();
    const gateIdx = src.indexOf("analyzeProductBomHealth(db, input.productId)");
    const draftIdx = src.indexOf("createProductionCostTableDraft(db,");
    assert.ok(gateIdx > 0, "gate de saúde existe no snapshot individual");
    assert.ok(draftIdx > 0, "criação de draft existe");
    assert.ok(gateIdx < draftIdx, "gate roda ANTES da criação do draft (sem lixo)");
    assert.match(src, /status: "BOM_INACTIVE_COMPONENT"/);
    assert.match(src, /bomHealthIssues: bomHealth\.issues/);
    assert.match(src, /buildBomHealthBlockMessage\(bomHealth\)/);
  });

  it("T14/T18/T19/T20: fluxo saudável preservado — gate só interrompe quando !ok; nenhum update de histórico", () => {
    const src = snapshotSrc();
    assert.match(src, /if \(!bomHealth\.ok\) \{/);
    // Histórico: o arquivo continua sem qualquer update de version/item publicada.
    assert.doesNotMatch(src, /productionCostTableItem\.update/);
    assert.doesNotMatch(src, /productionCostTableVersion\.update\(\s*\{\s*where[\s\S]{0,80}PUBLISHED/);
  });

  it("T21–T27: geração consolidada usa análise em LOTE, pula com código+SKU+mensagem e segue os demais", () => {
    const src = publicationSrc();
    assert.match(src, /analyzeProductsBomHealthBatch\(\s*db,\s*selectedProducts\.map\(\(p\) => p\.id\)\s*\)/);
    assert.match(src, /code: BOM_INACTIVE_COMPONENT_CODE/);
    assert.match(src, /summary\.itemsSkipped \+= 1;[\s\S]{0,400}buildBomHealthBlockMessage\(bomHealth\)/);
    // continue → demais produtos seguem no laço (T27/T28).
    const skipBlock = src.slice(src.indexOf("code: BOM_INACTIVE_COMPONENT_CODE"), src.indexOf("code: BOM_INACTIVE_COMPONENT_CODE") + 400);
    assert.match(skipBlock, /continue;/);
  });

  it("T28: loader é batch (uma query por nível de profundidade) — sem N+1 por produto", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "productBomHealth.server.ts"),
      "utf8"
    );
    assert.match(src, /while \(frontier\.length > 0/);
    assert.match(src, /id: \{ in: frontier \}/);
    // Nenhum findUnique/findFirst por item.
    assert.doesNotMatch(src, /findUnique|findFirst/);
  });
});

describe("productBomHealth — UI (T29–T36, wiring)", () => {
  const page = () =>
    readFileSync(join(process.cwd(), "src", "components", "ProductModule.tsx"), "utf8");

  it("T29/T30: ProductModule mostra alerta com o título oficial", () => {
    const src = page();
    assert.match(src, /bom-inactive-component-alert/);
    assert.match(src, /BOM_INACTIVE_COMPONENT_TITLE/);
    assert.equal(BOM_INACTIVE_COMPONENT_TITLE, "Composição contém componente inativo");
  });

  it("T31/T32/T33: alerta identifica SKU/nome, status Inativo e caminho para nível indireto", () => {
    const src = page();
    assert.match(src, /issue\.componentSku\} — \{issue\.componentName/);
    assert.match(src, /Status: Inativo/);
    assert.match(src, /formatBomHealthPath\(issue\.path\)/);
  });

  it("T34: linha da BOM (opção salva) recebe indicador INATIVO", () => {
    const src = page();
    assert.match(src, /INATIVO/);
    assert.match(src, /child\.status \?\? "ACTIVE"/);
  });

  it("T35: alerta só renderiza quando health !ok (produto saudável não mostra)", () => {
    const src = page();
    assert.match(src, /bomHealth && !bomHealth\.ok \? bomHealth\.issues : \[\]/);
    assert.match(src, /bomIssues\.length > 0 \?/);
  });

  it("T36: clique em Atualizar snapshot com BOM inválida mostra o diagnóstico (não sugere que snapshot resolve)", () => {
    const src = page();
    assert.match(src, /result\.status === "BOM_INACTIVE_COMPONENT"/);
    assert.match(src, /NÃO resolve componente/);
  });

  it("F18–F20/F32/F33: coluna Engenharia — OK, contador de pendências, texto além de cor, compacta", () => {
    const src = page();
    assert.match(src, />Engenharia<\/th>/);
    assert.match(src, /✅ OK/);
    assert.match(src, /pendência/); // texto sempre presente (não só cor)
    assert.match(src, /atenção/);
    assert.match(src, /summary\.issueCount > 1 \? "s" : ""/); // plural correto
    assert.match(src, /engineering-health-badge-/);
  });

  it("F21–F26: clique abre painel 'Pendências de engenharia' com SKU, nome, status e caminho", () => {
    const src = page();
    assert.match(src, /Pendências de engenharia/);
    assert.match(src, /setOpenHealthDetailId\(isOpen \? null : item\.id\)/); // clique, não hover
    assert.match(src, /engineering-health-details-/);
    assert.match(src, /Ver composição/);
    assert.match(src, /aria-expanded=\{isOpen\}/);
  });

  it("F27–F30: filtro de Engenharia no pipeline aplicado (com busca/status) e nas opções da UI", () => {
    const src = page();
    assert.match(src, /engineering: appliedEngineeringFilter/);
    assert.match(src, /Sem pendências<\/option>/);
    assert.match(src, /Com pendências<\/option>/);
    assert.match(src, /Bloqueantes<\/option>/);
    assert.match(src, /Atenção<\/option>/);
    assert.match(src, /products-engineering-filter/);
  });

  it("F-indisponível: health ausente mostra 'Não disponível' — nunca vira OK", () => {
    const src = page();
    assert.match(src, /— Não disponível/);
    assert.match(src, /engineering-health-unavailable-/);
  });

  it("F-status: coluna Engenharia é INDEPENDENTE do Product.status (badge Ativo/Inativo intacto)", () => {
    const src = page();
    assert.match(src, /item\.status === "ACTIVE" \? "Ativo" : "Inativo"/);
    // Saúde vem do backend; nenhuma decisão de negócio no front:
    assert.match(src, /bomHealthByProductId\[item\.id\]\?\.summary \?\? null/);
    assert.doesNotMatch(src, /ChildProduct[\s\S]{0,40}status === "INACTIVE"[\s\S]{0,80}BLOCKED/);
  });

  it("backend expõe endpoints read-only (single + batch) para a regra", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /"\/api\/products\/:id\/bom-health"/);
    assert.match(server, /"\/api\/products\/bom-health-batch"/);
    assert.match(server, /analyzeProductsBomHealthBatch\(prisma, ids\)/);
  });
});
