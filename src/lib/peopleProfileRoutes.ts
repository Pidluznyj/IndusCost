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
  resolveActorNames,
  resolveProfileAccess,
} from "@/src/lib/peopleProfile.server.js";
import { PeopleProfileAccessError } from "@/src/lib/peopleProfileErrors.js";
import {
  applyCareerMovement,
  applyCompensationAdjustment,
  createEmergencyContact,
  createEmployeeAbsence,
  createEmployeeNote,
  createEpiDelivery,
  deleteCareerEvent,
  deleteCompensationAdjustment,
  deleteEmergencyContact,
  deleteEmployeeAbsence,
  deleteEmployeeBenefit,
  deleteEmployeeDocument,
  deleteEmployeeNote,
  deleteEpiDelivery,
  PEOPLE_CAREER_POST_EVENT_TYPES,
  readEmployeeDocumentFile,
  readEmployeePhotoFile,
  removeEmployeePhoto,
  saveEmployeeDocument,
  saveEmployeePhoto,
  updateCareerEvent,
  updateCompensationAdjustment,
  updateEmergencyContact,
  updateEmployeeAbsence,
  updateEmployeeDocument,
  updateEmployeeNote,
  setEpiDeliveryStatus,
  createEpiDeliveryEvent,
  updateEpiDeliveryEvent,
  updateEpiDelivery,
  writeHistoryEvent,
} from "@/src/lib/peopleProfileMutations.server.js";
import { buildPeopleProfileCapabilities } from "@/src/lib/peopleProfileCapabilities.js";
import { listOfficialPayrollHrCatalogItems } from "@/src/lib/peopleOfficialPayrollCatalog.server.js";
import { EmployeeRegistrationError } from "@/src/lib/employeeRegistration.js";
import { registerHrEvaluationRoutes } from "@/src/lib/hrEvaluationRoutes.js";
import { PEOPLE_PROFILE_PHOTO_MAX_BYTES } from "@/src/lib/peopleProfileRecordEdits.js";
import { deleteAppLocalFile, saveAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import { businessTodayIso } from "@/src/lib/competencies/competencyDomain.js";
import {
  EPI_RECEIPT_MAX_BYTES,
  attachEpiReceipt,
  issueEpiDeliveryForm,
  planEpiReceiptBatch,
  renderEpiDeliveryFormPdf,
  resolveEpiFormReference,
  validateEpiReceipt,
} from "@/src/lib/epi/epiForms.server.js";
import { sha256Hex } from "@/src/lib/commercialPolicy/commercialPolicyRules.js";
import { canManageEmployeeEpi } from "@/src/lib/employeesPermissions.js";
import { randomUUID } from "node:crypto";
import { EXTERNAL_CERTIFICATE_MAX_BYTES, parseExternalCertificateInput } from "@/src/lib/hrEmployeeCertificates.js";
import {
  createExternalCertificate,
  findExternalCertificateDocument,
  listExternalCertificates,
  updateExternalCertificate,
} from "@/src/lib/hrEmployeeCertificates.server.js";

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

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PEOPLE_PROFILE_PHOTO_MAX_BYTES, files: 1 },
});

/** Certificado externo: 1 arquivo de até 10 MB; erro do multer vira 400 em JSON. */
const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EXTERNAL_CERTIFICATE_MAX_BYTES, files: 1, fields: 20 },
});

const certificateUploadSingle: RequestHandler = (req, res, next) => {
  certificateUpload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    noStore(res);
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      error: tooLarge ? "O certificado deve ter no máximo 10 MB." : "Não foi possível ler o arquivo enviado.",
      code: tooLarge ? "FILE_TOO_LARGE" : "INVALID_FILE",
    });
  });
};

/** Ficha de EPI assinada: 1 arquivo de até 10 MB; erro do multer vira 400 em JSON. */
const epiReceiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EPI_RECEIPT_MAX_BYTES, files: 1, fields: 10 },
});

const epiReceiptUploadSingle: RequestHandler = (req, res, next) => {
  epiReceiptUpload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    noStore(res);
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      error: tooLarge ? "O arquivo deve ter no máximo 10 MB." : "Não foi possível ler o arquivo enviado.",
      code: tooLarge ? "FILE_TOO_LARGE" : "INVALID_FILE",
    });
  });
};

