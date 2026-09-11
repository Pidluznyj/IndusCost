/**
 * Evidências de homologação de CRM > Relatórios — SOMENTE LEITURA.
 *
 * Roda o pipeline REAL do endpoint (runCrmReportsAnalysis /
 * loadCrmReportsOperational / runCrmCustomReport / exportação) sobre a base
 * da homologação e produz as provas do fechamento técnico:
 *
 *   1. reconciliação × Pedidos de Venda (universo inteiro + amostra por perfil);
 *   2. recompra conferida À MÃO (implementação independente) × endpoint;
 *   3. exclusão EXCLUDE / ONLY no backend (universo, cards, listas, arquivo);
 *   4. escopo por usuário real (global / carteira própria / sem escopo);
 *   5. desempenho (tempo, payload, round-trips) sem N+1;
 *   6. construtor: agrupamentos e totais conferidos.
 *
 * Nada é escrito. A CLI (`scripts/homolog-crm-reports-evidence.ts`) abre a
 * conexão em modo somente leitura e injeta os usuários e as amostras por
 * status do pedido (seleção de casos de teste, não regra de compra).
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { resolveCrmCommercialAccessScope, type CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import { buildSalesOrderSellerFilterOptionLabel } from "@/src/lib/salesOrderNomusSellerDisplay.js";
import {
  CrmReportsForbiddenError,
  loadCrmReportsFilterOptions,
  loadCrmReportsOperational,
  resolveCrmReportsOwnersInBatches,
  runCrmReportsAnalysis,
  type CrmReportsDataSource,
  type CrmReportsRun,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";
import {
  CRM_REPORTS_VERIFIER_SCOPE,
  verifyCrmReportsAgainstSalesOrders,
  type CrmReportsVerificationResult,
} from "@/src/lib/commercial/crmReportsVerification.server.js";
import { runCrmCustomReport } from "@/src/lib/commercial/crmCustomReportService.server.js";
import { parseCrmCustomReportRequest } from "@/src/lib/commercial/crmCustomReportCore.js";
import { exportCrmReportsOperationalList } from "@/src/lib/commercial/crmReportsExportService.server.js";
import { parseCrmReportsOperationalRequest, type CrmReportsCustomerFacts } from "@/src/lib/commercial/crmReportsOperationalCore.js";
import { auditRepurchaseManually, compareManualAudit, type ManualAuditOrder } from "@/src/lib/commercial/crmRepurchaseManualAudit.js";
import {
  buildCrmCustomReportRequestBody,
  createDefaultCrmReportsUiState,
  createEmptyCrmReportBuilderState,
  resolveCrmReportPeriod,
} from "@/src/lib/commercial/crmReportsUiState.js";
import { CRM_REPORT_TEMPLATES, applyCrmReportTemplate } from "@/src/lib/commercial/crmReportsTemplates.js";
import type {
  CrmReportsListKey,
  CrmReportsNormalizedFilters,
  CrmReportsOperationalRequest,
} from "@/src/lib/commercial/crmReportsTypes.js";

type EvidencePrisma = Parameters<typeof verifyCrmReportsAgainstSalesOrders>[0] & {
  salesOrder: {
    findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
};

export type CrmReportsEvidenceStatus = "PASS" | "FAIL" | "SKIP";

export type CrmReportsEvidenceSection = {
  id: string;
  title: string;
  status: CrmReportsEvidenceStatus;
  /** Linhas em Markdown (tabelas e observações). */
  lines: string[];
};

export type CrmReportsEvidenceUser = { label: string; auth: AppAuthContext };

export type CrmReportsEvidenceInput = {
  prisma: EvidencePrisma;
  dataSource: CrmReportsDataSource;
  now: Date;
  /** Clientes com pedido ERROR / CANCELLED — só para montar a amostra. */
  statusSamples: { errorCustomerIds: readonly string[]; cancelledCustomerIds: readonly string[] };
  users: readonly CrmReportsEvidenceUser[];
  perCategory?: number;
  performanceRuns?: number;
  /** Contador de consultas SQL (eventos do Prisma), se a CLI tiver. */
  queryCount?: () => number;
};

