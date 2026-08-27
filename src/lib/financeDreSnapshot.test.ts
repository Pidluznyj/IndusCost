import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildFinanceDreReportFromRawSources,
  deriveFinanceDreSeriesBundle,
  FINANCE_DRE_LEGAL_ENTITY_COMPANIES,
  type FinanceDreRawSourceSeries,
} from "./financeDreReportBuilder.js";
import {
  FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
  parseFinanceDreSnapshotSeriesPayload,
  serializeFinanceDreSnapshotSeriesPayload,
} from "./financeDreSnapshotTypes.js";
import {
  claimFinanceDreSnapshotRefresh,
  markFinanceDreSnapshotsDirty,
  refreshDirtyFinanceDreSnapshots,
  refreshFinanceDreSnapshot,
  resolveFinanceDreReportWithSnapshot,
  type FinanceDreSnapshotDb,
} from "./financeDreSnapshot.server.js";
import { buildEstimatedCorporateTaxSeriesFromEntityBases } from "./financeDreEstimatedCorporateTaxes.js";
import { computeFinanceDreEstimatedTaxBaseSeries, roundDreMoney } from "./financeDreMath.js";
import type { DreCostCenterRole } from "./financeDreCostCenterRoles.js";
import type { FinanceDreCompany } from "./financeDreTypes.js";

const GENERATED_AT = "2026-08-27T12:00:00.000Z";

function monthlySeries(base: number, zeroFrom?: number): number[] {
  return Array.from({ length: 12 }, (_, i) =>
    zeroFrom != null && i + 1 >= zeroFrom ? 0 : roundDreMoney(base * (i + 1))
  );
}

function makeRaw(
  year: number,
  company: FinanceDreCompany,
  seed: number,
  opts: { zeroFromMonth?: number } = {}
): FinanceDreRawSourceSeries {
  const z = opts.zeroFromMonth;
  return {
    year,
    company,
    receitaBrutaByMonth: monthlySeries(1000 * seed, z),
    deductions: {
      cofins: monthlySeries(10 * seed, z),
      icms: monthlySeries(20 * seed, z),
      icmsSt: monthlySeries(5 * seed, z),
      ipi: monthlySeries(3 * seed, z),
      pis: monthlySeries(2 * seed, z),
      devolucoes: monthlySeries(4 * seed, z),
      taxSummaryGapCount: seed,
    },
    cmv: {
      cmvByMonth: monthlySeries(300 * seed, z),
      missingItemsRevenueByMonth: monthlySeries(1 * seed, z),
      missingProductRevenueByMonth: monthlySeries(0.5 * seed, z),
      missingCostRevenueByMonth: monthlySeries(0.25 * seed, z),
      missingItemsNfeCount: seed,
      missingProductLineCount: seed + 1,
      missingCostLineCount: seed + 2,
      pricedLineCount: 100 * seed,
    },
    costCenters: {
      byCostCenter: [
        {
          costCenterId: `cc-log-${company}`,
          code: "CC10",
          name: "Logistica Expedicao",
          byMonth: monthlySeries(15 * seed, z),
        },
        {
          costCenterId: `cc-emb-${company}`,
          code: "CC11",
          name: "Embalagens",
          byMonth: monthlySeries(7 * seed, z),
        },
        {
          costCenterId: `cc-adm-${company}`,
          code: "CC20",
          name: "Administrativo Central",
          byMonth: monthlySeries(25 * seed, z),
        },
        {
          costCenterId: `cc-folha-${company}`,
          code: "CC30",
          name: "Folha Salarios",
          byMonth: monthlySeries(9 * seed, z),
        },
      ],
      unclassifiedByMonth: monthlySeries(2 * seed, z),
    },
  };
}

function makePerEntity(year: number, opts: { zeroFromMonth?: number } = {}) {
  return FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((company, idx) =>
    makeRaw(year, company, idx + 2, opts)
  );
}

