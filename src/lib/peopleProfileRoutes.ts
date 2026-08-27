/**
 * Rotas da Ficha Funcional Corporativa.
 * Gate externo: admin.employees:view. Autorização fina + escopo no resolver.
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
import { logEmployeeHrAudit } from "@/src/lib/employeeHrAudit.js";
import { isEmployeeUuid } from "@/src/lib/employeeRegistration.js";
import {
  loadPeopleAbsences,
  loadPeopleBenefits,
  loadPeopleCareer,
  loadPeopleCompensation,
  loadPeopleDocuments,
  loadPeopleEmergency,
  loadPeopleEpi,
  loadPeopleHistoryPage,
  loadPeopleNotes,
  loadPeoplePersonal,
  loadPeopleProfessional,
  loadPeopleProfileSummary,
  resolveProfileAccess,
} from "@/src/lib/peopleProfile.server.js";
import { PeopleProfileAccessError } from "@/src/lib/peopleProfileErrors.js";
import {
  applyCareerMovement,
  applyCompensationAdjustment,
  createEmergencyContact,
  createEmployeeAbsence,
  createEmployeeBenefit,
  createEmployeeNote,
  createEpiDelivery,
  PEOPLE_CAREER_POST_EVENT_TYPES,
  readEmployeeDocumentFile,
  saveEmployeeDocument,
} from "@/src/lib/peopleProfileMutations.server.js";
import { buildPeopleProfileCapabilities } from "@/src/lib/peopleProfileCapabilities.js";
import { listOfficialPayrollHrCatalogItems } from "@/src/lib/peopleOfficialPayrollCatalog.server.js";
import { readAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import { EmployeeRegistrationError } from "@/src/lib/employeeRegistration.js";

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

function parseDate(value: unknown, fallback?: Date): Date | null {
  if (value == null || value === "") return fallback ?? null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function sendError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof PeopleProfileAccessError) {
    noStore(res);
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof EmployeeRegistrationError) {
    noStore(res);
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(fallback, { message: error instanceof Error ? error.message : "unknown" });
  noStore(res);
  return res.status(500).json({ error: fallback });
}

export function registerPeopleProfileRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
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
    const actorEmployeeId = user?.employeeId ?? null;
    const access = await resolveProfileAccess(prisma, {
      check,
      actorEmployeeId,
      targetEmployeeId: employeeId,
    });
    return { check, user, actorEmployeeId, ...access };
  }

  app.get("/api/employees/:id/profile", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      const summary = await loadPeopleProfileSummary(prisma, id, ctx.capabilities);
      noStore(res);
      return res.json(summary);
    } catch (error) {
      return sendError(res, error, "Erro ao carregar ficha.");
    }
  });

  app.get("/api/employees/:id/professional", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewProfessional) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para dados profissionais.");
      }
      noStore(res);
      return res.json(await loadPeopleProfessional(prisma, id));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar dados profissionais.");
    }
  });

  app.get("/api/employees/:id/career", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewCareer) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para carreira.");
      }
      noStore(res);
      return res.json(await loadPeopleCareer(prisma, id));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar carreira.");
    }
  });

  app.get("/api/employees/:id/compensation", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewCompensationEvents) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para remuneração.");
      }
      noStore(res);
      return res.json(
        await loadPeopleCompensation(prisma, id, {
          includeValues: ctx.capabilities.canViewCompensationValues,
          actorUserId: ctx.user?.id,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao carregar remuneração.");
    }
  });

  app.get("/api/employees/:id/benefits", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para benefícios.");
      }
      noStore(res);
      return res.json({
        items: await loadPeopleBenefits(prisma, id, {
          includeAmounts: ctx.capabilities.canViewCompensationValues,
        }),
      });
    } catch (error) {
      return sendError(res, error, "Erro ao carregar benefícios.");
    }
  });

  app.get("/api/employees/:id/personal", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewPersonal) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para dados pessoais.");
      }
      noStore(res);
      return res.json(
        await loadPeoplePersonal(prisma, id, { reveal: ctx.capabilities.canViewPersonal })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao carregar dados pessoais.");
    }
  });

  app.get("/api/employees/:id/emergency", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewEmergency) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para emergência.");
      }
      noStore(res);
      return res.json(
        await loadPeopleEmergency(prisma, id, { reveal: ctx.capabilities.canViewEmergency })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao carregar emergência.");
    }
  });

  app.get("/api/employees/:id/epi", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      noStore(res);
      return res.json(await loadPeopleEpi(prisma, id));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar EPI.");
    }
  });

  app.get("/api/employees/:id/documents", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      noStore(res);
      return res.json(await loadPeopleDocuments(prisma, id));
    } catch (error) {
      return sendError(res, error, "Erro ao carregar documentos.");
    }
  });

  app.get("/api/employees/:id/documents/:documentId/download", ...viewGuard, async (req, res) => {
    try {
      const { id, documentId } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      if (!isEmployeeUuid(documentId)) {
        throw new PeopleProfileAccessError("INVALID_ID", "Documento inválido.", 400);
      }
      const { row, buffer } = await readEmployeeDocumentFile(prisma, {
        employeeId: id,
        documentId,
      });
      logEmployeeHrAudit({
        event: "employee.document.download",
        actorUserId: ctx.user?.id,
        employeeId: id,
        details: { documentId },
      });
      noStore(res);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(row.originalFileName)}"`
      );
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "Erro ao baixar documento.");
    }
  });

  app.get("/api/employees/:id/absences", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewAbsences) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para férias/afastamentos.");
      }
      noStore(res);
      return res.json({ items: await loadPeopleAbsences(prisma, id) });
    } catch (error) {
      return sendError(res, error, "Erro ao carregar afastamentos.");
    }
  });

  app.get("/api/employees/:id/history", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewHistory) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para histórico.");
      }
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = Number(req.query.limit ?? 50);
      noStore(res);
      return res.json(
        await loadPeopleHistoryPage(prisma, id, {
          includeAmounts: ctx.capabilities.canViewCompensationValues,
          cursor,
          limit,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao carregar histórico.");
    }
  });

  app.get("/api/employees/:id/notes", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewNotes) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observações.");
      }
      noStore(res);
      return res.json(
        await loadPeopleNotes(prisma, id, {
          includeRestricted: ctx.capabilities.canViewRestrictedNotes,
        })
      );
    } catch (error) {
      return sendError(res, error, "Erro ao carregar observações.");
    }
  });

  app.get("/api/employees/:id/photo", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      await context(req, id);
      const row = await prisma.employee.findUnique({
        where: { id },
        select: { photoStorageKey: true },
      });
      if (!row?.photoStorageKey) {
        return res.status(404).json({ error: "Foto não cadastrada." });
      }
      const buffer = await readAppLocalFile(row.photoStorageKey);
      noStore(res);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "Erro ao carregar foto.");
    }
  });

  app.post("/api/employees/:id/compensation-adjustments", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageCompensation) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para registrar reajuste.");
      }
      const body = req.body as Record<string, unknown>;
      const effectiveDate = parseDate(body.effectiveDate, new Date());
      if (!effectiveDate) {
        return res.status(400).json({ error: "Data de vigência inválida." });
      }
      const result = await applyCompensationAdjustment(prisma, {
        employeeId: id,
        expectedPreviousAmount: Number(body.expectedPreviousAmount),
        newAmount: Number(body.newAmount),
        type: String(body.type ?? "OTHER"),
        effectiveDate,
        reason: typeof body.reason === "string" ? body.reason : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao registrar reajuste.");
    }
  });

  app.post("/api/employees/:id/career-events", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageCareer) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para movimentação.");
      }
      const body = req.body as Record<string, unknown>;
      const eventType = String(body.eventType ?? "");
      if (!(PEOPLE_CAREER_POST_EVENT_TYPES as readonly string[]).includes(eventType)) {
        return res.status(400).json({ error: "Tipo de evento inválido." });
      }
      const effectiveDate = parseDate(body.effectiveDate, new Date());
      if (!effectiveDate) return res.status(400).json({ error: "Data de vigência inválida." });
      const result = await applyCareerMovement(prisma, {
        employeeId: id,
        eventType: eventType as (typeof PEOPLE_CAREER_POST_EVENT_TYPES)[number],
        effectiveDate,
        reason: typeof body.reason === "string" ? body.reason : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
        newRoleId: typeof body.newRoleId === "string" ? body.newRoleId : null,
        newDepartmentId: typeof body.newDepartmentId === "string" ? body.newDepartmentId : null,
        newDepartment: typeof body.newDepartment === "string" ? body.newDepartment : null,
        newManagerId: typeof body.newManagerId === "string" ? body.newManagerId : null,
        newContractType: typeof body.newContractType === "string" ? body.newContractType : null,
        newCostCenterId: typeof body.newCostCenterId === "string" ? body.newCostCenterId : null,
        newCostCenter: typeof body.newCostCenter === "string" ? body.newCostCenter : null,
        newWorkSchedule: typeof body.newWorkSchedule === "string" ? body.newWorkSchedule : null,
      });
      noStore(res);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao registrar movimentação.");
    }
  });

  app.post("/api/employees/:id/benefits", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para benefícios.");
      }
      const body = req.body as Record<string, unknown>;
      const startDate = parseDate(body.startDate);
      if (!startDate || typeof body.benefitId !== "string") {
        return res.status(400).json({ error: "Benefício e data de início são obrigatórios." });
      }
      const row = await createEmployeeBenefit(prisma, {
        employeeId: id,
        benefitId: body.benefitId,
        startDate,
        endDate: parseDate(body.endDate),
        planName: typeof body.planName === "string" ? body.planName : null,
        amount:
          ctx.capabilities.canViewCompensationValues && body.amount != null
            ? Number(body.amount)
            : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar benefício.");
    }
  });

  app.post("/api/employees/:id/absences", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageAbsences) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para afastamentos.");
      }
      const body = req.body as Record<string, unknown>;
      const startDate = parseDate(body.startDate);
      if (!startDate || typeof body.type !== "string") {
        return res.status(400).json({ error: "Tipo e data de início são obrigatórios." });
      }
      const row = await createEmployeeAbsence(prisma, {
        employeeId: id,
        type: body.type,
        startDate,
        endDate: parseDate(body.endDate),
        expectedReturn: parseDate(body.expectedReturn),
        status: typeof body.status === "string" ? body.status : "SCHEDULED",
        reason: typeof body.reason === "string" ? body.reason : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar afastamento.");
    }
  });

  app.post("/api/employees/:id/notes", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageNotes) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observações.");
      }
      const body = req.body as Record<string, unknown>;
      const category = String(body.category ?? "GERAL");
      if (category === "RESTRITA" && !ctx.capabilities.canViewRestrictedNotes) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observação restrita.");
      }
      const row = await createEmployeeNote(prisma, {
        employeeId: id,
        category,
        body: String(body.body ?? ""),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar observação.");
    }
  });

  app.post("/api/employees/:id/emergency-contacts", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEmergency) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para emergência.");
      }
      const body = req.body as Record<string, unknown>;
      if (typeof body.name !== "string" || typeof body.phone !== "string") {
        return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
      }
      const row = await createEmergencyContact(prisma, {
        employeeId: id,
        name: body.name,
        phone: body.phone,
        relationship: typeof body.relationship === "string" ? body.relationship : null,
        alternatePhone: typeof body.alternatePhone === "string" ? body.alternatePhone : null,
        priority: Number(body.priority ?? 2),
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar contato.");
    }
  });

  app.post("/api/employees/:id/epi-deliveries", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      const body = req.body as Record<string, unknown>;
      const deliveredAt = parseDate(body.deliveredAt, new Date());
      if (!deliveredAt || typeof body.item !== "string") {
        return res.status(400).json({ error: "Item e data são obrigatórios." });
      }
      const row = await createEpiDelivery(prisma, {
        employeeId: id,
        item: body.item,
        deliveredAt,
        quantity: Number(body.quantity ?? 1),
        size: typeof body.size === "string" ? body.size : null,
        validUntil: parseDate(body.validUntil),
        responsibleName: typeof body.responsibleName === "string" ? body.responsibleName : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar entrega de EPI.");
    }
  });

  app.post(
    "/api/employees/:id/documents",
    ...viewGuard,
    upload.single("file"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const ctx = await context(req, id);
        if (!ctx.capabilities.canManageDocuments) {
          throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
        }
        const file = req.file;
        if (!file) return res.status(400).json({ error: "Arquivo não enviado." });
        const body = req.body as Record<string, unknown>;
        const emp = await prisma.employee.findUnique({
          where: { id },
          select: { personId: true },
        });
        const row = await saveEmployeeDocument({
          prisma,
          employeeId: id,
          personId: emp?.personId ?? null,
          documentType: String(body.documentType ?? "OTHER"),
          displayName: String(body.displayName ?? file.originalname),
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          issuedAt: parseDate(body.issuedAt),
          expiresAt: parseDate(body.expiresAt),
          notes: typeof body.notes === "string" ? body.notes : null,
          actorUserId: ctx.user?.id,
        });
        noStore(res);
        return res.status(201).json({ id: row.id });
      } catch (error) {
        return sendError(res, error, "Erro ao anexar documento.");
      }
    }
  );

  app.get("/api/hr/benefits", ...viewGuard, async (req, res) => {
    try {
      const check = await getPermissionCheck(req);
      const caps = buildPeopleProfileCapabilities(check);
      if (!caps.canViewBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para benefícios.");
      }
      const items = await listOfficialPayrollHrCatalogItems(prisma);
      noStore(res);
      return res.json({ items });
    } catch (error) {
      return sendError(res, error, "Erro ao listar benefícios.");
    }
  });

  app.post("/api/hr/benefits", ...viewGuard, async (req, res) => {
    try {
      const check = await getPermissionCheck(req);
      const caps = buildPeopleProfileCapabilities(check);
      if (!caps.canManageBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para catálogo de benefícios.");
      }
      noStore(res);
      return res.status(409).json({
        error:
          "O catálogo oficial é Administração → Configurações → Estrutura Operacional (Encargos e Benefícios).",
      });
    } catch (error) {
      return sendError(res, error, "Erro ao criar benefício.");
    }
  });
}