/** Lote de fichas assinadas: até 30 arquivos de 10 MB por envio. */
const EPI_BATCH_MAX_FILES = 30;
const epiReceiptBatchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EPI_RECEIPT_MAX_BYTES, files: EPI_BATCH_MAX_FILES, fields: 10 },
});

const epiReceiptUploadBatch: RequestHandler = (req, res, next) => {
  epiReceiptBatchUpload.array("files", EPI_BATCH_MAX_FILES)(req, res, (error: unknown) => {
    if (!error) return next();
    noStore(res);
    const code = error instanceof multer.MulterError ? error.code : "";
    return res.status(400).json({
      error:
        code === "LIMIT_FILE_SIZE"
          ? "Cada arquivo deve ter no máximo 10 MB."
          : code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE"
            ? `Envie no máximo ${EPI_BATCH_MAX_FILES} arquivos por lote.`
            : "Não foi possível ler os arquivos enviados.",
      code: code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "INVALID_FILE",
    });
  });
};

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

/** Erro do multer (arquivo acima do limite etc.) vira 400 em JSON, não o handler genérico do Express. */
const photoUploadSingle: RequestHandler = (req, res, next) => {
  photoUpload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    noStore(res);
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      error: tooLarge ? "A foto deve ter no máximo 5 MB." : "Não foi possível ler a foto enviada.",
      code: tooLarge ? "PHOTO_TOO_LARGE" : "INVALID_PHOTO",
    });
  });
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

  /** `:recordId` dos PATCH/DELETE. O vínculo com `:id` é conferido dentro da transação (IDOR → 404). */
  function recordParam(req: express.Request): string {
    const recordId = String(req.params.recordId ?? "");
    if (!isEmployeeUuid(recordId)) {
      throw new PeopleProfileAccessError("INVALID_ID", "Registro inválido.", 400);
    }
    return recordId;
  }

  function patchBody(req: express.Request): Record<string, unknown> {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new PeopleProfileAccessError("INVALID_BODY", "Dados inválidos.", 400);
    }
    return body as Record<string, unknown>;
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
      return res.json(
        await loadPeopleProfessional(prisma, id, {
          revealTerminationDetails: ctx.capabilities.canViewRestrictedNotes,
          revealLeaveRecord: ctx.capabilities.canViewAbsences,
        })
      );
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
      if (!ctx.capabilities.canViewDocuments && !ctx.capabilities.canViewEvaluationDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      if (!isEmployeeUuid(documentId)) {
        throw new PeopleProfileAccessError("INVALID_ID", "Documento inválido.", 400);
      }
      const { row, buffer } = await readEmployeeDocumentFile(prisma, {
        employeeId: id,
        documentId,
      });
      if (!ctx.capabilities.canViewDocuments && !row.evaluationId) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      logEmployeeHrAudit({
        event: "employee.document.download",
        actorUserId: ctx.user?.id,
        employeeId: id,
        details: { documentId },
      });
      noStore(res);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
      const inline = req.query.inline === "1" || req.query.disposition === "inline";
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(row.originalFileName)}"`
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
      const photo = await readEmployeePhotoFile(prisma, { employeeId: id });
      if (!photo) {
        noStore(res);
        return res.status(404).json({ error: "Foto não cadastrada." });
      }
      noStore(res);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Tipo real pelos magic bytes (JPEG/PNG/WebP) — nada de image/jpeg fixo.
      res.setHeader("Content-Type", photo.contentType);
      return res.send(photo.buffer);
    } catch (error) {
      return sendError(res, error, "Erro ao carregar foto.");
    }
  });

  app.post("/api/employees/:id/photo", ...viewGuard, photoUploadSingle, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageProfessional) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para alterar a foto.");
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Arquivo não enviado." });
      const result = await saveEmployeePhoto({
        prisma,
        employeeId: id,
        buffer: file.buffer,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao salvar foto.");
    }
  });

  app.delete("/api/employees/:id/photo", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageProfessional) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para alterar a foto.");
      }
      const result = await removeEmployeePhoto(prisma, {
        employeeId: id,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao remover foto.");
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
      // historicalOnly: reajuste retroativo — só o registro, sem comparar/alterar o salário vigente.
      // Nesse modo a vigência é obrigatória (não faz sentido assumir "hoje").
      const historicalOnly = body.historicalOnly === true;
      const effectiveDate = parseDate(body.effectiveDate, historicalOnly ? undefined : new Date());
      if (!effectiveDate) {
        return res.status(400).json({ error: "Data de vigência inválida." });
      }
      const result = await applyCompensationAdjustment(prisma, {
        employeeId: id,
        historicalOnly,
        expectedPreviousAmount: historicalOnly ? undefined : Number(body.expectedPreviousAmount),
        previousAmount:
          historicalOnly && body.previousAmount != null && body.previousAmount !== ""
            ? Number(body.previousAmount)
            : null,
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

  app.patch(
    "/api/employees/:id/compensation-adjustments/:recordId",
    ...viewGuard,
    async (req, res) => {
      try {
        const { id } = req.params;
        const ctx = await context(req, id);
        if (!ctx.capabilities.canManageCompensation) {
          throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para corrigir reajuste.");
        }
        const result = await updateCompensationAdjustment(prisma, {
          employeeId: id,
          recordId: recordParam(req),
          patch: patchBody(req),
          actorUserId: ctx.user?.id,
        });
        noStore(res);
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Erro ao corrigir reajuste.");
      }
    }
  );

  app.delete(
    "/api/employees/:id/compensation-adjustments/:recordId",
    ...viewGuard,
    async (req, res) => {
      try {
        const { id } = req.params;
        const ctx = await context(req, id);
        if (!ctx.capabilities.canManageCompensation) {
          throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para excluir reajuste.");
        }
        const result = await deleteCompensationAdjustment(prisma, {
          employeeId: id,
          recordId: recordParam(req),
          actorUserId: ctx.user?.id,
        });
        noStore(res);
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Erro ao excluir reajuste.");
      }
    }
  );

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
      // recordOnly: evento retroativo — só o histórico, sem alterar o cadastro do colaborador.
      const recordOnly = body.recordOnly === true;
      const effectiveDate = parseDate(body.effectiveDate, recordOnly ? undefined : new Date());
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
        recordOnly,
        ...(recordOnly
          ? {
              previousRoleId: optionalString(body.previousRoleId),
              previousDepartmentId: optionalString(body.previousDepartmentId),
              previousDepartment: optionalString(body.previousDepartment),
              previousManagerId: optionalString(body.previousManagerId),
              previousContractType: optionalString(body.previousContractType),
              previousCostCenterId: optionalString(body.previousCostCenterId),
              previousCostCenter: optionalString(body.previousCostCenter),
              previousWorkSchedule: optionalString(body.previousWorkSchedule),
            }
          : {}),
      });
      noStore(res);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao registrar movimentação.");
    }
  });

  app.patch("/api/employees/:id/career-events/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageCareer) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para corrigir movimentação.");
      }
      const result = await updateCareerEvent(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        patch: patchBody(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao corrigir movimentação.");
    }
  });

  app.delete("/api/employees/:id/career-events/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageCareer) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para excluir movimentação.");
      }
      const result = await deleteCareerEvent(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir movimentação.");
    }
  });

  // Só registros do modelo anterior (HrEmployeeBenefit). As verbas oficiais são marcadas /
  // desmarcadas no cadastro (PUT /api/employees/:id, componentIds).
  app.delete("/api/employees/:id/benefits/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para benefícios.");
      }
      const result = await deleteEmployeeBenefit(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir benefício.");
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
        status: typeof body.status === "string" && body.status ? body.status : undefined,
        reason: typeof body.reason === "string" ? body.reason : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        extendedLicense: body.extendedLicense === true || body.extendedLicense === "true",
        inssBenefitNumber: typeof body.inssBenefitNumber === "string" ? body.inssBenefitNumber : null,
        catNumber: typeof body.catNumber === "string" ? body.catNumber : null,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar afastamento.");
    }
  });

  app.patch("/api/employees/:id/absences/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageAbsences) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para afastamentos.");
      }
      const result = await updateEmployeeAbsence(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        patch: patchBody(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar afastamento.");
    }
  });

  app.delete("/api/employees/:id/absences/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageAbsences) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para afastamentos.");
      }
      const result = await deleteEmployeeAbsence(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir afastamento.");
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

  app.patch("/api/employees/:id/notes/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageNotes) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observações.");
      }
      // Linha RESTRITA sem permissão → 404; nova categoria RESTRITA sem permissão → 403 (na mutação).
      const result = await updateEmployeeNote(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        patch: patchBody(req),
        canViewRestrictedNotes: ctx.capabilities.canViewRestrictedNotes,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar observação.");
    }
  });

  app.delete("/api/employees/:id/notes/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageNotes) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observações.");
      }
      const result = await deleteEmployeeNote(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        canViewRestrictedNotes: ctx.capabilities.canViewRestrictedNotes,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir observação.");
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

  // `:recordId` vai cru para a mutação: "primary" → 400 PRIMARY_CONTACT antes da checagem de UUID.
  app.patch("/api/employees/:id/emergency-contacts/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id, recordId } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEmergency) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para emergência.");
      }
      const result = await updateEmergencyContact(prisma, {
        employeeId: id,
        recordId,
        patch: patchBody(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar contato.");
    }
  });

  app.delete("/api/employees/:id/emergency-contacts/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id, recordId } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEmergency) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para emergência.");
      }
      const result = await deleteEmergencyContact(prisma, {
        employeeId: id,
        recordId,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir contato.");
    }
  });

  app.post("/api/employees/:id/epi-deliveries", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      const row = await createEpiDelivery(prisma, {
        employeeId: id,
        body: patchBody(req),
        todayIso: businessTodayIso(new Date()),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json({ id: row.id, eventId: row.eventId });
    } catch (error) {
      return sendError(res, error, "Erro ao registrar entrega de EPI.");
    }
  });

  app.patch("/api/employees/:id/epi-deliveries/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      const result = await updateEpiDelivery(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        patch: patchBody(req),
        todayIso: businessTodayIso(new Date()),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar entrega de EPI.");
    }
  });

  // Cancelar (lançamento incorreto) / encerrar (ciclo finalizado): com motivo, sem excluir.
  for (const [path, action] of [
    ["cancel", "CANCEL"],
    ["close", "CLOSE"],
  ] as const) {
    app.post(`/api/employees/:id/epi-deliveries/:recordId/${path}`, ...viewGuard, async (req, res) => {
      try {
        const { id } = req.params;
        const ctx = await context(req, id);
        if (!ctx.capabilities.canManageEpi) {
          throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
        }
        const result = await setEpiDeliveryStatus(prisma, {
          employeeId: id,
          recordId: recordParam(req),
          action,
          reason: patchBody(req).reason,
          actorUserId: ctx.user?.id,
        });
        noStore(res);
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Erro ao atualizar a situação da entrega de EPI.");
      }
    });
  }

  // —— Entrega (evento com vários itens), ficha em PDF com identificador único e comprovante assinado ——
  async function epiActorName(userId: string | null | undefined): Promise<string | null> {
    if (!userId || !isEmployeeUuid(userId)) return null;
    const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? null;
  }

  async function epiManageContext(req: express.Request, employeeId: string) {
    const ctx = await context(req, employeeId);
    if (!ctx.capabilities.canManageEpi) {
      throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
    }
    return ctx;
  }

  app.post("/api/employees/:id/epi-events", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await epiManageContext(req, id);
      const result = await createEpiDeliveryEvent(prisma, {
        employeeId: id,
        body: patchBody(req),
        todayIso: businessTodayIso(new Date()),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao registrar a entrega de EPI.");
    }
  });

  app.patch("/api/employees/:id/epi-events/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await epiManageContext(req, id);
      const result = await updateEpiDeliveryEvent(prisma, {
        employeeId: id,
        eventId: recordParam(req),
        patch: patchBody(req),
        todayIso: businessTodayIso(new Date()),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao corrigir a entrega de EPI.");
    }
  });

  app.post("/api/employees/:id/epi-events/:recordId/form", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await epiManageContext(req, id);
      const result = await issueEpiDeliveryForm(prisma, {
        employeeId: id,
        eventId: recordParam(req),
        actor: { userId: ctx.user?.id ?? null, name: await epiActorName(ctx.user?.id) },
      });
      noStore(res);
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao emitir a ficha de entrega.");
    }
  });

  app.get("/api/employees/:id/epi-events/:recordId/forms/:formId/pdf", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      const pdf = await renderEpiDeliveryFormPdf(prisma, {
        employeeId: id,
        eventId: recordParam(req),
        formId: String(req.params.formId ?? ""),
      });
      logEmployeeHrAudit({
        event: "employee.epi.form.download",
        actorUserId: ctx.user?.id,
        employeeId: id,
        details: { documentNumber: pdf.documentNumber },
      });
      noStore(res);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("X-Document-Sha256", pdf.sha256);
      const inline = req.query.download !== "1";
      res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(pdf.filename)}"`);
      return res.send(pdf.buffer);
    } catch (error) {
      return sendError(res, error, "Erro ao gerar o PDF da ficha.");
    }
  });

  app.post("/api/employees/:id/epi-events/:recordId/receipt", ...viewGuard, epiReceiptUploadSingle, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await epiManageContext(req, id);
      const file = req.file;
      const result = await attachEpiReceipt(prisma, {
        employeeId: id,
        eventId: recordParam(req),
        reference: (req.body as Record<string, unknown> | undefined)?.reference,
        file: file
          ? { buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, size: file.size }
          : { buffer: Buffer.alloc(0), originalName: "", mimeType: null, size: 0 },
        actorUserId: ctx.user?.id ?? null,
      });
      noStore(res);
      return res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao anexar o comprovante.");
    }
  });

  app.post("/api/employees/:id/epi-events/:recordId/receipt/validate", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await epiManageContext(req, id);
      const body = patchBody(req);
      const result = await validateEpiReceipt(prisma, {
        employeeId: id,
        eventId: recordParam(req),
        result: body.result,
        note: body.note,
        actorUserId: ctx.user?.id ?? null,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao conferir o comprovante.");
    }
  });

  // Localiza a ficha pelo número impresso / QR. Só devolve o que o usuário pode ver do colaborador.
  app.get("/api/hr/epi-forms/lookup", ...viewGuard, async (req, res) => {
    try {
      const resolved = await resolveEpiFormReference(prisma, req.query.reference);
      let ctx;
      try {
        ctx = await context(req, resolved.employeeId);
      } catch {
        throw new PeopleProfileAccessError("FORM_NOT_FOUND", "Nenhuma ficha de EPI com este identificador.", 404);
      }
      if (!ctx.capabilities.canViewEpi) {
        throw new PeopleProfileAccessError("FORM_NOT_FOUND", "Nenhuma ficha de EPI com este identificador.", 404);
      }
      noStore(res);
      return res.json(resolved);
    } catch (error) {
      return sendError(res, error, "Erro ao localizar a ficha.");
    }
  });

  // —— Envio em lote de fichas assinadas: plano (sem gravar) e envio (um arquivo = um documento) ——
  async function epiBatchAccess(req: express.Request) {
    const check = await getPermissionCheck(req);
    if (!canManageEmployeeEpi(check)) {
      throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
    }
    const cache = new Map<string, boolean>();
    return async (employeeId: string) => {
      if (!cache.has(employeeId)) {
        try {
          const ctx = await context(req, employeeId);
          cache.set(employeeId, ctx.capabilities.canManageEpi);
        } catch {
          cache.set(employeeId, false);
        }
      }
      return cache.get(employeeId)!;
    };
  }

  function parseBatchManifest(raw: unknown): Array<{ index: number; reference: string | null }> {
    let list: unknown = raw;
    if (typeof raw === "string") {
      try {
        list = JSON.parse(raw);
      } catch {
        throw new PeopleProfileAccessError("INVALID_BODY", "Manifesto do lote inválido.", 400);
      }
    }
    if (!Array.isArray(list)) return [];
    return list.map((v, i) => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      return {
        index: typeof o.index === "number" ? o.index : i,
        reference: typeof o.reference === "string" && o.reference.trim() ? o.reference.trim().slice(0, 200) : null,
      };
    });
  }

  app.post("/api/hr/epi-receipts/batch/plan", ...viewGuard, async (req, res) => {
    try {
      const canAccess = await epiBatchAccess(req);
      const body = patchBody(req);
      const files = Array.isArray(body.files) ? (body.files as unknown[]) : [];
      if (files.length === 0 || files.length > EPI_BATCH_MAX_FILES) {
        throw new PeopleProfileAccessError("INVALID_BODY", `Envie de 1 a ${EPI_BATCH_MAX_FILES} arquivos por lote.`, 400);
      }
      const input = files.map((f, i) => {
        const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        return {
          index: i,
          name: String(o.name ?? "").slice(0, 255),
          sha256: String(o.sha256 ?? "").toLowerCase(),
          size: Number(o.size ?? 0),
          reference: typeof o.reference === "string" ? o.reference : null,
        };
      });
      const rows = await planEpiReceiptBatch(prisma, input, canAccess);
      noStore(res);
      return res.json({ rows });
    } catch (error) {
      return sendError(res, error, "Erro ao conferir o lote de fichas.");
    }
  });

  app.post("/api/hr/epi-receipts/batch", ...viewGuard, epiReceiptUploadBatch, async (req, res) => {
    try {
      const canAccess = await epiBatchAccess(req);
      const uploaded = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      if (uploaded.length === 0) throw new PeopleProfileAccessError("FILE_REQUIRED", "Selecione os arquivos digitalizados.", 400);
      const manifest = parseBatchManifest((req.body as Record<string, unknown> | undefined)?.manifest);
      // O servidor refaz o plano com os arquivos recebidos (SHA-256 calculado aqui, não o do navegador).
      const files = uploaded.map((f, i) => ({
        index: i,
        name: f.originalname,
        sha256: sha256Hex(f.buffer),
        size: f.size,
        reference: manifest.find((m) => m.index === i)?.reference ?? null,
      }));
      const rows = await planEpiReceiptBatch(prisma, files, canAccess);
      const batchId = randomUUID();
      const user = await getCurrentAppUser(req);
      const results = [];
      for (const row of rows) {
        const f = uploaded[row.index];
        if (row.status !== "READY" || !row.employeeId || !row.eventId) {
          results.push({ ...row, outcome: row.status === "ALREADY_ATTACHED" ? "SKIPPED" : "NOT_ATTACHED" });
          continue;
        }
        try {
          const attached = await attachEpiReceipt(prisma, {
            employeeId: row.employeeId,
            eventId: row.eventId,
            reference: row.documentNumber,
            file: { buffer: f.buffer, originalName: f.originalname, mimeType: f.mimetype, size: f.size },
            actorUserId: user?.id ?? null,
            batchId,
          });
          results.push({ ...row, outcome: attached.duplicate ? "SKIPPED" : "ATTACHED", message: attached.duplicate ? "Já estava anexado." : "Anexado." });
        } catch (error) {
          results.push({
            ...row,
            outcome: "FAILED",
            message: error instanceof PeopleProfileAccessError ? error.message : "Falha ao anexar este arquivo.",
          });
        }
      }
      logEmployeeHrAudit({
        event: "employee.epi.receipt.batch",
        actorUserId: user?.id ?? null,
        details: {
          batchId,
          files: results.length,
          attached: results.filter((r) => r.outcome === "ATTACHED").length,
          failed: results.filter((r) => r.outcome === "FAILED").length,
          notAttached: results.filter((r) => r.outcome === "NOT_ATTACHED").length,
        },
      });
      noStore(res);
      return res.json({ batchId, results });
    } catch (error) {
      return sendError(res, error, "Erro ao enviar o lote de fichas.");
    }
  });

  app.delete("/api/employees/:id/epi-deliveries/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageEpi) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para EPI.");
      }
      const result = await deleteEpiDelivery(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir entrega de EPI.");
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

  // Só metadados (JSON): o arquivo anexado não é substituído.
  app.patch("/api/employees/:id/documents/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const result = await updateEmployeeDocument(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        patch: patchBody(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar documento.");
    }
  });

  app.delete("/api/employees/:id/documents/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const result = await deleteEmployeeDocument(prisma, {
        employeeId: id,
        recordId: recordParam(req),
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir documento.");
    }
  });

  // —— Certificados (aba da ficha) ——
  // Externos: arquivo no dossiê + dados estruturados. Os emitidos pelo sistema vêm da API de Competências.
  app.get("/api/employees/:id/certificates", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canViewDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const items = await listExternalCertificates(prisma, id, businessTodayIso(new Date()), (ids) =>
        resolveActorNames(prisma, ids)
      );
      noStore(res);
      return res.json({ items, canManage: ctx.capabilities.canManageDocuments });
    } catch (error) {
      return sendError(res, error, "Erro ao carregar certificados.");
    }
  });

  app.post("/api/employees/:id/certificates", ...viewGuard, certificateUploadSingle, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const file = req.file;
      if (!file) throw new PeopleProfileAccessError("FILE_REQUIRED", "Anexe o arquivo do certificado.", 400);
      const parsed = parseExternalCertificateInput(req.body, businessTodayIso(new Date()));
      if (parsed.ok === false) throw new PeopleProfileAccessError(parsed.code, parsed.message, 400);
      const emp = await prisma.employee.findUnique({ where: { id }, select: { personId: true } });
      const created = await createExternalCertificate({
        prisma,
        files: { save: saveAppLocalFile, remove: deleteAppLocalFile },
        writeHistory: writeHistoryEvent,
        employeeId: id,
        personId: emp?.personId ?? null,
        data: parsed.value,
        file: { originalName: file.originalname, buffer: file.buffer },
        actorUserId: ctx.user?.id ?? null,
      });
      noStore(res);
      return res.status(201).json(created);
    } catch (error) {
      return sendError(res, error, "Erro ao anexar certificado.");
    }
  });

  app.patch("/api/employees/:id/certificates/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const parsed = parseExternalCertificateInput(patchBody(req), businessTodayIso(new Date()));
      if (parsed.ok === false) throw new PeopleProfileAccessError(parsed.code, parsed.message, 400);
      const result = await updateExternalCertificate({
        prisma,
        employeeId: id,
        certificateId: recordParam(req),
        data: parsed.value,
        actorUserId: ctx.user?.id ?? null,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar certificado.");
    }
  });

  // Exclui pelo fluxo oficial do dossiê (arquivo + histórico); o certificado sai junto (CASCADE).
  app.delete("/api/employees/:id/certificates/:recordId", ...viewGuard, async (req, res) => {
    try {
      const { id } = req.params;
      const ctx = await context(req, id);
      if (!ctx.capabilities.canManageDocuments) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para documentos.");
      }
      const documentId = await findExternalCertificateDocument(prisma, id, recordParam(req));
      const result = await deleteEmployeeDocument(prisma, {
        employeeId: id,
        recordId: documentId,
        actorUserId: ctx.user?.id,
      });
      noStore(res);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir certificado.");
    }
  });

  app.get("/api/hr/benefits", ...viewGuard, async (req, res) => {
    try {
      const check = await getPermissionCheck(req);
      const caps = buildPeopleProfileCapabilities(check);
      if (!caps.canViewBenefits) {
        throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para benefícios.");
      }
      // R$ das verbas fixas só com permissão de valores; percentuais sempre.
      const items = await listOfficialPayrollHrCatalogItems(prisma, {
        includeValues: caps.canViewCompensationValues,
      });
      noStore(res);
      return res.json({ items });
    } catch (error) {
      return sendError(res, error, "Erro ao listar benefícios.");
    }
  });
  registerHrEvaluationRoutes(app, guards);
}