function roundTrip(raw: FinanceDreRawSourceSeries): FinanceDreRawSourceSeries {
  const parsed = parseFinanceDreSnapshotSeriesPayload(
    JSON.parse(JSON.stringify(serializeFinanceDreSnapshotSeriesPayload(raw)))
  );
  assert.ok(parsed, "payload deveria sobreviver ao roundtrip");
  return parsed;
}

// ---------------------------------------------------------------------------
// Fake db (Prisma-like) para o modelo FinanceDreAnnualSnapshot
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown> & { year: number; company: string };

function createFakeDb(initial: Array<Partial<FakeRow>> = []) {
  let seq = 1;
  const rows: FakeRow[] = [];

  const baseRow = (data: Partial<FakeRow>): FakeRow => ({
    year: 0,
    company: "",
    schemaVersion: FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
    seriesJson: null,
    computedAt: null,
    computeDurationMs: null,
    availableThroughMonthAtCompute: null,
    dirtyAt: null,
    dirtyReason: null,
    dirtyGeneration: 0,
    refreshClaimedAt: null,
    refreshClaimToken: null,
    lastSuccessfulRefreshAt: null,
    lastRefreshError: null,
    lastRefreshErrorAt: null,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1, 0, 0, seq++),
    ...data,
  });

  for (const r of initial) rows.push(baseRow(r));

  const matches = (row: FakeRow, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "OR") {
        const list = value as Array<Record<string, unknown>>;
        if (!list.some((w) => matches(row, w))) return false;
        continue;
      }
      const current = row[key];
      if (
        value != null &&
        typeof value === "object" &&
        !(value instanceof Date)
      ) {
        const op = value as Record<string, unknown>;
        if ("in" in op) {
          if (!(op.in as unknown[]).includes(current)) return false;
          continue;
        }
        if ("gte" in op) {
          if (!(current != null && (current as number) >= (op.gte as number))) return false;
          continue;
        }
        if ("lt" in op) {
          if (!(current instanceof Date && op.lt instanceof Date && current < op.lt)) return false;
          continue;
        }
        if ("not" in op) {
          if (op.not === null ? current == null : current === op.not) return false;
          continue;
        }
        throw new Error(`fake db: operador não suportado em ${key}`);
      }
      if (value === null) {
        if (current != null) return false;
        continue;
      }
      if (current !== value) return false;
    }
    return true;
  };

  const applyData = (row: FakeRow, data: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(data)) {
      if (
        value != null &&
        typeof value === "object" &&
        !(value instanceof Date) &&
        "increment" in (value as Record<string, unknown>)
      ) {
        row[key] =
          ((row[key] as number) ?? 0) +
          ((value as { increment: number }).increment ?? 0);
        continue;
      }
      row[key] = value as unknown;
    }
    row.updatedAt = new Date(2026, 0, 1, 0, 0, seq++);
  };

  const model = {
    findMany: async (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      take?: number;
      select?: unknown;
    } = {}) => {
      let out = rows.filter((r) => (args.where ? matches(r, args.where) : true));
      if (args.orderBy?.updatedAt === "asc") {
        out = [...out].sort(
          (a, b) => (a.updatedAt as Date).getTime() - (b.updatedAt as Date).getTime()
        );
      }
      if (args.take != null) out = out.slice(0, args.take);
      return out.map((r) => ({ ...r }));
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, args.where)) {
          applyData(row, args.data);
          count += 1;
        }
      }
      return { count };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const exists = rows.some(
        (r) => r.year === args.data.year && r.company === args.data.company
      );
      if (exists) {
        throw new Error("unique constraint");
      }
      const row = baseRow(args.data as Partial<FakeRow>);
      rows.push(row);
      return { ...row };
    },
  };

  const db = {
    financeDreAnnualSnapshot: model,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    __rows: rows,
  };
  return db as unknown as FinanceDreSnapshotDb & { __rows: FakeRow[] };
}

function seededRow(
  year: number,
  company: FinanceDreCompany,
  raw: FinanceDreRawSourceSeries,
  extra: Partial<FakeRow> = {}
): Partial<FakeRow> {
  return {
    year,
    company,
    seriesJson: JSON.parse(JSON.stringify(serializeFinanceDreSnapshotSeriesPayload(raw))),
    computedAt: new Date(2026, 7, 20),
    computeDurationMs: 1234,
    ...extra,
  };
}

