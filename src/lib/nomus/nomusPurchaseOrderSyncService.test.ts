import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  computePurchaseOrderScheduleDelaySeconds,
  isPurchaseOrderTriggerAllowed,
  lookupNomusPurchaseOrderById,
  purchaseOrderSyncExitCode,
  resolvePurchaseOrderScheduleSource,
  resolvePurchaseOrderSyncFlags,
  sanitizePurchaseOrderSyncError,
} from "./nomusPurchaseOrderSyncService.server.js";
import {
  NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE,
  computeNextPurchaseOrderRuns,
  computePurchaseOrderSyncHealth,
  resolvePurchaseOrderStaleHours,
  sanitizePurchaseOrderRunSummary,
} from "./nomusPurchaseOrderSyncHealth.js";
import {
  parsePurchaseOrderPresenceFilter,
  purchaseOrderPresenceBadge,
  purchaseOrderSyncOverallLabel,
} from "./nomusPurchaseOrderSyncUi.js";
import { buildPurchaseOrderPresenceWhere, parseNomusPurchaseOrderListFilters } from "./nomusPurchaseOrderQuery.js";
import {
  CANONICAL_SYNC_SERVICE_NAMES,
  ENTITY_LOCK_FILE_DEFAULT,
  NOMUS_AUTOMATIC_SYNC_ROUTINES,
  SHELL_FORBIDDEN_BUSINESS_PATTERNS,
  buildCanonicalSyncExecution,
} from "./nomusCanonicalSyncContract.js";
import { isObservabilityIgnoredRun } from "./nomusSourceReconciliationObservability.js";
import { ADMIN_SETTINGS_PILOT_ENDPOINTS } from "../adminSettingsAccess.js";
import {
  NOMUS_PO_ADMIN_ROUTES,
  createPurchaseOrderAuthorizeGuard,
  registerNomusPurchaseOrdersSyncAdminRoutes,
} from "../nomusPurchaseOrdersSyncAdminRoutes.js";
import { parsePurchaseOrderCliRequest } from "../../../scripts/nomusPurchaseOrdersSync.js";
import {
  diagnosePurchaseOrderPresence,
  parsePurchaseOrderPresenceAuditArgs,
} from "../../../scripts/auditNomusPurchaseOrderPresence.js";

const read = (rel: string) => readFileSync(rel, "utf8");

