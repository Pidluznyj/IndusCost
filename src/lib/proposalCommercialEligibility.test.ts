/**
 * Elegibilidade comercial das propostas — sem banco real.
 * Banco simulado com um avaliador dos predicados Prisma usados (AND/OR/NOT, relações some/none/is/isNot,
 * comparações, contains) seguindo a semântica do SQL para NULL. Cenário: teste_bi 29/10/2026
 * (CP 01818–01822 zeradas sem itens, CP 01823 de R$ 42.900,00).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROPOSAL_COMMERCIAL_METRICS_WHERE,
  PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE,
  PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE,
  andProposalWhere,
  classifyProposalCommercialEligibility,
} from "./proposalCommercialEligibility.js";
import { loadProposalConversionYtd } from "./proposalConversionYtd.server.js";
import { summarizeProposalIntegrationQuality } from "./proposalIntegrationQuality.js";
import { loadProposalIntegrationQuality } from "./proposalIntegrationQuality.server.js";
import { buildProposalListWheres, loadProposalListPage, type ProposalListFilters } from "./proposalListPage.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const NOW = new Date("2026-10-29T15:00:00.000Z");

type Row = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  responsible: string | null;
  customerId: string;
  sourceSystem: string | null;
  externalProposalCode: string | null;
  totalNetValue: number;
  totalGrossValue: number;
  commercialDate: Date;
  updatedAt: Date;
  externalRawPayload: unknown;
  Customer: { id: string; companyName: string; tradeName: string | null; taxId: string | null };
  items: Array<{ id: string }>;
  salesOrder: { id: string; orderCode: string; status: string } | null;
};

const JAIRO = { id: "c-jairo", companyName: "JAIRO M AVELINO LTDA", tradeName: null, taxId: "11222333000181" };
const ACME = { id: "c-acme", companyName: "ACME INDUSTRIA", tradeName: "ACME", taxId: "44555666000199" };

let seq = 0;
function proposal(partial: Partial<Row> & { totalNetValue: number }): Row {
  seq += 1;
  return {
    id: `p-${seq}`,
    number: seq,
    title: null,
    status: "SENT",
    responsible: "Vendedor A",
    customerId: ACME.id,
    sourceSystem: "NOMUS",
    externalProposalCode: `CP ${String(seq).padStart(5, "0")}`,
    totalGrossValue: partial.totalNetValue,
    commercialDate: new Date(Date.UTC(2026, 9, Math.min(28, 1 + (seq % 28)), 12)),
    updatedAt: NOW,
    externalRawPayload: { valorTotal: String(partial.totalNetValue), itensProposta: [] },
    Customer: ACME,
    items: [],
    salesOrder: null,
    ...partial,
  };
}

/** CP 01818–01822 do teste_bi: valorTotal 0, valorTotalNfe 42.900, itensProposta vazio. */
function jairoZero(code: string): Row {
  return proposal({
    externalProposalCode: code,
    customerId: JAIRO.id,
    Customer: JAIRO,
    totalNetValue: 0,
    totalGrossValue: 42900,
    externalRawPayload: { valorTotal: "0,00", valorTotalNfe: "42.900,00", itensProposta: [] },
  });
}

// ---------- avaliador dos predicados Prisma (semântica SQL para NULL) ----------
type Where = Record<string, unknown>;
const RELATIONS = new Set(["items", "salesOrder", "Customer"]);

