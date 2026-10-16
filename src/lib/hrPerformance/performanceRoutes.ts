/**
 * Rotas administrativas e portal público do ciclo de desempenho.
 * A flag desligada responde 404 antes de ler o banco. O token não entra em log.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { buildPerformanceScope, type PerformanceAccessScope } from "./performanceAccess.js";
import { PERFORMANCE_RESOURCE_KEYS } from "./performanceAccessKeys.js";
import type { EmployeeSnapshotSource } from "./performanceDomain.js";
import { parseAnswer } from "./performanceDomain.js";
import { requirePerformanceCycleEnabled } from "./performanceFeatureFlags.js";
import { buildPlainPdf } from "./performancePdf.js";
import { GraphConflictError } from "./performancePrisma.js";
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
  dashboardCounts,
  describeCycle,
  dispatchReminders,
  duplicateModel,
  employeeHistory,
  exchangeLink,
  issueInvite,
  leaderQueue,
  openAssisted,
  planReminders,
  publicForm,
  publicSave,
  publicSubmit,
  publishModel,
  readLeaderForm,
  reassignLeader,
  recordConduct,
  reportRows,
  returnForRevision,
  saveAnswers,
  submitAssignment,
  transitionCycle,
  updateDraftQuestion,
  updatePdiStatus,
  validateTechnical,
  verifyOtp,
  type ServiceOptions,
} from "./performanceService.js";

const SESSION_COOKIE = "ic_perf_session";

export type PerformanceStore = {
  read: () => Promise<PerformanceDatabase>;
  write: (db: PerformanceDatabase) => Promise<void>;
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
  actorUserId: (req: express.Request) => Promise<string | null>;
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
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionToken(req: express.Request): string {
  const body = req.body as { sessionToken?: unknown } | undefined;
  if (typeof body?.sessionToken === "string" && body.sessionToken) return body.sessionToken;
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

function setSession(res: express.Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/public/performance; Max-Age=28800${secure}`
  );
}

async function persist(store: PerformanceStore, db: PerformanceDatabase | undefined, res: express.Response): Promise<boolean> {
  if (!db) return true;
  try {
    await store.write(db);
    return true;
  } catch (error) {
    if (error instanceof GraphConflictError) {
      res.status(409).json({ error: "VERSION_CONFLICT", message: "Outra pessoa salvou esta tela. Atualize e tente de novo." });
      return false;
    }
    throw error;
  }
}

export function registerPerformanceRoutes(app: express.Application, deps: PerformanceRouteDeps): void {
  const gate = requirePerformanceCycleEnabled(deps.enabled);
  const view = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "view")];
  const manage = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "manage")];
  const evaluate = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.module, "update")];
  const calibrateGuard = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.calibration, "manage")];
  const report = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.reports, "view")];
  const invites = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.invites, "manage")];
  const conduct = [deps.requireAppAuth, gate, deps.requireResource(PERFORMANCE_RESOURCE_KEYS.conduct, "manage")];

  app.get("/api/hr/performance/feature-status", deps.requireAppAuth, (_req, res) => {
    noStore(res);
    res.json({ enabled: deps.enabled() });
  });

  app.get("/api/hr/performance/models", ...view, async (_req, res) => {
    const db = await deps.store.read();
    noStore(res);
    res.json({
      models: deps.enabled()
        ? db.models.map((model) => ({
            ...model,
            questionCount: db.questions.filter((q) => q.modelId === model.id).length,
            homologated: false,
          }))
        : [],
    });
  });

  app.post("/api/hr/performance/models", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = createDraftModel(db, { name: String(req.body?.name ?? ""), actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(400).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/models/:id/publish", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = publishModel(db, { modelId: req.params.id, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json({ ...result.value, homologated: false });
  });

  app.post("/api/hr/performance/models/:id/duplicate", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = duplicateModel(db, { modelId: req.params.id, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(404).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.put("/api/hr/performance/models/:id/questions/:code", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = updateDraftQuestion(
      db,
      {
        modelId: req.params.id,
        code: req.params.code,
        selfText: String(req.body?.selfText ?? ""),
        leaderText: String(req.body?.leaderText ?? ""),
        hint: typeof req.body?.hint === "string" ? req.body.hint : null,
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.get("/api/hr/performance/cycles", ...view, async (_req, res) => {
    const db = await deps.store.read();
    noStore(res);
    res.json({ cycles: db.cycles, counts: Object.fromEntries(db.cycles.map((c) => [c.id, dashboardCounts(db, c.id)])) });
  });

  app.post("/api/hr/performance/cycles", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = createCycle(
      db,
      {
        name: String(req.body?.name ?? ""),
        periodLabel: String(req.body?.periodLabel ?? ""),
        modelId: String(req.body?.modelId ?? ""),
        selfDueAt: String(req.body?.selfDueAt ?? ""),
        leaderDueAt: String(req.body?.leaderDueAt ?? ""),
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(400).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/cycles/:id/participants", ...manage, async (req, res) => {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String) : [];
    const employees = await deps.loadEmployees(ids);
    const db = await deps.store.read();
    const result = applyParticipants(
      db,
      {
        cycleId: req.params.id,
        employees,
        selectedIds: ids,
        exceptions: (req.body?.exceptions ?? {}) as Record<string, string>,
        absenceIds: Array.isArray(req.body?.absenceIds) ? req.body.absenceIds.map(String) : [],
        roleChangeIds: Array.isArray(req.body?.roleChangeIds) ? req.body.roleChangeIds.map(String) : [],
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/cycles/:id/transition", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = transitionCycle(
      db,
      {
        cycleId: req.params.id,
        to: req.body?.to,
        actorUserId: await deps.actorUserId(req),
        reversalReason: typeof req.body?.reason === "string" ? req.body.reason : null,
        pilotAck: req.body?.pilotAck === true,
        acceptPending: req.body?.acceptPending === true,
        actorEmployeeId: (await deps.loadScope(req)).actorEmployeeId,
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.get("/api/hr/performance/cycles/:id/dashboard", ...view, async (req, res) => {
    const db = await deps.store.read();
    const scope = buildPerformanceScope(await deps.loadScope(req));
    const cells = db.participants
      .filter((p) => p.cycleId === req.params.id && p.eligibility === "ELIGIBLE")
      .filter((p) => scope.kind === "ALL" || scope.visible.has(p.employeeId))
      .map((p) => {
        const result = db.results.find((r) => r.participantId === p.id && r.active);
        return {
          employeeId: p.employeeId,
          name: p.employeeName,
          quadrant: result?.quadrant ?? "SEM_CLASSIFICACAO",
          official: Boolean(result?.official),
          cultureBand: result?.cultureBand ?? null,
          technicalValidation: result?.technicalValidation ?? null,
          departmentName: p.departmentName,
          roleName: p.roleName,
          managerName: p.managerName,
          technicalSum: result?.technicalSum ?? null,
          technicalCount: result?.technicalCount ?? null,
          potentialSum: result?.potentialSum ?? null,
          potentialCount: result?.potentialCount ?? null,
        };
      });
    noStore(res);
    res.json({ ...dashboardCounts(db, req.params.id), cells });
  });

  app.get("/api/hr/performance/team", ...evaluate, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const scope = buildPerformanceScope(scopeInput);
    const db = await deps.store.read();
    noStore(res);
    res.json({ items: leaderQueue(db, scope, scopeInput.actorEmployeeId) });
  });

  app.get("/api/hr/performance/assignments/:id", ...evaluate, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const db = await deps.store.read();
    const result = readLeaderForm(db, req.params.id, buildPerformanceScope(scopeInput), scopeInput.actorEmployeeId);
    noStore(res);
    if (result.ok === false) return res.status(403).json({ error: result.code, message: result.message });
    res.json(result);
  });

  app.put("/api/hr/performance/assignments/:id/answers", ...evaluate, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const parsed = [];
    for (const row of answers) {
      const answer = parseAnswer(row?.answer);
      if (!answer || typeof row?.code !== "string") return res.status(400).json({ error: "INVALID_ANSWER", message: "Resposta inválida." });
      parsed.push({ code: row.code, answer });
    }
    const db = await deps.store.read();
    const result = saveAnswers(
      db,
      {
        assignmentId: req.params.id,
        expectedVersion: Number(req.body?.expectedVersion),
        answers: parsed,
        actorUserId: await deps.actorUserId(req),
        scope: buildPerformanceScope(scopeInput),
      },
      deps.options
    );
    if (result.ok === false) return res.status(result.code === "FORBIDDEN" ? 403 : 409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/assignments/:id/submit", ...evaluate, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const db = await deps.store.read();
    const result = submitAssignment(
      db,
      {
        assignmentId: req.params.id,
        expectedVersion: Number(req.body?.expectedVersion),
        actorUserId: await deps.actorUserId(req),
        scope: buildPerformanceScope(scopeInput),
        assistedConfirmation: true,
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/assignments/:id/invites", ...invites, async (req, res) => {
    const db = await deps.store.read();
    const result = issueInvite(db, { assignmentId: req.params.id, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/assignments/:id/return", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = returnForRevision(db, { assignmentId: req.params.id, reason: String(req.body?.reason ?? ""), actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/assignments/:id/assist", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const userId = await deps.actorUserId(req);
    const result = openAssisted(db, { assignmentId: req.params.id, assistantUserId: userId ?? "rh", actorEmployeeId: (await deps.loadScope(req)).actorEmployeeId }, deps.options);
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/participants/:id/validation", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = validateTechnical(
      db,
      { participantId: req.params.id, decision: req.body?.decision, note: String(req.body?.note ?? ""), actorUserId: await deps.actorUserId(req) },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/participants/:id/calibration", ...calibrateGuard, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const db = await deps.store.read();
    const result = calibrate(
      db,
      { participantId: req.params.id, note: String(req.body?.note ?? ""), actorUserId: await deps.actorUserId(req), actorEmployeeId: scopeInput.actorEmployeeId },
      deps.options
    );
    if (result.ok === false) return res.status(403).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/participants/:id/feedback", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = createFeedback(
      db,
      {
        participantId: req.params.id,
        strength: String(req.body?.strength ?? ""),
        improvement: String(req.body?.improvement ?? ""),
        action: String(req.body?.action ?? ""),
        ownerName: String(req.body?.ownerName ?? ""),
        dueAt: req.body?.dueAt ? String(req.body.dueAt) : null,
        conversationAt: req.body?.conversationAt ? String(req.body.conversationAt) : null,
        leaderEmployeeId: String(req.body?.leaderEmployeeId ?? ""),
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/feedbacks/:id/ack", ...view, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    if (!scopeInput.actorEmployeeId) return res.status(403).json({ error: "FORBIDDEN", message: "A ciência é da própria pessoa." });
    const db = await deps.store.read();
    const result = acknowledgeFeedback(
      db,
      {
        feedbackId: req.params.id,
        action: req.body?.action,
        note: typeof req.body?.note === "string" ? req.body.note : null,
        actorEmployeeId: scopeInput.actorEmployeeId,
      },
      deps.options
    );
    if (result.ok === false) return res.status(403).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/feedbacks/:id/pdi", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = createPdi(
      db,
      {
        feedbackId: req.params.id,
        title: String(req.body?.title ?? ""),
        priority: Boolean(req.body?.priority),
        justification: typeof req.body?.justification === "string" ? req.body.justification : null,
        ownerName: String(req.body?.ownerName ?? ""),
        dueAt: req.body?.dueAt ? String(req.body.dueAt) : null,
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/pdis/:id/checkins", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = addCheckin(
      db,
      {
        pdiId: req.params.id,
        note: String(req.body?.note ?? ""),
        obstacle: typeof req.body?.obstacle === "string" ? req.body.obstacle : null,
        nextStep: typeof req.body?.nextStep === "string" ? req.body.nextStep : null,
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(404).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.get("/api/hr/performance/employees/:id/history", ...view, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const db = await deps.store.read();
    const includeInternal = scopeInput.accessScope === "ALL";
    const result = employeeHistory(db, req.params.id, buildPerformanceScope(scopeInput), includeInternal);
    noStore(res);
    if (result.ok === false) return res.status(404).json({ error: result.code, message: "Registro não encontrado." });
    res.json(result);
  });

  app.get("/api/hr/performance/cycles/:id/export", ...report, async (req, res) => {
    const scopeInput = await deps.loadScope(req);
    const db = await deps.store.read();
    const rows = reportRows(db, req.params.id, buildPerformanceScope(scopeInput));
    noStore(res);
    const header = "nome,cargo,setor,elegibilidade,quadrante,cultura";
    const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const body = rows.map((row) => [row.name, row.role, row.department, row.eligibility, row.quadrant, row.culture].map(cell).join(",")).join("\n");
    res.type("text/csv").send(`${header}\n${body}`);
  });

  app.post("/api/hr/performance/conducts", ...conduct, async (req, res) => {
    const db = await deps.store.read();
    const result = recordConduct(db, { employeeId: String(req.body?.employeeId ?? ""), summary: String(req.body?.summary ?? ""), actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(400).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.status(201).json(result.value);
  });

  app.post("/api/hr/performance/cycles/:id/reminders", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const planned = planReminders(db, { cycleId: req.params.id, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (planned.ok === false) return res.status(404).json({ error: planned.code, message: planned.message });
    if (!(await persist(deps.store, planned.db, res))) return;
    const sent = dispatchReminders(deps.options);
    noStore(res);
    res.json({ ...planned.value, dispatch: sent.ok === false ? sent.code : "sent" });
  });

  app.get("/api/hr/performance/directory", ...view, async (req, res) => {
    const query = String(req.query.q ?? "");
    const rows = deps.searchEmployees ? await deps.searchEmployees(query) : [];
    noStore(res);
    res.json({
      employees: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        roleName: row.roleName,
        departmentName: row.departmentName,
        managerId: row.managerId,
        managerName: row.managerName,
      })),
    });
  });

  app.get("/api/hr/performance/models/:id", ...view, async (req, res) => {
    const db = await deps.store.read();
    const model = db.models.find((item) => item.id === req.params.id);
    if (!model) return res.status(404).json({ error: "NOT_FOUND", message: "Modelo não encontrado." });
    noStore(res);
    res.json({ model, questions: db.questions.filter((q) => q.modelId === model.id).sort((a, b) => a.sortOrder - b.sortOrder) });
  });

  app.post("/api/hr/performance/models/:id/archive", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = archiveModel(db, { modelId: req.params.id, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.get("/api/hr/performance/cycles/:id/workspace", ...view, async (req, res) => {
    const db = await deps.store.read();
    const scope = buildPerformanceScope(await deps.loadScope(req));
    const workspace = describeCycle(db, req.params.id, scope);
    noStore(res);
    if (!workspace) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    res.json(workspace);
  });

  app.post("/api/hr/performance/participants/:id/leader", ...manage, async (req, res) => {
    const db = await deps.store.read();
    const result = reassignLeader(
      db,
      {
        participantId: req.params.id,
        managerId: String(req.body?.managerId ?? ""),
        managerName: String(req.body?.managerName ?? ""),
        actorUserId: await deps.actorUserId(req),
      },
      deps.options
    );
    if (result.ok === false) return res.status(409).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.post("/api/hr/performance/pdis/:id/status", ...manage, async (req, res) => {
    const status = req.body?.status;
    if (status !== "PLANNED" && status !== "IN_PROGRESS" && status !== "DONE" && status !== "SUSPENDED" && status !== "CANCELLED") {
      return res.status(400).json({ error: "INVALID_STATUS", message: "Situação do PDI inválida." });
    }
    const db = await deps.store.read();
    const result = updatePdiStatus(db, { pdiId: req.params.id, status, actorUserId: await deps.actorUserId(req) }, deps.options);
    if (result.ok === false) return res.status(404).json({ error: result.code, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    noStore(res);
    res.json(result.value);
  });

  app.get("/api/hr/performance/reports/document.pdf", ...report, async (req, res) => {
    const db = await deps.store.read();
    const scope = buildPerformanceScope(await deps.loadScope(req));
    const cycleId = String(req.query.cycleId ?? "");
    const workspace = describeCycle(db, cycleId, scope);
    if (!workspace) return res.status(404).json({ error: "NOT_FOUND", message: "Ciclo não encontrado." });
    const kind = String(req.query.kind ?? "consolidado");
    const participantId = String(req.query.participantId ?? "");
    const person = workspace.people.find((item) => item.participant.id === participantId);
    const lines: string[] = [`Ciclo: ${workspace.cycle.name}`, `Referência: ${workspace.cycle.periodLabel}`, `Situação: ${workspace.cycle.status}`, `Tipo: ${kind}`];
    const people = person ? [person] : workspace.people;
    for (const item of people) {
      lines.push("");
      lines.push(item.participant.employeeName);
      lines.push(`${item.participant.roleName} · ${item.participant.departmentName}`);
      lines.push(`Elegibilidade: ${item.participant.eligibility}`);
      if (item.result) {
        lines.push(`Técnico: ${item.result.technicalCount ? (item.result.technicalSum / item.result.technicalCount).toFixed(2) : "sem nota"} · validação ${item.result.technicalValidation}`);
        lines.push(`Potencial: ${item.result.potentialCount ? (item.result.potentialSum / item.result.potentialCount).toFixed(2) : "sem nota"}`);
        lines.push(`Cultura: ${item.result.cultureBand} (fora da Nine-Box)`);
        lines.push(`Nine-Box: ${item.result.quadrant} · ${item.result.official ? "oficial" : "preliminar"}`);
      }
      if (kind === "devolutiva" || kind === "pdi" || kind === "individual") {
        if (item.feedback) lines.push(`Devolutiva: ${item.feedback.strength} / ${item.feedback.improvement}`);
        for (const pdi of item.pdis) lines.push(`PDI: ${pdi.title} · ${pdi.status} · ${pdi.dueAt ?? "sem prazo"}`);
      }
    }
    if (kind === "historico" && person) {
      const history = employeeHistory(db, person.participant.employeeId, scope, scope.kind === "ALL");
      if (history.ok) {
        for (const cycle of history.cycles) lines.push(`Histórico ${cycle.cycleName}: ${cycle.quadrant ?? "sem posição"} · ${cycle.roleName}`);
      }
    }
    const pdf = buildPlainPdf(kind === "ninebox" ? "Nine-Box" : "Relatório de desempenho", lines);
    noStore(res);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="desempenho-${kind}.pdf"`);
    res.send(pdf);
  });

  app.post("/api/public/performance/assist", gate, async (req, res) => {
    const db = await deps.store.read();
    const result = claimAssisted(db, { token: String(req.body?.token ?? "") }, deps.options);
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, message: result.message });
    setSession(res, result.value.sessionToken);
    res.json({ ok: true, phase: "ASSISTED" });
  });

  app.post("/api/public/performance/session", gate, async (req, res) => {
    const db = await deps.store.read();
    const result = exchangeLink(db, { token: String(req.body?.token ?? "") }, deps.options);
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    setSession(res, result.value.sessionToken);
    res.json({ ok: true, phase: result.value.phase });
  });

  app.post("/api/public/performance/verify", gate, async (req, res) => {
    const db = await deps.store.read();
    const result = verifyOtp(db, { sessionToken: sessionToken(req), otp: String(req.body?.otp ?? "") }, deps.options);
    noStore(res);
    if (result.ok === false) {
      if (!(await persist(deps.store, result.db, res))) return;
      return res.json({ ok: false, message: result.message });
    }
    if (!(await persist(deps.store, result.db, res))) return;
    setSession(res, result.value.sessionToken);
    res.json({ ok: true });
  });

  app.get("/api/public/performance/form", gate, async (req, res) => {
    const db = await deps.store.read();
    const result = publicForm(db, { sessionToken: sessionToken(req) }, deps.options);
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, message: result.message });
    res.json({ ok: true, ...result.value });
  });

  app.put("/api/public/performance/answers", gate, async (req, res) => {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const parsed = [];
    for (const row of answers) {
      const answer = parseAnswer(row?.answer);
      if (!answer || typeof row?.code !== "string") return res.status(400).json({ ok: false, message: "Resposta inválida." });
      parsed.push({ code: row.code, answer });
    }
    const db = await deps.store.read();
    const result = publicSave(db, { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), answers: parsed }, deps.options);
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    res.json({ ok: true, version: result.value.version });
  });

  app.post("/api/public/performance/submit", gate, async (req, res) => {
    const db = await deps.store.read();
    const result = publicSubmit(
      db,
      { sessionToken: sessionToken(req), expectedVersion: Number(req.body?.expectedVersion), confirm: req.body?.confirm === true },
      deps.options
    );
    noStore(res);
    if (result.ok === false) return res.json({ ok: false, message: result.message });
    if (!(await persist(deps.store, result.db, res))) return;
    res.json({ ok: true, status: result.value.status });
  });
}