describe("agenda independente — fonte única", () => {
  it("28. padrão = chain (comportamento legado preservado até a transição)", () => {
    assert.equal(resolvePurchaseOrderScheduleSource({}), "chain");
    assert.equal(resolvePurchaseOrderScheduleSource({ NOMUS_PO_SCHEDULE_SOURCE: "INDEPENDENT" }), "independent");
    assert.equal(resolvePurchaseOrderScheduleSource({ NOMUS_PO_SCHEDULE_SOURCE: "qualquer" }), "chain");
  });

  it("29. só a fonte ativa executa; painel/CLI sempre", () => {
    assert.equal(isPurchaseOrderTriggerAllowed("SCHEDULED_HOURLY", "chain").allowed, false);
    assert.equal(isPurchaseOrderTriggerAllowed("SCHEDULED_DAILY", "chain").allowed, false);
    assert.equal(isPurchaseOrderTriggerAllowed("CHAIN_AFTER_AR", "chain").allowed, true);
    assert.equal(isPurchaseOrderTriggerAllowed("SCHEDULED_HOURLY", "independent").allowed, true);
    assert.equal(isPurchaseOrderTriggerAllowed("CHAIN_AFTER_AR", "independent").allowed, false);
    for (const t of ["ADMIN_PANEL", "CLI", "TARGETED_AUDIT"]) {
      assert.equal(isPurchaseOrderTriggerAllowed(t, "chain").allowed, true);
      assert.equal(isPurchaseOrderTriggerAllowed(t, "independent").allowed, true);
    }
  });

  it("30. flags fail-closed: reconciliação desligada, só-prévia ligada, confirmação desligada", () => {
    const f = resolvePurchaseOrderSyncFlags({});
    assert.equal(f.absenceReconciliationEnabled, false);
    assert.equal(f.previewOnly, true);
    assert.equal(f.applyConfirmedEnabled, false);
    assert.equal(f.directedLookupEnabled, false);
    assert.equal(f.directedLookupTrust404, false);
    assert.equal(f.respectGlobalLock, true);
    assert.equal(f.reconcileScope, "full");
    assert.equal(f.incrementalMaxPages, 80);
  });

  it("31. minuto 37 e 03:37 BRT; atraso de disparo calculado", () => {
    assert.equal(computePurchaseOrderScheduleDelaySeconds("SCHEDULED_HOURLY", new Date("2026-10-23T14:39:00Z")), 120);
    assert.equal(computePurchaseOrderScheduleDelaySeconds("SCHEDULED_DAILY", new Date("2026-10-23T06:37:30Z")), 30);
    assert.equal(computePurchaseOrderScheduleDelaySeconds("ADMIN_PANEL", new Date()), null);
    const next = computeNextPurchaseOrderRuns(new Date("2026-10-23T14:40:00Z"));
    assert.equal(next.nextHourlyAt.toISOString(), "2026-10-23T15:37:00.000Z");
    assert.equal(next.nextDailyAt.toISOString(), "2026-10-24T06:37:00.000Z");
  });

  it("32. contrato canônico: 4 rotinas de Compras e lock próprio (OP-04)", () => {
    const po = NOMUS_AUTOMATIC_SYNC_ROUTINES.filter((r) => r.entity === "PURCHASE_ORDER");
    assert.deepEqual(po.map((r) => r.trigger).sort(), ["ADMIN_PANEL", "CHAIN_AFTER_AR", "SCHEDULED_DAILY", "SCHEDULED_HOURLY"]);
    assert.ok(po.every((r) => r.canonicalService === CANONICAL_SYNC_SERVICE_NAMES.PURCHASE_ORDER));
    assert.ok(po.filter((r) => r.strategy === "RECENT_WINDOW").every((r) => r.allowMissingDetection === false));
    assert.equal(ENTITY_LOCK_FILE_DEFAULT["nomus-purchase-orders"], "/tmp/induscost-nomus-purchase-orders.canonical.lock");
    const exec = buildCanonicalSyncExecution({
      entity: "PURCHASE_ORDER",
      strategy: "RECENT_WINDOW",
      mode: "apply",
      scope: {},
      sourceTrigger: "CHAIN_AFTER_AR",
      allowMissingDetection: true,
    });
    assert.equal(exec.allowMissingDetection, false, "incremental nunca detecta ausência");
  });
});

describe("resiliência e saída", () => {
  it("33. códigos de saída: pulo não é falha, parcial = 3, falha = 1", () => {
    assert.equal(purchaseOrderSyncExitCode("SUCCESS"), 0);
    assert.equal(purchaseOrderSyncExitCode("SKIPPED_LOCKED"), 0);
    assert.equal(purchaseOrderSyncExitCode("SKIPPED_SCHEDULE_SOURCE"), 0);
    assert.equal(purchaseOrderSyncExitCode("INCONCLUSIVE"), 3);
    assert.equal(purchaseOrderSyncExitCode("FAILED"), 1);
  });

  it("34. erro sanitizado: sem URL, corpo de resposta ou credencial", () => {
    const msg = sanitizePurchaseOrderSyncError(new Error("Falha HTTP 500 em https://erp/rest/pedidoscompra?pagina=2: {\"valorParcela\":\"1.000\"}"));
    assert.equal(msg, "Falha HTTP 500 no Nomus (pedidoscompra)");
    const other = sanitizePurchaseOrderSyncError(new Error("timeout chamando https://erp/rest?token=abc Authorization: Basic xyz"));
    assert.doesNotMatch(other, /https?:|abc|xyz/);
  });

  it("35. consulta por ID: 404 só vira 'não encontrado' com semântica validada", async () => {
    const notFound = async () => {
      throw new Error("Falha HTTP 404 em https://erp/rest/pedidoscompra/638: (sem corpo)");
    };
    const untrusted = await lookupNomusPurchaseOrderById({ deps: { fetchJson: notFound }, baseUrl: "https://erp/rest", externalId: 638, trust404: false });
    assert.deepEqual(untrusted, { status: "inconclusive", reason: "LOOKUP_404_SEMANTICS_NOT_VALIDATED" });
    const trusted = await lookupNomusPurchaseOrderById({ deps: { fetchJson: notFound }, baseUrl: "https://erp/rest", externalId: 638, trust404: true });
    assert.equal(trusted.status, "not_found");
    const other = await lookupNomusPurchaseOrderById({
      deps: { fetchJson: async () => ({ id: 999 }) },
      baseUrl: "https://erp/rest",
      externalId: 638,
      trust404: true,
    });
    assert.equal(other.status, "inconclusive");
    const found = await lookupNomusPurchaseOrderById({
      deps: { fetchJson: async () => ({ id: 638, codigoPedido: "PC00637" }) },
      baseUrl: "https://erp/rest",
      externalId: 638,
      trust404: false,
    });
    assert.equal(found.status, "found");
  });
});