export type CrmReportsEvidenceReport = {
  generatedAt: string;
  today: string;
  approved: boolean;
  sections: CrmReportsEvidenceSection[];
  markdown: string;
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const EMPTY_FILTERS: CrmReportsNormalizedFilters = {
  customerIds: [],
  commercialOwner: null,
  lastOrderSeller: null,
  cities: [],
  states: [],
  customerSelection: { mode: "ALL", customerIds: [] },
};

const cents = (value: number) => Math.round(value * 100);
const money = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ids = (facts: readonly CrmReportsCustomerFacts[]) => new Set(facts.map((f) => f.customer.id));
const esc = (text: string) => text.replace(/\|/g, "\\|");
const short = (id: string) => id.slice(0, 8);

function table(header: string[], rows: Array<Array<string | number | null>>): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map((c) => esc(c == null ? "—" : String(c))).join(" | ")} |`),
  ];
}

function operationalRequest(body: unknown) {
  const parsed = parseCrmReportsOperationalRequest(body);
  if (parsed.ok === false) throw new Error(`request inválido na evidência: ${parsed.errors.join(" ")}`);
  return parsed.request;
}

function withSelection(mode: "EXCLUDE" | "ONLY", customerIds: string[]): CrmReportsNormalizedFilters {
  return { ...EMPTY_FILTERS, customerSelection: { mode, customerIds } };
}

/** Conta chamadas ao banco por método (cada chamada = 1 round-trip, lotes incluídos). */
export function countingDataSource(ds: CrmReportsDataSource): {
  ds: CrmReportsDataSource;
  calls: Record<string, number>;
  reset: () => void;
} {
  const calls: Record<string, number> = {};
  const wrapped = {} as CrmReportsDataSource;
  for (const key of Object.keys(ds) as Array<keyof CrmReportsDataSource>) {
    const fn = ds[key] as unknown as (...args: unknown[]) => unknown;
    (wrapped as Record<string, unknown>)[key] = (...args: unknown[]) => {
      calls[key] = (calls[key] ?? 0) + 1;
      return fn.apply(ds, args);
    };
  }
  return {
    ds: wrapped,
    calls,
    reset: () => {
      for (const key of Object.keys(calls)) delete calls[key];
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Amostra por perfil
// ---------------------------------------------------------------------------

export const CRM_REPORTS_EVIDENCE_CATEGORIES = {
  manyOrders: "muitos pedidos",
  fewOrders: "poucos pedidos (1–2)",
  sameDayMultiple: "vários pedidos no mesmo dia",
  withError: "com pedido ERROR",
  withCancelled: "com pedido CANCELLED",
  withOwner: "com Responsável Comercial",
  withoutOwner: "sem Responsável Comercial",
  sellerDiffersFromOwner: "vendedor Nomus ≠ responsável",
} as const;
export type CrmReportsEvidenceCategory = keyof typeof CRM_REPORTS_EVIDENCE_CATEGORIES;

const normalizeName = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function selectEvidenceSamples(args: {
  analyzed: readonly CrmReportsCustomerFacts[];
  owners: ReadonlyMap<string, { sellerCanonicalName: string | null; sellerExternalId: number | null } | null>;
  sellerLabelOf: (externalSellerId: number) => string;
  errorCustomerIds: ReadonlySet<string>;
  cancelledCustomerIds: ReadonlySet<string>;
  perCategory: number;
}): Record<CrmReportsEvidenceCategory, CrmReportsCustomerFacts[]> {
  const { analyzed, owners, perCategory } = args;
  const withOrders = analyzed.filter((f) => f.totalOrders > 0);
  const recentFirst = (list: CrmReportsCustomerFacts[]) =>
    [...list].sort((a, b) => (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? ""));
  const take = (list: CrmReportsCustomerFacts[]) => list.slice(0, perCategory);
  const owner = (f: CrmReportsCustomerFacts) => owners.get(f.customer.id) ?? null;
  return {
    manyOrders: take([...withOrders].sort((a, b) => b.totalOrders - a.totalOrders)),
    fewOrders: take(recentFirst(withOrders.filter((f) => f.totalOrders <= 2))),
    sameDayMultiple: take(recentFirst(withOrders.filter((f) => f.occasions.some((o) => o.orderCount >= 2)))),
    withError: take(recentFirst(withOrders.filter((f) => args.errorCustomerIds.has(f.customer.id)))),
    withCancelled: take(recentFirst(analyzed.filter((f) => args.cancelledCustomerIds.has(f.customer.id)))),
    withOwner: take(recentFirst(withOrders.filter((f) => owner(f) != null))),
    withoutOwner: take(recentFirst(withOrders.filter((f) => owner(f) == null))),
    sellerDiffersFromOwner: take(
      recentFirst(
        withOrders.filter((f) => {
          const o = owner(f);
          const seller = f.lastOrder?.externalSellerId ?? null;
          if (!o || seller == null || seller <= 0) return false;
          if (o.sellerExternalId != null && o.sellerExternalId === seller) return false;
          return normalizeName(args.sellerLabelOf(seller)) !== normalizeName(o.sellerCanonicalName);
        })
      )
    ),
  };
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

async function reconciliationSection(
  input: CrmReportsEvidenceInput,
  run: CrmReportsRun,
  verification: CrmReportsVerificationResult
): Promise<CrmReportsEvidenceSection> {
  const analyzedIds = run.analysis.analyzed.map((f) => f.customer.id);
  const owners = await resolveCrmReportsOwnersInBatches(input.dataSource, analyzedIds);
  const sellerCtx = await run.loadSellerContext();
  const samples = selectEvidenceSamples({
    analyzed: run.analysis.analyzed,
    owners,
    sellerLabelOf: (id) => buildSalesOrderSellerFilterOptionLabel(id, sellerCtx),
    errorCustomerIds: new Set(input.statusSamples.errorCustomerIds),
    cancelledCustomerIds: new Set(input.statusSamples.cancelledCustomerIds),
    perCategory: input.perCategory ?? 3,
  });
  const rowsByCustomer = new Map<string, typeof verification.rows>();
  for (const row of verification.rows) {
    const list = rowsByCustomer.get(row.customerId) ?? [];
    list.push(row);
    rowsByCustomer.set(row.customerId, list);
  }

  const s = verification.summary;
  const lines = [
    `Universo inteiro: **${s.customersCompared}** clientes × 5 indicadores = ${s.comparisons} comparações · divergentes: **${s.divergentComparisons}** · totais divergentes: **${s.divergentTotals}**.`,
    `Janelas: 60d ${s.windows.recent60d.from}…${s.windows.recent60d.to} · 12m ${s.windows.rolling12m.from}…${s.windows.rolling12m.to} · hoje ${s.windows.today}.`,
    "",
    ...table(
      ["total", "Pedidos de Venda", "Relatório", "delta", "status"],
      verification.totals.map((t) => [
        t.indicator,
        t.kind === "money" ? money(t.pv) : t.pv,
        t.kind === "money" ? money(t.crm) : t.crm,
        t.kind === "money" ? money(t.delta) : t.delta,
        t.status,
      ])
    ),
    "",
    "Amostra por perfil (mesma conferência, cliente a cliente):",
    "",
  ];
  const sampleRows: Array<Array<string | number | null>> = [];
  let sampled = 0;
  for (const [category, facts] of Object.entries(samples) as Array<[CrmReportsEvidenceCategory, CrmReportsCustomerFacts[]]>) {
    if (facts.length === 0) {
      sampleRows.push([CRM_REPORTS_EVIDENCE_CATEGORIES[category], "(nenhum caso na base)", null, null, null, null, null, null]);
      continue;
    }
    for (const f of facts) {
      sampled += 1;
      const rows = rowsByCustomer.get(f.customer.id) ?? [];
      const cell = (indicator: string) => {
        const r = rows.find((x) => x.indicator === indicator);
        if (!r) return "—";
        const fmt = (v: number | string | null) => (r.kind === "money" && typeof v === "number" ? money(v) : String(v ?? "—"));
        return r.status === "OK" ? `${fmt(r.crm)} ✓` : `PV ${fmt(r.pv)} ≠ ${fmt(r.crm)} ✗`;
      };
      sampleRows.push([
        CRM_REPORTS_EVIDENCE_CATEGORIES[category],
        `${f.customer.companyName} (${short(f.customer.id)})`,
        f.totalOrders,
        cell("pedidos 60d"),
        cell("valor 60d"),
        cell("última compra"),
        cell("pedidos 12m"),
        cell("valor 12m"),
      ]);
    }
  }
  lines.push(
    ...table(["perfil", "cliente", "pedidos (hist.)", "orders60d", "purchaseValue60d", "lastPurchaseDate", "orders12m", "purchaseValue12m"], sampleRows)
  );
  for (const warning of verification.warnings) lines.push("", `Aviso: ${warning}`);
  return {
    id: "reconciliation",
    title: "Reconciliação com Pedidos de Venda",
    status: s.approved && sampled > 0 ? "PASS" : "FAIL",
    lines,
  };
}

async function officialOrdersOf(prisma: EvidencePrisma, customerId: string): Promise<ManualAuditOrder[]> {
  const rows = await prisma.salesOrder.findMany({
    where: { AND: [buildSalesOrderListWhere({}, { excludeEconomicGroupCustomers: true }), { customerId }] },
    select: { orderCode: true, issueDate: true, totalNetValue: true },
  });
  return rows.map((r) => {
    const value = r.totalNetValue as { toNumber?: () => number } | number | null;
    return {
      orderCode: String(r.orderCode ?? ""),
      issueDate: r.issueDate as Date,
      totalNetValue: typeof value === "number" ? value : value?.toNumber?.() ?? Number(value ?? 0),
    };
  });
}

async function repurchaseSection(input: CrmReportsEvidenceInput, run: CrmReportsRun): Promise<CrmReportsEvidenceSection> {
  const a = run.analysis;
  const today = a.windows.today;
  const pickOne = (list: CrmReportsCustomerFacts[], label: string) => (list[0] ? [{ label, facts: list[0] }] : []);
  const cadence = a.analyzed.filter((f) => f.cadence.occasionsUsed >= 2);
  const profiles = [
    ...pickOne(
      [...cadence].filter((f) => f.cadence.occasionsUsed === 6).sort((x, y) => (x.cadence.averageRepurchaseDays ?? 0) - (y.cadence.averageRepurchaseDays ?? 0)),
      "alta frequência"
    ),
    ...pickOne([...cadence].sort((x, y) => (y.cadence.averageRepurchaseDays ?? 0) - (x.cadence.averageRepurchaseDays ?? 0)), "esporádico"),
    ...pickOne(
      [...a.overdue].sort((x, y) => (y.cadence.deltaDays ?? 0) - (x.cadence.deltaDays ?? 0)),
      "atrasado"
    ),
    ...pickOne(a.analyzed.filter((f) => f.cadence.status === "INSUFFICIENT_HISTORY"), "uma compra"),
    ...pickOne(a.analyzed.filter((f) => f.occasions.some((o) => o.orderCount >= 2) && f.cadence.occasionsUsed >= 2), "vários pedidos no mesmo dia"),
  ];
  const unique = profiles.filter((p, i) => profiles.findIndex((q) => q.facts.customer.id === p.facts.customer.id) === i);
  if (unique.length === 0) return { id: "repurchase", title: "Recompra conferida à mão", status: "SKIP", lines: ["Base sem clientes com histórico."] };

  // Endpoint: a MESMA resposta que a tela recebe (ONLY com os clientes escolhidos).
  const response = await loadCrmReportsOperational(
    input.dataSource,
    CRM_REPORTS_VERIFIER_SCOPE,
    operationalRequest({
      filters: { customerSelection: { mode: "ONLY", customerIds: unique.map((p) => p.facts.customer.id) } },
      pagination: { cadence: { limit: 100 } },
    }),
    { now: input.now }
  );
  const lines: string[] = [`Hoje ${today}. Regra: últimas 6 ocasiões (dias distintos), média dos intervalos, esperada = última + arredondado(média), delta = hoje − esperada.`];
  let failed = 0;
  for (const { label, facts } of unique) {
    const orders = await officialOrdersOf(input.prisma, facts.customer.id);
    const manual = auditRepurchaseManually(orders, today);
    const row = response.repurchaseCadence.rows.find((r) => r.customerId === facts.customer.id);
    const diff = row
      ? compareManualAudit(manual, row)
      : [{ field: "linha no endpoint", manual: "presente", endpoint: "ausente" }];
    if (diff.length > 0) failed += 1;
    lines.push(
      "",
      `**${label} — ${facts.customer.companyName} (${short(facts.customer.id)})** · ${manual.totalOccasions} ocasião(ões) no histórico · ${diff.length === 0 ? "✓ conta manual = endpoint" : "✗ DIVERGE"}`,
      "",
      ...table(
        ["ocasião", "pedidos", "valor do dia"],
        manual.occasionsUsed.map((o) => [o.day, `${o.orderCodes.length}: ${o.orderCodes.join(", ")}`, money(o.totalNetValue)])
      ),
      "",
      ...table(
        ["", "intervalos", "média", "última", "esperada", "delta", "status", "confiança"],
        [
          ["manual", manual.intervals.join(" + ") || "—", manual.mean == null ? null : manual.mean.toFixed(2), manual.lastPurchase, manual.expected, manual.delta, manual.status, manual.confidence],
          row
            ? ["endpoint", "—", row.averageRepurchaseDays == null ? null : row.averageRepurchaseDays.toFixed(2), row.lastPurchaseDate, row.expectedRepurchaseDate, row.deltaDays, row.repurchaseStatus, row.cadenceConfidence]
            : ["endpoint", "linha ausente", null, null, null, null, null, null],
        ]
      )
    );
    for (const d of diff) lines.push(`- ✗ ${d.field}: manual ${d.manual} × endpoint ${d.endpoint}`);
  }
  return {
    id: "repurchase",
    title: "Recompra conferida à mão",
    status: failed === 0 ? "PASS" : "FAIL",
    lines: unique.length < 5 ? [...lines, "", `Observação: só ${unique.length} perfil(is) distinto(s) existem nesta base.`] : lines,
  };
}

function contributions(facts: CrmReportsCustomerFacts, run: CrmReportsRun) {
  const status = facts.cadence.status;
  return {
    customersPurchased60d: ids(run.analysis.recent60d).has(facts.customer.id) ? 1 : 0,
    repurchaseDueNext15d: status === "DUE_SOON" ? 1 : 0,
    overdueRepurchase: status === "OVERDUE" || status === "SEVERELY_OVERDUE" ? 1 : 0,
    severelyOverdueRepurchase: status === "SEVERELY_OVERDUE" ? 1 : 0,
    insufficientCadence: status === "INSUFFICIENT_HISTORY" ? 1 : 0,
  };
}

const EVIDENCE_AUTH = {
  id: "homolog-evidence",
  name: "Evidência de homologação (read-only)",
  email: null,
} as unknown as AppAuthContext;

async function exclusionSection(input: CrmReportsEvidenceInput, before: CrmReportsRun): Promise<CrmReportsEvidenceSection> {
  const x = before.analysis.overdue[0] ?? before.analysis.cadence[0];
  if (!x) return { id: "exclusion", title: "Exclusão EXCLUDE / ONLY", status: "SKIP", lines: ["Base sem clientes nas listas."] };
  const scope = CRM_REPORTS_VERIFIER_SCOPE;
  const after = await runCrmReportsAnalysis(input.dataSource, scope, withSelection("EXCLUDE", [x.customer.id]), { now: input.now });
  const expected = contributions(x, before);
  const checks: Array<[string, boolean, string]> = [];
  const b = before.analysis;
  const c = after.analysis;
  checks.push(["analyzedCustomers cai 1", c.universe.analyzedCustomers === b.universe.analyzedCustomers - 1, `${b.universe.analyzedCustomers} → ${c.universe.analyzedCustomers}`]);
  checks.push(["manuallyExcluded = 1", c.universe.manuallyExcluded === 1, String(c.universe.manuallyExcluded)]);
  const present = (["recent60d", "cadence", "overdue"] as const).filter((k) => ids(c[k]).has(x.customer.id));
  checks.push(["X some das 3 listas", present.length === 0, present.length ? `ainda em ${present.join(", ")}` : "ausente"]);
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    const want = b.indicators[key] - expected[key];
    checks.push([`card ${key}`, c.indicators[key] === want, `${b.indicators[key]} → ${c.indicators[key]} (esperado ${want})`]);
  }
  // Arquivo exportado com o MESMO corpo: X só pode aparecer como "Cliente excluído" no cabeçalho.
  const request = operationalRequest({ filters: { customerSelection: { mode: "EXCLUDE", customerIds: [x.customer.id] } } });
  for (const list of ["recent", "cadence", "overdue"] as CrmReportsListKey[]) {
    const file = await exportCrmReportsOperationalList({
      ds: input.dataSource,
      scope,
      auth: EVIDENCE_AUTH,
      request,
      list,
      format: "csv",
      options: { now: input.now },
    });
    const text = String(file.body);
    const lines = text.split("\r\n");
    const header = lines.findIndex((l) => l.startsWith("Cliente;"));
    const data = header >= 0 ? lines.slice(header + 1) : [];
    const leaked = data.some((l) => l.includes(x.customer.taxId) || l.startsWith(`${x.customer.companyName};`));
    const declared = lines.some((l) => l.startsWith("# Cliente excluído:") && l.includes(x.customer.id));
    checks.push([`exportação ${list}: X fora das linhas`, !leaked, `${file.rowCount} linha(s)`]);
    checks.push([`exportação ${list}: X declarado como excluído`, declared, declared ? "metadado presente" : "ausente"]);
  }

  // ONLY com 3 clientes das listas.
  const onlyIds = [...new Set([...b.cadence, ...b.recent60d].map((f) => f.customer.id))].slice(0, 3);
  const only = await runCrmReportsAnalysis(input.dataSource, scope, withSelection("ONLY", onlyIds), { now: input.now });
  const onlySet = new Set(onlyIds);
  const outside = (["recent60d", "cadence", "overdue"] as const).flatMap((k) => only.analysis[k]).filter((f) => !onlySet.has(f.customer.id));
  checks.push([`ONLY ${onlyIds.length} clientes: analisados = ${onlyIds.length}`, only.analysis.universe.analyzedCustomers === onlyIds.length, String(only.analysis.universe.analyzedCustomers)]);
  checks.push(["ONLY: nenhuma linha fora da seleção", outside.length === 0, outside.length ? `${outside.length} fora` : "ok"]);

  return {
    id: "exclusion",
    title: "Exclusão EXCLUDE / ONLY",
    status: checks.every(([, ok]) => ok) ? "PASS" : "FAIL",
    lines: [
      `X = ${x.customer.companyName} (${short(x.customer.id)}) · situação ${x.cadence.status} · nas listas: ${(["recent60d", "cadence", "overdue"] as const).filter((k) => ids(b[k]).has(x.customer.id)).join(", ")}.`,
      `ONLY = ${onlyIds.map(short).join(", ")}.`,
      "",
      ...table(["verificação", "resultado", "detalhe"], checks.map(([name, ok, detail]) => [name, ok ? "✓" : "✗", detail])),
    ],
  };
}

async function scopeSection(input: CrmReportsEvidenceInput, global: CrmReportsRun): Promise<CrmReportsEvidenceSection> {
  if (input.users.length === 0) {
    return { id: "scope", title: "Escopo por usuário", status: "SKIP", lines: ["Nenhum usuário informado/encontrado."] };
  }
  const rows: Array<Array<string | number | null>> = [];
  let failed = 0;
  const globalAuthorized = global.analysis.universe.authorizedCustomers;
  for (const { label, auth } of input.users) {
    const scope: CrmCommercialAccessScope = resolveCrmCommercialAccessScope(auth);
    let run: CrmReportsRun;
    try {
      run = await runCrmReportsAnalysis(input.dataSource, scope, EMPTY_FILTERS, { now: input.now });
    } catch (error) {
      const forbidden = error instanceof CrmReportsForbiddenError;
      rows.push([label, auth.role, scope.dataScope, forbidden ? "403 (sem escopo CRM)" : `erro: ${String(error)}`, null, null, forbidden ? "✓" : "✗"]);
      if (!forbidden) failed += 1;
      continue;
    }
    const u = run.analysis.universe;
    const checks: string[] = [];
    let ok = u.authorizedCustomers <= globalAuthorized;
    if (!ok) checks.push("vê acima do universo global");
    if (scope.dataScope === "own") {
      const owners = await resolveCrmReportsOwnersInBatches(input.dataSource, run.analysis.analyzed.map((f) => f.customer.id));
      const myIds = new Set([auth.externalSellerId, ...(auth.externalSellerIds ?? [])].filter((v): v is number => v != null));
      const foreign = run.analysis.analyzed.filter((f) => {
        const owner = owners.get(f.customer.id);
        if (!owner) return true;
        const byKey = scope.sellerIdentityKey && owner.sellerIdentityKey === scope.sellerIdentityKey;
        const byId = owner.sellerExternalId != null && myIds.has(owner.sellerExternalId);
        return !(byKey || byId);
      });
      if (foreign.length > 0) {
        ok = false;
        checks.push(`${foreign.length} cliente(s) fora da carteira`);
      } else checks.push("todos da própria carteira");
    }
    // Filtro "Vendedor do último pedido" nunca amplia: resultado ⊆ universo sem filtro.
    const options = await loadCrmReportsFilterOptions(input.dataSource, scope);
    const seller = [...options.lastOrderSellers].sort((p, q) => q.orderCount - p.orderCount)[0];
    if (seller) {
      const filtered = await runCrmReportsAnalysis(
        input.dataSource,
        scope,
        { ...EMPTY_FILTERS, lastOrderSeller: { sellerKey: seller.sellerKey, sellerName: null } },
        { now: input.now }
      );
      const base = ids(run.analysis.analyzed);
      const widened = filtered.analysis.analyzed.filter((f) => !base.has(f.customer.id));
      const sameAuthorized = filtered.analysis.universe.authorizedCustomers === u.authorizedCustomers;
      if (widened.length > 0 || !sameAuthorized) {
        ok = false;
        checks.push(`filtro vendedor ${seller.label} ampliou (${widened.length})`);
      } else checks.push(`filtro vendedor ${seller.label}: ${filtered.analysis.universe.analyzedCustomers} ⊆ ${u.analyzedCustomers}`);
    }
    if (!ok) failed += 1;
    rows.push([label, auth.role, scope.dataScope, u.authorizedCustomers, u.analyzedCustomers, checks.join("; "), ok ? "✓" : "✗"]);
  }
  return {
    id: "scope",
    title: "Escopo por usuário",
    status: failed === 0 ? "PASS" : "FAIL",
    lines: [
      `Universo global (máximo possível): ${globalAuthorized} clientes elegíveis. Carteira = CrmCustomerCommercialOwner ativo; vendedor Nomus só filtra dentro do universo.`,
      "",
      ...table(["usuário", "papel", "escopo", "universo permitido", "analisados", "verificações", "ok"], rows),
    ],
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function performanceSection(input: CrmReportsEvidenceInput, global: CrmReportsRun): Promise<CrmReportsEvidenceSection> {
  const counting = countingDataSource(input.dataSource);
  const options = await loadCrmReportsFilterOptions(input.dataSource, CRM_REPORTS_VERIFIER_SCOPE);
  const topOwner = [...options.commercialOwners].sort((a, b) => b.customerCount - a.customerCount)[0];
  const x = global.analysis.overdue[0] ?? global.analysis.analyzed[0];
  const only = global.analysis.cadence.slice(0, 3).map((f) => f.customer.id);
  const scenarios: Array<{ label: string; body: CrmReportsOperationalRequest }> = [
    { label: "sem filtros", body: {} },
    ...(topOwner ? [{ label: `responsável (${topOwner.label}, ${topOwner.customerCount} clientes)`, body: { filters: { commercialOwner: topOwner.filter } } }] : []),
    ...(x ? [{ label: "EXCLUDE 1 cliente", body: { filters: { customerSelection: { mode: "EXCLUDE" as const, customerIds: [x.customer.id] } } } }] : []),
    ...(only.length ? [{ label: `ONLY ${only.length} clientes`, body: { filters: { customerSelection: { mode: "ONLY" as const, customerIds: only } } } }] : []),
  ];
  const runs = Math.max(1, input.performanceRuns ?? 3);
  const rows: Array<Array<string | number | null>> = [];
  let nPlusOne = false;
  for (const scenario of scenarios) {
    const request = operationalRequest(scenario.body);
    await loadCrmReportsOperational(counting.ds, CRM_REPORTS_VERIFIER_SCOPE, request, { now: input.now }); // aquecimento
    const times: number[] = [];
    let bytes = 0;
    let calls: Record<string, number> = {};
    let queries: number | null = null;
    let customers = 0;
    for (let i = 0; i < runs; i += 1) {
      counting.reset();
      const q0 = input.queryCount?.() ?? 0;
      const t0 = performance.now();
      const response = await loadCrmReportsOperational(counting.ds, CRM_REPORTS_VERIFIER_SCOPE, request, { now: input.now });
      times.push(performance.now() - t0);
      bytes = Buffer.byteLength(JSON.stringify(response));
      calls = { ...counting.calls };
      queries = input.queryCount ? input.queryCount() - q0 : null;
      customers = response.universe.authorizedCustomers;
    }
    // Sem N+1: pedidos em lotes de 1.000 clientes; enriquecimento em ≤ 1 lote por lista.
    const orderBatches = calls.findSalesOrders ?? 0;
    const maxOrderBatches = Math.max(1, Math.ceil(customers / 1000));
    if (orderBatches > maxOrderBatches || (calls.resolveCommercialOwners ?? 0) > 3 || (calls.findActivities ?? 0) > 1) nPlusOne = true;
    rows.push([
      scenario.label,
      Math.round(median(times)),
      Math.round(Math.max(...times)),
      (bytes / 1024).toFixed(1),
      Object.entries(calls).map(([k, v]) => `${k}×${v}`).join(", "),
      queries,
    ]);
  }
  return {
    id: "performance",
    title: "Desempenho do endpoint operacional",
    status: nPlusOne ? "FAIL" : "PASS",
    lines: [
      `${runs} execução(ões) por cenário após aquecimento, escopo global, ${global.ordersLoaded} pedidos canônicos no universo.`,
      "",
      ...table(["cenário", "p50 (ms)", "máx (ms)", "payload (KB)", "chamadas ao banco (data source)", "consultas SQL"], rows),
      "",
      nPlusOne ? "✗ Número de chamadas cresce com as linhas — investigar N+1." : "✓ Sem N+1: pedidos em lotes de 1.000 clientes; responsável/vendedor/follow-up em lote só das páginas.",
      "EXPLAIN ANALYZE: `npx tsx scripts/explain-crm-reports-queries.ts` (mesma conexão somente leitura).",
    ],
  };
}

async function builderSection(
  input: CrmReportsEvidenceInput,
  global: CrmReportsRun,
  verification: CrmReportsVerificationResult
): Promise<CrmReportsEvidenceSection> {
  const wanted = ["sales-by-customer", "sales-by-owner", "owner-x-order-seller", "overdue-repurchase", "due-soon-repurchase"];
  const ui = createDefaultCrmReportsUiState();
  const rows: Array<Array<string | number | null>> = [];
  let failed = 0;
  const official12m = verification.totals.find((t) => t.indicator === "Σ valor 12m");
  const officialOrders12m = verification.totals.find((t) => t.indicator === "Σ pedidos 12m");
  for (const template of CRM_REPORT_TEMPLATES.filter((t) => wanted.includes(t.id))) {
    const builder = applyCrmReportTemplate(createEmptyCrmReportBuilderState(), template);
    const period = resolveCrmReportPeriod(builder, global.analysis.windows);
    const parsed = parseCrmCustomReportRequest(
      buildCrmCustomReportRequestBody({ builder, ui, period: period.ok ? period.period : null, limit: 500 })
    );
    if (parsed.ok === false) {
      failed += 1;
      rows.push([template.label, null, null, `spec inválido: ${parsed.errors.join(" ")}`, "✗"]);
      continue;
    }
    const { computed } = await runCrmCustomReport(input.dataSource, CRM_REPORTS_VERIFIER_SCOPE, parsed.spec, { now: input.now });
    const checks: string[] = [];
    let ok = true;
    const sumCents = computed.rows.reduce((acc, r) => acc + cents(Number(r.metrics.soldValue ?? 0)), 0);
    const sumOrders = computed.rows.reduce((acc, r) => acc + Number(r.metrics.orders ?? 0), 0);
    if (computed.totals.soldValue != null) {
      const same = sumCents === cents(Number(computed.totals.soldValue));
      ok &&= same;
      checks.push(`Σ linhas ${money(sumCents / 100)} ${same ? "=" : "≠"} total ${money(Number(computed.totals.soldValue))}`);
    }
    if (computed.totals.orders != null) {
      const same = sumOrders === Number(computed.totals.orders);
      ok &&= same;
      checks.push(`Σ pedidos ${sumOrders} ${same ? "=" : "≠"} ${computed.totals.orders}`);
    }
    if (template.id === "sales-by-customer" && official12m && officialOrders12m) {
      const same = cents(Number(computed.totals.soldValue ?? 0)) === cents(official12m.pv) && Number(computed.totals.orders ?? 0) === officialOrders12m.pv;
      ok &&= same;
      checks.push(`× Pedidos de Venda 12m ${money(official12m.pv)} / ${officialOrders12m.pv} pedidos ${same ? "✓" : "✗"}`);
    }
    if (parsed.spec.groupBy) {
      let groupCents = 0;
      for (const group of computed.groupsByKey.values()) groupCents += cents(Number(group.metrics.soldValue ?? 0));
      const same = groupCents === cents(Number(computed.totals.soldValue ?? 0));
      ok &&= same;
      checks.push(`Σ subtotais ${money(groupCents / 100)} ${same ? "=" : "≠"} total (${computed.groupsByKey.size} grupos)`);
    }
    if (template.id === "overdue-repurchase" || template.id === "due-soon-repurchase") {
      const expected =
        template.id === "overdue-repurchase"
          ? ids(global.analysis.overdue)
          : new Set(global.analysis.analyzed.filter((f) => f.cadence.status === "DUE_SOON").map((f) => f.customer.id));
      const got = new Set(computed.rows.map((r) => r.customerId).filter((v): v is string => v != null));
      const same = got.size === expected.size && [...got].every((id) => expected.has(id));
      ok &&= same;
      checks.push(`clientes ${got.size} ${same ? "=" : "≠"} lista do motor ${expected.size}`);
    }
    if (!ok) failed += 1;
    rows.push([template.label, computed.rows.length, money(Number(computed.totals.soldValue ?? 0)), checks.join("; "), ok ? "✓" : "✗"]);
  }
  return {
    id: "builder",
    title: "Construtor (modelos prontos)",
    status: failed === 0 ? "PASS" : "FAIL",
    lines: [
      "Período: últimos 12 meses (janelas do backend). Abertura da aba sem consulta ao construtor: conferir no DevTools (só `filter-options` + `operational`).",
      "",
      ...table(["modelo", "linhas", "total vendido", "conferências", "ok"], rows),
    ],
  };
}

// ---------------------------------------------------------------------------

export async function collectCrmReportsHomologEvidence(input: CrmReportsEvidenceInput): Promise<CrmReportsEvidenceReport> {
  const verification = await verifyCrmReportsAgainstSalesOrders(input.prisma, { now: input.now, dataSource: input.dataSource });
  const global = await runCrmReportsAnalysis(input.dataSource, CRM_REPORTS_VERIFIER_SCOPE, EMPTY_FILTERS, { now: input.now });
  const sections = [
    await reconciliationSection(input, global, verification),
    await repurchaseSection(input, global),
    await exclusionSection(input, global),
    await scopeSection(input, global),
    await performanceSection(input, global),
    await builderSection(input, global, verification),
  ];
  const approved = sections.every((s) => s.status !== "FAIL");
  const markdown = [
    `# Evidências de homologação — CRM > Relatórios`,
    "",
    `Gerado em ${new Date().toISOString()} · hoje (servidor) ${global.analysis.windows.today} · somente leitura · resultado: **${approved ? "APROVADO" : "REPROVADO"}**`,
    "",
    ...table(["seção", "status"], sections.map((s) => [s.title, s.status])),
    ...sections.flatMap((s) => ["", `## ${s.title} — ${s.status}`, "", ...s.lines]),
    "",
  ].join("\n");
  return { generatedAt: new Date().toISOString(), today: global.analysis.windows.today, approved, sections, markdown };
}
