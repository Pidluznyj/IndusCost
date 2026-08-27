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
  markFinanceDreSnapshotsDirtyForNfeExternalIds,
  markFinanceDreSnapshotsDirtyForNfeIds,
  markFinanceDreSnapshotsDirtyForStockDocumentChanges,
  refreshDirtyFinanceDreSnapshots,
  refreshFinanceDreSnapshot,
  releaseFinanceDreSnapshotClaim,
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

/** NF-e mínima para os testes de invalidação (contrato real: externalId numérico). */
type FakeNfe = {
  id: string;
  externalId: number;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  cnpjEmitente: string | null;
};

function createFakeDb(initial: Array<Partial<FakeRow>> = [], nfes: FakeNfe[] = []) {
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

  const nfeModel = {
    findMany: async (args: { where?: Record<string, unknown>; select?: unknown } = {}) => {
      return nfes
        .filter((n) => (args.where ? matches(n as unknown as FakeRow, args.where) : true))
        .map((n) => ({ ...n }));
    },
  };

  const db = {
    financeDreAnnualSnapshot: model,
    nomusNfe: nfeModel,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    __rows: rows,
  };
  return db as unknown as FinanceDreSnapshotDb & {
    __rows: FakeRow[];
    nomusNfe: typeof nfeModel;
  };
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

describe("DRE snapshot — invalidação NF-e pelo contrato REAL do sync (externalId numérico)", () => {
  const NFES: FakeNfe[] = [
    {
      id: "uuid-101",
      externalId: 101,
      xmlDhEmi: new Date(2026, 2, 10),
      dataProcessamento: null,
      cnpjEmitente: "72.569.510/0001-95", // Lazarios (formatado de propósito)
    },
    {
      id: "uuid-102",
      externalId: 102,
      xmlDhEmi: null,
      dataProcessamento: new Date(2025, 10, 5),
      cnpjEmitente: "14055501000180", // Koppetel
    },
    {
      id: "uuid-103",
      externalId: 103,
      xmlDhEmi: new Date(2026, 6, 1),
      dataProcessamento: null,
      cnpjEmitente: "99999999000199", // desconhecido
    },
  ];

  function dbWithSnapshots(nfes: FakeNfe[]) {
    return createFakeDb(
      [
        seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 1)),
        seededRow(2026, "koppetel", makeRaw(2026, "koppetel", 1)),
        seededRow(2026, "sm", makeRaw(2026, "sm", 1)),
        seededRow(2026, "all", makeRaw(2026, "all", 1)),
        seededRow(2025, "koppetel", makeRaw(2025, "koppetel", 1)),
        seededRow(2025, "all", makeRaw(2025, "all", 1)),
        seededRow(2024, "sm", makeRaw(2024, "sm", 1)),
      ],
      nfes
    );
  }

  it("externalIds numéricos [101, 102] (com duplicado) → marca PJ + all dos anos certos e incrementa geração", async () => {
    const db = dbWithSnapshots(NFES);
    const result = await markFinanceDreSnapshotsDirtyForNfeExternalIds(
      db as never,
      [101, 102, 101],
      "nfes-sync"
    );
    // Conservador por produto cartesiano anos × empresas afetadas:
    // {2025,2026} × {lazarios,koppetel,all} ∩ existentes — sm e 2024 intocados.
    assert.equal(result.error, null);
    assert.equal(result.count, 5);
    const dirty = db.__rows
      .filter((r) => r.dirtyAt != null)
      .map((r) => `${r.year}/${r.company}`)
      .sort();
    assert.deepEqual(dirty, [
      "2025/all",
      "2025/koppetel",
      "2026/all",
      "2026/koppetel",
      "2026/lazarios",
    ]);
    for (const r of db.__rows.filter((row) => row.dirtyAt != null)) {
      assert.equal(r.dirtyGeneration, 1);
      assert.equal(r.dirtyReason, "nfes-sync");
    }
  });

  it("CNPJ emitente desconhecido → invalidação conservadora de TODAS as empresas do ano", async () => {
    const db = dbWithSnapshots(NFES);
    await markFinanceDreSnapshotsDirtyForNfeExternalIds(db as never, [103], "nfes-sync");
    const dirty = db.__rows
      .filter((r) => r.dirtyAt != null)
      .map((r) => `${r.year}/${r.company}`)
      .sort();
    assert.deepEqual(dirty, ["2026/all", "2026/koppetel", "2026/lazarios", "2026/sm"]);
  });

  it("lista vazia e externalId inexistente → nenhum snapshot tocado, sem erro", async () => {
    const db = dbWithSnapshots(NFES);
    const empty = await markFinanceDreSnapshotsDirtyForNfeExternalIds(db as never, [], "x");
    assert.deepEqual(empty, { count: 0, error: null });
    const missing = await markFinanceDreSnapshotsDirtyForNfeExternalIds(db as never, [777], "x");
    assert.deepEqual(missing, { count: 0, error: null });
    assert.equal(db.__rows.some((r) => r.dirtyAt != null), false);
  });

  it("a consulta é por externalId — UUIDs no lugar de números não passam no tipo/filtro", async () => {
    const db = dbWithSnapshots(NFES);
    // Contrato antigo bugado (UUID strings) não marca nada nem lança.
    const result = await markFinanceDreSnapshotsDirtyForNfeExternalIds(
      db as never,
      ["uuid-101", "uuid-102"] as unknown as number[],
      "nfes-sync"
    );
    assert.deepEqual(result, { count: 0, error: null });
  });

  it("backfill fiscal invalida pelos UUIDs internos (persistedNomusNfeIds)", async () => {
    const db = dbWithSnapshots(NFES);
    const result = await markFinanceDreSnapshotsDirtyForNfeIds(
      db as never,
      ["uuid-102"],
      "nfe-fiscal-backfill"
    );
    assert.equal(result.count, 2); // 2025/koppetel + 2025/all
    const dirty = db.__rows
      .filter((r) => r.dirtyAt != null)
      .map((r) => `${r.year}/${r.company}`)
      .sort();
    assert.deepEqual(dirty, ["2025/all", "2025/koppetel"]);
  });
});