describe("saúde e observabilidade", () => {
  const run = (id: string, status: string, startedAt: string, strategy = "RECENT_WINDOW") => ({
    id,
    status,
    strategy,
    startedAt: new Date(startedAt),
    finishedAt: new Date(startedAt),
    payloadComplete: status === "SUCCESS",
  });

  it("36. pulo e prévia não atualizam o último sucesso; STALE após o limite", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const h = computePurchaseOrderSyncHealth({
      runs: [
        run("skip", "SKIPPED", "2026-10-23T11:37:00Z"),
        run("prev", "SUCCESS", "2026-10-23T11:00:00Z", "FULL_RECONCILIATION_PREVIEW"),
        run("ok", "SUCCESS", "2026-10-23T07:37:00Z"),
      ],
      now,
      staleHours: 3,
    });
    assert.equal(h.lastSuccess?.id, "ok");
    assert.equal(h.overallStatus, "STALE");
    assert.equal(h.staleReason, "LAST_SUCCESS_TOO_OLD");
  });

  it("37. RUNNING preso além do limite = STALE; parcial recente = INCONCLUSIVE", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    assert.equal(
      computePurchaseOrderSyncHealth({ runs: [run("r", "RUNNING", "2026-10-23T08:00:00Z")], now, staleHours: 3 }).staleReason,
      "RUN_STUCK_IN_RUNNING"
    );
    assert.equal(
      computePurchaseOrderSyncHealth({
        runs: [run("p", "INCONCLUSIVE", "2026-10-23T11:37:00Z"), run("ok", "SUCCESS", "2026-10-23T10:37:00Z")],
        now,
        staleHours: 3,
      }).overallStatus,
      "INCONCLUSIVE"
    );
    assert.equal(resolvePurchaseOrderStaleHours("chain", {}), 5);
    assert.equal(resolvePurchaseOrderStaleHours("independent", {}), 3);
  });

  it("38. observabilidade ignora pulos e prévias; resumo do painel sem payload", () => {
    assert.equal(isObservabilityIgnoredRun({ status: "SKIPPED", strategy: "RECENT_WINDOW" }), true);
    assert.equal(isObservabilityIgnoredRun({ status: "SUCCESS", strategy: "FULL_RECONCILIATION_PREVIEW" }), true);
    assert.equal(isObservabilityIgnoredRun({ status: "SUCCESS", strategy: "FULL_RECONCILIATION" }), false);
    const safe = sanitizePurchaseOrderRunSummary({ trigger: "SCHEDULED_DAILY", rawPayload: { x: 1 }, token: "t", fetch: { pagesRead: 2 } });
    assert.deepEqual(safe, { trigger: "SCHEDULED_DAILY", fetch: { pagesRead: 2 } });
  });
});

describe("carteira e rótulos", () => {
  it("39. carteira padrão exclui só o confirmado; em verificação permanece", () => {
    assert.equal(parseNomusPurchaseOrderListFilters({}).presence, "ACTIVE");
    assert.deepEqual(buildPurchaseOrderPresenceWhere("ACTIVE"), { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } });
    assert.equal(buildPurchaseOrderPresenceWhere("ALL"), null);
    assert.equal(parsePurchaseOrderPresenceFilter("missing_confirmed"), "MISSING_CONFIRMED");
    assert.equal(parsePurchaseOrderPresenceFilter("x"), "ACTIVE");
  });

  it("40. selos distintos para cancelado oficial, em verificação e confirmado", () => {
    assert.equal(purchaseOrderPresenceBadge({ sourcePresenceStatus: "PRESENT", stage: "CANCELED" }), null);
    assert.equal(purchaseOrderPresenceBadge({ sourcePresenceStatus: "MISSING_CANDIDATE" })?.label, "Ausente no Nomus — em verificação");
    assert.equal(purchaseOrderPresenceBadge({ sourcePresenceStatus: "MISSING_CONFIRMED" })?.label, "Ausente no Nomus — confirmado");
    assert.equal(purchaseOrderSyncOverallLabel("STALE"), "Sincronização atrasada");
  });
});

