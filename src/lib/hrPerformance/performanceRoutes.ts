/**
 * Rotas administrativas e portal público do ciclo de desempenho.
 * A flag desligada responde 404 antes de ler o banco. O token não entra em log.
 *
 * Toda mutação passa por `mutate`: lê o estado, aplica o caso de uso e grava só a
 * diferença. Se outra gravação entrou antes (revisão do grafo mudou), relê e reaplica o
 * caso de uso sobre o estado novo; conflitos reais (versão da tarefa) continuam
 * respondendo 409 pelo próprio caso de uso.
 */
import { randomBytes } from "node:crypto";
import type express from "express";
import type { RequestHandler } from "express";
import { buildPerformanceScope, type PerformanceAccessScope, type PerformanceScope } from "./performanceAccess.js";
import { PERFORMANCE_RESOURCE_KEYS } from "./performanceAccessKeys.js";
import { classifyEligibility, isCycleStatus, isNineBoxBand, parseAnswer, parseRules, type EmployeeSnapshotSource } from "./performanceDomain.js";
import { requirePerformanceCycleEnabled } from "./performanceFeatureFlags.js";
import {
  calibrationQueue,
  cycleEvolution,
  dashboard,
  dashboardCounts,
  describeCycle,
  employeeHistory,
  modelDetail,
  pdiTracking,
  reportData,
  reportRows,
  resultHistory,
} from "./performanceInsights.js";
import { GraphConflictError, HistoryIntegrityError, type PerformanceStore } from "./performancePrisma.js";
import { createRateLimiter } from "./performanceRateLimit.js";
import type { PerformanceDatabase } from "./performanceState.js";
import {
  acknowledgeFeedback,
  addCheckin,
  applyParticipants,
  archiveModel,
  calibrate,
  claimAssisted,
  createCycle,
  createDraftModel,
  createFeedback,
  createPdi,
  dispatchReminders,
  duplicateModel,
  exchangeLink,
  isReportKind,
  issueInvite,
  issueInvitesBatch,
  issueReport,
  leaderQueue,
  moveDraftQuestion,
  openAssisted,
  planReminders,
  publicForm,
  publicLogout,
  publicSave,
  publicSubmit,
  publishModel,
  readLeaderForm,
  recordExport,
  reassignLeader,
  recordConduct,
  removeParticipant,
  returnForRevision,
  revokeInvite,
  saveAnswers,
  setEligibilityException,
  submitAssignment,
  transitionCycle,
  updateCycle,
  updateDraftQuestion,
  updateModelDraft,
  updatePdiStatus,
  validateTechnical,
  verifyOtp,
  type ServiceOptions,
  type ServiceResult,
} from "./performanceService.js";

export { type PerformanceStore } from "./performancePrisma.js";

const SESSION_COOKIE = "ic_perf_session";
const MAX_WRITE_ATTEMPTS = 4;

export type PerformanceCapabilities = {
  view: boolean;
  evaluate: boolean;
  manage: boolean;
  calibrate: boolean;
  report: boolean;
  invites: boolean;
  conduct: boolean;
};

export type PerformanceRouteDeps = {
  enabled: () => boolean;
  options: ServiceOptions;
  store: PerformanceStore;
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  loadScope: (req: express.Request) => Promise<{ accessScope: PerformanceAccessScope; actorEmployeeId: string | null; teamIds: string[] }>;
  loadEmployees: (ids: string[]) => Promise<EmployeeSnapshotSource[]>;
  searchEmployees?: (query: string) => Promise<EmployeeSnapshotSource[]>;
  /** Afastamento e mudança de função/setor no período de referência, do cadastro oficial. */
  loadEligibilitySignals?: (employeeIds: string[], since: Date) => Promise<{ absenceIds: string[]; roleChangeIds: string[] }>;
  actorUserId: (req: express.Request) => Promise<string | null>;
  actorName?: (req: express.Request) => Promise<string | null>;
  /** Mesma decisão do guard (deny > allow), para a tela esconder o que o servidor recusaria. */
  can?: (req: express.Request, resourceKey: string, action: string) => Promise<boolean>;
};

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function sessionToken(req: express.Request): string {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

function setSession(res: express.Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/public/performance; Max-Age=28800${secure}`
  );
}

function clearSession(res: express.Response) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/public/performance; Max-Age=0`);
}