describe("DRE snapshot — invalidação canônica de Documentos de Saída", () => {
  it("changedCount 0 → não invalida; changedCount > 0 → invalida existentes", async () => {
    const db = createFakeDb([
      seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 1)),
      seededRow(2026, "all", makeRaw(2026, "all", 1)),
    ]);
    const none = await markFinanceDreSnapshotsDirtyForStockDocumentChanges(db, {
      changedCount: 0,
      reason: "stock-documents-sync",
    });
    assert.deepEqual(none, { count: 0, error: null });
    assert.equal(db.__rows.some((r) => r.dirtyAt != null), false);

    const some = await markFinanceDreSnapshotsDirtyForStockDocumentChanges(db, {
      changedCount: 3,
      reason: "stock-documents-after-sales-orders",
    });
    assert.equal(some.count, 2);
    assert.equal(db.__rows.every((r) => r.dirtyAt != null), true);
  });
});

describe("DRE snapshot — FENCING da publicação (CRITICAL)", () => {
  it("cenário adversarial: claim de A expira, B assume e publica; A NÃO publica nem toca o estado de B", async () => {
    const rawA = makeRaw(2026, "lazarios", 1);
    const rawB = makeRaw(2026, "lazarios", 9);
    const db = createFakeDb([
      seededRow(2026, "lazarios", makeRaw(2026, "lazarios", 5), {
        dirtyGeneration: 10,
        dirtyAt: new Date(),
      }),
    ]);
    const row = () => db.__rows.find((r) => r.company === "lazarios")!;

    let bResult: Awaited<ReturnType<typeof refreshFinanceDreSnapshot>> | null = null;
    const aResult = await refreshFinanceDreSnapshot(
      db,
      { year: 2026, company: "lazarios" },
      {
        computeRaw: async () => {
          // t2: claim de A expira durante o cômputo…
          row().refreshClaimedAt = new Date(Date.now() - 11 * 60 * 1000);
          // t3/t4: …B assume e publica o payload B.
          bResult = await refreshFinanceDreSnapshot(
            db,
            { year: 2026, company: "lazarios" },
            { computeRaw: async () => rawB }
          );
          // t5: A termina e tenta publicar o payload A (obsoleto).
          return rawA;
        },
      }
    );

    assert.equal(bResult!.status, "refreshed");
    assert.equal(aResult.status, "claim_lost");
    // Payload final é o de B — A não sobrescreveu.
    assert.deepEqual(parseFinanceDreSnapshotSeriesPayload(row().seriesJson), rawB);
    // B publicou e liberou o próprio claim; A não recriou/zerou nada indevido.
    assert.equal(row().refreshClaimToken, null);
    assert.equal(row().refreshClaimedAt, null);
    // dirtyGeneration consistente (B limpou o dirty da geração 10).
    assert.equal(row().dirtyGeneration, 10);
    assert.equal(row().dirtyAt, null);
  });

  it("release com token antigo não toca o claim atual de B", async () => {
    const db = createFakeDb([seededRow(2026, "sm", makeRaw(2026, "sm", 1))]);
    const a = await claimFinanceDreSnapshotRefresh(db, 2026, "sm");
    assert.ok(a);
    const row = db.__rows.find((r) => r.company === "sm")!;
    row.refreshClaimedAt = new Date(Date.now() - 11 * 60 * 1000);
    const b = await claimFinanceDreSnapshotRefresh(db, 2026, "sm");
    assert.ok(b);
    await releaseFinanceDreSnapshotClaim(db, 2026, "sm", a!.token, "erro antigo");
    assert.equal(row.refreshClaimToken, b!.token);
    assert.equal(row.lastRefreshError, null); // erro de A não é registrado sobre claim de B
  });
});