const emptyRoleMap = new Map<string, DreCostCenterRole>();

// ---------------------------------------------------------------------------

describe("DRE snapshot — serialização validada", () => {
  it("roundtrip preserva todas as séries e contagens", () => {
    const raw = makeRaw(2026, "lazarios", 3);
    assert.deepEqual(roundTrip(raw), raw);
  });

  it("shape inválido e schemaVersion incompatível → null (nunca usado silenciosamente)", () => {
    assert.equal(parseFinanceDreSnapshotSeriesPayload(null), null);
    assert.equal(parseFinanceDreSnapshotSeriesPayload({}), null);
    const good = serializeFinanceDreSnapshotSeriesPayload(makeRaw(2026, "sm", 1));
    assert.equal(
      parseFinanceDreSnapshotSeriesPayload({ ...good, schemaVersion: 999 }),
      null
    );
    assert.equal(
      parseFinanceDreSnapshotSeriesPayload({
        ...good,
        receitaBrutaByMonth: [1, 2, 3],
      }),
      null
    );
    const badCc = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    (badCc.costCenters as { byCostCenter: unknown[] }).byCostCenter.push({ nope: true });
    assert.equal(parseFinanceDreSnapshotSeriesPayload(badCc), null);
  });
});

describe("DRE snapshot — paridade LIVE == SNAPSHOT (motor puro único)", () => {
  it("report de séries roundtripped é idêntico ao das séries originais — meses 1..12, company única", () => {
    const raw = makeRaw(2026, "koppetel", 4);
    for (let month = 1; month <= 12; month += 1) {
      const filters = {
        year: 2026,
        highlightMonth: month,
        company: "koppetel" as const,
        dateBase: "emissao" as const,
      };
      const live = buildFinanceDreReportFromRawSources({
        filters,
        availableThroughMonth: 12,
        roleMap: emptyRoleMap,
        consolidated: raw,
        perEntity: null,
        generatedAt: GENERATED_AT,
      });
      const viaSnapshot = buildFinanceDreReportFromRawSources({
        filters,
        availableThroughMonth: 12,
        roleMap: emptyRoleMap,
        consolidated: roundTrip(raw),
        perEntity: null,
        generatedAt: GENERATED_AT,
      });
      assert.deepEqual(viaSnapshot, live, `mês ${month}`);
    }
  });

  it("company=all: paridade completa incluindo IRPJ/CSLL por PJ", () => {
    const consolidated = makeRaw(2026, "all", 9);
    const perEntity = makePerEntity(2026);
    const filters = {
      year: 2026,
      highlightMonth: 8,
      company: "all" as const,
      dateBase: "emissao" as const,
    };
    const live = buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth: 8,
      roleMap: emptyRoleMap,
      consolidated,
      perEntity,
      generatedAt: GENERATED_AT,
    });
    const viaSnapshot = buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth: 8,
      roleMap: emptyRoleMap,
      consolidated: roundTrip(consolidated),
      perEntity: perEntity.map(roundTrip),
      generatedAt: GENERATED_AT,
    });
    assert.deepEqual(viaSnapshot, live);
    assert.equal(live.estimatedCorporateTaxes.consolidationMode, "per_legal_entity");
    assert.equal(live.estimatedCorporateTaxes.entitiesHighlightMonth.length, 3);
  });

  it("all: bloco tributário bate com o motor canônico chamado diretamente com as bases por PJ", () => {
    const perEntity = makePerEntity(2026);
    const filters = {
      year: 2026,
      highlightMonth: 6,
      company: "all" as const,
      dateBase: "emissao" as const,
    };
    const report = buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth: 12,
      roleMap: emptyRoleMap,
      consolidated: makeRaw(2026, "all", 9),
      perEntity,
      generatedAt: GENERATED_AT,
    });
    const expected = buildEstimatedCorporateTaxSeriesFromEntityBases(
      FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((company, idx) => {
        const bundle = deriveFinanceDreSeriesBundle(
          perEntity[idx]!,
          { year: 2026, highlightMonth: 6 },
          12,
          emptyRoleMap
        );
        return {
          companyKey: company,
          companyLabel: report.estimatedCorporateTaxes.entitiesHighlightMonth[idx]!.companyLabel,
          cnpjDigits: "x",
          baseByMonth: computeFinanceDreEstimatedTaxBaseSeries(bundle.mathInput),
        };
      }),
      6,
      "per_legal_entity"
    );
    assert.deepEqual(
      report.estimatedCorporateTaxes.provisionByMonth,
      expected.provisionByMonth
    );
    assert.deepEqual(report.estimatedCorporateTaxes.irpjByMonth, expected.irpjByMonth);
    assert.deepEqual(report.estimatedCorporateTaxes.csllByMonth, expected.csllByMonth);
  });
});

