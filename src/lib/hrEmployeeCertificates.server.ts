/**
 * Ficha › Certificados — certificados externos (upload). O arquivo vai para o dossiê
 * (HrEmployeeDocument, tipo TRAINING_CERTIFICATE), com histórico e auditoria iguais aos documentos;
 * os dados estruturados ficam em HrEmployeeExternalCertificate (1:1 com o documento).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { logEmployeeHrAudit } from "./employeeHrAudit.js";
import { PeopleProfileAccessError } from "./peopleProfileErrors.js";
import {
  CERTIFICATE_FILE_MIME,
  EXTERNAL_CERTIFICATE_DOCUMENT_TYPE,
  certificateValidity,
  detectCertificateFileKind,
  type EmployeeCertificateItemDto,
  type ExternalCertificateInput,
} from "./hrEmployeeCertificates.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type CertificateFileStore = {
  save: (input: { namespace: string; entityId: string; originalFileName: string; buffer: Buffer }) => Promise<{
    storageKey: string;
    fileName: string;
    fileSize: number;
  }>;
  remove: (storageKey: string) => Promise<void>;
};

export type CertificateHistoryWriter = (
  db: Db,
  input: {
    employeeId: string;
    eventType: string;
    effectiveDate: Date;
    source?: string;
    notes?: string | null;
    createdByUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
) => Promise<unknown>;

const fromIso = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const toIso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function assertActiveCompetency(db: Db, competencyId: string | null) {
  if (!competencyId) return;
  const row = await db.hrCompetency.findUnique({ where: { id: competencyId }, select: { status: true } });
  if (!row || row.status !== "ACTIVE") {
    throw new PeopleProfileAccessError("INVALID_COMPETENCY", "Competência inexistente ou arquivada.", 400);
  }
}

export async function listExternalCertificates(
  db: Db,
  employeeId: string,
  todayIso: string,
  resolveNames: (ids: (string | null)[]) => Promise<Map<string, string>>,
): Promise<EmployeeCertificateItemDto[]> {
  const rows = await db.hrEmployeeExternalCertificate.findMany({
    where: { employeeId },
    orderBy: { completedAt: "desc" },
    take: 500,
    include: {
      document: { select: { id: true, originalFileName: true, mimeType: true } },
      competency: { select: { id: true, name: true } },
    },
  });
  const names = await resolveNames(rows.map((r) => r.createdByUserId));
  return rows.map((r) => {
    const expiresOn = toIso(r.expiresAt);
    return {
      key: `upload:${r.id}`,
      origin: "UPLOAD" as const,
      id: r.id,
      title: r.title,
      issuer: r.institution,
      number: null,
      competencyId: r.competency?.id ?? null,
      competencyName: r.competency?.name ?? null,
      workloadHours: r.workloadHours == null ? null : Number(r.workloadHours),
      completedOn: toIso(r.completedAt) ?? "",
      expiresOn,
      validity: certificateValidity(expiresOn, todayIso),
      trainingId: null,
      documentId: r.documentId,
      downloadUrl: `/api/employees/${employeeId}/documents/${r.documentId}/download`,
      fileName: r.document.originalFileName,
      mimeType: r.document.mimeType,
      notes: r.notes,
      createdByName: r.createdByUserId ? names.get(r.createdByUserId) ?? null : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Arquivo validado pelo conteúdo; documento + certificado + histórico na mesma transação. */
