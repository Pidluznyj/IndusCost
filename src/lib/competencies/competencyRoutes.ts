/**
 * Rotas de Competências e Desenvolvimento (Gestão de pessoas).
 *
 * Guardas por capacidade (ver `competencyAccess.ts`); autoria sempre da sessão.
 * Todo número devolvido sai da engine oficial (`competencyEngine.ts`) via `competency.server.ts`.
 */
import type express from "express";
import multer from "multer";
import type { RequestHandler } from "express";
import { logEmployeeHrAudit } from "../employeeHrAudit";
import type { PeopleAccessScope } from "../peopleProfileTypes";
import { buildCompetencyScope, type CompetencyScope } from "./competencyScope";
import { isCompetenciesEnabled, requireCompetenciesEnabled } from "./competencyFeatureFlags";
import { IMPORT_MAX_FILE_BYTES, type ImportResolutions } from "./competencyImport";
import {
  applyCompetencyImport,
  buildCompetencyImportTemplate,
  previewCompetencyImport,
} from "./competencyImport.server";
import { COMPETENCY_CAPABILITY_GRANTS, type CompetencyCapability } from "./competencyAccess";
import {
  archiveCompetency,
  archiveWorkPosition,
  businessTodayIso,
  CompetencyServiceError,
  createAssessment,
  createCompetency,
  createTraining,
  createWorkPosition,
  deleteAssessment,
  deleteTraining,
  getCompetencyMatrix,
  getCompetencyOptions,
  getCompetencyOverview,
  getEmployeeCompetencyProfile,
  decideLevelRequest,
  listLevelRequests,
  listAssessments,
  listCompetencies,
  listTrainings,
  listWorkPositions,
  setEmployeeCompetencyLevel,
  setTrainingStatus,
  setWorkPositionTeam,
  updateAssessment,
  updateCompetency,
  updateTraining,
  updateWorkPosition,
  type CompetencyDb,
} from "./competency.server";
import {
  isUuidString,
  parseAssessmentBody,
  parseCompetencyBody,
  parseDecisionBody,
  parseLevelBody,
  parsePositionTeamBody,
  parseTrainingBody,
  parseTrainingStatusBody,
  parseWorkPositionBody,
  type ParseResult,
} from "./competencyValidation";

export type CompetencyRouteGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id: string } | null>;
  /**
   * Escopo hierárquico do ator (mesma régua do RH: `resolvePeopleAccessScope`) e o colaborador
   * vinculado ao usuário. Autorização efetiva: toda leitura e escrita passa por ele.
   */
  getScopeInput: (req: express.Request) => Promise<{ accessScope: PeopleAccessScope; actorEmployeeId: string | null }>;
  /** O ator pode aprovar níveis governados (admin.employees.competencies.approvals:manage). */
  canApprove: (req: express.Request) => Promise<boolean>;
};

export type CompetencyRouteDeps = {
  prisma: CompetencyDb;
  now?: () => Date;
  /** Árvore abaixo do líder (CTE recursiva em produção; injetável em teste). */
  loadDescendantIds: (managerEmployeeId: string) => Promise<string[]>;
  /** Feature flag (padrão: COMPETENCIES_ENABLED, fail closed). Injetável em teste. */
  isEnabled?: () => boolean;
};

type AsyncHandler = (req: express.Request, res: express.Response) => Promise<unknown>;

function asyncRoute(label: string, handler: AsyncHandler): RequestHandler {
  return (req, res) => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof CompetencyServiceError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      const code = (error as { code?: string } | null)?.code;
      if (code === "P2025") {
        res.status(404).json({ error: "NOT_FOUND", message: "Registro não encontrado." });
        return;
      }
      if (code === "P2002") {
        res.status(409).json({ error: "CONFLICT", message: "Registro duplicado." });
        return;
      }
      if (code === "P2023" || code === "P2009" || code === "P2019") {
        res.status(400).json({ error: "INVALID_INPUT", message: "Dados inválidos." });
        return;
      }
      console.error(label, error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno em Competências e Desenvolvimento." });
    });
  };
}

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
}

function invalidId(res: express.Response) {
  return res.status(400).json({ error: "INVALID_ID", message: "Identificador inválido." });
}

function badRequest(res: express.Response, parsed: Extract<ParseResult<unknown>, { ok: false }>) {
  return res.status(400).json({ error: parsed.code, message: parsed.message });
}

/** `?employeeId=` opcional (ficha); inválido → null (400). */
function employeeFilter(req: express.Request): { employeeId?: string } | null {
  const raw = req.query.employeeId;
  if (raw === undefined || raw === "") return {};
  return typeof raw === "string" && isUuidString(raw) ? { employeeId: raw.trim().toLowerCase() } : null;
}