describe("DRE snapshot — regra temporal é read-time (nunca a persistida)", () => {
  it("snapshot computado em agosto lido em setembro: highlight avança, séries iguais, setembro zerado", () => {
    // Fontes até agosto (setembro..dezembro = 0), como um snapshot tirado em 31/08.
    const raw = makeRaw(2026, "lazarios", 5, { zeroFromMonth: 9 });
    const filtersSep = {
      year: 2026,
      highlightMonth: 9,
      company: "lazarios" as const,
      dateBase: "emissao" as const,
    };
    // Leitura em setembro: availableThroughMonth read-time = 9.
    const report = buildFinanceDreReportFromRawSources({
      filters: filtersSep,
      availableThroughMonth: 9,
      roleMap: emptyRoleMap,
      consolidated: raw,
      perEntity: null,
      generatedAt: GENERATED_AT,
    });
    const receita = report.lines.find((l) => l.id === "receita_bruta")!;
    // Setembro permitido como destaque; sem dado novo → zero (nenhuma regra inventada).
    assert.equal(receita.values.highlight, 0);
    // YTD de setembro = soma jan..ago (séries materializadas intactas).
    assert.equal(receita.values.ytd, roundDreMoney(5000 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8)));
    assert.equal(receita.values.byMonth[7], 5000 * 8);
    assert.equal(receita.values.byMonth[8], 0);
  });

  it("leitura em agosto de série com setembro preenchido: clamp read-time zera setembro", () => {
    const raw = makeRaw(2026, "lazarios", 5); // 12 meses preenchidos
    const report = buildFinanceDreReportFromRawSources({
      filters: {
        year: 2026,
        highlightMonth: 8,
        company: "lazarios",
        dateBase: "emissao",
      },
      availableThroughMonth: 8,
      roleMap: emptyRoleMap,
      consolidated: raw,
      perEntity: null,
      generatedAt: GENERATED_AT,
    });
    const receita = report.lines.find((l) => l.id === "receita_bruta")!;
    assert.equal(receita.values.byMonth[8], 0);
    assert.equal(receita.values.byMonth[11], 0);
  });
});

describe("DRE snapshot — roleMap de CC aplicado em read-time (séries brutas por CC)", () => {
  it("mudar o mapeamento muda fretes/admin na leitura do MESMO payload — sem invalidação", () => {
    const raw = makeRaw(2026, "sm", 2);
    const filters = {
      year: 2026,
      highlightMonth: 5,
      company: "sm" as const,
      dateBase: "emissao" as const,
    };
    const asLogistics = buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth: 12,
      roleMap: new Map([["cc-log-sm", "logistics"]]),
      consolidated: raw,
      perEntity: null,
      generatedAt: GENERATED_AT,
    });
    const asAdmin = buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth: 12,
      roleMap: new Map([["cc-log-sm", "admin"]]),
      consolidated: raw,
      perEntity: null,
      generatedAt: GENERATED_AT,
    });
    const fretesA = asLogistics.lines.find((l) => l.id === "fretes")!;
    const fretesB = asAdmin.lines.find((l) => l.id === "fretes")!;
    // Com o CC de logística re-mapeado para admin, a linha de fretes zera…
    assert.equal(fretesB.values.ytd, 0);
    assert.notEqual(fretesA.values.ytd, 0);
    // …e as despesas operacionais absorvem o valor (mesma matemática do live).
    const adminA = asLogistics.lines.find((l) => l.id === "despesas_administrativas")!;
    const adminB = asAdmin.lines.find((l) => l.id === "despesas_administrativas")!;
    assert.equal(
      roundDreMoney(adminB.values.ytd - adminA.values.ytd),
      roundDreMoney(fretesA.values.ytd)
    );
  });
});