function compareScalar(value: unknown, filter: unknown): boolean {
  if (filter === null) return value === null || value === undefined;
  if (filter instanceof Date || typeof filter !== "object") {
    if (value === null || value === undefined) return false;
    return value instanceof Date ? value.getTime() === (filter as Date).getTime?.() : value === filter;
  }
  const f = filter as Record<string, unknown>;
  if (value === null || value === undefined) return false; // NULL nunca passa em comparação SQL
  const num = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Number(v));
  const insensitive = f.mode === "insensitive";
  for (const [op, arg] of Object.entries(f)) {
    if (op === "mode") continue;
    if (op === "equals" && !compareScalar(value, arg)) return false;
    if (op === "not" && (arg === null ? false : compareScalar(value, arg))) return false;
    if (op === "gt" && !(num(value) > num(arg))) return false;
    if (op === "gte" && !(num(value) >= num(arg))) return false;
    if (op === "lt" && !(num(value) < num(arg))) return false;
    if (op === "lte" && !(num(value) <= num(arg))) return false;
    if (op === "in" && !(arg as unknown[]).includes(value)) return false;
    if (op === "contains") {
      const hay = String(value);
      const needle = String(arg);
      if (!(insensitive ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle))) return false;
    }
  }
  return true;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((part) => matches(row, part as Where))) return false;
    } else if (key === "OR") {
      if (!(cond as Where[]).some((part) => matches(row, part))) return false;
    } else if (key === "NOT") {
      if ((Array.isArray(cond) ? cond : [cond]).some((part) => matches(row, part as Where))) return false;
    } else if (RELATIONS.has(key)) {
      const c = cond as Record<string, unknown>;
      if (key === "items") {
        if ("some" in c && row.items.length === 0) return false;
        if ("none" in c && row.items.length > 0) return false;
      } else if (key === "salesOrder") {
        if ("is" in c && c.is === null && row.salesOrder !== null) return false;
        if ("isNot" in c && c.isNot === null && row.salesOrder === null) return false;
      } else if (key === "Customer") {
        for (const [field, filter] of Object.entries(c)) {
          if (!compareScalar((row.Customer as Record<string, unknown>)[field], filter)) return false;
        }
      }
    } else if (!compareScalar((row as Record<string, unknown>)[key], cond)) {
      return false;
    }
  }
  return true;
}

function createStore(initial: Row[]) {
  const rows = initial;
  const writes: string[] = [];
  const order = (list: Row[]) =>
    [...list].sort((a, b) => b.commercialDate.getTime() - a.commercialDate.getTime() || b.number - a.number);
  const shape = (row: Row) => ({ ...row, _count: { items: row.items.length } });
  const proposalModel = {
    findMany: async (args: { where?: Where; skip?: number; take?: number } = {}) => {
      const list = order(rows.filter((row) => matches(row, args.where)));
      const skip = args.skip ?? 0;
      return list.slice(skip, args.take != null ? skip + args.take : undefined).map(shape);
    },
    count: async (args: { where?: Where } = {}) => rows.filter((row) => matches(row, args.where)).length,
    aggregate: async (args: { where?: Where }) => {
      const list = rows.filter((row) => matches(row, args.where));
      return {
        _count: { id: list.length },
        _sum: {
          totalNetValue: list.reduce((sum, row) => sum + row.totalNetValue, 0),
          totalGrossValue: list.reduce((sum, row) => sum + row.totalGrossValue, 0),
        },
      };
    },
    update: async () => {
      writes.push("proposal.update");
      throw new Error("a leitura não grava");
    },
  };
  return { db: { proposal: proposalModel }, rows, writes };
}

function filters(partial: Partial<ProposalListFilters> = {}): ProposalListFilters {
  return {
    search: "",
    status: null,
    responsible: "",
    customerId: "",
    startDate: null,
    endDate: null,
    minNetValue: null,
    maxNetValue: null,
    includeWithoutCommercialValue: false,
    ...partial,
  };
}

async function listAll(store: ReturnType<typeof createStore>, f = filters()) {
  return loadProposalListPage(store.db as never, { filters: f, page: 1, pageSize: 200, now: NOW });
}

function testBiScenario() {
  seq = 1800;
  const hidden = ["CP 01818", "CP 01819", "CP 01820", "CP 01821", "CP 01822"].map(jairoZero);
  const cp01823 = proposal({
    externalProposalCode: "CP 01823",
    customerId: JAIRO.id,
    Customer: JAIRO,
    totalNetValue: 42900,
    totalGrossValue: 42900,
    items: [{ id: "i1" }],
  });
  const won = proposal({ totalNetValue: 10000, items: [{ id: "i2" }], salesOrder: { id: "so1", orderCode: "PV 900", status: "OPEN" } });
  const lost = proposal({ totalNetValue: 5000, status: "REJECTED", items: [{ id: "i3" }] });
  return { hidden, cp01823, won, lost, store: createStore([...hidden, cp01823, won, lost]) };
}