describe("painel — permissões e rotas", () => {
  type Handler = (req: unknown, res: unknown, next: () => void) => unknown;
  const fakeApp = () => {
    const routes: Array<{ method: string; path: string; handlers: Handler[] }> = [];
    const add = (method: string) => (path: string, ...handlers: Handler[]) => routes.push({ method, path, handlers });
    return { app: { get: add("GET"), post: add("POST") } as never, routes };
  };
  const guardTag = (action: string) => Object.assign(((_req: unknown, _res: unknown, next: () => void) => next()) as Handler, { action });

  it("41. view para leitura, execute para disparo; autorizar exige execute + Super Admin + frase", () => {
    const { app, routes } = fakeApp();
    registerNomusPurchaseOrdersSyncAdminRoutes(
      app,
      { requireBootstrapOrResource: (_b, _key, action) => guardTag(String(action)) as never },
      { prisma: {} as never }
    );
    const actionOf = (method: string, path: string) =>
      (routes.find((r) => r.method === method && r.path === path)?.handlers[0] as unknown as { action: string }).action;
    assert.equal(actionOf("GET", NOMUS_PO_ADMIN_ROUTES.status), "view");
    assert.equal(actionOf("GET", NOMUS_PO_ADMIN_ROUTES.runs), "view");
    assert.equal(actionOf("GET", NOMUS_PO_ADMIN_ROUTES.runDetail), "view");
    assert.equal(actionOf("GET", NOMUS_PO_ADMIN_ROUTES.missing), "view");
    assert.equal(actionOf("POST", NOMUS_PO_ADMIN_ROUTES.run), "execute");
    assert.equal(actionOf("POST", NOMUS_PO_ADMIN_ROUTES.reconcilePreview), "execute");
    assert.equal(actionOf("POST", NOMUS_PO_ADMIN_ROUTES.reconcileApply), "execute");
    assert.equal(routes.find((r) => r.path === NOMUS_PO_ADMIN_ROUTES.reconcileApply)?.handlers.length, 4);
  });

  it("42. guarda de autorização: 401 sem sessão, 403 sem Super Admin, segue com Super Admin", () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, STRICT: process.env.REQUIRE_RESOURCE_STRICT };
    process.env.REQUIRE_RESOURCE_STRICT = "1";
    try {
      const guard = createPurchaseOrderAuthorizeGuard(() => false) as unknown as Handler;
      const call = (req: unknown) => {
        const res = { code: 0, status(c: number) { this.code = c; return this; }, json() { return this; } };
        let nexted = false;
        guard(req, res, () => (nexted = true));
        return { code: res.code, nexted };
      };
      assert.equal(call({}).code, 401);
      assert.equal(call({ appAuth: { role: "ADMIN" } }).code, 403);
      assert.equal(call({ appAuth: { role: "SUPER_ADMIN" } }).nexted, true);
    } finally {
      if (previous.STRICT === undefined) delete process.env.REQUIRE_RESOURCE_STRICT;
      else process.env.REQUIRE_RESOURCE_STRICT = previous.STRICT;
    }
  });

  it("43. endpoints registrados no contrato de permissões", () => {
    const paths = ADMIN_SETTINGS_PILOT_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    for (const expected of [
      "GET /api/settings/nomus-sync/*-status",
      "POST /api/settings/nomus-sync/*-run",
      "GET /api/settings/nomus-sync/purchase-orders-runs*",
      "GET /api/settings/nomus-sync/purchase-orders-missing",
      "POST /api/settings/nomus-sync/purchase-orders-reconcile-preview",
      "POST /api/settings/nomus-sync/purchase-orders-reconcile-apply",
    ]) {
      assert.ok(paths.includes(expected), expected);
    }
    assert.match(NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE, /AUTORIZO/);
  });
});