describe("DRE snapshot — claim / lock por chave", () => {
  it("mesma chave não é reivindicada duas vezes; claim expirado é retomado; chaves distintas independem", async () => {
    const db = createFakeDb([seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 1))]);
    const first = await claimFinanceDreSnapshotRefresh(db, 2026, "lazarios");
    assert.ok(first);
    const second = await claimFinanceDreSnapshotRefresh(db, 2026, "lazarios");
    assert.equal(second, null);

    // Chave diferente não é bloqueada.
    const other = await claimFinanceDreSnapshotRefresh(db, 2026, "koppetel");
    assert.ok(other);

    // Claim expirado (mais velho que o timeout) pode ser retomado.
    const row = db.__rows.find((r) => r.company === "lazarios")!;
    row.refreshClaimedAt = new Date(Date.now() - 11 * 60 * 1000);
    const reclaimed = await claimFinanceDreSnapshotRefresh(db, 2026, "lazarios");
    assert.ok(reclaimed);
  });
});

describe("DRE snapshot — dirtyGeneration (CRITICAL: invalidação nunca é perdida)", () => {
  it("markDirty durante o refresh: payload novo é publicado, mas dirty PERMANECE", async () => {
    const before = makeRaw(2026, "lazarios", 1);
    const db = createFakeDb([
      seededRow(2026, "lazarios", before, { dirtyGeneration: 10, dirtyAt: new Date() }),
    ]);
    const after = makeRaw(2026, "lazarios", 7);

    const result = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "lazarios" },
      {
        computeRaw: async () => {
          // Fonte muda DURANTE o cômputo → nova invalidação.
          await markFinanceDreSnapshotsDirty(db, {
            reason: "nova-alteracao",
            years: [2026],
            companies: ["lazarios"],
          });
          return after;
        },
      }
    );

    assert.equal(result.status, "refreshed");
    assert.equal(result.clearedDirty, false);
    const row = db.__rows.find((r) => r.company === "lazarios")!;
    // Publicou o resultado completo calculado…
    const parsed = parseFinanceDreSnapshotSeriesPayload(row.seriesJson);
    assert.deepEqual(parsed, after);
    // …mas NÃO marcou FRESH: dirty permanece para novo ciclo.
    assert.notEqual(row.dirtyAt, null);
    assert.equal(row.dirtyGeneration, 11);
  });

  it("sem invalidação concorrente, o refresh limpa dirty", async () => {
    const db = createFakeDb([
      seededRow(2026, "sm", makeRaw(2026, "sm", 1), {
        dirtyGeneration: 4,
        dirtyAt: new Date(),
        dirtyReason: "x",
      }),
    ]);
    const result = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "sm" },
      { computeRaw: async () => makeRaw(2026, "sm", 2) }
    );
    assert.equal(result.status, "refreshed");
    assert.equal(result.clearedDirty, true);
    const row = db.__rows.find((r) => r.company === "sm")!;
    assert.equal(row.dirtyAt, null);
    assert.equal(row.dirtyReason, null);
  });
});