describe("propostas › regra central de elegibilidade", () => {
  it("1. Nomus zerada, sem itens e sem pedido: oculta e fora dos indicadores", async () => {
    const { store, hidden } = testBiScenario();
    const page = await listAll(store);
    for (const row of hidden) assert.ok(!page.rows.some((item) => item.id === row.id), String(row.externalProposalCode));
    assert.equal(page.summary.hiddenWithoutCommercialValueCount, 5);
    const facts = classifyProposalCommercialEligibility({ sourceSystem: "NOMUS", totalNetValue: "0", mappedItemCount: 0, hasSalesOrder: false });
    assert.deepEqual([facts.visibleByDefault, facts.countsInCommercialMetrics], [false, false]);
  });

  it("2. Nomus válida continua visível (CP 01823, R$ 42.900,00)", async () => {
    const { store, cp01823 } = testBiScenario();
    const page = await listAll(store);
    const row = page.rows.find((item) => item.id === cp01823.id) as { commercialEligibility: { commercialClass: string; label: string | null } };
    assert.ok(row);
    assert.equal(row.commercialEligibility.commercialClass, "EFFECTIVE");
    assert.equal(row.commercialEligibility.label, null);
  });

  it("3. proposta local em elaboração sem valor fica no grid, fora dos indicadores", async () => {
    const local = proposal({ sourceSystem: null, status: "DRAFT", totalNetValue: 0, externalProposalCode: null });
    const localNamed = proposal({ sourceSystem: "INDUSCOST", status: "DRAFT", totalNetValue: 0, externalProposalCode: null });
    const store = createStore([local, localNamed, proposal({ totalNetValue: 100 })]);
    const page = await listAll(store);
    assert.ok(page.rows.some((row) => row.id === local.id), "origem nula não some (NOT sobre NULL)");
    assert.ok(page.rows.some((row) => row.id === localNamed.id));
    assert.equal(page.summary.totalProposals, 1);
    const row = page.rows.find((item) => item.id === local.id) as { commercialEligibility: { commercialClass: string } };
    assert.equal(row.commercialEligibility.commercialClass, "LOCAL_WITHOUT_VALUE");
  });

  it("4. zerada com pedido vinculado é preservada para análise (e conta como convertida)", async () => {
    const zeroWithOrder = proposal({ totalNetValue: 0, salesOrder: { id: "so9", orderCode: "PV 1", status: "OPEN" } });
    const store = createStore([zeroWithOrder]);
    const page = await listAll(store);
    const row = page.rows[0] as { id: string; commercialEligibility: { commercialClass: string; label: string } };
    assert.equal(row.id, zeroWithOrder.id);
    assert.equal(row.commercialEligibility.commercialClass, "ZERO_WITH_SALES_ORDER");
    assert.match(row.commercialEligibility.label, /revisar/);
    assert.equal(page.summary.convertedProposalsCount, 1);
  });

  it("5. zerada com itens mapeados é anomalia visível, não oculta automaticamente", async () => {
    const anomaly = proposal({ totalNetValue: 0, items: [{ id: "x" }] });
    const store = createStore([anomaly, proposal({ totalNetValue: 300 })]);
    const page = await listAll(store);
    const row = page.rows.find((item) => item.id === anomaly.id) as { commercialEligibility: { commercialClass: string } };
    assert.equal(row.commercialEligibility.commercialClass, "NOMUS_ZERO_WITH_ITEMS");
    assert.equal(page.summary.hiddenWithoutCommercialValueCount, 0);
    assert.equal(page.summary.totalProposals, 1, "fora do ticket e da conversão");
  });

  it("6. filtro administrativo mostra as ocultas sem mudar os indicadores", async () => {
    const { store, hidden } = testBiScenario();
    const normal = await listAll(store);
    const admin = await listAll(store, filters({ includeWithoutCommercialValue: true }));
    assert.equal(admin.total, normal.total + hidden.length);
    for (const row of hidden) {
      const shown = admin.rows.find((item) => item.id === row.id) as { commercialEligibility: { label: string } };
      assert.equal(shown.commercialEligibility.label, "Sem valor comercial (Nomus)");
    }
    assert.deepEqual({ ...admin.summary, hiddenWithoutCommercialValueCount: 0 }, { ...normal.summary, hiddenWithoutCommercialValueCount: 0 });
    assert.equal(admin.summary.hiddenWithoutCommercialValueCount, 0);
  });

  it("7. paginação no banco: nenhuma página vazia nem curta no meio, total certo", async () => {
    seq = 0;
    const rows: Row[] = [];
    for (let i = 0; i < 45; i += 1) rows.push(i % 3 === 0 ? jairoZero(`CP Z${i}`) : proposal({ totalNetValue: 100 + i }));
    const store = createStore(rows);
    const visible = rows.filter((row) => !(row.totalNetValue <= 0)).length;
    const first = await loadProposalListPage(store.db as never, { filters: filters(), page: 1, pageSize: 10, now: NOW });
    assert.equal(first.total, visible);
    const seen = new Set<string>();
    for (let page = 1; page <= first.totalPages; page += 1) {
      const result = await loadProposalListPage(store.db as never, { filters: filters(), page, pageSize: 10, now: NOW });
      const expected = page < first.totalPages ? 10 : visible - 10 * (first.totalPages - 1);
      assert.equal(result.rows.length, expected, `página ${page}`);
      for (const row of result.rows) seen.add(String(row.id));
    }
    assert.equal(seen.size, visible, "sem repetição nem buraco entre páginas");
  });

  it("8. totalizadores batem com as consultas do banco", async () => {
    const { store } = testBiScenario();
    const page = await listAll(store);
    const eligible = store.rows.filter((row) => row.totalNetValue > 0 || row.salesOrder);
    assert.equal(page.summary.totalProposals, eligible.length);
    assert.equal(page.summary.totalNetAmount, eligible.reduce((sum, row) => sum + row.totalNetValue, 0));
    const wheres = buildProposalListWheres(filters(), NOW);
    assert.equal(page.summary.totalProposals, await store.db.proposal.count({ where: wheres.metricsWhere as Where }));
    assert.equal(page.total, await store.db.proposal.count({ where: wheres.gridWhere as Where }));
    assert.equal(
      page.total + page.summary.hiddenWithoutCommercialValueCount,
      store.rows.length,
      "grid padrão + ocultas = todas"
    );
  });

  it("9. ticket médio e conversão excluem as propostas sem elegibilidade", async () => {
    const { store } = testBiScenario();
    const page = await listAll(store);
    assert.equal(page.summary.totalProposals, 3);
    assert.equal(page.summary.averageNetValue, (42900 + 10000 + 5000) / 3);
    assert.equal(page.summary.convertedProposalsCount, 1);
    assert.equal(page.summary.conversionRate, (1 / 3) * 100);
    // Antes da correção: 8 propostas, ticket (57.900 / 8) e conversão 12,5%.
    assert.notEqual(page.summary.conversionRate, (1 / 8) * 100);
  });

  it("10. gráfico YTD usa a mesma população dos cards", async () => {
    const { store } = testBiScenario();
    const ytd = await loadProposalConversionYtd(store.db as never, NOW);
    const october = ytd.months.find((month) => month.month === 10)!;
    const page = await listAll(store, filters({ startDate: new Date(Date.UTC(2026, 9, 1, 3)), endDate: new Date(Date.UTC(2026, 10, 1, 2, 59)) }));
    assert.equal(october.totalCount, page.summary.totalProposals);
    assert.equal(october.convertedCount, page.summary.convertedProposalsCount);
    const source = readFileSync(join(here, "proposalConversionYtd.server.ts"), "utf8");
    assert.match(source, /PROPOSAL_COMMERCIAL_METRICS_WHERE/);
  });

  it("11. bruto positivo com líquido zero não cria valor nem faturamento fictício", async () => {
    const { store } = testBiScenario();
    const page = await listAll(store);
    assert.equal(page.summary.totalGrossAmount, 42900 + 10000 + 5000, "os 5 × 42.900 brutos ficam fora");
    const facts = classifyProposalCommercialEligibility({ sourceSystem: "NOMUS", totalNetValue: 0, mappedItemCount: 0, hasSalesOrder: false });
    assert.equal(facts.countsInCommercialMetrics, false);
    const sync = readFileSync(join(ROOT, "scripts", "nomusProposalsSyncV1.ts"), "utf8");
    assert.match(sync, /const totalNetValue = parseNomusPtBrNumber\(proposal\.valorTotal\);/);
    assert.doesNotMatch(sync, /totalNetValue\s*=\s*[^;]*valorTotalNfe/);
  });

  it("12. nova sincronização não traz as ocultas de volta (a regra é recalculada na leitura)", async () => {
    const { store, hidden } = testBiScenario();
    for (const row of hidden) {
      row.updatedAt = new Date(NOW.getTime() + 3_600_000);
      row.externalRawPayload = { ...(row.externalRawPayload as object), sincronizadoDeNovo: true };
    }
    const page = await listAll(store);
    for (const row of hidden) assert.ok(!page.rows.some((item) => item.id === row.id));
    const sync = readFileSync(join(ROOT, "scripts", "nomusProposalsSyncV1.ts"), "utf8");
    assert.doesNotMatch(sync, /proposalCommercialEligibility|deleteMany\(\{\s*where:\s*\{\s*totalNetValue/);
    // Se o Nomus passar a mandar valor, a proposta volta sozinha — sem script.
    hidden[0]!.totalNetValue = 1000;
    assert.ok((await listAll(store)).rows.some((item) => item.id === hidden[0]!.id));
  });

  it("13. vínculos Proposta × PV e dados ficam intactos (a listagem só lê)", async () => {
    const { store, won } = testBiScenario();
    const before = JSON.stringify(store.rows);
    await listAll(store);
    await listAll(store, filters({ includeWithoutCommercialValue: true }));
    await loadProposalIntegrationQuality(store.db as never);
    assert.equal(JSON.stringify(store.rows), before);
    assert.deepEqual(store.writes, []);
    const page = await listAll(store);
    assert.equal((page.rows.find((row) => row.id === won.id) as Row).salesOrder?.orderCode, "PV 900");
  });

  it("14. filtros combinados mantêm a semântica (busca não é sobrescrita pela conversão nem a visibilidade)", async () => {
    seq = 0;
    const store = createStore([
      proposal({ totalNetValue: 100, Customer: JAIRO, customerId: JAIRO.id, status: "APPROVED" }),
      proposal({ totalNetValue: 200, status: "APPROVED" }),
      proposal({ totalNetValue: 300, Customer: JAIRO, customerId: JAIRO.id }),
      jairoZero("CP 09999"),
    ]);
    const page = await listAll(store, filters({ search: "jairo" }));
    assert.equal(page.total, 2, "busca + visibilidade: duas do JAIRO, a zerada some");
    assert.equal(page.summary.totalProposals, 2);
    assert.equal(page.summary.convertedProposalsCount, 1, "convertidas respeitam a busca (antes o OR sobrescrevia)");
    const approved = await listAll(store, filters({ status: "APPROVED" }));
    assert.equal(approved.summary.openProposalsCount, 0, "em aberto respeita o status filtrado");
    const ranged = await listAll(store, filters({ search: "jairo", minNetValue: 150 }));
    assert.deepEqual(ranged.rows.map((row) => row.totalNetValue), [300]);
    const wheres = buildProposalListWheres(filters({ search: "x" }), NOW);
    assert.ok(Array.isArray((wheres.gridWhere as { AND?: unknown[] }).AND), "composição por AND, sem espalhar OR");
    assert.ok(Array.isArray((wheres.convertedWhere as { AND?: unknown[] }).AND));
  });
});

describe("propostas › qualidade da integração e aceite", () => {
  it("diagnóstico separa sem itens, itens descartados, bruto positivo e pedido a revisar", () => {
    const report = summarizeProposalIntegrationQuality([
      { id: "a", number: 1, externalProposalCode: "CP 01818", customerName: "JAIRO", status: "SENT", totalNetValue: 0, totalGrossValue: 42900, mappedItemCount: 0, hasSalesOrder: false, externalRawPayload: { valorTotal: "0,00", valorTotalNfe: "42.900,00", itensProposta: [] } },
      { id: "b", number: 2, externalProposalCode: "CP 02000", customerName: "X", status: "SENT", totalNetValue: 0, totalGrossValue: 0, mappedItemCount: 0, hasSalesOrder: false, externalRawPayload: { valorTotal: "0", itensProposta: [{ id: 1, codigoProduto: "" }, { id: 2 }] } },
      { id: "c", number: 3, externalProposalCode: "CP 02001", customerName: "Y", status: "APPROVED", totalNetValue: 0, totalGrossValue: 0, mappedItemCount: 0, hasSalesOrder: true, externalRawPayload: {} },
      { id: "d", number: 4, externalProposalCode: "CP 02002", customerName: "Z", status: "SENT", totalNetValue: 0, totalGrossValue: 0, mappedItemCount: 2, hasSalesOrder: false, externalRawPayload: { itensProposta: [{ codigoProduto: "A" }, { codigoProduto: "B" }] } },
      { id: "e", number: 5, externalProposalCode: "CP 01823", customerName: "JAIRO", status: "SENT", totalNetValue: 42900, totalGrossValue: 42900, mappedItemCount: 1, hasSalesOrder: false, externalRawPayload: {} },
    ]);
    assert.equal(report.total, 4, "a proposta com valor não entra no diagnóstico");
    assert.equal(report.hiddenFromDefaultGrid, 2);
    assert.equal(report.counts.ZERO_NET_VALUE, 4);
    assert.equal(report.counts.NO_SOURCE_ITEMS, 2);
    assert.equal(report.counts.SOURCE_ITEMS_NONE_MAPPED, 1);
    assert.equal(report.counts.GROSS_POSITIVE_NET_ZERO, 1);
    assert.equal(report.counts.SALES_ORDER_NEEDS_REVIEW, 1);
    assert.equal(report.counts.MAPPED_ITEMS_ZERO_VALUE, 1);
    const b = report.items.find((item) => item.id === "b")!;
    assert.equal(b.sourceItemCount, 2);
    assert.equal(b.sourceItemsWithoutSku, 2);
    assert.equal(report.items.find((item) => item.id === "a")!.rawGrossValue, "42.900,00");
  });

  it("aceite: 70 Nomus sem valor somem do grid e dos indicadores; CP 01823 fica; total preservado", async () => {
    seq = 0;
    const hidden = Array.from({ length: 70 }, (_, index) => jairoZero(`CP ${String(1000 + index).padStart(5, "0")}`));
    const valid = Array.from({ length: 30 }, (_, index) => proposal({ totalNetValue: 1000 + index, items: [{ id: `i${index}` }] }));
    const cp01823 = proposal({ externalProposalCode: "CP 01823", Customer: JAIRO, customerId: JAIRO.id, totalNetValue: 42900, items: [{ id: "k" }] });
    const store = createStore([...hidden, ...valid, cp01823]);
    const page = await listAll(store);
    assert.equal(page.summary.hiddenWithoutCommercialValueCount, 70);
    assert.equal(page.total, 31);
    assert.ok(page.rows.some((row) => row.id === cp01823.id));
    assert.equal(page.summary.totalProposals, 31);
    assert.equal(await store.db.proposal.count({ where: PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE as Where }), 70);
    assert.equal(store.rows.length, 101, "nada excluído");
    const quality = await loadProposalIntegrationQuality(store.db as never);
    assert.equal(quality.hiddenFromDefaultGrid, 70);
    assert.equal(quality.counts.GROSS_POSITIVE_NET_ZERO, 70);
  });

  it("os três predicados e a função pura concordam em todas as combinações", () => {
    seq = 0;
    for (const sourceSystem of ["NOMUS", null, "INDUSCOST"]) {
      for (const net of [-1, 0, 10]) {
        for (const items of [0, 2]) {
          for (const order of [false, true]) {
            const row = proposal({
              sourceSystem,
              totalNetValue: net,
              items: Array.from({ length: items }, (_, i) => ({ id: `i${i}` })),
              salesOrder: order ? { id: "so", orderCode: "PV", status: "OPEN" } : null,
            });
            const facts = classifyProposalCommercialEligibility({ sourceSystem, totalNetValue: net, mappedItemCount: items, hasSalesOrder: order });
            const label = `${sourceSystem}/${net}/${items}/${order}`;
            assert.equal(matches(row, PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE as Where), facts.visibleByDefault, `grid ${label}`);
            assert.equal(matches(row, PROPOSAL_COMMERCIAL_METRICS_WHERE as Where), facts.countsInCommercialMetrics, `métricas ${label}`);
            assert.equal(matches(row, PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE as Where), !facts.visibleByDefault, `oculta ${label}`);
          }
        }
      }
    }
    assert.deepEqual(andProposalWhere({}, null, { status: "SENT" }), { status: "SENT" });
  });

  it("a rota usa a regra central, o filtro exige proposals.edit e o detalhe por ID não filtra", () => {
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    const route = /app\.get\("\/api\/proposals", requireAppAuth[\s\S]*?\n  \}\);/.exec(server)?.[0] ?? "";
    assert.match(route, /loadProposalListPage\(/);
    assert.match(route, /hasPermission\(auth, PROPOSAL_WITHOUT_COMMERCIAL_VALUE_FILTER_PERMISSION\)/);
    assert.doesNotMatch(route, /\.\.\.where,/);
    const detail = /app\.get\("\/api\/proposals\/:id"[\s\S]*?\n  \}\);/.exec(server)?.[0] ?? "";
    assert.doesNotMatch(detail, /PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE|loadProposalListPage/);
    const crm = /negotiationProposals\][\s\S]*?prisma\.proposal\.findMany\(\{[\s\S]*?\}\),/.exec(server)?.[0] ?? server;
    assert.match(crm, /PROPOSAL_COMMERCIAL_METRICS_WHERE/);
  });
});