/** Arquivo em memória (nunca em disco), um por requisição, até IMPORT_MAX_FILE_BYTES. */
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1, fields: 5 } });

function receiveFile(req: express.Request, res: express.Response): Promise<boolean> {
  return new Promise((resolve) => {
    importUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return resolve(true);
      const code = (err as { code?: string }).code;
      res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "INVALID_UPLOAD",
        message: code === "LIMIT_FILE_SIZE" ? "Planilha maior que 5 MB." : "Envio de arquivo inválido.",
      });
      resolve(false);
    });
  });
}

/** Resoluções da prévia (campo multipart `resolutions`, JSON). Só chaves/valores esperados. */
function readResolutions(raw: unknown): ImportResolutions | null {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const out: ImportResolutions = { employeeChoices: {}, conflictDecisions: {} };
  const choices = (parsed as { employeeChoices?: unknown }).employeeChoices ?? {};
  const decisions = (parsed as { conflictDecisions?: unknown }).conflictDecisions ?? {};
  if (typeof choices !== "object" || typeof decisions !== "object") return null;
  for (const [row, id] of Object.entries(choices as Record<string, unknown>)) {
    if (!/^\d{1,6}$/.test(row) || !isUuidString(id)) return null;
    out.employeeChoices![row] = id.trim().toLowerCase();
  }
  for (const [key, decision] of Object.entries(decisions as Record<string, unknown>)) {
    const [e, c] = key.split(":");
    if (!isUuidString(e) || !isUuidString(c) || (decision !== "APPLY" && decision !== "KEEP")) return null;
    out.conflictDecisions![`${e.toLowerCase()}:${c.toLowerCase()}`] = decision;
  }
  return out;
}

function param(req: express.Request, name: string): string | null {
  const v = req.params[name];
  return isUuidString(v) ? v.trim().toLowerCase() : null;
}