export async function createExternalCertificate(input: {
  prisma: PrismaClient;
  files: CertificateFileStore;
  writeHistory: CertificateHistoryWriter;
  employeeId: string;
  personId: string | null;
  data: ExternalCertificateInput;
  file: { originalName: string; buffer: Buffer };
  actorUserId: string | null;
}): Promise<{ id: string; documentId: string }> {
  const kind = detectCertificateFileKind(input.file.buffer);
  if (!kind) {
    throw new PeopleProfileAccessError("INVALID_FILE", "Envie o certificado em PDF, JPG ou PNG.", 400);
  }
  await assertActiveCompetency(input.prisma, input.data.competencyId);
  const saved = await input.files.save({
    namespace: "hremployeedocs",
    entityId: input.employeeId,
    originalFileName: input.file.originalName,
    buffer: input.file.buffer,
  });
  try {
    return await input.prisma.$transaction(async (tx) => {
      const doc = await tx.hrEmployeeDocument.create({
        data: {
          employeeId: input.employeeId,
          personId: input.personId,
          documentType: EXTERNAL_CERTIFICATE_DOCUMENT_TYPE,
          displayName: input.data.title,
          storageKey: saved.storageKey,
          originalFileName: saved.fileName,
          mimeType: CERTIFICATE_FILE_MIME[kind],
          fileSize: saved.fileSize,
          issuedAt: fromIso(input.data.completedOn),
          expiresAt: input.data.expiresOn ? fromIso(input.data.expiresOn) : null,
          notes: input.data.notes,
          uploadedByUserId: input.actorUserId,
        },
      });
      const cert = await tx.hrEmployeeExternalCertificate.create({
        data: {
          employeeId: input.employeeId,
          documentId: doc.id,
          title: input.data.title,
          institution: input.data.institution,
          workloadHours: input.data.workloadHours,
          completedAt: fromIso(input.data.completedOn),
          expiresAt: input.data.expiresOn ? fromIso(input.data.expiresOn) : null,
          competencyId: input.data.competencyId,
          notes: input.data.notes,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        },
      });
      await input.writeHistory(tx, {
        employeeId: input.employeeId,
        eventType: "DOCUMENT_ADDED",
        effectiveDate: new Date(),
        source: "USER",
        notes: `Certificado: ${input.data.title}`,
        createdByUserId: input.actorUserId,
        metadata: { recordType: "document", recordId: doc.id },
      });
      logEmployeeHrAudit({
        event: "employee.certificate.upload",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: { certificateId: cert.id, documentId: doc.id, fileSize: saved.fileSize, kind },
      });
      return { id: cert.id, documentId: doc.id };
    });
  } catch (error) {
    // Nada gravado no banco: o arquivo não pode ficar órfão no disco.
    await input.files.remove(saved.storageKey).catch(() => undefined);
    throw error;
  }
}

/** Correção dos dados (o arquivo não muda). Mantém o documento do dossiê coerente. */
export async function updateExternalCertificate(input: {
  prisma: PrismaClient;
  employeeId: string;
  certificateId: string;
  data: ExternalCertificateInput;
  actorUserId: string | null;
}) {
  await assertActiveCompetency(input.prisma, input.data.competencyId);
  return input.prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeExternalCertificate.findFirst({
      where: { id: input.certificateId, employeeId: input.employeeId },
      select: { id: true, documentId: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Certificado não encontrado.", 404);
    await tx.hrEmployeeExternalCertificate.update({
      where: { id: row.id },
      data: {
        title: input.data.title,
        institution: input.data.institution,
        workloadHours: input.data.workloadHours,
        completedAt: fromIso(input.data.completedOn),
        expiresAt: input.data.expiresOn ? fromIso(input.data.expiresOn) : null,
        competencyId: input.data.competencyId,
        notes: input.data.notes,
        updatedByUserId: input.actorUserId,
      },
    });
    await tx.hrEmployeeDocument.updateMany({
      where: { id: row.documentId, employeeId: input.employeeId },
      data: {
        displayName: input.data.title,
        issuedAt: fromIso(input.data.completedOn),
        expiresAt: input.data.expiresOn ? fromIso(input.data.expiresOn) : null,
        notes: input.data.notes,
      },
    });
    logEmployeeHrAudit({
      event: "employee.certificate.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { certificateId: row.id },
    });
    return { id: row.id, documentId: row.documentId };
  });
}

/** Documento do certificado (para excluir pelo fluxo oficial do dossiê, que apaga arquivo e histórico). */
export async function findExternalCertificateDocument(db: Db, employeeId: string, certificateId: string) {
  const row = await db.hrEmployeeExternalCertificate.findFirst({
    where: { id: certificateId, employeeId },
    select: { documentId: true },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Certificado não encontrado.", 404);
  return row.documentId;
}