describe("DRE snapshot — erro de refresh preserva snapshot anterior", () => {
  it("computeRaw lança: payload antigo intacto, lastRefreshError registrado, claim liberado", async () => {
    const before = makeRaw(2026, "koppetel", 3);
    const db = createFakeDb([seededRow(2026, "koppetel", before, { dirtyAt: new Date() })]);
    const result = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "koppetel" },
      {
        computeRaw: async () => {
          throw new Error("falha de fonte");
        },
      }
    );
    assert.equal(result.status, "error");
    const row = db.__rows.find((r) => r.company === "koppetel")!;
    assert.deepEqual(parseFinanceDreSnapshotSeriesPayload(row.seriesJson), before);
    assert.match(String(row.lastRefreshError), /falha de fonte/);
    assert.equal(row.refreshClaimedAt, null);
    assert.equal(row.refreshClaimToken, null);
    assert.notEqual(row.dirtyAt, null); // dirty permanece para nova tentativa
  });
});

describe("DRE snapshot — markDirty / refreshDirty", () => {
  it("markDirty só toca linhas existentes, sempre inclui all, respeita minYear e incrementa geração", async () => {
    const db = createFakeDb([
      seededRow(2024, "lazarios", makeRaw(2024, "lazarios", 1)),
      seededRow(2025, "lazarios", makeRaw(2025, "lazarios", 1)),
      seededRow(2025, "all", makeRaw(2025, "all", 1)),
      seededRow(2026, "koppetel", makeRaw(2026, "koppetel", 1)),
    ]);
    const count = await markFinanceDreSnapshotsDirty(db, {
      reason: "custo-retroativo",
      minYear: 2025,
      companies: ["lazarios"],
    });
    // 2025/lazarios + 2025/all (all sempre acompanha) — 2024 fora, koppetel fora.
    assert.equal(count, 2);
    const r2024 = db.__rows.find((r) => r.year === 2024)!;
    assert.equal(r2024.dirtyAt, null);
    const r2025 = db.__rows.find((r) => r.year === 2025 && r.company === "lazarios")!;
    assert.notEqual(r2025.dirtyAt, null);
    assert.equal(r2025.dirtyGeneration, 1);
    assert.equal(r2025.dirtyReason, "custo-retroativo");
    const rAll = db.__rows.find((r) => r.year === 2025 && r.company === "all")!;
    assert.notEqual(rAll.dirtyAt, null);
  });

  it("refreshDirty processa PJs antes de all", async () => {
    const db = createFakeDb([
      seededRow(2026, "all", makeRaw(2026, "all", 1), { dirtyAt: new Date() }),
      seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 1), { dirtyAt: new Date() }),
      seededRow(2026, "koppetel", makeRaw(2026, "koppetel", 1)),
      seededRow(2026, "sm", makeRaw(2026, "sm", 1)),
    ]);
    const calls: string[] = [];
    const result = await refreshDirtyFinanceDreSnapshots(
      db,
      {},
      {
        computeRaw: async (year, company) => {
          calls.push(company);
          return makeRaw(year, company, 2);
        },
      }
    );
    assert.equal(calls[0], "lazarios"); // PJ dirty primeiro
    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      result.refreshed.map((r) => r.company),
      ["lazarios", "all"]
    );
  });

  it("refreshDirty soft-faila por chave — erro numa PJ não impede as demais", async () => {
    const db = createFakeDb([
      seededRow(2026, "koppetel", makeRaw(2026, "koppetel", 1), { dirtyAt: new Date() }),
      seededRow(2026, "sm", makeRaw(2026, "sm", 1), { dirtyAt: new Date() }),
    ]);
    const result = await refreshDirtyFinanceDreSnapshots(
      db,
      {},
      {
        computeRaw: async (year, company) => {
          if (company === "koppetel") throw new Error("boom");
          return makeRaw(year, company, 2);
        },
      }
    );
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.company, "koppetel");
    assert.equal(result.refreshed.length, 1);
    assert.equal(result.refreshed[0]!.company, "sm");
    // A chave que falhou permanece dirty para nova tentativa.
    const failed = db.__rows.find((r) => r.company === "koppetel")!;
    assert.notEqual(failed.dirtyAt, null);
  });
});

