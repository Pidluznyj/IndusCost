/**
 * Rotas de avaliações da ficha de Pessoas.
 * O gate do módulo é o mesmo da ficha; a autorização fina fica nas capabilities.
 */

import type express from "express";
import type { RequestHandler } from "express";
import multer from "multer";
import { prisma } from "@/src/lib/prisma.js";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_RESOURCE_KEYS,
} from "@/src/lib/employeesAccess.js";
import type { EmployeePermissionBag } from "@/src/lib/employeesPermissions.js";
import { isEmployeeUuid } from "@/src/lib/employeeRegistration.js";
import { HrEvaluationError } from "@/src/lib/hrEvaluation.js";
import {
  addEvaluationActionPlan,
  attachEvaluationDocument,
  cancelEmployeeEvaluation,
  completeEmployeeEvaluation,
  createEmployeeEvaluation,
  ensureExperienceEvaluations,
  getEmployeeEvaluation,
  listEmployeeEvaluations,
  loadOperationalEvaluationSummary,
  recordEvaluationPrint,
  updateEmployeeEvaluation,
  updateEvaluationActionPlan,
} from "@/src/lib/hrEvaluation.server.js";
import { resolveProfileAccess } from "@/src/lib/peopleProfile.server.js";
import { PeopleProfileAccessError } from "@/src/lib/peopleProfileErrors.js";
import { buildPeopleProfileCapabilities } from "@/src/lib/peopleProfileCapabilities.js";
import type { HrEvaluationUpdateInput } from "@/src/lib/hrEvaluation.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    employeeId?: string | null;
  } | null>;
  getPermissionCheck: (req: express.Request) => Promise<EmployeePermissionBag>;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function sendError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof HrEvaluationError || error instanceof PeopleProfileAccessError) {
    noStore(res);
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(fallback, { message: error instanceof Error ? error.message : "unknown" });
  noStore(res);
  return res.status(500).json({ error: fallback });
}

function readPatch(body: unknown): HrEvaluationUpdateInput {
  if (!body || typeof body !== "object") return {};
  return body as HrEvaluationUpdateInput;
}