describe("scripts, shell e cron", () => {
  it("44. CLI: trigger explícito, sem herdar o trigger exportado pelo runner de CR", () => {
    const r = parsePurchaseOrderCliRequest(["apply", "--incremental", "--trigger=CHAIN_AFTER_AR"], {
      NOMUS_CANONICAL_SOURCE_TRIGGER: "SCHEDULED_HOURLY",
    });
    assert.equal(r.trigger, "CHAIN_AFTER_AR");
    assert.equal(r.strategy, "RECENT_WINDOW");
    assert.equal(parsePurchaseOrderCliRequest(["preview"], { NOMUS_CANONICAL_SOURCE_TRIGGER: "SCHEDULED_HOURLY" }).trigger, "CLI");
    const reconcile = parsePurchaseOrderCliRequest(["apply", "--reconcile"], {});
    assert.equal(reconcile.strategy, "FULL_RECONCILIATION");
    assert.equal(reconcile.allowMissingDetection, true);
    const backfill = parsePurchaseOrderCliRequest(["apply", "--backfill"], {});
    assert.equal(backfill.allowMissingDetection, false, "backfill nunca avalia ausência");
    assert.equal(parsePurchaseOrderCliRequest(["preview", "--lookup=638"], {}).strategy, "TARGETED_LOOKUP");
  });

  it("45. shell fino: sem regra de negócio, sem flock do lock global, delega ao CLI canônico", () => {
    const sh = read("scripts/runNomusPurchaseOrdersSync.sh");
    for (const pattern of SHELL_FORBIDDEN_BUSINESS_PATTERNS) assert.doesNotMatch(sh, pattern);
    assert.doesNotMatch(sh, /flock/);
    assert.match(sh, /npm run "nomus:purchase-orders:\$\{STRATEGY\}:\$\{MODE\}"/);
    assert.match(read("scripts/runNomusAccountsReceivableSync.sh"), /NOMUS_PO_TRIGGER=CHAIN_AFTER_AR bash/);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const s of ["incremental", "reconcile", "backfill"]) {
      for (const m of ["preview", "apply"]) assert.ok(pkg.scripts[`nomus:purchase-orders:${s}:${m}`], `${s}:${m}`);
    }
    const service = read("src/lib/nomus/nomusPurchaseOrderSyncService.server.ts");
    assert.match(service, /waitForGlobalNomusSyncLockToFree/);
    assert.doesNotMatch(service, /\.delete\(|deleteMany\(/);
  });

  it("46. cron versionado: minuto 37 horário + diário, gerado pelo instalador, homolog bloqueada por padrão", () => {
    const tpl = read("infra/cron/nomus-purchase-orders/induscost-nomus-purchase-orders.cron.template");
    assert.match(tpl, /^37 \* \* \* \* __RUN_AS__ NOMUS_PO_TRIGGER=SCHEDULED_HOURLY .* apply incremental/m);
    assert.match(tpl, /^37 __DAILY_HOUR__ \* \* \* __RUN_AS__ NOMUS_PO_TRIGGER=SCHEDULED_DAILY .* apply reconcile/m);
    const installer = read("scripts/installNomusPurchaseOrdersCron.sh");
    assert.match(installer, /--allow-homolog/);
    assert.match(installer, /utc_minutes=\$\(\(6 \* 60 \+ 37\)\)/);
    assert.doesNotMatch(installer, /DELETE FROM|TRUNCATE|DROP TABLE/i);
  });

  it("47. auditoria do 638 é somente leitura e não trata 404 como prova", () => {
    const src = read("scripts/auditNomusPurchaseOrderPresence.ts");
    assert.doesNotMatch(src, /\.(create|update|upsert|delete|deleteMany|updateMany|createMany)\(|\$executeRaw/);
    assert.match(src, /trust404: false/);
    assert.equal(parsePurchaseOrderPresenceAuditArgs([]).externalId, 638);
    const d = diagnosePurchaseOrderPresence({
      order: { stage: "APPROVED", sourcePresenceStatus: "PRESENT", lastSeenAt: new Date("2026-10-22T10:00:00Z"), missingConsecutiveRuns: 0 },
      lastCompleteFullRun: null,
      absenceReconciliationEnabled: false,
      previewOnly: true,
    });
    assert.ok(d.some((line) => /incremental só faz upsert/.test(line)));
  });

  it("48. migration aditiva com inicialização conservadora e rollback sem apagar pedidos", () => {
    const sql = read("prisma/migrations/20261101120000_nomus_purchase_order_source_lifecycle/migration.sql");
    assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE|DROP COLUMN/i);
    assert.match(sql, /ADD VALUE IF NOT EXISTS 'PURCHASE_ORDER'/);
    assert.match(sql, /ADD VALUE IF NOT EXISTS 'SKIPPED'/);
    assert.match(sql, /UPDATE "NomusPurchaseOrder" SET "presentInLastPayload" = false/);
    const rollback = read("docs/nomus/rollback/20261101120000_nomus_purchase_order_source_lifecycle.rollback.sql");
    assert.doesNotMatch(rollback, /DELETE FROM "NomusPurchaseOrder"|DROP TABLE "NomusPurchaseOrder"\b/);
  });
});