const STATUS_BY_CODE: Record<string, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_NAME: 400,
  INVALID_TEXT: 400,
  INVALID_DATE: 400,
  INVALID_PERIOD: 400,
  INVALID_RULES: 400,
  INVALID_STATUS: 400,
  INVALID_BAND: 400,
  INVALID_DECISION: 400,
  INVALID_ANSWER: 400,
  INVALID_ACTION: 400,
  INVALID_COMPETENCY: 400,
  NOTE_REQUIRED: 400,
  JUSTIFICATION_REQUIRED: 400,
  EVIDENCE_REQUIRED: 400,
  LEADER_REQUIRED: 400,
};

function statusOf(code: string): number {
  return STATUS_BY_CODE[code] ?? 409;
}

type Mutation<T> = (db: PerformanceDatabase) => ServiceResult<T> | Promise<ServiceResult<T>>;

/**
 * Lê, aplica e grava a diferença. Em conflito de revisão do grafo, repete com o estado
 * novo. Devolve o valor do caso de uso ou responde o erro.
 */
async function mutate<T>(store: PerformanceStore, res: express.Response, run: Mutation<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const before = await store.read();
    const result = await run(before);
    const next = result.db;
    if (next && next !== before) {
      try {
        await store.write(next, before);
      } catch (error) {
        if (error instanceof GraphConflictError) continue;
        if (error instanceof HistoryIntegrityError) {
          res.status(500).json({ error: "HISTORY_INTEGRITY", message: "A gravação foi recusada para preservar o histórico." });
          return { ok: false, code: "HISTORY_INTEGRITY", message: error.message };
        }
        throw error;
      }
    }
    if (result.ok === false) return { ok: false, code: result.code, message: result.message };
    return { ok: true, value: result.value };
  }
  res.status(409).json({ error: "VERSION_CONFLICT", message: "Muitas gravações ao mesmo tempo. Tente de novo." });
  return { ok: false, code: "VERSION_CONFLICT", message: "conflict" };
}

/** Variante administrativa: responde o erro com o status HTTP do código. */
async function mutateAdmin<T>(store: PerformanceStore, res: express.Response, run: Mutation<T>, status = 200) {
  const outcome = await mutate(store, res, run);
  if (res.headersSent) return;
  noStore(res);
  if (outcome.ok === false) {
    res.status(statusOf(outcome.code)).json({ error: outcome.code, message: outcome.message });
    return;
  }
  res.status(status).json(outcome.value);
}

function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function strOrNull(value: unknown, max = 2000): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : null;
}

function filtersFrom(query: express.Request["query"]) {
  return {
    department: typeof query.department === "string" && query.department ? query.department : null,
    role: typeof query.role === "string" && query.role ? query.role : null,
    manager: typeof query.manager === "string" && query.manager ? query.manager : null,
  };
}

/** Portal público só aceita JSON: formulário de outro site não consegue enviar sem preflight. */
const requireJson: RequestHandler = (req, res, next) => {
  if (req.method === "GET" || req.is("application/json")) return next();
  res.status(415).json({ ok: false, message: "Formato não aceito." });
};

type Handler = express.RequestHandler;

/**
 * Express 4 não captura promessa rejeitada: um erro de banco numa rota derrubaria o processo
 * inteiro do IndusCost (achado no teste de navegador). Toda rota do módulo passa por aqui:
 * responde 500 neutro e registra só o código do erro, nunca dados, token ou texto livre.
 */
function guardedApp(app: express.Application) {
  const wrap = (handlers: unknown[]) =>
    handlers.map((handler, index) => {
      if (index !== handlers.length - 1 || typeof handler !== "function") return handler;
      const fn = handler as Handler;
      return ((req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error: unknown) => {
          const code = (error as { code?: string; name?: string } | null)?.code ?? (error as { name?: string } | null)?.name ?? "erro";
          console.error(`[desempenho] falha em ${req.method} ${req.route?.path ?? "rota"}: ${code}`);
          if (!res.headersSent) res.status(500).json({ error: "INTERNAL", ok: false, message: "Falha interna. Tente de novo em instantes." });
        });
      }) as Handler;
    });
  return {
    get: (path: string, ...handlers: unknown[]) => app.get(path, ...(wrap(handlers) as Handler[])),
    post: (path: string, ...handlers: unknown[]) => app.post(path, ...(wrap(handlers) as Handler[])),
    put: (path: string, ...handlers: unknown[]) => app.put(path, ...(wrap(handlers) as Handler[])),
  };
}