describe("DRE snapshot — MISS concorrente espera o vencedor (sem segundo compute pesado)", () => {
  const query = { year: "2026", month: "8", company: "lazarios" };
  const referenceNow = new Date(2026, 7, 27, 10, 0, 0);

  it("claim ocupado: espera limitada e serve o snapshot publicado pelo vencedor", async () => {
    const raw = makeRaw(2026, "lazarios", 6);
    // Shell com claim ativo simula o processo A computando.
    const db = createFakeDb([
      {
        year: 2026,
        company: "lazarios",
        seriesJson: null,
        refreshClaimedAt: new Date(),
        refreshClaimToken: "token-A",
      },
    ]);
    let computeCalls = 0;
    let sleeps = 0;
    const report = await resolveFinanceDreReportWithSnapshot(query, referenceNow, {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        computeCalls += 1;
        return raw;
      },
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) {
          // A publica durante a espera de B.
          const row = db.__rows.find((r) => r.company === "lazarios")!;
          row.seriesJson = JSON.parse(
            JSON.stringify(serializeFinanceDreSnapshotSeriesPayload(raw))
          );
          row.computedAt = new Date();
          row.refreshClaimedAt = null;
          row.refreshClaimToken = null;
        }
      },
      missWaitAttempts: 4,
      missWaitIntervalMs: 250,
    });
    assert.equal(computeCalls, 0); // B nunca rodou o motor pesado
    assert.equal(sleeps, 2);
    assert.equal(report.snapshot.freshness, "fresh");
  });

  it("espera esgotada: fallback live sem persistir (contrato preservado)", async () => {
    const db = createFakeDb([
      {
        year: 2026,
        company: "lazarios",
        seriesJson: null,
        refreshClaimedAt: new Date(),
        refreshClaimToken: "token-A",
      },
    ]);
    let computeCalls = 0;
    const report = await resolveFinanceDreReportWithSnapshot(query, referenceNow, {
      db,
      loadRoleMap: async () => emptyRoleMap,
      computeRaw: async () => {
        computeCalls += 1;
        return makeRaw(2026, "lazarios", 6);
      },
      sleep: async () => {},
      missWaitAttempts: 2,
      missWaitIntervalMs: 250,
    });
    assert.equal(report.snapshot.freshness, "live");
    assert.equal(computeCalls, 1);
    // Nada foi persistido pelo perdedor.
    const row = db.__rows.find((r) => r.company === "lazarios")!;
    assert.equal(row.seriesJson, null);
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

  it("hooks de invalidação existem nos pontos reais de escrita, com o identificador certo", () => {
    const nfesSync = read("../../scripts/nomusNfesSync.ts");
    // NF-e: SEMPRE por externalId numérico (nunca o UUID interno) e cobrindo
    // resumo fiscal de nota unchanged (fiscal.skipped).
    assert.match(nfesSync, /markFinanceDreSnapshotsDirtyForNfeExternalIds\(\s*prisma/);
    assert.match(nfesSync, /dreAffectedNfeExternalIds/);
    assert.match(nfesSync, /fiscal\.skipped/);
    assert.equal(nfesSync.includes("markFinanceDreSnapshotsDirtyForNfes("), false);

    // Backfill fiscal: UUIDs realmente persistidos.
    assert.match(
      read("../../scripts/nomus-nfe-fiscal-backfill.ts"),
      /markFinanceDreSnapshotsDirtyForNfeIds\(\s*prisma,\s*result\.persistedNomusNfeIds/
    );

    // Documentos de Saída: os TRÊS caminhos usam a mesma função canônica.
    assert.match(
      read("../../scripts/nomusStockDocumentsSync.ts"),
      /markFinanceDreSnapshotsDirtyForStockDocumentChanges/
    );
    assert.match(
      read("../../scripts/nomusSalesOrdersSyncV1.ts"),
      /markFinanceDreSnapshotsDirtyForStockDocumentChanges/
    );
    assert.match(
      read("../../scripts/nomusStockDocumentsRepair.ts"),
      /markFinanceDreSnapshotsDirtyForStockDocumentChanges/
    );

    assert.match(
      read("../../scripts/nomusAccountsPayableSync.ts"),
      /markFinanceDreSnapshotsDirtySafe\(prisma,\s*\{\s*reason:\s*"accounts-payable-sync"/
    );
    assert.match(read("./productionCostPublication.server.ts"), /production-cost-publish/);
    const productsSync = read("../../scripts/nomusProductsSyncV1.ts");
    assert.match(productsSync, /products-sync/);
    assert.match(productsSync, /catalogSync\.upserted/);
    assert.match(
      read("./financeAccountsPayableCostCenterAllocationRoutes.ts"),
      /ap-allocation-manual/
    );
  });

  it("publicação exige o token do claim (fencing) no WHERE", () => {
    const src = read("./financeDreSnapshot.server.ts");
    const publishIdx = src.indexOf("async function publishOneInTx");
    assert.ok(publishIdx > 0);
    const publishSrc = src.slice(publishIdx, src.indexOf("export type FinanceDreSnapshotRefreshResult"));
    assert.match(publishSrc, /refreshClaimToken:\s*input\.claimToken/);
    // Sem create fallback: token perdido = abandono, nunca recriação.
    assert.equal(publishSrc.includes(".create("), false);
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
