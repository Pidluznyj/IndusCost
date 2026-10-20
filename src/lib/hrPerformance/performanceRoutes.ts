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
import { canSeeResultOf, NO_CAPS, resolvePerformanceCaps, type PerformanceCapabilityKey, type PerformanceCaps } from "./performancePermissions.js";
import { redactCalibrationQueue, redactDashboard, redactLeadershipRows, redactWorkspace } from "./performanceDisclosure.js";
import { evaluatorStats, personDossier } from "./performanceDossier.js";
import { cycleReadiness, readinessBlocked, type ReadinessContext } from "./performanceReadiness.js";
import { OBLIGATION_STATUSES, trackingBoard, trackingCsv, type ObligationStatus, type OrgUnits, type TrackingModality } from "./performanceTracking.js";
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
import { CycleInactiveError, DeletionIntegrityError, GraphConflictError, HistoryIntegrityError, type PerformanceStore } from "./performancePrisma.js";
import { checkCycleDeletion, classifyCycle, cycleGovernance, cycleLifecycleHistory, inactivateCycle, planCycleDeletion, reactivateCycle } from "./performanceLifecycle.js";
import { createRateLimiter } from "./performanceRateLimit.js";
import {
  calibrateLeadership,
  createLeadershipModel,
  leadershipCalibrationList,
  leadershipComparison,
  readSuperiorLeadershipForm,
  setCycleLeadershipModel,
  superiorLeadershipQueue,
  updateLeadershipQuestion,
  type LeadershipSnapshot,
} from "./performanceLeadershipService.js";
import { audit } from "./performanceService.js";
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
  syncParticipantLeaders,
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
  /** Compatibilidade da tela: ciclos ou modelos. */
  manage: boolean;
  calibrate: boolean;
  report: boolean;
  invites: boolean;
  conduct: boolean;
  track: boolean;
  trackExport: boolean;
  cycles: boolean;
  models: boolean;
  results: boolean;
  calibrationView: boolean;
  homologate: boolean;
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
  /** Ciclo de vida (classificar, inativar, reativar, excluir teste): só o SUPER_ADMIN. */
  isSuperAdmin?: (req: express.Request) => Promise<boolean>;
  /** Avaliação 180°: liderados diretos ativos (hierarquia efetiva) na abertura do ciclo. */
  loadLeadershipSnapshot?: (employeeIds: string[]) => Promise<LeadershipSnapshot>;
  /** Prontidão: colaboradores com usuário ativo vinculado (quem consegue avaliar a equipe). */
  loadLinkedEmployeeIds?: (employeeIds: string[]) => Promise<Set<string>>;
  /** Prontidão: desde quando cada pessoa está com o líder atual (histórico do cadastro). */
  loadLeaderSince?: (employeeIds: string[]) => Promise<Map<string, { since: string; managerId: string | null; previousManagerName: string | null }>>;
  /** Central de acompanhamento: diretoria de cada setor (organograma). */
  loadOrgUnits?: () => Promise<{ id: string; name: string; directorateName: string | null }[]>;
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
  CLASSIFICATION_REQUIRED: 400,
  INVALID_CLASSIFICATION: 400,
  CONFIRMATION_MISMATCH: 400,
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
        if (error instanceof CycleInactiveError) {
          res.status(409).json({ error: "CYCLE_INACTIVE", message: "Ciclo inativo: nada pode ser alterado. O SUPER_ADMIN pode reativar." });
          return { ok: false, code: "CYCLE_INACTIVE", message: error.message };
        }
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
    delete: (path: string, ...handlers: unknown[]) => app.delete(path, ...(wrap(handlers) as Handler[])),
  };
}