export function registerPerformanceRoutes(expressApp: express.Application, deps: PerformanceRouteDeps): void {
  const app = guardedApp(expressApp);
  const gate = requirePerformanceCycleEnabled(deps.enabled);
  const view = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "view")];
  const manage = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "manage")];
  const evaluate = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "update")];
  const calibrateGuard = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.calibration, "manage")];
  const report = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.reports, "view")];
  const invites = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.invites, "manage")];
  const conduct = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.conduct, "manage")];
  const publicLimit = createRateLimiter("perf-public", { windowMs: 60_000, max: 240 });
  const publicAuthLimit = createRateLimiter("perf-public-auth", { windowMs: 60_000, max: 20 });
  const pub = [gate, publicLimit, requireJson];
  const pubAuth = [gate, publicLimit, publicAuthLimit, requireJson];

  const scopeOf = async (req: express.Request): Promise<{ scope: PerformanceScope; actorEmployeeId: string | null; accessScope: PerformanceAccessScope }> => {
    const input = await deps.loadScope(req);
    return { scope: buildPerformanceScope(input), actorEmployeeId: input.actorEmployeeId, accessScope: input.accessScope };
  };
  const now = () => deps.options.now();

  app.get("/api/hr/performance/feature-status", deps.requireAppAuth, (_req, res) => {
    noStore(res);
    res.json({ enabled: deps.enabled() });
  });

  app.get("/api/hr/performance/me", deps.requireAppAuth, gate, async (req, res) => {
    const { accessScope, actorEmployeeId } = await scopeOf(req);
    const can = deps.can ?? (async () => false);
    const keys = PERFORMANCE_RESOURCE_KEYS;
    const [viewCap, evaluateCap, manageCap, calibrateCap, reportCap, invitesCap, conductCap] = await Promise.all([
      can(req, keys.module, "view"),
      can(req, keys.module, "update"),
      can(req, keys.module, "manage"),
      can(req, keys.calibration, "manage"),
      can(req, keys.reports, "view"),
      can(req, keys.invites, "manage"),
      can(req, keys.conduct, "manage"),
    ]);
    const capabilities: PerformanceCapabilities = {
      view: viewCap,
      evaluate: evaluateCap,
      manage: manageCap && accessScope === "ALL",
      calibrate: calibrateCap && accessScope === "ALL",
      report: reportCap,
      invites: invitesCap && accessScope === "ALL",
      conduct: conductCap,
    };
    noStore(res);
    res.json({ accessScope, actorEmployeeId, capabilities, officialPublication: deps.options.officialPublication });
  });

  // ---------------------------------------------------------------- modelos
  app.get("/api/hr/performance/models", ...view, async (_req, res) => {
    const db = await deps.store.read();
    noStore(res);
    res.json({
      models: db.models
        .map((model) => ({
          id: model.id,
          lineageId: model.lineageId,
          name: model.name,
          description: model.description,
          status: model.status,
          version: model.version,
          governance: model.governance,
          ruleSetId: model.rules.ruleSetId,
          publishedAt: model.publishedAt,
          archivedAt: model.archivedAt,
          createdAt: model.createdAt,
          questionCount: db.questions.filter((q) => q.modelId === model.id).length,
          cycles: db.cycles.filter((c) => c.modelId === model.id).length,
          homologated: false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || b.version - a.version),
    });
  });

  app.get("/api/hr/performance/models/:id", ...view, async (req, res) => {
    const db = await deps.store.read();
    const detail = modelDetail(db, req.params.id);
    noStore(res);
    if (!detail) return res.status(404).json({ error: "NOT_FOUND", message: "Modelo não encontrado." });
    res.json(detail);
  });

  app.post("/api/hr/performance/models", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) => createDraftModel(db, { name: str(req.body?.name), description: strOrNull(req.body?.description), instructions: strOrNull(req.body?.instructions), actorUserId, scope }, deps.options),
      201
    );
  });

  app.put("/api/hr/performance/models/:id", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const body = req.body ?? {};
    await mutateAdmin(deps.store, res, (db) => {
      const model = db.models.find((m) => m.id === req.params.id);
      return updateModelDraft(
        db,
        {
          modelId: req.params.id,
          name: typeof body.name === "string" ? body.name : undefined,
          description: body.description === undefined ? undefined : strOrNull(body.description),
          instructions: body.instructions === undefined ? undefined : strOrNull(body.instructions),
          rules: body.rules && typeof body.rules === "object" ? parseRules(body.rules, model?.rules) : undefined,
          actorUserId,
          scope,
        },
        deps.options
      );
    });
  });

  app.put("/api/hr/performance/models/:id/questions/:code", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      updateDraftQuestion(
        db,
        {
          modelId: req.params.id,
          code: req.params.code,
          competency: typeof req.body?.competency === "string" ? req.body.competency : undefined,
          selfText: str(req.body?.selfText),
          leaderText: str(req.body?.leaderText),
          hint: strOrNull(req.body?.hint),
          description: req.body?.description === undefined ? undefined : strOrNull(req.body.description, 400),
          positiveExample: req.body?.positiveExample === undefined ? undefined : strOrNull(req.body.positiveExample, 300),
          negativeExample: req.body?.negativeExample === undefined ? undefined : strOrNull(req.body.negativeExample, 300),
          roleExamples: Array.isArray(req.body?.roleExamples)
            ? req.body.roleExamples.slice(0, 50).map((row: { roleName?: unknown; text?: unknown }) => ({ roleName: str(row?.roleName, 80), text: str(row?.text, 300) }))
            : undefined,
          actorUserId,
          scope,
        },
        deps.options
      )
    );
  });

  app.post("/api/hr/performance/models/:id/questions/:code/move", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const direction = req.body?.direction === "up" ? "up" : "down";
    await mutateAdmin(deps.store, res, (db) => moveDraftQuestion(db, { modelId: req.params.id, code: req.params.code, direction, actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/models/:id/publish", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => publishModel(db, { modelId: req.params.id, actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/models/:id/duplicate", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => duplicateModel(db, { modelId: req.params.id, actorUserId, scope }, deps.options), 201);
  });

  app.post("/api/hr/performance/models/:id/archive", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => archiveModel(db, { modelId: req.params.id, actorUserId, scope }, deps.options));
  });

  // ---------------------------------------------------------------- ciclos
  app.get("/api/hr/performance/cycles", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    noStore(res);
    const cycles = [...db.cycles].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      cycles: cycles.map((c) => {
        const model = db.models.find((m) => m.id === c.modelId);
        return { ...c, modelName: model?.name ?? "", modelVersion: model?.version ?? null };
      }),
      counts: Object.fromEntries(cycles.map((c) => [c.id, dashboardCounts(db, c.id, scope, undefined, now())])),
    });
  });

  app.post("/api/hr/performance/cycles", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) =>
        createCycle(
          db,
          {
            name: str(req.body?.name),
            periodLabel: str(req.body?.periodLabel),
            modelId: str(req.body?.modelId),
            selfDueAt: str(req.body?.selfDueAt),
            leaderDueAt: str(req.body?.leaderDueAt),
            actorUserId,
            scope,
          },
          deps.options
        ),
      201
    );
  });

  app.put("/api/hr/performance/cycles/:id", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      updateCycle(
        db,
        {
          cycleId: req.params.id,
          name: str(req.body?.name),
          periodLabel: str(req.body?.periodLabel),
          selfDueAt: str(req.body?.selfDueAt),
          leaderDueAt: str(req.body?.leaderDueAt),
          reason: strOrNull(req.body?.reason),
          actorUserId,
          scope,
        },
        deps.options
      )
    );
  });

  app.get("/api/hr/performance/cycles/:id/workspace", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const workspace = describeCycle(db, req.params.id, scope, now());
    noStore(res);
    if (!workspace) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json(workspace);
  });

  app.get("/api/hr/performance/cycles/:id/dashboard", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const board = dashboard(db, req.params.id, scope, filtersFrom(req.query), now());
    noStore(res);
    if (!board) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json(board);
  });

  app.get("/api/hr/performance/evolution", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    noStore(res);
    res.json({ cycles: cycleEvolution(db, scope, now()) });
  });

  app.get("/api/hr/performance/cycles/:id/calibration", ...calibrateGuard, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const queue = calibrationQueue(db, req.params.id, scope, filtersFrom(req.query));
    noStore(res);
    if (!queue) return res.status(scope.kind === "ALL" ? 404 : 403).json({ error: scope.kind === "ALL" ? "NOT_FOUND" : "FORBIDDEN", message: "Fila de calibração indisponível." });
    res.json(queue);
  });

  const signalsFor = async (ids: string[], cycleMinDays: number) => {
    if (!deps.loadEligibilitySignals || ids.length === 0) return { absenceIds: [] as string[], roleChangeIds: [] as string[] };
    const windowDays = Math.max(180, cycleMinDays);
    return deps.loadEligibilitySignals(ids, new Date(now().getTime() - windowDays * 86_400_000));
  };

  app.post("/api/hr/performance/cycles/:id/participants/preview", ...manage, async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String).slice(0, 500) : [];
    const db = await deps.store.read();
    const cycle = db.cycles.find((c) => c.id === req.params.id);
    noStore(res);
    if (!cycle) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const employees = await deps.loadEmployees(ids);
    const signals = await signalsFor(ids, cycle.minObservationDays);
    res.json({
      people: employees.map((employee) => {
        const decision = classifyEligibility({
          employee,
          asOf: now(),
          minObservationDays: cycle.minObservationDays,
          absenceOverlapsReference: signals.absenceIds.includes(employee.id),
          roleChangedInsideWindow: signals.roleChangeIds.includes(employee.id),
          exceptionReason: null,
        });
        const existing = db.participants.find((p) => p.cycleId === cycle.id && p.employeeId === employee.id && !p.removedAt);
        return { employeeId: employee.id, name: employee.name, eligibility: decision.state, reason: decision.reason, alreadyInCycle: Boolean(existing), managerName: employee.managerName };
      }),
    });
  });

  app.post("/api/hr/performance/cycles/:id/participants", ...manage, async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String).slice(0, 500) : [];
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const employees = await deps.loadEmployees(ids);
    const first = await deps.store.read();
    const cycle = first.cycles.find((c) => c.id === req.params.id);
    const signals = await signalsFor(ids, cycle?.minObservationDays ?? 90);
    const rawExceptions = req.body?.exceptions && typeof req.body.exceptions === "object" ? (req.body.exceptions as Record<string, unknown>) : {};
    const exceptions = Object.fromEntries(Object.entries(rawExceptions).map(([key, value]) => [key, str(value, 300)]));
    await mutateAdmin(deps.store, res, (db) =>
      applyParticipants(
        db,
        { cycleId: req.params.id, employees, selectedIds: ids, exceptions, absenceIds: signals.absenceIds, roleChangeIds: signals.roleChangeIds, actorUserId, scope },
        deps.options
      )
    );
  });

  app.post("/api/hr/performance/participants/:id/remove", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => removeParticipant(db, { participantId: req.params.id, reason: str(req.body?.reason, 300), actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/participants/:id/eligibility", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      setEligibilityException(db, { participantId: req.params.id, reason: strOrNull(req.body?.reason, 300), actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/participants/:id/leader", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const managerId = str(req.body?.managerId, 64);
    const [manager] = managerId ? await deps.loadEmployees([managerId]) : [];
    if (!manager) {
      noStore(res);
      return res.status(400).json({ error: "LEADER_REQUIRED", message: "Escolha o líder na lista de pessoas do cadastro." });
    }
    if ((manager.status ?? "ACTIVE").toUpperCase() !== "ACTIVE" || manager.terminationDate) {
      noStore(res);
      return res.status(400).json({ error: "LEADER_INACTIVE", message: "O líder escolhido não está ativo no cadastro." });
    }
    await mutateAdmin(deps.store, res, (db) =>
      reassignLeader(db, { participantId: req.params.id, managerId: manager.id, managerName: manager.name, reason: str(req.body?.reason, 300), actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/cycles/:id/transition", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    const to = req.body?.to;
    const canReopen = to === "CALIBRATION" && deps.can ? await deps.can(req, PERFORMANCE_RESOURCE_KEYS.calibration, "manage") : false;
    if (to === "HOMOLOGATED") {
      noStore(res);
      return res.status(403).json({ error: "FORBIDDEN", message: "Homologar exige a permissão de calibração (use Homologar ciclo)." });
    }
    if (!isCycleStatus(to)) {
      noStore(res);
      return res.status(400).json({ error: "INVALID_STATUS", message: "Situação inválida." });
    }
    await mutateAdmin(deps.store, res, (db) =>
      transitionCycle(
        db,
        {
          cycleId: req.params.id,
          to,
          actorUserId,
          reversalReason: strOrNull(req.body?.reason, 300),
          pilotAck: req.body?.pilotAck === true,
          acceptPending: req.body?.acceptPending === true,
          actorEmployeeId,
          // Só vale para reabrir resultado homologado; homologar continua na rota própria.
          canHomologate: canReopen,
          scope,
        },
        deps.options
      )
    );
  });

  app.post("/api/hr/performance/cycles/:id/homologate", ...calibrateGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      transitionCycle(db, { cycleId: req.params.id, to: "HOMOLOGATED", actorUserId, reversalReason: null, actorEmployeeId, canHomologate: true, scope }, deps.options)
    );
  });

  // ---------------------------------------------------------------- convites
  app.post("/api/hr/performance/cycles/:id/invites", ...invites, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const participantIds = Array.isArray(req.body?.participantIds) ? req.body.participantIds.map(String) : null;
    await mutateAdmin(
      deps.store,
      res,
      (db) => issueInvitesBatch(db, { cycleId: req.params.id, participantIds, onlyMissing: req.body?.onlyMissing !== false, actorUserId, scope }, deps.options),
      201
    );
  });

  app.post("/api/hr/performance/assignments/:id/invites", ...invites, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => issueInvite(db, { assignmentId: req.params.id, actorUserId, scope }, deps.options), 201);
  });

  app.post("/api/hr/performance/assignments/:id/invites/revoke", ...invites, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => revokeInvite(db, { assignmentId: req.params.id, reason: str(req.body?.reason, 300), actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/assignments/:id/assist", ...invites, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      openAssisted(db, { assignmentId: req.params.id, assistantUserId: actorUserId, actorEmployeeId, reason: str(req.body?.reason, 300), scope }, deps.options)
    );
  });

  // ---------------------------------------------------------------- liderança
  app.get("/api/hr/performance/team", ...evaluate, async (req, res) => {
    const { scope, actorEmployeeId } = await scopeOf(req);
    const db = await deps.store.read();
    noStore(res);
    res.json({ items: leaderQueue(db, scope, actorEmployeeId) });
  });

  app.get("/api/hr/performance/assignments/:id", ...evaluate, async (req, res) => {
    const { scope, actorEmployeeId } = await scopeOf(req);
    const db = await deps.store.read();
    const result = readLeaderForm(db, req.params.id, scope, actorEmployeeId);
    noStore(res);
    if (result.ok === false) return res.status(403).json({ error: result.code, message: result.message });
    res.json(result);
  });

  app.put("/api/hr/performance/assignments/:id/answers", ...evaluate, async (req, res) => {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 50) : [];
    const parsed = [];
    for (const row of answers) {
      const answer = parseAnswer(row?.answer);
      if (!answer || typeof row?.code !== "string") {
        noStore(res);
        return res.status(400).json({ error: "INVALID_ANSWER", message: "Resposta inválida." });
      }
      parsed.push({ code: row.code, answer });
    }
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      saveAnswers(db, { assignmentId: req.params.id, expectedVersion: Number(req.body?.expectedVersion), answers: parsed, actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/assignments/:id/submit", ...evaluate, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      submitAssignment(db, { assignmentId: req.params.id, expectedVersion: Number(req.body?.expectedVersion), actorUserId, scope, assistedConfirmation: true }, deps.options)
    );
  });

  app.post("/api/hr/performance/assignments/:id/return", ...calibrateGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => returnForRevision(db, { assignmentId: req.params.id, reason: str(req.body?.reason, 600), actorUserId, scope }, deps.options));
  });

  // ---------------------------------------------------------------- calibração
  app.post("/api/hr/performance/participants/:id/validation", ...calibrateGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      validateTechnical(db, { participantId: req.params.id, decision: req.body?.decision, note: str(req.body?.note, 600), actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/participants/:id/calibration", ...calibrateGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      calibrate(
        db,
        {
          participantId: req.params.id,
          note: str(req.body?.note, 600),
          decision: req.body?.decision === "ADJUST" ? "ADJUST" : "CONFIRM",
          technicalBand: isNineBoxBand(req.body?.technicalBand) ? req.body.technicalBand : null,
          potentialBand: isNineBoxBand(req.body?.potentialBand) ? req.body.potentialBand : null,
          actorUserId,
          actorEmployeeId,
          scope,
        },
        deps.options
      )
    );
  });

  app.get("/api/hr/performance/participants/:id/results", ...calibrateGuard, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const history = resultHistory(db, req.params.id, scope);
    noStore(res);
    if (!history) return res.status(404).json({ error: "NOT_FOUND", message: "Participante não encontrado." });
    res.json(history);
  });

  // ---------------------------------------------------------------- devolutiva e PDI
  app.post("/api/hr/performance/participants/:id/feedback", ...evaluate, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) =>
        createFeedback(
          db,
          {
            participantId: req.params.id,
            strength: str(req.body?.strength, 600),
            improvement: str(req.body?.improvement, 600),
            action: str(req.body?.action, 600),
            ownerName: str(req.body?.ownerName, 160),
            dueAt: strOrNull(req.body?.dueAt, 10),
            conversationAt: strOrNull(req.body?.conversationAt, 10),
            actorUserId,
            scope,
          },
          deps.options
        ),
      201
    );
  });

  app.post("/api/hr/performance/feedbacks/:id/ack", ...view, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      acknowledgeFeedback(
        db,
        {
          feedbackId: req.params.id,
          action: req.body?.action,
          note: strOrNull(req.body?.note, 600),
          actorEmployeeId,
          actorUserId,
          assisted: req.body?.assisted === true,
          scope,
        },
        deps.options
      )
    );
  });

  app.post("/api/hr/performance/feedbacks/:id/pdi", ...evaluate, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) =>
        createPdi(
          db,
          {
            feedbackId: req.params.id,
            title: str(req.body?.title, 200),
            objective: strOrNull(req.body?.objective, 600),
            competencyCode: strOrNull(req.body?.competencyCode, 20),
            priority: req.body?.priority === true,
            justification: strOrNull(req.body?.justification, 600),
            ownerName: str(req.body?.ownerName, 160),
            dueAt: strOrNull(req.body?.dueAt, 10),
            actorUserId,
            scope,
          },
          deps.options
        ),
      201
    );
  });

  app.post("/api/hr/performance/pdis/:id/status", ...evaluate, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      updatePdiStatus(db, { pdiId: req.params.id, status: req.body?.status, note: strOrNull(req.body?.note, 600), evidence: strOrNull(req.body?.evidence, 600), actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/pdis/:id/checkins", ...evaluate, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) => addCheckin(db, { pdiId: req.params.id, note: str(req.body?.note, 600), obstacle: strOrNull(req.body?.obstacle, 600), nextStep: strOrNull(req.body?.nextStep, 600), actorUserId, scope }, deps.options),
      201
    );
  });

  app.get("/api/hr/performance/pdis", ...evaluate, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const due = req.query.due === "late" || req.query.due === "next30" ? req.query.due : "all";
    noStore(res);
    res.json({
      items: pdiTracking(
        db,
        scope,
        { status: typeof req.query.status === "string" && req.query.status ? req.query.status : null, due, cycleId: typeof req.query.cycleId === "string" && req.query.cycleId ? req.query.cycleId : null },
        now()
      ),
    });
  });

  // ---------------------------------------------------------------- histórico e relatórios
  app.get("/api/hr/performance/employees/:id/history", ...view, async (req, res) => {
    const { scope, accessScope } = await scopeOf(req);
    const db = await deps.store.read();
    const result = employeeHistory(db, req.params.id, scope, accessScope === "ALL");
    noStore(res);
    if (result.ok === false) return res.status(404).json({ error: result.code, message: "Registro não encontrado." });
    res.json(result);
  });

  app.get("/api/hr/performance/cycles/:id/export", ...report, async (req, res) => {
    const { scope } = await scopeOf(req);
    const db = await deps.store.read();
    if (!db.cycles.some((c) => c.id === req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const rows = reportRows(db, req.params.id, scope);
    const actorUserId = await deps.actorUserId(req);
    const logged = await mutate(deps.store, res, (current) => recordExport(current, { cycleId: req.params.id, rows: rows.length, format: "CSV", actorUserId }, deps.options));
    if (res.headersSent || logged.ok === false) return;
    noStore(res);
    const header = "nome,cargo,setor,elegibilidade,quadrante,cultura";
    const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const body = rows.map((row) => [row.name, row.role, row.department, row.eligibility, row.quadrant, row.culture].map(cell).join(",")).join("\n");
    res.setHeader("Content-Disposition", 'attachment; filename="desempenho-ciclo.csv"');
    res.type("text/csv").send(`﻿${header}\n${body}`);
  });

  /** Emite o documento (código único + versão, auditado) e devolve os dados para o impresso. */
  app.post("/api/hr/performance/reports/issue", ...report, async (req, res) => {
    const kind = req.body?.kind;
    if (!isReportKind(kind)) {
      noStore(res);
      return res.status(400).json({ error: "INVALID_KIND", message: "Tipo de documento inválido." });
    }
    const cycleId = str(req.body?.cycleId, 64);
    const participantId = strOrNull(req.body?.participantId, 64);
    const actorUserId = await deps.actorUserId(req);
    const actorName = deps.actorName ? await deps.actorName(req) : null;
    const { scope } = await scopeOf(req);
    const outcome = await mutate(deps.store, res, (db) =>
      issueReport(db, { cycleId, kind, participantId, actorUserId, actorName, scope, randomSuffix: randomBytes(3).toString("hex") }, deps.options)
    );
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.status(statusOf(outcome.code)).json({ error: outcome.code, message: outcome.message });
    const db = await deps.store.read();
    const data = reportData(db, { cycleId, kind, participantId }, scope, now());
    if (!data) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json({ issue: { ...outcome.value, kind, issuedByName: actorName }, data });
  });

  app.post("/api/hr/performance/conducts", ...conduct, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    await mutateAdmin(deps.store, res, (db) => recordConduct(db, { employeeId: str(req.body?.employeeId, 64), summary: str(req.body?.summary, 1000), actorUserId }, deps.options), 201);
  });

  app.post("/api/hr/performance/cycles/:id/reminders", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const outcome = await mutate(deps.store, res, (db) => planReminders(db, { cycleId: req.params.id, actorUserId }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.status(statusOf(outcome.code)).json({ error: outcome.code, message: outcome.message });
    const sent = dispatchReminders(deps.options);
    res.json({ ...outcome.value, dispatch: sent.ok === false ? sent.code : "sent" });
  });

  app.get("/api/hr/performance/directory", ...manage, async (req, res) => {
    const query = str(req.query.q, 80);
    const rows = deps.searchEmployees ? await deps.searchEmployees(query) : [];
    noStore(res);
    res.json({
      employees: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        terminated: Boolean(row.terminationDate),
        roleName: row.roleName,
        departmentName: row.departmentName,
        managerId: row.managerId,
        managerName: row.managerName,
        admissionDate: row.admissionDate ? row.admissionDate.toISOString().slice(0, 10) : null,
        registration: row.registration,
      })),
    });
  });

  // ---------------------------------------------------------------- portal público
  app.post("/api/public/performance/assist", ...pubAuth, async (req, res) => {
    const outcome = await mutate(deps.store, res, (db) => claimAssisted(db, { token: str(req.body?.token, 200) }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, message: outcome.message });
    setSession(res, outcome.value.sessionToken);
    res.json({ ok: true, phase: "ASSISTED" });
  });

  app.post("/api/public/performance/session", ...pubAuth, async (req, res) => {
    const outcome = await mutate(deps.store, res, (db) => exchangeLink(db, { token: str(req.body?.token, 200) }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, message: outcome.message });
    setSession(res, outcome.value.sessionToken);
    res.json({ ok: true, phase: outcome.value.phase });
  });

  app.post("/api/public/performance/verify", ...pubAuth, async (req, res) => {
    const outcome = await mutate(deps.store, res, (db) => verifyOtp(db, { sessionToken: sessionToken(req), otp: str(req.body?.otp, 12) }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, message: outcome.message });
    setSession(res, outcome.value.sessionToken);
    res.json({ ok: true });
  });

  app.get("/api/public/performance/form", ...pub, async (req, res) => {
    const db = await deps.store.read();
    const result = publicForm(db, { sessionToken: sessionToken(req) }, deps.options);
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, expired: true, message: result.message });
    res.json({ ok: true, ...result.value });
  });

  app.put("/api/public/performance/answers", ...pub, async (req, res) => {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 50) : [];
    const parsed = [];
    for (const row of answers) {
      const answer = parseAnswer(row?.answer);
      if (!answer || typeof row?.code !== "string") {
        noStore(res);
        return res.status(400).json({ ok: false, message: "Resposta inválida." });
      }
      parsed.push({ code: row.code, answer });
    }
    const outcome = await mutate(deps.store, res, (db) => publicSave(db, { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), answers: parsed }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, code: outcome.code === "INVITE_REJECTED" ? "EXPIRED" : outcome.code, message: outcome.message });
    res.json({ ok: true, version: outcome.value.version });
  });

  app.post("/api/public/performance/submit", ...pub, async (req, res) => {
    const outcome = await mutate(deps.store, res, (db) =>
      publicSubmit(db, { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), confirm: req.body?.confirm === true }, deps.options)
    );
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, code: outcome.code === "INVITE_REJECTED" ? "EXPIRED" : outcome.code, message: outcome.message });
    clearSession(res);
    res.json({ ok: true, status: outcome.value.status });
  });

  app.post("/api/public/performance/logout", ...pub, async (req, res) => {
    await mutate(deps.store, res, (db) => publicLogout(db, { sessionToken: sessionToken(req) }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    clearSession(res);
    res.json({ ok: true });
  });
}