export function registerHrEvaluationRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requireResource, getCurrentAppUser, getPermissionCheck } = guards;
  const viewGuard = [
    requireAppAuth,
    requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view),
  ];

  async function context(req: express.Request, employeeId: string) {
    if (!isEmployeeUuid(employeeId)) {
      throw new PeopleProfileAccessError("INVALID_ID", "ID inválido.", 400);
    }
    const [check, user] = await Promise.all([getPermissionCheck(req), getCurrentAppUser(req)]);
    const access = await resolveProfileAccess(prisma, {
      check,
      actorEmployeeId: user?.employeeId ?? null,
      targetEmployeeId: employeeId,
    });
    return { user, ...access };
  }

  app.get("/api/hr/evaluations/operational-summary", ...viewGuard, async (req, res) => {
    try {
      const check = await getPermissionCheck(req);
      const caps = buildPeopleProfileCapabilities(check);
      if (!caps.canViewEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para avaliações.", 403);
      }
      noStore(res);
      return res.json(await loadOperationalEvaluationSummary(prisma));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar pendências de avaliação.");
    }
  });

  app.get("/api/employees/:id/evaluations", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canViewEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para avaliações.", 403);
      }
      noStore(res);
      return res.json(await listEmployeeEvaluations(prisma, req.params.id));
    } catch (error) {
      return sendError(res, error, "Erro ao listar avaliações.");
    }
  });

  app.post("/api/employees/:id/evaluations/ensure", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canManageEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para programar avaliações.", 403);
      }
      noStore(res);
      return res.json(
        await ensureExperienceEvaluations(prisma, {
          employeeId: req.params.id,
          actorUserId: ctx.user?.id,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao programar avaliações.");
    }
  });

  app.post("/api/employees/:id/evaluations", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canManageEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para registrar avaliações.", 403);
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const created = await createEmployeeEvaluation(prisma, {
        employeeId: req.params.id,
        evaluationType: String(body.evaluationType ?? ""),
        dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
        periodStart: typeof body.periodStart === "string" ? body.periodStart : null,
        periodEnd: typeof body.periodEnd === "string" ? body.periodEnd : null,
        confirmDuplicate: body.confirmDuplicate === true,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json(created);
    } catch (error) {
      return sendError(res, error, "Erro ao criar avaliação.");
    }
  });

  app.get("/api/employees/:id/evaluations/:evaluationId", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canViewEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para avaliações.", 403);
      }
      if (!isEmployeeUuid(req.params.evaluationId)) {
        throw new HrEvaluationError("INVALID_ID", "Avaliação inválida.");
      }
      noStore(res);
      return res.json(await getEmployeeEvaluation(prisma, req.params.id, req.params.evaluationId));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar avaliação.");
    }
  });

  app.patch("/api/employees/:id/evaluations/:evaluationId", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canManageEvaluations && !ctx.capabilities.canCompleteEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para editar avaliações.", 403);
      }
      noStore(res);
      return res.json(
        await updateEmployeeEvaluation(prisma, {
          employeeId: req.params.id,
          evaluationId: req.params.evaluationId,
          patch: readPatch(req.body),
          actorUserId: ctx.user?.id,
          allowCompletedEdit: ctx.capabilities.canCompleteEvaluations,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar avaliação.");
    }
  });

  app.post("/api/employees/:id/evaluations/:evaluationId/complete", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canCompleteEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para concluir avaliações.", 403);
      }
      noStore(res);
      return res.json(
        await completeEmployeeEvaluation(prisma, {
          employeeId: req.params.id,
          evaluationId: req.params.evaluationId,
          patch: readPatch(req.body),
          actorUserId: ctx.user?.id,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao concluir avaliação.");
    }
  });

  app.post("/api/employees/:id/evaluations/:evaluationId/cancel", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canManageEvaluations && !ctx.capabilities.canCompleteEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para cancelar avaliações.", 403);
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      noStore(res);
      return res.json(
        await cancelEmployeeEvaluation(prisma, {
          employeeId: req.params.id,
          evaluationId: req.params.evaluationId,
          reason: typeof body.reason === "string" ? body.reason : null,
          actorUserId: ctx.user?.id,
          allowCompletedEdit: ctx.capabilities.canCompleteEvaluations,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao cancelar avaliação.");
    }
  });

  app.post("/api/employees/:id/evaluations/:evaluationId/print", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canPrintEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para imprimir avaliações.", 403);
      }
      noStore(res);
      return res.json(
        await recordEvaluationPrint(prisma, {
          employeeId: req.params.id,
          evaluationId: req.params.evaluationId,
          actorUserId: ctx.user?.id,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao registrar impressão.");
    }
  });

  app.post(
    "/api/employees/:id/evaluations/:evaluationId/documents",
    ...viewGuard,
    upload.single("file"),
    async (req, res) => {
      try {
        const ctx = await context(req, req.params.id);
        if (!ctx.capabilities.canAttachEvaluationDocuments) {
          throw new HrEvaluationError("FORBIDDEN", "Sem permissão para anexar o documento.", 403);
        }
        const file = req.file;
        if (!file) return res.status(400).json({ error: "Arquivo não enviado." });
        noStore(res);
        return res.status(201).json(
          await attachEvaluationDocument(prisma, {
            employeeId: req.params.id,
            evaluationId: req.params.evaluationId,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
            actorUserId: ctx.user?.id,
            allowCompletedEdit: ctx.capabilities.canCompleteEvaluations,
          })
        );
      } catch (error) {
        return sendError(res, error, "Erro ao anexar documento da avaliação.");
      }
    }
  );

  app.post("/api/employees/:id/evaluations/:evaluationId/action-plans", ...viewGuard, async (req, res) => {
    try {
      const ctx = await context(req, req.params.id);
      if (!ctx.capabilities.canManageEvaluations && !ctx.capabilities.canCompleteEvaluations) {
        throw new HrEvaluationError("FORBIDDEN", "Sem permissão para o plano de acompanhamento.", 403);
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      noStore(res);
      const created = await addEvaluationActionPlan(prisma, {
        employeeId: req.params.id,
        evaluationId: req.params.evaluationId,
        title: String(body.title ?? ""),
        description: typeof body.description === "string" ? body.description : null,
        responsibleEmployeeId:
          typeof body.responsibleEmployeeId === "string" ? body.responsibleEmployeeId : null,
        responsibleName: typeof body.responsibleName === "string" ? body.responsibleName : null,
        dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
        allowCompletedEdit: ctx.capabilities.canCompleteEvaluations,
      });
      return res.status(201).json(created);
    } catch (error) {
      return sendError(res, error, "Erro ao registrar ação.");
    }
  });

  app.patch(
    "/api/employees/:id/evaluations/:evaluationId/action-plans/:planId",
    ...viewGuard,
    async (req, res) => {
      try {
        const ctx = await context(req, req.params.id);
        if (!ctx.capabilities.canManageEvaluations && !ctx.capabilities.canCompleteEvaluations) {
          throw new HrEvaluationError("FORBIDDEN", "Sem permissão para o plano de acompanhamento.", 403);
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        noStore(res);
        return res.json(
          await updateEvaluationActionPlan(prisma, {
            employeeId: req.params.id,
            evaluationId: req.params.evaluationId,
            planId: req.params.planId,
            title: typeof body.title === "string" ? body.title : undefined,
            description: typeof body.description === "string" ? body.description : undefined,
            responsibleName: typeof body.responsibleName === "string" ? body.responsibleName : undefined,
            dueDate: typeof body.dueDate === "string" ? body.dueDate : undefined,
            status: typeof body.status === "string" ? body.status : undefined,
            notes: typeof body.notes === "string" ? body.notes : undefined,
            actorUserId: ctx.user?.id,
            allowCompletedEdit: ctx.capabilities.canCompleteEvaluations,
          })
        );
      } catch (error) {
        return sendError(res, error, "Erro ao atualizar ação.");
      }
    }
  );
}