export function registerPerformanceRoutes(expressApp: express.Application, deps: PerformanceRouteDeps): void {
  const app = guardedApp(expressApp);
  const gate = requirePerformanceCycleEnabled(deps.enabled);
  /**
   * Capacidades por requisição (RBAC oficial, `deps.can` = mesma decisão dos guards). Toda rota
   * exige ver o módulo e ao menos uma das capacidades listadas; o conteúdo é cortado depois por
   * `canSeeResultOf` (operacional vê situação, não nota).
   */
  type Access = {
    caps: PerformanceCaps;
    scope: PerformanceScope;
    /** Escopo para CONTEÚDO de resultado: toda a organização só com `results`; senão, a própria equipe. */
    resultScope: PerformanceScope;
    actorEmployeeId: string | null;
    accessScope: PerformanceAccessScope;
    teamIds: ReadonlySet<string>;
  };
  const accessCache = new WeakMap<express.Request, Promise<Access>>();
  const computeAccess = async (req: express.Request): Promise<Access> => {
    const input = await deps.loadScope(req);
    const superAdmin = deps.isSuperAdmin ? await deps.isSuperAdmin(req) : false;
    const can = deps.can;
    const caps = can ? await resolvePerformanceCaps({ can: (resource, action) => can(req, resource, action), employeesOrgWide: input.accessScope === "ALL", superAdmin }) : { ...NO_CAPS };
    const actorEmployeeId = input.actorEmployeeId;
    const limitedInput = input.accessScope === "ALL" ? { accessScope: "DIRECT_REPORTS" as const, actorEmployeeId, teamIds: input.teamIds } : input;
    const limited = buildPerformanceScope(limitedInput);
    const all: PerformanceScope = { kind: "ALL", actorEmployeeId };
    return {
      caps,
      scope: caps.orgWide ? all : limited,
      resultScope: caps.results ? all : limited,
      actorEmployeeId,
      accessScope: caps.orgWide ? "ALL" : limitedInput.accessScope,
      teamIds: new Set(input.teamIds.filter((id) => id && id !== actorEmployeeId)),
    };
  };
  const accessOf = (req: express.Request) => {
    let pending = accessCache.get(req);
    if (!pending) {
      pending = computeAccess(req);
      accessCache.set(req, pending);
    }
    return pending;
  };
  const need = (...anyOf: PerformanceCapabilityKey[]): RequestHandler[] => [
    deps.requireAppAuth,
    gate,
    (req, res, next) => {
      accessOf(req)
        .then((access) => {
          if (access.caps.view && anyOf.some((key) => access.caps[key])) return next();
          noStore(res);
          res.status(403).json({ error: "FORBIDDEN", message: "Seu perfil não permite esta ação no Desempenho." });
        })
        .catch(() => {
          if (!res.headersSent) res.status(500).json({ error: "INTERNAL", message: "Falha interna. Tente de novo em instantes." });
        });
    },
  ];
  /** Resultado desta pessoa pode sair para quem pede? */
  const resultGate = (access: Access, purpose: "read" | "calibration" = "read") => (participant: { employeeId: string; managerId: string | null }) =>
    canSeeResultOf(access.caps, { orgWide: access.caps.orgWide, actorEmployeeId: access.actorEmployeeId, teamIds: access.teamIds }, participant, purpose);
  const view = need("view");
  const manage = need("cycles");
  const modelsGuard = need("models");
  const evaluate = need("evaluate");
  const calibrateGuard = need("calibrate");
  const calibrationRead = need("calibrationView", "calibrate");
  const homologateGuard = need("homologate");
  const report = need("reports");
  const invites = need("invites");
  const conduct = need("conduct");
  const tracking = need("track");
  const trackingExport = need("trackExport");
  // Guardas compostas (qualquer uma das capacidades), com nome para a auditoria estática de rotas.
  const leaderFormGuard = need("evaluate", "results", "calibrate");
  const resultHistoryGuard = need("results", "calibrate");
  const resultsWriteGuard = need("evaluate", "results");
  const lifecycleReadGuard = need("cycles", "track");
  const leadershipListGuard = need("evaluate", "calibrationView", "calibrate", "results");
  const leadershipReadGuard = need("evaluate", "calibrate", "results");
  const leadershipCalibrateGuard = need("evaluate", "calibrate");
  const remindersGuard = need("cycles", "invites");
  const publicLimit = createRateLimiter("perf-public", { windowMs: 60_000, max: 240 });
  const publicAuthLimit = createRateLimiter("perf-public-auth", { windowMs: 60_000, max: 20 });
  const pub = [gate, publicLimit, requireJson];
  const pubAuth = [gate, publicLimit, publicAuthLimit, requireJson];

  const scopeOf = async (req: express.Request): Promise<{ scope: PerformanceScope; actorEmployeeId: string | null; accessScope: PerformanceAccessScope }> => {
    const access = await accessOf(req);
    return { scope: access.scope, actorEmployeeId: access.actorEmployeeId, accessScope: access.accessScope };
  };
  const now = () => deps.options.now();

  app.get("/api/hr/performance/feature-status", deps.requireAppAuth, (_req, res) => {
    noStore(res);
    res.json({ enabled: deps.enabled() });
  });

  app.get("/api/hr/performance/me", deps.requireAppAuth, gate, async (req, res) => {
    const access = await accessOf(req);
    const c = access.caps;
    const capabilities: PerformanceCapabilities = {
      view: c.view,
      evaluate: c.evaluate,
      manage: c.view && (c.cycles || c.models),
      calibrate: c.view && c.calibrate,
      report: c.view && c.reports,
      invites: c.view && c.invites,
      conduct: c.view && c.conduct,
      track: c.view && c.track,
      trackExport: c.view && c.trackExport,
      cycles: c.view && c.cycles,
      models: c.view && c.models,
      results: c.view && c.results,
      calibrationView: c.view && c.calibrationView,
      homologate: c.view && c.homologate,
    };
    noStore(res);
    res.json({ accessScope: access.accessScope, actorEmployeeId: access.actorEmployeeId, capabilities: { ...capabilities, lifecycle: c.lifecycle }, officialPublication: deps.options.officialPublication });
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
          kind: model.kind,
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

  app.post("/api/hr/performance/models", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(
      deps.store,
      res,
      (db) => createDraftModel(db, { name: str(req.body?.name), description: strOrNull(req.body?.description), instructions: strOrNull(req.body?.instructions), actorUserId, scope }, deps.options),
      201
    );
  });

  app.put("/api/hr/performance/models/:id", ...modelsGuard, async (req, res) => {
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

  app.put("/api/hr/performance/models/:id/questions/:code", ...modelsGuard, async (req, res) => {
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

  app.post("/api/hr/performance/models/:id/questions/:code/move", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const direction = req.body?.direction === "up" ? "up" : "down";
    await mutateAdmin(deps.store, res, (db) => moveDraftQuestion(db, { modelId: req.params.id, code: req.params.code, direction, actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/models/:id/publish", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => publishModel(db, { modelId: req.params.id, actorUserId, scope }, deps.options));
  });

  app.post("/api/hr/performance/models/:id/duplicate", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => duplicateModel(db, { modelId: req.params.id, actorUserId, scope }, deps.options), 201);
  });

  app.post("/api/hr/performance/models/:id/archive", ...modelsGuard, async (req, res) => {
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
        return { ...c, modelName: model?.name ?? "", modelVersion: model?.version ?? null, governance: cycleGovernance(db, c) };
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
            classification: str(req.body?.classification, 16),
            leadershipModelId: strOrNull(req.body?.leadershipModelId, 64),
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
    res.json(redactWorkspace(workspace, resultGate(await accessOf(req))));
  });

  app.get("/api/hr/performance/cycles/:id/dashboard", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const board = dashboard(db, req.params.id, scope, filtersFrom(req.query), now());
    noStore(res);
    if (!board) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const access = await accessOf(req);
    res.json(redactDashboard(board, resultGate(access), access.caps.reports || access.caps.results));
  });

  app.get("/api/hr/performance/evolution", ...view, async (req, res) => {
    const db = await deps.store.read();
    const { scope, accessScope } = await scopeOf(req);
    noStore(res);
    // Teste e inativo só entram no filtro de auditoria do RH, rotulados.
    const includeNonOfficial = accessScope === "ALL" && req.query.includeNonOfficial === "1";
    res.json({ cycles: cycleEvolution(db, scope, now(), includeNonOfficial) });
  });

  app.get("/api/hr/performance/cycles/:id/calibration", ...calibrationRead, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const queue = calibrationQueue(db, req.params.id, scope, filtersFrom(req.query));
    noStore(res);
    if (!queue) return res.status(scope.kind === "ALL" ? 404 : 403).json({ error: scope.kind === "ALL" ? "NOT_FOUND" : "FORBIDDEN", message: "Fila de calibração indisponível." });
    const access = await accessOf(req);
    // Acompanhar calibração = situação de cada pessoa; médias, divergências e evidências só para quem calibra.
    res.json(access.caps.calibrate || access.caps.results ? queue : redactCalibrationQueue(queue));
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
        return {
          employeeId: employee.id,
          name: employee.name,
          eligibility: decision.state,
          reason: decision.reason,
          alreadyInCycle: Boolean(existing),
          managerName: employee.managerName,
          managerSource: employee.managerSource ?? "CADASTRO",
          managerNote: employee.managerNote ?? null,
        };
      }),
    });
  });

  /** Antes da abertura: líderes pela hierarquia efetiva (exceção do RH preservada). */
  app.post("/api/hr/performance/cycles/:id/participants/sync-leaders", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const first = await deps.store.read();
    const ids = first.participants.filter((p) => p.cycleId === req.params.id && !p.removedAt).map((p) => p.employeeId);
    const employees = await deps.loadEmployees(ids);
    await mutateAdmin(deps.store, res, (db) =>
      syncParticipantLeaders(db, { cycleId: req.params.id, employees, actorUserId, scope }, deps.options)
    );
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

  // ---------------------------------------------------------------- prontidão (antes de abrir)
  /** Monta o contexto externo. Sem `loadLinkedEmployeeIds` (testes antigos), a trava não se aplica. */
  const readinessOf = async (db: PerformanceDatabase, cycleId: string) => {
    const cycle = db.cycles.find((c) => c.id === cycleId);
    if (!cycle || !deps.loadLinkedEmployeeIds) return null;
    const live = db.participants.filter((p) => p.cycleId === cycleId && !p.removedAt);
    const evaluatorIds = [...new Set(live.map((p) => p.managerId).filter((id): id is string => Boolean(id)))];
    const outsideIds = evaluatorIds.filter((id) => !live.some((p) => p.employeeId === id));
    const [linked, leaderSince, outsiders] = await Promise.all([
      deps.loadLinkedEmployeeIds(evaluatorIds),
      deps.loadLeaderSince ? deps.loadLeaderSince(live.map((p) => p.employeeId)) : Promise.resolve(new Map()),
      outsideIds.length ? deps.loadEmployees(outsideIds) : Promise.resolve([]),
    ]);
    const ctx: ReadinessContext = { linkedEmployeeIds: linked, leaderSince, names: new Map(outsiders.map((e) => [e.id, e.name])) };
    return cycleReadiness(db, cycle, ctx, now());
  };

  app.get("/api/hr/performance/cycles/:id/readiness", ...lifecycleReadGuard, async (req, res) => {
    const db = await deps.store.read();
    const cycle = db.cycles.find((c) => c.id === req.params.id);
    noStore(res);
    if (!cycle) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const issues = cycle.status === "DRAFT" || cycle.status === "PREPARED" ? (await readinessOf(db, cycle.id)) ?? [] : [];
    res.json({ issues, blocked: readinessBlocked(issues).length > 0 });
  });

  /** Inclui no ciclo os líderes que faltam, subindo a cadeia até o topo (um clique). */
  app.post("/api/hr/performance/cycles/:id/participants/include-leaders", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    const first = await deps.store.read();
    const cycle = first.cycles.find((c) => c.id === req.params.id);
    if (!cycle) {
      noStore(res);
      return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    }
    const present = new Set(first.participants.filter((p) => p.cycleId === cycle.id && !p.removedAt).map((p) => p.employeeId));
    let frontier = [...new Set(first.participants.filter((p) => p.cycleId === cycle.id && !p.removedAt && p.managerId && !present.has(p.managerId)).map((p) => p.managerId!))];
    const toAdd = new Set<string>();
    for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
      for (const id of frontier) toAdd.add(id);
      const loaded = await deps.loadEmployees(frontier);
      frontier = [...new Set(loaded.map((e) => e.managerId).filter((id): id is string => Boolean(id) && !present.has(id!) && !toAdd.has(id!)))];
    }
    const ids = [...toAdd];
    if (ids.length === 0) {
      noStore(res);
      return res.json({ added: 0 });
    }
    const employees = await deps.loadEmployees(ids);
    const signals = await signalsFor(ids, cycle.minObservationDays ?? 90);
    await mutateAdmin(deps.store, res, (db) =>
      applyParticipants(db, { cycleId: cycle.id, employees, selectedIds: ids, exceptions: {}, absenceIds: signals.absenceIds, roleChangeIds: signals.roleChangeIds, actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/cycles/:id/transition", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    const to = req.body?.to;
    // Reabrir resultado homologado é decisão de homologação (concessão separada de calibrar).
    const canReopen = to === "CALIBRATION" ? (await accessOf(req)).caps.homologate : false;
    if (to === "HOMOLOGATED") {
      noStore(res);
      return res.status(403).json({ error: "FORBIDDEN", message: "Homologar exige a permissão de calibração (use Homologar ciclo)." });
    }
    if (!isCycleStatus(to)) {
      noStore(res);
      return res.status(400).json({ error: "INVALID_STATUS", message: "Situação inválida." });
    }
    let leadershipSnapshot: LeadershipSnapshot | undefined;
    if (to === "OPEN") {
      const issues = await readinessOf(await deps.store.read(), req.params.id);
      const blocked = issues ? readinessBlocked(issues) : [];
      if (blocked.length > 0) {
        noStore(res);
        return res.status(409).json({ error: "READINESS_BLOCKED", message: `Antes de abrir: ${blocked.map((i) => i.title.toLowerCase()).join("; ")}.`, issues });
      }
      const current = await deps.store.read();
      const cycle = current.cycles.find((c) => c.id === req.params.id);
      if (cycle?.leadershipModelId && deps.loadLeadershipSnapshot) {
        const ids = current.participants.filter((p) => p.cycleId === cycle.id && !p.removedAt).map((p) => p.employeeId);
        leadershipSnapshot = await deps.loadLeadershipSnapshot(ids);
      }
    }
    await mutateAdmin(deps.store, res, (db) =>
      transitionCycle(
        db,
        {
          cycleId: req.params.id,
          to,
          leadershipSnapshot,
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

  app.post("/api/hr/performance/cycles/:id/homologate", ...homologateGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope, actorEmployeeId } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      transitionCycle(db, { cycleId: req.params.id, to: "HOMOLOGATED", actorUserId, reversalReason: null, actorEmployeeId, canHomologate: true, scope }, deps.options)
    );
  });

  // ---------------------------------------------------------------- central de acompanhamento
  // Só metadados operacionais (performanceTracking.ts): situação, responsável, prazo e motivo.
  const orgUnits = async (): Promise<OrgUnits | null> => {
    if (!deps.loadOrgUnits) return null;
    const rows = await deps.loadOrgUnits();
    return {
      byDepartmentId: new Map(rows.map((r) => [r.id, r.directorateName ?? "Sem diretoria"])),
      byDepartmentName: new Map(rows.map((r) => [r.name, r.directorateName ?? "Sem diretoria"])),
    };
  };
  const trackingFilters = (query: express.Request["query"]) => {
    const pick = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 200) : null);
    const modality = pick(query.modality);
    const status = pick(query.status);
    return {
      department: pick(query.department),
      directorate: pick(query.directorate),
      manager: pick(query.manager),
      modality: modality && ["INDIVIDUAL", "LIDERANCA", "CALIBRACAO", "FECHAMENTO"].includes(modality) ? (modality as TrackingModality) : null,
      status: status && (OBLIGATION_STATUSES as readonly string[]).includes(status) ? (status as ObligationStatus) : null,
    };
  };

  app.get("/api/hr/performance/cycles/:id/tracking", ...tracking, async (req, res) => {
    const db = await deps.store.read();
    const board = trackingBoard(db, req.params.id, trackingFilters(req.query), now(), await orgUnits());
    noStore(res);
    if (!board) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json(board);
  });

  app.get("/api/hr/performance/cycles/:id/tracking/export", ...trackingExport, async (req, res) => {
    const db = await deps.store.read();
    const cycle = db.cycles.find((c) => c.id === req.params.id);
    noStore(res);
    if (!cycle) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    if (cycle.activation !== "ACTIVE") return res.status(409).json({ error: "CYCLE_INACTIVE", message: "Ciclo inativo não é exportado. Consulte o histórico de ações." });
    const board = trackingBoard(db, cycle.id, trackingFilters(req.query), now(), await orgUnits())!;
    const actorUserId = await deps.actorUserId(req);
    const logged = await mutate(deps.store, res, (current) => recordExport(current, { cycleId: cycle.id, rows: board.rows.length, format: "CSV_OPERACIONAL", actorUserId }, deps.options));
    if (res.headersSent || logged.ok === false) return;
    noStore(res);
    const governance = cycleGovernance(db, cycle);
    const classification = governance.officialEligible ? "OFICIAL" : cycle.classification === "TEST" ? "TESTE - NAO OFICIAL" : "NAO OFICIAL";
    res.setHeader("Content-Disposition", 'attachment; filename="desempenho-acompanhamento.csv"');
    res.type("text/csv").send(trackingCsv(board, classification));
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
    res.json({ items: leaderQueue(db, scope, actorEmployeeId), leadership: superiorLeadershipQueue(db, actorEmployeeId) });
  });

  app.get("/api/hr/performance/assignments/:id", ...leaderFormGuard, async (req, res) => {
    const { scope, actorEmployeeId } = await scopeOf(req);
    const db = await deps.store.read();
    const kind = db.assignments.find((a) => a.id === req.params.id)?.kind;
    noStore(res);
    if (kind === "LEADERSHIP_UPWARD" || kind === "LEADERSHIP_SELF") {
      // Respostas da equipe e autoavaliação de liderança não abrem por aqui, para ninguém.
      return res.status(403).json({ error: "FORBIDDEN", message: "Esta avaliação não é consultada individualmente." });
    }
    const assignment = db.assignments.find((a) => a.id === req.params.id);
    const access = await accessOf(req);
    if (assignment && assignment.evaluatorEmployeeId !== actorEmployeeId && !(access.caps.results || access.caps.calibrate)) {
      // Alcance operacional não abre respostas de avaliação de terceiros.
      return res.status(403).json({ error: "FORBIDDEN", message: "Esta avaliação só é aberta por quem avalia ou por quem consulta resultados." });
    }
    const result = kind === "LEADERSHIP_SUPERIOR" ? readSuperiorLeadershipForm(db, req.params.id, actorEmployeeId, scope) : readLeaderForm(db, req.params.id, scope, actorEmployeeId);
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
          acceptMissingLeader: req.body?.acceptMissingLeader === true,
          committee: strOrNull(req.body?.committee, 300),
          actorUserId,
          actorEmployeeId,
          scope,
        },
        deps.options
      )
    );
  });

  /** Dossiê da pessoa: todos os ângulos numa ficha (calibrar ou consultar resultados). */
  app.get("/api/hr/performance/participants/:id/dossier", ...resultHistoryGuard, async (req, res) => {
    const db = await deps.store.read();
    const access = await accessOf(req);
    const dossier = personDossier(db, req.params.id, access.resultScope, access.actorEmployeeId);
    noStore(res);
    if (dossier.ok === false) return res.status(statusOf(dossier.code)).json({ error: dossier.code, message: dossier.message });
    res.json(dossier);
  });

  /** Painel por avaliador: distribuição das notas dadas por cada líder (sem conteúdo de resposta). */
  app.get("/api/hr/performance/cycles/:id/calibration/evaluators", ...resultHistoryGuard, async (req, res) => {
    const db = await deps.store.read();
    noStore(res);
    if (!db.cycles.some((c) => c.id === req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json({ evaluators: evaluatorStats(db, req.params.id) });
  });

  app.get("/api/hr/performance/participants/:id/results", ...resultHistoryGuard, async (req, res) => {
    const db = await deps.store.read();
    const { scope } = await scopeOf(req);
    const history = resultHistory(db, req.params.id, scope);
    noStore(res);
    if (!history) return res.status(404).json({ error: "NOT_FOUND", message: "Participante não encontrado." });
    res.json(history);
  });

  // ---------------------------------------------------------------- devolutiva e PDI
  app.post("/api/hr/performance/participants/:id/feedback", ...resultsWriteGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const scope = (await accessOf(req)).resultScope;
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

  app.post("/api/hr/performance/feedbacks/:id/pdi", ...resultsWriteGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const scope = (await accessOf(req)).resultScope;
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

  app.post("/api/hr/performance/pdis/:id/status", ...resultsWriteGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const scope = (await accessOf(req)).resultScope;
    await mutateAdmin(deps.store, res, (db) =>
      updatePdiStatus(db, { pdiId: req.params.id, status: req.body?.status, note: strOrNull(req.body?.note, 600), evidence: strOrNull(req.body?.evidence, 600), actorUserId, scope }, deps.options)
    );
  });

  app.post("/api/hr/performance/pdis/:id/checkins", ...resultsWriteGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const scope = (await accessOf(req)).resultScope;
    await mutateAdmin(
      deps.store,
      res,
      (db) => addCheckin(db, { pdiId: req.params.id, note: str(req.body?.note, 600), obstacle: strOrNull(req.body?.obstacle, 600), nextStep: strOrNull(req.body?.nextStep, 600), actorUserId, scope }, deps.options),
      201
    );
  });

  app.get("/api/hr/performance/pdis", ...resultsWriteGuard, async (req, res) => {
    const db = await deps.store.read();
    const scope = (await accessOf(req)).resultScope;
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
    const access = await accessOf(req);
    const scope = access.resultScope;
    const db = await deps.store.read();
    // Histórico traz resultado: toda a organização só com `results`; sem isso, a própria equipe.
    const orgResults = scope.kind === "ALL";
    const includeNonOfficial = orgResults && req.query.includeNonOfficial === "1";
    const result = employeeHistory(db, req.params.id, scope, orgResults, includeNonOfficial);
    noStore(res);
    if (result.ok === false) return res.status(404).json({ error: result.code, message: "Registro não encontrado." });
    res.json(result);
  });

  app.get("/api/hr/performance/cycles/:id/export", ...report, async (req, res) => {
    const access = await accessOf(req);
    if (!access.caps.results) {
      noStore(res);
      return res.status(403).json({ error: "FORBIDDEN", message: "O CSV com quadrante e cultura exige consultar resultados. Use o relatório operacional da Central de acompanhamento." });
    }
    const scope = access.resultScope;
    const db = await deps.store.read();
    const exported = db.cycles.find((c) => c.id === req.params.id);
    if (!exported) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    if (exported.activation !== "ACTIVE") {
      noStore(res);
      return res.status(409).json({ error: "CYCLE_INACTIVE", message: "Ciclo inativo não é exportado. Consulte o histórico de ações." });
    }
    const rows = reportRows(db, req.params.id, scope);
    const actorUserId = await deps.actorUserId(req);
    const logged = await mutate(deps.store, res, (current) => recordExport(current, { cycleId: req.params.id, rows: rows.length, format: "CSV", actorUserId }, deps.options));
    if (res.headersSent || logged.ok === false) return;
    noStore(res);
    // A classificação vai em cada linha: o arquivo de um ciclo de teste não passa por oficial.
    const governance = cycleGovernance(db, exported);
    const classification = governance.officialEligible ? "OFICIAL" : exported.classification === "TEST" ? "TESTE - NAO OFICIAL" : "NAO OFICIAL";
    const header = "nome,cargo,setor,elegibilidade,quadrante,cultura,classificacao_ciclo";
    const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const body = rows.map((row) => [row.name, row.role, row.department, row.eligibility, row.quadrant, row.culture, classification].map(cell).join(",")).join("\n");
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
    const access = await accessOf(req);
    // Documento pessoal e Nine-Box nominal trazem resultado: escopo de resultado. Liderança: quem calibra.
    // Consolidado: alcance do relatório, com o resultado de cada pessoa cortado abaixo.
    const scope =
      kind === "consolidado" ? access.scope : kind === "lideranca" ? (access.caps.calibrate || access.caps.results ? access.scope : access.resultScope) : access.resultScope;
    const outcome = await mutate(deps.store, res, (db) =>
      issueReport(db, { cycleId, kind, participantId, actorUserId, actorName, scope, randomSuffix: randomBytes(3).toString("hex") }, deps.options)
    );
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.status(statusOf(outcome.code)).json({ error: outcome.code, message: outcome.message });
    const db = await deps.store.read();
    const data = reportData(db, { cycleId, kind, participantId }, scope, now());
    if (!data) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const gate = resultGate(access);
    const byId = new Map(db.participants.map((p) => [p.id, p]));
    const visibleResult = (participantId: string) => {
      const p = byId.get(participantId);
      return Boolean(p && gate(p));
    };
    res.json({
      issue: { ...outcome.value, kind, issuedByName: actorName },
      data: {
        ...data,
        people: data.people.map((p) => (visibleResult(p.participantId) ? p : { ...p, result: null, resultHidden: true })),
      },
    });
  });

  // ---------------------------------------------------------------- ciclo de vida (SUPER_ADMIN)
  const superAdmin = async (req: express.Request) => (deps.isSuperAdmin ? deps.isSuperAdmin(req) : false);
  const withAudit = (db: PerformanceDatabase, actorUserId: string | null, action: string, entityId: string, detail: Record<string, string | number | boolean | null>) => {
    const next = structuredClone(db);
    audit(next, now(), actorUserId, action, entityId, detail);
    return next;
  };
  const lifecycleInput = async (req: express.Request) => ({
    cycleId: req.params.id,
    reason: str(req.body?.reason, 600),
    actorUserId: await deps.actorUserId(req),
    superAdmin: await superAdmin(req),
    now: now(),
  });

  app.get("/api/hr/performance/cycles/:id/lifecycle", ...lifecycleReadGuard, async (req, res) => {
    const db = await deps.store.read();
    const cycle = db.cycles.find((c) => c.id === req.params.id);
    noStore(res);
    if (!cycle) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json({
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status, classification: cycle.classification, activation: cycle.activation, activationReason: cycle.activationReason, activationChangedAt: cycle.activationChangedAt },
      governance: cycleGovernance(db, cycle),
      deletion: checkCycleDeletion(db, cycle.id),
      history: cycleLifecycleHistory(db, cycle.id),
      canManage: await superAdmin(req),
    });
  });

  app.post("/api/hr/performance/cycles/:id/classification", ...view, async (req, res) => {
    const input = await lifecycleInput(req);
    await mutateAdmin(deps.store, res, (db) => classifyCycle(db, { ...input, classification: str(req.body?.classification, 16) }));
  });

  app.post("/api/hr/performance/cycles/:id/inactivate", ...view, async (req, res) => {
    const input = await lifecycleInput(req);
    await mutateAdmin(deps.store, res, (db) => inactivateCycle(db, input));
  });

  app.post("/api/hr/performance/cycles/:id/reactivate", ...view, async (req, res) => {
    const input = await lifecycleInput(req);
    await mutateAdmin(deps.store, res, (db) => reactivateCycle(db, input));
  });

  /** Exclusão física de ciclo de TESTE já inativo. A auditoria fica; os dados do ciclo saem. */
  app.delete("/api/hr/performance/cycles/:id", ...view, async (req, res) => {
    const input = await lifecycleInput(req);
    noStore(res);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const db = await deps.store.read();
      const planned = planCycleDeletion(db, { ...input, confirmation: str(req.body?.confirmation, 200) });
      if (planned.ok === false) {
        if (planned.code === "DELETE_BLOCKED" && input.superAdmin) {
          // A tentativa bloqueada também fica registrada.
          await mutate(deps.store, res, (current) => ({ ok: true, db: withAudit(current, input.actorUserId, "CYCLE_DELETE_BLOCKED", req.params.id, { reason: input.reason, blockers: planned.message }), value: null }));
          if (res.headersSent) return;
        }
        return res.status(statusOf(planned.code)).json({ error: planned.code, message: planned.message });
      }
      if (!deps.store.deleteTestCycle) return res.status(501).json({ error: "NOT_SUPPORTED", message: "Exclusão indisponível neste armazenamento." });
      try {
        const deleted = await deps.store.deleteTestCycle(planned.plan, db.graphRevision);
        return res.json({ deleted, auditId: planned.plan.audit.id });
      } catch (error) {
        if (error instanceof GraphConflictError) continue;
        if (error instanceof DeletionIntegrityError) return res.status(409).json({ error: "DELETE_INTEGRITY", message: `Exclusão cancelada sem apagar nada: ${error.message}` });
        throw error;
      }
    }
    res.status(409).json({ error: "VERSION_CONFLICT", message: "Muitas gravações ao mesmo tempo. Tente de novo." });
  });

  // ---------------------------------------------------------------- liderança (180°)
  app.post("/api/hr/performance/models/leadership", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => createLeadershipModel(db, { name: str(req.body?.name, 120), actorUserId, scope }, deps.options), 201);
  });

  app.put("/api/hr/performance/models/:id/leadership-questions/:code", ...modelsGuard, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) =>
      updateLeadershipQuestion(
        db,
        {
          modelId: req.params.id,
          code: req.params.code,
          competency: str(req.body?.competency, 60),
          behavior: str(req.body?.behavior, 300),
          selfText: str(req.body?.selfText, 300),
          upwardText: str(req.body?.upwardText, 300),
          superiorText: str(req.body?.superiorText, 300),
          actorUserId,
          scope,
        },
        deps.options
      )
    );
  });

  app.put("/api/hr/performance/cycles/:id/leadership", ...manage, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    const { scope } = await scopeOf(req);
    await mutateAdmin(deps.store, res, (db) => setCycleLeadershipModel(db, { cycleId: req.params.id, leadershipModelId: strOrNull(req.body?.leadershipModelId, 64), actorUserId, scope }, deps.options));
  });

  /** RH (escopo total) precisa da permissão de calibração; líder vê só quem ele calibra. */
  /**
   * Liderança com alcance de toda a organização: calibrar (ou consultar resultados) para o
   * comparativo; acompanhar calibração para a lista, sem índice. Sem isso, vale ser o superior.
   */
  const leadershipAccess = async (req: express.Request, purpose: "list" | "read" | "calibrate") => {
    const access = await accessOf(req);
    const actorEmployeeId = access.actorEmployeeId;
    const c = access.caps;
    const orgOk = purpose === "calibrate" ? c.calibrate : purpose === "read" ? c.calibrate || c.results : c.calibrationView || c.results;
    if (orgOk) return { scope: access.scope, actorEmployeeId, showIndex: c.calibrate || c.results };
    if (!c.evaluate) return null;
    const team: PerformanceScope = access.scope.kind === "ALL" ? buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId, teamIds: [...access.teamIds] }) : access.scope;
    return { scope: team, actorEmployeeId, showIndex: true };
  };

  app.get("/api/hr/performance/cycles/:id/leadership", ...leadershipListGuard, async (req, res) => {
    const access = await leadershipAccess(req, "list");
    noStore(res);
    if (!access) return res.status(403).json({ error: "FORBIDDEN", message: "A calibração de liderança exige a permissão de calibração." });
    const rows = leadershipCalibrationList(await deps.store.read(), req.params.id, access.scope, access.actorEmployeeId);
    if (!rows) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json({ rows: access.showIndex ? rows : redactLeadershipRows(rows) });
  });

  app.get("/api/hr/performance/participants/:id/leadership", ...leadershipReadGuard, async (req, res) => {
    const access = await leadershipAccess(req, "read");
    noStore(res);
    if (!access) return res.status(403).json({ error: "FORBIDDEN", message: "A calibração de liderança exige a permissão de calibração." });
    const view = leadershipComparison(await deps.store.read(), req.params.id, access.scope, access.actorEmployeeId);
    if (view.ok === false) return res.status(statusOf(view.code)).json({ error: view.code, message: view.message });
    res.json(view);
  });

  app.post("/api/hr/performance/participants/:id/leadership/calibration", ...leadershipCalibrateGuard, async (req, res) => {
    const access = await leadershipAccess(req, "calibrate");
    if (!access) {
      noStore(res);
      return res.status(403).json({ error: "FORBIDDEN", message: "A calibração de liderança exige a permissão de calibração." });
    }
    const actorUserId = await deps.actorUserId(req);
    const scores = req.body?.scores && typeof req.body.scores === "object" ? (req.body.scores as Record<string, unknown>) : {};
    const justifications = req.body?.justifications && typeof req.body.justifications === "object" ? (req.body.justifications as Record<string, unknown>) : {};
    await mutateAdmin(deps.store, res, (db) =>
      calibrateLeadership(
        db,
        {
          participantId: req.params.id,
          scores,
          justifications,
          generalNote: str(req.body?.generalNote, 1200),
          exceptionReason: strOrNull(req.body?.exceptionReason, 600),
          actorUserId,
          actorEmployeeId: access.actorEmployeeId,
          scope: access.scope,
        },
        deps.options
      )
    );
  });

  app.post("/api/hr/performance/conducts", ...conduct, async (req, res) => {
    const actorUserId = await deps.actorUserId(req);
    await mutateAdmin(deps.store, res, (db) => recordConduct(db, { employeeId: str(req.body?.employeeId, 64), summary: str(req.body?.summary, 1000), actorUserId }, deps.options), 201);
  });

  app.post("/api/hr/performance/cycles/:id/reminders", ...remindersGuard, async (req, res) => {
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
        managerSource: row.managerSource ?? "CADASTRO",
        managerNote: row.managerNote ?? null,
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
    const step = strOrNull(req.body?.step, 32);
    const outcome = await mutate(deps.store, res, (db) => publicSave(db, { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), answers: parsed, step }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, code: outcome.code === "INVITE_REJECTED" ? "EXPIRED" : outcome.code, message: outcome.message });
    res.json({ ok: true, version: outcome.value.version });
  });

  app.post("/api/public/performance/submit", ...pub, async (req, res) => {
    const outcome = await mutate(deps.store, res, (db) =>
      publicSubmit(db, { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), confirm: req.body?.confirm === true, step: strOrNull(req.body?.step, 32) }, deps.options)
    );
    if (res.headersSent) return;
    noStore(res);
    if (outcome.ok === false) return res.json({ ok: false, code: outcome.code === "INVITE_REJECTED" ? "EXPIRED" : outcome.code, message: outcome.message });
    // A sessão continua para a próxima etapa; só termina com a jornada concluída.
    if (outcome.value.done) clearSession(res);
    res.json({ ok: true, status: outcome.value.status, done: outcome.value.done, next: outcome.value.next });
  });

  app.post("/api/public/performance/logout", ...pub, async (req, res) => {
    await mutate(deps.store, res, (db) => publicLogout(db, { sessionToken: sessionToken(req) }, deps.options));
    if (res.headersSent) return;
    noStore(res);
    clearSession(res);
    res.json({ ok: true });
  });
}