export function registerCompetencyRoutes(
  app: express.Application,
  guards: CompetencyRouteGuards,
  deps: CompetencyRouteDeps,
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const db = deps.prisma;
  const now = () => (deps.now ? deps.now() : new Date());
  const isEnabled = deps.isEnabled ?? (() => isCompetenciesEnabled());
  const requireEnabled = requireCompetenciesEnabled(isEnabled);
  const gate = (cap: CompetencyCapability) => {
    const g = COMPETENCY_CAPABILITY_GRANTS[cap];
    // Flag antes da permissão: desligado responde 404 a todos (inclusive SUPER_ADMIN).
    return [requireAppAuth, requireEnabled, requireResource(g.resourceKey, g.action)] as const;
  };

  /** Escopo resolvido por requisição — nunca vem do corpo nem do cliente. */
  async function scopeOf(req: express.Request): Promise<CompetencyScope> {
    const { accessScope, actorEmployeeId } = await guards.getScopeInput(req);
    let teamIds: string[] = [];
    if (actorEmployeeId && accessScope === "DIRECT_REPORTS") {
      const rows = (await db.employee.findMany({ where: { managerId: actorEmployeeId } })) as { id: string }[];
      teamIds = rows.map((r) => r.id);
    } else if (actorEmployeeId && accessScope === "DESCENDANTS") {
      teamIds = await deps.loadDescendantIds(actorEmployeeId);
    }
    return buildCompetencyScope({ accessScope, actorEmployeeId, teamIds });
  }

  /** Autoria sempre da sessão autenticada — nunca do corpo. */
  async function actor(req: express.Request) {
    const user = await getCurrentAppUser(req);
    return { userId: user && isUuidString(user.id) ? user.id : null };
  }

  const base = "/api/hr/competencies";

  /** Status da flag para menu/rota/ficha — só autenticação (sem a flag, senão 404). */
  app.get(`${base}/feature-status`, requireAppAuth, (_req, res) => {
    noStore(res);
    res.json({ enabled: isEnabled() });
  });

  // —— Leitura ——
  app.get(`${base}/overview`, ...gate("view"), asyncRoute("GET competencies/overview", async (_req, res) => {
    noStore(res);
    return res.json(await getCompetencyOverview(db, businessTodayIso(now()), await scopeOf(_req)));
  }));

  app.get(`${base}/matrix`, ...gate("view"), asyncRoute("GET competencies/matrix", async (_req, res) => {
    noStore(res);
    return res.json(await getCompetencyMatrix(db, businessTodayIso(now()), await scopeOf(_req)));
  }));

  // Ficha do colaborador (aba Competências): mesma engine e mesmo escopo do módulo.
  app.get(`${base}/employees/:employeeId`, ...gate("view"), asyncRoute("GET competencies/employee", async (req, res) => {
    const employeeId = param(req, "employeeId");
    if (!employeeId) return invalidId(res);
    noStore(res);
    return res.json(await getEmployeeCompetencyProfile(db, employeeId, businessTodayIso(now()), await scopeOf(req)));
  }));

  app.get(`${base}/catalog`, ...gate("view"), asyncRoute("GET competencies/catalog", async (_req, res) => {
    noStore(res);
    return res.json({ competencies: await listCompetencies(db) });
  }));

  app.get(`${base}/positions`, ...gate("view"), asyncRoute("GET competencies/positions", async (_req, res) => {
    noStore(res);
    return res.json({ positions: await listWorkPositions(db, await scopeOf(_req)) });
  }));

  app.get(`${base}/options`, ...gate("view"), asyncRoute("GET competencies/options", async (_req, res) => {
    noStore(res);
    return res.json(await getCompetencyOptions(db, await scopeOf(_req)));
  }));

  // —— Catálogo de competências ——
  app.post(`${base}/catalog`, ...gate("manageCatalog"), asyncRoute("POST competencies/catalog", async (req, res) => {
    const parsed = parseCompetencyBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const created = await createCompetency(db, parsed.value, who);
    logEmployeeHrAudit({ event: "competency.catalog.change", actorUserId: who.userId, details: { action: "create", competencyId: created.id } });
    return res.status(201).json(created);
  }));

  app.put(`${base}/catalog/:id`, ...gate("manageCatalog"), asyncRoute("PUT competencies/catalog", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseCompetencyBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const updated = await updateCompetency(db, id, parsed.value, who);
    logEmployeeHrAudit({ event: "competency.catalog.change", actorUserId: who.userId, details: { action: "update", competencyId: id } });
    return res.json(updated);
  }));

  app.delete(`${base}/catalog/:id`, ...gate("manageCatalog"), asyncRoute("DELETE competencies/catalog", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const who = await actor(req);
    await archiveCompetency(db, id, who);
    logEmployeeHrAudit({ event: "competency.catalog.change", actorUserId: who.userId, details: { action: "archive", competencyId: id } });
    return res.status(204).end();
  }));

  // —— Postos ——
  app.post(`${base}/positions`, ...gate("manageCatalog"), asyncRoute("POST competencies/positions", async (req, res) => {
    const parsed = parseWorkPositionBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const created = await createWorkPosition(db, parsed.value, who);
    logEmployeeHrAudit({
      event: "competency.position.change",
      actorUserId: who.userId,
      details: { action: "create", positionId: created.id, requirementCount: parsed.value.requirements.length },
    });
    return res.status(201).json(created);
  }));

  app.put(`${base}/positions/:id`, ...gate("manageCatalog"), asyncRoute("PUT competencies/positions", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseWorkPositionBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    await updateWorkPosition(db, id, parsed.value, who);
    logEmployeeHrAudit({
      event: "competency.position.change",
      actorUserId: who.userId,
      details: { action: "update", positionId: id, requirementCount: parsed.value.requirements.length },
    });
    return res.json({ id });
  }));

  app.put(`${base}/positions/:id/team`, ...gate("manageCatalog"), asyncRoute("PUT competencies/positions/team", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parsePositionTeamBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const result = await setWorkPositionTeam(db, id, parsed.value.employeeIds, who, now(), await scopeOf(req));
    for (const employeeId of result.added) {
      logEmployeeHrAudit({ event: "employee.competency.position.assign", actorUserId: who.userId, employeeId, details: { positionId: id, assigned: true } });
    }
    for (const employeeId of result.removed) {
      logEmployeeHrAudit({ event: "employee.competency.position.assign", actorUserId: who.userId, employeeId, details: { positionId: id, assigned: false } });
    }
    return res.json(result);
  }));

  app.delete(`${base}/positions/:id`, ...gate("manageCatalog"), asyncRoute("DELETE competencies/positions", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const who = await actor(req);
    await archiveWorkPosition(db, id, who, now(), await scopeOf(req));
    logEmployeeHrAudit({ event: "competency.position.change", actorUserId: who.userId, details: { action: "archive", positionId: id } });
    return res.status(204).end();
  }));

  // —— Matriz (nível manual) ——
  app.put(
    `${base}/levels/:employeeId/:competencyId`,
    ...gate("editMatrix"),
    asyncRoute("PUT competencies/levels", async (req, res) => {
      const employeeId = param(req, "employeeId");
      const competencyId = param(req, "competencyId");
      if (!employeeId || !competencyId) return invalidId(res);
      const parsed = parseLevelBody(req.body);
      if (parsed.ok === false) return badRequest(res, parsed);
      const who = await actor(req);
      const result = await setEmployeeCompetencyLevel(
        db,
        { employeeId, competencyId, level: parsed.value.level, expectedVersion: parsed.value.expectedVersion },
        who,
        now(),
        await scopeOf(req),
        { actorCanApprove: await guards.canApprove(req) },
      );
      if (result.outcome === "REQUESTED") {
        logEmployeeHrAudit({
          event: "employee.competency.level.request",
          actorUserId: who.userId,
          employeeId,
          details: { competencyId, requestId: result.requestId, reason: result.reason, previousLevel: result.previousLevel, newLevel: parsed.value.level },
        });
        return res.status(202).json({
          outcome: "REQUESTED",
          employeeId,
          competencyId,
          level: parsed.value.level,
          previousLevel: result.previousLevel,
          requestId: result.requestId,
          reason: result.reason,
        });
      }
      if (result.changed) {
        logEmployeeHrAudit({
          event: "employee.competency.level.change",
          actorUserId: who.userId,
          employeeId,
          details: {
            competencyId,
            previousLevel: result.previousLevel,
            newLevel: parsed.value.level,
            source: "MANUAL",
            selfApproved: result.selfApproved,
          },
        });
      }
      return res.json({
        outcome: "APPLIED",
        employeeId,
        competencyId,
        level: parsed.value.level,
        previousLevel: result.previousLevel,
        version: result.version,
      });
    }),
  );

  // —— Aprovações de nível (governança) ——
  app.get(`${base}/approvals`, ...gate("viewApprovals"), asyncRoute("GET competencies/approvals", async (req, res) => {
    const status = req.query.status === "DECIDED" ? "DECIDED" : req.query.status === "ALL" ? undefined : "PENDING";
    noStore(res);
    return res.json({ requests: await listLevelRequests(db, await scopeOf(req), { status }) });
  }));

  app.post(`${base}/approvals/:id/decision`, ...gate("approveLevels"), asyncRoute("POST competencies/approvals/decision", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseDecisionBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const result = await decideLevelRequest(db, id, parsed.value, who, now(), await scopeOf(req));
    logEmployeeHrAudit({
      event: "employee.competency.level.decision",
      actorUserId: who.userId,
      details: { requestId: id, decision: parsed.value.decision, status: result.status },
    });
    return res.json(result);
  }));

  // —— Importação assistida por planilha (editar matriz) ——
  app.get(`${base}/import/template`, ...gate("editMatrix"), asyncRoute("GET competencies/import/template", async (req, res) => {
    const buffer = await buildCompetencyImportTemplate(db, await scopeOf(req));
    noStore(res);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="competencias-niveis.xlsx"');
    return res.send(buffer);
  }));

  app.post(`${base}/import/preview`, ...gate("editMatrix"), asyncRoute("POST competencies/import/preview", async (req, res) => {
    if (!(await receiveFile(req, res))) return;
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED", message: "Selecione a planilha." });
    const resolutions = readResolutions(req.body?.resolutions);
    if (!resolutions) return res.status(400).json({ error: "INVALID_RESOLUTIONS", message: "Resoluções inválidas." });
    noStore(res);
    return res.json(
      await previewCompetencyImport(
        db,
        { buffer: req.file.buffer, fileName: req.file.originalname, resolutions },
        await scopeOf(req),
        { actorCanApprove: await guards.canApprove(req) },
      ),
    );
  }));

  app.post(`${base}/import/apply`, ...gate("editMatrix"), asyncRoute("POST competencies/import/apply", async (req, res) => {
    if (!(await receiveFile(req, res))) return;
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED", message: "Selecione a planilha." });
    const resolutions = readResolutions(req.body?.resolutions);
    if (!resolutions) return res.status(400).json({ error: "INVALID_RESOLUTIONS", message: "Resoluções inválidas." });
    const fingerprint = typeof req.body?.fingerprint === "string" ? req.body.fingerprint : "";
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      return res.status(400).json({ error: "FINGERPRINT_REQUIRED", message: "Gere a prévia antes de aplicar." });
    }
    const who = await actor(req);
    const result = await applyCompetencyImport(
      db,
      { buffer: req.file.buffer, fileName: req.file.originalname, resolutions, fingerprint },
      await scopeOf(req),
      who,
      now(),
      { actorCanApprove: await guards.canApprove(req) },
    );
    logEmployeeHrAudit({
      event: "competency.import.apply",
      actorUserId: who.userId,
      details: {
        batchId: result.batchId,
        changed: result.changed,
        requested: result.requested,
        conflictsApplied: result.conflictsApplied,
        rows: result.summary.rows,
      },
    });
    return res.json(result);
  }));

  // —— Avaliações ——
  app.get(`${base}/assessments`, ...gate("viewAssessments"), asyncRoute("GET competencies/assessments", async (req, res) => {
    const filter = employeeFilter(req);
    if (filter === null) return invalidId(res);
    noStore(res);
    return res.json({ assessments: await listAssessments(db, await scopeOf(req), filter) });
  }));

  app.post(`${base}/assessments`, ...gate("registerAssessment"), asyncRoute("POST competencies/assessments", async (req, res) => {
    const parsed = parseAssessmentBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const result = await createAssessment(db, parsed.value, who, now(), await scopeOf(req));
    logEmployeeHrAudit({
      event: parsed.value.status === "COMPLETED" ? "employee.competency.assessment.complete" : "employee.competency.assessment.create",
      actorUserId: who.userId,
      employeeId: parsed.value.employeeId,
      details: { assessmentId: result.id, replacedPendingId: result.replacedPendingId, itemCount: parsed.value.items.length },
    });
    return res.status(201).json(result);
  }));

  app.put(`${base}/assessments/:id`, ...gate("registerAssessment"), asyncRoute("PUT competencies/assessments", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseAssessmentBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    await updateAssessment(db, id, parsed.value, who, now(), await scopeOf(req));
    logEmployeeHrAudit({
      event: parsed.value.status === "COMPLETED" ? "employee.competency.assessment.complete" : "employee.competency.assessment.update",
      actorUserId: who.userId,
      employeeId: parsed.value.employeeId,
      details: { assessmentId: id, itemCount: parsed.value.items.length },
    });
    return res.json({ id });
  }));

  app.delete(`${base}/assessments/:id`, ...gate("registerAssessment"), asyncRoute("DELETE competencies/assessments", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const who = await actor(req);
    const { employeeId } = await deleteAssessment(db, id, await scopeOf(req));
    logEmployeeHrAudit({ event: "employee.competency.assessment.delete", actorUserId: who.userId, employeeId, details: { assessmentId: id } });
    return res.status(204).end();
  }));

  // —— Treinamentos ——
  app.get(`${base}/trainings`, ...gate("viewTrainings"), asyncRoute("GET competencies/trainings", async (req, res) => {
    const filter = employeeFilter(req);
    if (filter === null) return invalidId(res);
    noStore(res);
    return res.json({ trainings: await listTrainings(db, await scopeOf(req), filter) });
  }));

  app.post(`${base}/trainings`, ...gate("manageTrainings"), asyncRoute("POST competencies/trainings", async (req, res) => {
    const parsed = parseTrainingBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    const created = await createTraining(db, parsed.value, who, await scopeOf(req));
    logEmployeeHrAudit({
      event: "competency.training.change",
      actorUserId: who.userId,
      details: { action: "create", trainingId: created.id, participantCount: parsed.value.participantIds.length },
    });
    return res.status(201).json(created);
  }));

  app.put(`${base}/trainings/:id`, ...gate("manageTrainings"), asyncRoute("PUT competencies/trainings", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseTrainingBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    await updateTraining(db, id, parsed.value, who, await scopeOf(req));
    logEmployeeHrAudit({
      event: "competency.training.change",
      actorUserId: who.userId,
      details: { action: "update", trainingId: id, participantCount: parsed.value.participantIds.length },
    });
    return res.json({ id });
  }));

  app.patch(`${base}/trainings/:id/status`, ...gate("manageTrainings"), asyncRoute("PATCH competencies/trainings/status", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const parsed = parseTrainingStatusBody(req.body);
    if (parsed.ok === false) return badRequest(res, parsed);
    const who = await actor(req);
    await setTrainingStatus(db, id, parsed.value, who, now(), await scopeOf(req));
    logEmployeeHrAudit({ event: "competency.training.change", actorUserId: who.userId, details: { action: "status", trainingId: id, status: parsed.value.status } });
    return res.json({ id, status: parsed.value.status });
  }));

  app.delete(`${base}/trainings/:id`, ...gate("manageTrainings"), asyncRoute("DELETE competencies/trainings", async (req, res) => {
    const id = param(req, "id");
    if (!id) return invalidId(res);
    const who = await actor(req);
    await deleteTraining(db, id, await scopeOf(req));
    logEmployeeHrAudit({ event: "competency.training.change", actorUserId: who.userId, details: { action: "delete", trainingId: id } });
    return res.status(204).end();
  }));
}