describe("DRE snapshot — resolve (HIT / STALE / MISS / schemaVersion)", () => {
  const baseQuery = { year: "2026", month: "8", company: "lazarios" };
  const referenceNow = new Date(2026, 7, 27, 10, 0, 0);

  it("HIT: responde do snapshot sem chamar NENHUM motor caro", async () => {
    const raw = makeRaw(2026, "lazarios", 5);
    const db = createFakeDb([seededRow(2026, "lazarios", raw)]);
    let computeCalls = 0;
    const report = await resolveFinanceDreReportWithSnapshot(baseQuery, referenceNow, {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        computeCalls += 1;
        throw new Error("motor caro não deveria rodar em HIT");
      },
      scheduleBackgroundRefresh: () => {
        throw new Error("não deveria agendar refresh em FRESH");
      },
    });
    assert.equal(computeCalls, 0);
    assert.equal(report.snapshot.freshness, "fresh");
    assert.equal(report.snapshot.refreshPending, false);
    assert.equal(report.filters.highlightMonth, 8);
    const receita = report.lines.find((l) => l.id === "receita_bruta")!;
    assert.equal(receita.values.byMonth[0], 5000);
  });

  it("STALE: responde imediatamente com o último válido e agenda refresh em background", async () => {
    const raw = makeRaw(2026, "lazarios", 5);
    const db = createFakeDb([
      seededRow(2026, "lazarios", raw, { dirtyAt: new Date(), dirtyReason: "nfes-sync" }),
    ]);
    const scheduled: string[] = [];
    const report = await resolveFinanceDreReportWithSnapshot(baseQuery, referenceNow, {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        throw new Error("fast path não computa em STALE");
      },
      scheduleBackgroundRefresh: (year, company) => {
        scheduled.push(`${year}/${company}`);
      },
    });
    assert.equal(report.snapshot.freshness, "stale");
    assert.equal(report.snapshot.refreshPending, true);
    assert.equal(report.snapshot.dirtyReason, "nfes-sync");
    assert.deepEqual(scheduled, ["2026/lazarios"]);
  });

  it("MISS: computa uma vez sob claim, persiste e a segunda leitura é HIT", async () => {
    const db = createFakeDb([]);
    let computeCalls = 0;
    const raw = makeRaw(2026, "lazarios", 6);
    const deps = {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        computeCalls += 1;
        return raw;
      },
    };
    const first = await resolveFinanceDreReportWithSnapshot(baseQuery, referenceNow, deps);
    assert.equal(first.snapshot.freshness, "fresh");
    assert.equal(computeCalls, 1);

    const second = await resolveFinanceDreReportWithSnapshot(baseQuery, referenceNow, deps);
    assert.equal(second.snapshot.freshness, "fresh");
    assert.equal(computeCalls, 1); // HIT — não recomputou
  });

  it("schemaVersion incompatível é tratado como MISS (recompute), nunca usado como válido", async () => {
    const good = serializeFinanceDreSnapshotSeriesPayload(makeRaw(2026, "lazarios", 1));
    const db = createFakeDb([
      {
        year: 2026,
        company: "lazarios",
        seriesJson: { ...good, schemaVersion: 999 },
        computedAt: new Date(),
      },
    ]);
    let computeCalls = 0;
    const report = await resolveFinanceDreReportWithSnapshot(baseQuery, referenceNow, {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        computeCalls += 1;
        return makeRaw(2026, "lazarios", 6);
      },
    });
    assert.equal(computeCalls, 1);
    assert.equal(report.snapshot.freshness, "fresh");
  });

  it("company=all em MISS computa consolidado + 3 PJs e publica as 4 linhas", async () => {
    const db = createFakeDb([]);
    const computed: string[] = [];
    const report = await resolveFinanceDreReportWithSnapshot(
      { year: "2026", month: "8" },
      referenceNow,
      {
        db,
        loadRoleMap: async () => emptyRoleMap,
        computeRaw: async (year, company) => {
          computed.push(company);
          return makeRaw(
            year,
            company,
            company === "all" ? 9 : FINANCE_DRE_LEGAL_ENTITY_COMPANIES.indexOf(company as never) + 2
          );
        },
      }
    );
    assert.deepEqual([...computed].sort(), ["all", "koppetel", "lazarios", "sm"]);
    assert.equal(report.estimatedCorporateTaxes.consolidationMode, "per_legal_entity");
    assert.equal(db.__rows.length, 4);
  });

  it("all reutiliza PJs FRESH no refresh (não recomputa entidade limpa)", async () => {
    const db = createFakeDb([
      seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 2)),
      seededRow(2026, "koppetel", makeRaw(2026, "koppetel", 3)),
      seededRow(2026, "sm", makeRaw(2026, "sm", 4)),
    ]);
    const computed: string[] = [];
    const result = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "all" },
      {
        computeRaw: async (year, company) => {
          computed.push(company);
          return makeRaw(year, company, 9);
        },
      }
    );
    assert.equal(result.status, "refreshed");
    assert.deepEqual(computed, ["all"]); // PJs FRESH reutilizadas
    assert.equal(result.entitiesRefreshed.length, 0);
  });
});

describe("DRE snapshot — fontes e permissões (guards estruturais)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("GET /api/finance/dre serve via snapshot e o refresh forçado exige manage", () => {
    const routes = read("./financeDreRoutes.ts");
    assert.match(routes, /resolveFinanceDreReportWithSnapshot/);
    assert.match(
      routes,
      /app\.post\("\/api\/finance\/dre\/refresh",\s*\.\.\.manageGuard/
    );
  });

  it("hooks de invalidação existem nos pontos reais de escrita", () => {
    assert.match(
      read("../../scripts/nomusNfesSync.ts"),
      /markFinanceDreSnapshotsDirtyForNfes\(prisma/
    );
    assert.match(
      read("../../scripts/nomusAccountsPayableSync.ts"),
      /markFinanceDreSnapshotsDirtySafe\(prisma,\s*\{\s*reason:\s*"accounts-payable-sync"/
    );
    assert.match(
      read("../../scripts/nomusStockDocumentsSync.ts"),
      /markFinanceDreSnapshotsDirtySafe\(prisma,\s*\{\s*reason:\s*"stock-documents-sync"/
    );
    assert.match(read("./productionCostPublication.server.ts"), /production-cost-publish/);
    assert.match(read("../../scripts/nomusProductsSyncV1.ts"), /products-sync/);
    assert.match(
      read("./financeAccountsPayableCostCenterAllocationRoutes.ts"),
      /ap-allocation-manual/
    );
  });

  it("mapeamento de CC da DRE NÃO invalida snapshot (roleMap é read-time)", () => {
    const mapping = read("./financeDreCostCenterMapping.server.ts");
    assert.equal(mapping.includes("markFinanceDreSnapshots"), false);
  });

  it("resolve usa a regra temporal canônica em read-time — nunca a persistida", () => {
    const src = read("./financeDreSnapshot.server.ts");
    const resolveIdx = src.indexOf("export async function resolveFinanceDreReportWithSnapshot");
    assert.ok(resolveIdx > 0);
    const resolveSrc = src.slice(resolveIdx);
    assert.match(resolveSrc, /resolveFinanceDreAvailableThroughMonth\(\s*filters\.year,\s*referenceNow/);
    assert.equal(resolveSrc.includes("availableThroughMonthAtCompute"), false);
  });

  it("publicação em transação curta — todo cômputo pesado ANTES da transação", async () => {
    const events: string[] = [];
    const inner = createFakeDb([seededRow(2026, "sm", makeRaw(2026, "sm", 1))]);
    const db = {
      financeDreAnnualSnapshot: (inner as never as { financeDreAnnualSnapshot: unknown })
        .financeDreAnnualSnapshot,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        events.push("tx");
        return fn(db);
      },
      __rows: inner.__rows,
    } as unknown as FinanceDreSnapshotDb;

    const result = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "sm" },
      {
        computeRaw: async (year, company) => {
          events.push("compute");
          return makeRaw(year, company, 2);
        },
      }
    );
    assert.equal(result.status, "refreshed");
    // O cômputo pesado ocorre integralmente antes da transação de publicação.
    assert.deepEqual(events, ["compute", "tx"]);
  });
});
