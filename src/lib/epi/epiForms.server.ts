/**
 * Ficha de entrega de EPI/uniforme por EVENTO: emissão (congelada, com revisões), PDF, resolução do
 * identificador, comprovantes assinados (histórico + conferência) e envio em lote.
 * Padrão dos documentos emitidos do IndusCost (Projetos): payload + SHA-256, número único, nova revisão
 * só quando o conteúdo muda.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { PeopleProfileAccessError } from "../peopleProfileErrors.js";
import { logEmployeeHrAudit } from "../employeeHrAudit.js";
import { isEmployeeUuid } from "../employeeRegistration.js";
import { sha256Hex, stableStringify } from "../commercialPolicy/commercialPolicyRules.js";
import { buildIssuerFromBranding } from "../projectsDocumentHeader.js";
import { businessTodayIso } from "../competencies/competencyDomain.js";
import { saveEmployeeDocument } from "../peopleProfileMutations.server.js";
import { toIsoDay } from "../employeeLifecycle.js";
import {
  EPI_FORM_DECLARATION,
  EPI_RECEIPT_DOCUMENT_TYPE,
  checkEpiReceiptFile,
  deriveEpiDocumentStatus,
  epiFormReferenceFromFileName,
  formatEpiFormCode,
  formatEpiFormDocumentNumber,
  parseEpiFormReference,
  type EpiDocumentState,
  type EpiFormBody,
  type EpiFormPayload,
} from "./epiForm.js";
import { buildEpiDeliveryFormPdf, epiDeliveryFormPdfFilename } from "./epiDeliveryFormPdf.js";

export { EPI_RECEIPT_MAX_BYTES } from "./epiForm.js";

type Actor = { userId: string | null; name: string | null };
type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

const FORM_SUMMARY_SELECT = {
  id: true,
  eventId: true,
  employeeId: true,
  formCode: true,
  revision: true,
  documentNumber: true,
  status: true,
  issuedAt: true,
  issuedByName: true,
  printCount: true,
  lastPrintedAt: true,
  supersededAt: true,
} as const;

export type EpiFormSummary = {
  id: string;
  documentNumber: string;
  formCode: string;
  revision: number;
  status: "ACTIVE" | "SUPERSEDED";
  issuedAt: string;
  issuedByName: string | null;
  printCount: number;
  lastPrintedAt: string;
};

export function summarizeEpiForm(row: {
  id: string;
  documentNumber: string;
  formCode: string;
  revision: number;
  status: string;
  issuedAt: Date;
  issuedByName: string | null;
  printCount: number;
  lastPrintedAt: Date;
}): EpiFormSummary {
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    formCode: row.formCode,
    revision: row.revision,
    status: row.status === "SUPERSEDED" ? "SUPERSEDED" : "ACTIVE",
    issuedAt: row.issuedAt.toISOString(),
    issuedByName: row.issuedByName,
    printCount: row.printCount,
    lastPrintedAt: row.lastPrintedAt.toISOString(),
  };
}

function assertIds(...ids: string[]) {
  if (!ids.every((id) => isEmployeeUuid(id))) throw new PeopleProfileAccessError("INVALID_ID", "Registro inválido.", 400);
}

/** Conteúdo da ficha: colaborador + data/responsável + itens não cancelados (retrato gravado em cada item). */
async function loadBody(tx: Db, employeeId: string, eventId: string): Promise<EpiFormBody> {
  const event = await tx.hrEpiDeliveryEvent.findFirst({
    where: { id: eventId, employeeId },
    select: {
      id: true,
      deliveredAt: true,
      responsibleName: true,
      notes: true,
      deliveries: {
        where: { status: { not: "CANCELLED" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          item: true,
          itemCode: true,
          itemType: true,
          itemCaNumber: true,
          itemUnit: true,
          quantity: true,
          size: true,
          replacementDays: true,
          replacementDueDate: true,
        },
      },
      employee: {
        select: {
          id: true,
          name: true,
          department: true,
          orgDepartment: { select: { name: true } },
          Role: { select: { name: true } },
        },
      },
    },
  });
  if (!event) throw new PeopleProfileAccessError("NOT_FOUND", "Entrega de EPI não encontrada.", 404);
  if (event.deliveries.length === 0) {
    throw new PeopleProfileAccessError("EPI_CANCELLED", "Todos os itens desta entrega foram cancelados: não há ficha a emitir.", 409);
  }
  const e = event.employee;
  return {
    employee: {
      id: e.id,
      // Nome civil completo na ficha (documento de recebimento).
      name: e.name,
      registration: e.id,
      department: e.orgDepartment?.name ?? (e.department?.trim() || null),
      role: e.Role?.name ?? null,
    },
    event: {
      id: event.id,
      deliveredOn: toIsoDay(event.deliveredAt)!,
      responsibleName: event.responsibleName,
      notes: event.notes,
    },
    items: event.deliveries.map((d) => ({
      deliveryId: d.id,
      itemCode: d.itemCode,
      item: d.item,
      itemType: d.itemType,
      caNumber: d.itemCaNumber,
      unit: d.itemUnit,
      quantity: d.quantity,
      size: d.size,
      replacementDays: d.replacementDays,
      replacementDueDate: toIsoDay(d.replacementDueDate),
    })),
    declaration: EPI_FORM_DECLARATION,
  };
}

/** Próximo código FE-{ano}-{seq}: maior sequência do ano + 1 (índice único na 1ª revisão garante unicidade). */
async function allocateFormCode(tx: Tx, year: number): Promise<string> {
  const prefix = `FE-${year}-`;
  const last = await tx.hrEpiDeliveryForm.findFirst({
    where: { revision: 1, formCode: { startsWith: prefix } },
    orderBy: { formCode: "desc" },
    select: { formCode: true },
  });
  const seq = last ? Number(last.formCode.slice(prefix.length)) + 1 : 1;
  return formatEpiFormCode(year, seq);
}

/**
 * Emitir / visualizar a ficha do evento. Conteúdo igual ao da revisão vigente → reaproveita (conta a
 * reimpressão); conteúdo diferente (entrega corrigida) → nova revisão com o mesmo código, anterior SUPERSEDED.
 */
export async function issueEpiDeliveryForm(
  prisma: PrismaClient,
  input: { employeeId: string; eventId: string; actor: Actor; now?: Date },
): Promise<{ form: EpiFormSummary; reused: boolean }> {
  assertIds(input.employeeId, input.eventId);
  const now = input.now ?? new Date();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const body = await loadBody(tx, input.employeeId, input.eventId);
        const contentSha256 = sha256Hex(stableStringify(body));
        const forms = await tx.hrEpiDeliveryForm.findMany({
          where: { eventId: input.eventId },
          orderBy: { revision: "desc" },
          select: { ...FORM_SUMMARY_SELECT, contentSha256: true },
        });
        const active = forms.find((f) => f.status === "ACTIVE") ?? null;
        if (active && active.contentSha256 === contentSha256) {
          const row = await tx.hrEpiDeliveryForm.update({
            where: { id: active.id },
            data: { printCount: { increment: 1 }, lastPrintedAt: now, lastPrintedByUserId: input.actor.userId },
            select: FORM_SUMMARY_SELECT,
          });
          return { form: summarizeEpiForm(row), reused: true, previous: null as string | null };
        }
        const formCode = forms.length ? forms[forms.length - 1].formCode : await allocateFormCode(tx, Number(businessTodayIso(now).slice(0, 4)));
        const revision = (forms[0]?.revision ?? 0) + 1;
        const documentNumber = formatEpiFormDocumentNumber(formCode, revision);
        if (active) {
          await tx.hrEpiDeliveryForm.update({ where: { id: active.id }, data: { status: "SUPERSEDED", supersededAt: now } });
        }
        const branding = await tx.brandingSettings.findFirst({ orderBy: { updatedAt: "desc" } });
        const id = (await tx.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`)[0].id;
        const payload: EpiFormPayload = {
          kind: "EPI_DELIVERY_FORM",
          version: 2,
          header: {
            formId: id,
            formCode,
            revision,
            documentNumber,
            previousDocumentNumber: active?.documentNumber ?? null,
            issuedAt: now.toISOString(),
            issuedByName: input.actor.name,
            issuer: buildIssuerFromBranding(branding),
          },
          body,
        };
        const row = await tx.hrEpiDeliveryForm.create({
          data: {
            id,
            eventId: input.eventId,
            employeeId: input.employeeId,
            formCode,
            revision,
            documentNumber,
            payload: payload as unknown as Prisma.InputJsonValue,
            payloadSha256: sha256Hex(stableStringify(payload)),
            contentSha256,
            issuedAt: now,
            issuedByUserId: input.actor.userId,
            issuedByName: input.actor.name,
            lastPrintedAt: now,
            lastPrintedByUserId: input.actor.userId,
          },
          select: FORM_SUMMARY_SELECT,
        });
        return { form: summarizeEpiForm(row), reused: false, previous: active?.documentNumber ?? null };
      });
      logEmployeeHrAudit({
        event: result.reused ? "employee.epi.form.reprint" : "employee.epi.form.issue",
        actorUserId: input.actor.userId,
        employeeId: input.employeeId,
        details: {
          eventId: input.eventId,
          formId: result.form.id,
          documentNumber: result.form.documentNumber,
          revision: result.form.revision,
          previousDocumentNumber: result.previous,
        },
      });
      return { form: result.form, reused: result.reused };
    } catch (error) {
      // Emissões simultâneas disputaram o mesmo código/revisão: tenta de novo (a vencedora já está gravada).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 3) continue;
      throw error;
    }
  }
  throw new PeopleProfileAccessError("FORM_CONFLICT", "Conflito ao emitir a ficha; tente novamente.", 409);
}

/** PDF regenerado do conteúdo congelado, com conferência do SHA-256. */
export async function renderEpiDeliveryFormPdf(
  prisma: PrismaClient,
  input: { employeeId: string; eventId: string; formId: string },
): Promise<{ buffer: Buffer; filename: string; sha256: string; documentNumber: string }> {
  assertIds(input.employeeId, input.eventId, input.formId);
  const form = await prisma.hrEpiDeliveryForm.findFirst({
    where: { id: input.formId, eventId: input.eventId, employeeId: input.employeeId },
    select: { payload: true, payloadSha256: true, status: true, documentNumber: true, eventId: true },
  });
  if (!form) throw new PeopleProfileAccessError("NOT_FOUND", "Ficha não encontrada.", 404);
  const sha = sha256Hex(stableStringify(form.payload));
  if (sha !== form.payloadSha256) {
    throw new PeopleProfileAccessError("FORM_INTEGRITY", "O conteúdo emitido da ficha não confere com o registro (SHA-256).", 409);
  }
  const active =
    form.status === "SUPERSEDED"
      ? await prisma.hrEpiDeliveryForm.findFirst({ where: { eventId: form.eventId, status: "ACTIVE" }, select: { documentNumber: true } })
      : null;
  const payload = form.payload as unknown as EpiFormPayload;
  return {
    buffer: buildEpiDeliveryFormPdf(payload, {
      sha256: sha,
      superseded: form.status === "SUPERSEDED",
      activeDocumentNumber: active?.documentNumber ?? null,
    }),
    filename: epiDeliveryFormPdfFilename(form.documentNumber, payload.body.employee.name),
    sha256: sha,
    documentNumber: form.documentNumber,
  };
}

export type ResolvedEpiForm = {
  formId: string;
  documentNumber: string;
  revision: number;
  status: "ACTIVE" | "SUPERSEDED";
  eventId: string;
  employeeId: string;
  employeeName: string;
  deliveredOn: string;
  itemCount: number;
  items: string[];
  activeDocumentNumber: string | null;
};

/**
 * Número impresso / código / texto do QR → ficha → evento → itens → colaborador. Sem correspondência exata
 * e única, recusa: inválido 400, inexistente 404, QR com id que não bate com o número 409.
 */
export async function resolveEpiFormReference(prisma: Db, raw: unknown): Promise<ResolvedEpiForm> {
  const ref = parseEpiFormReference(raw);
  if (!ref) {
    throw new PeopleProfileAccessError(
      "INVALID_FORM_CODE",
      "Identificador inválido. Informe o número impresso na ficha (ex.: FE-2026-00001-R01) ou leia o QR Code.",
      400,
    );
  }
  const rows = await prisma.hrEpiDeliveryForm.findMany({
    where: ref.revision ? { formCode: ref.formCode, revision: ref.revision } : { formCode: ref.formCode, status: "ACTIVE" },
    select: { id: true, documentNumber: true, revision: true, status: true, eventId: true, employeeId: true, payload: true },
  });
  if (rows.length !== 1) throw new PeopleProfileAccessError("FORM_NOT_FOUND", "Nenhuma ficha de EPI com este identificador.", 404);
  const row = rows[0];
  if (ref.formId && ref.formId !== row.id) {
    throw new PeopleProfileAccessError("FORM_ID_MISMATCH", "O QR Code não corresponde ao número da ficha. Confira o documento.", 409);
  }
  const active =
    row.status === "SUPERSEDED"
      ? await prisma.hrEpiDeliveryForm.findFirst({ where: { eventId: row.eventId, status: "ACTIVE" }, select: { documentNumber: true } })
      : null;
  const body = (row.payload as unknown as EpiFormPayload).body;
  return {
    formId: row.id,
    documentNumber: row.documentNumber,
    revision: row.revision,
    status: row.status === "SUPERSEDED" ? "SUPERSEDED" : "ACTIVE",
    eventId: row.eventId,
    employeeId: row.employeeId,
    employeeName: body.employee.name,
    deliveredOn: body.event.deliveredOn,
    itemCount: body.items.length,
    items: body.items.map((i) => (i.itemCode ? `${i.itemCode} · ${i.item}` : i.item)),
    activeDocumentNumber: active?.documentNumber ?? (row.status === "ACTIVE" ? row.documentNumber : null),
  };
}

export type EpiReceiptFile = { buffer: Buffer; originalName: string; mimeType: string | null; size: number };

/**
 * Anexa a ficha assinada ao evento. Com ficha emitida, o identificador é obrigatório e precisa ser a
 * revisão vigente deste evento deste colaborador. O arquivo vai para Documentos (armazenamento oficial,
 * privado, download autenticado); o comprovante anterior continua no histórico (SUPERSEDED).
 * Reenvio do mesmo arquivo (SHA-256) é idempotente; o mesmo arquivo em outro evento é recusado.
 */
export async function attachEpiReceipt(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    eventId: string;
    reference: unknown;
    file: EpiReceiptFile;
    actorUserId: string | null;
    batchId?: string | null;
  },
): Promise<{ receiptId: string; documentId: string; formId: string | null; documentNumber: string | null; duplicate: boolean }> {
  assertIds(input.employeeId, input.eventId);
  const check = checkEpiReceiptFile({ buffer: input.file?.buffer ?? new Uint8Array(), originalName: input.file?.originalName ?? "", mimeType: input.file?.mimeType ?? null });
  if (check.ok === false) throw new PeopleProfileAccessError((check as { code: string }).code, (check as { message: string }).message, 400);
  const event = await prisma.hrEpiDeliveryEvent.findFirst({
    where: { id: input.eventId, employeeId: input.employeeId },
    select: { id: true, deliveredAt: true, deliveries: { where: { status: { not: "CANCELLED" } }, select: { id: true } } },
  });
  if (!event) throw new PeopleProfileAccessError("NOT_FOUND", "Entrega de EPI não encontrada.", 404);
  if (event.deliveries.length === 0) {
    throw new PeopleProfileAccessError("EPI_CANCELLED", "Entrega com todos os itens cancelados não recebe comprovante.", 409);
  }
  const active = await prisma.hrEpiDeliveryForm.findFirst({
    where: { eventId: event.id, status: "ACTIVE" },
    select: { id: true, documentNumber: true },
  });
  const hasReference = typeof input.reference === "string" && input.reference.trim() !== "";
  let form: { id: string; documentNumber: string } | null = null;
  if (active || hasReference) {
    if (!hasReference) {
      throw new PeopleProfileAccessError(
        "FORM_REFERENCE_REQUIRED",
        `Informe o número impresso na ficha (${active!.documentNumber}) para confirmar que o arquivo é desta entrega.`,
        400,
      );
    }
    const resolved = await resolveEpiFormReference(prisma, input.reference);
    if (resolved.employeeId !== input.employeeId) {
      throw new PeopleProfileAccessError("FORM_OTHER_EMPLOYEE", `A ficha ${resolved.documentNumber} é de outro colaborador. Nada foi anexado.`, 409);
    }
    if (resolved.eventId !== event.id) {
      throw new PeopleProfileAccessError("FORM_OTHER_DELIVERY", `A ficha ${resolved.documentNumber} é de outra entrega. Nada foi anexado.`, 409);
    }
    if (resolved.status !== "ACTIVE") {
      throw new PeopleProfileAccessError(
        "FORM_SUPERSEDED",
        `A ficha ${resolved.documentNumber} foi substituída por ${resolved.activeDocumentNumber ?? "outra revisão"}: colha a assinatura na revisão vigente.`,
        409,
      );
    }
    form = { id: resolved.formId, documentNumber: resolved.documentNumber };
  }

  const fileSha256 = sha256Hex(input.file.buffer);
  const sameFile = await prisma.hrEpiDeliveryReceipt.findFirst({
    where: { fileSha256, status: "CURRENT" },
    select: { id: true, eventId: true, documentId: true, formId: true, form: { select: { documentNumber: true } } },
  });
  if (sameFile && sameFile.eventId === event.id && (sameFile.formId ?? null) === (form?.id ?? null)) {
    return { receiptId: sameFile.id, documentId: sameFile.documentId, formId: sameFile.formId, documentNumber: form?.documentNumber ?? null, duplicate: true };
  }
  if (sameFile && sameFile.eventId !== event.id) {
    throw new PeopleProfileAccessError(
      "DUPLICATE_FILE",
      `Este arquivo já é o comprovante de outra entrega${sameFile.form ? ` (${sameFile.form.documentNumber})` : ""}. Confira a digitalização.`,
      409,
    );
  }

  const deliveredOn = toIsoDay(event.deliveredAt)!.split("-").reverse().join("/");
  const doc = await saveEmployeeDocument({
    prisma,
    employeeId: input.employeeId,
    documentType: EPI_RECEIPT_DOCUMENT_TYPE,
    displayName: form ? `Ficha de entrega de EPI ${form.documentNumber} (assinada)` : `Comprovante de entrega de EPI (${deliveredOn})`,
    originalFileName: input.file.originalName,
    mimeType: input.file.mimeType,
    buffer: input.file.buffer,
    issuedAt: event.deliveredAt,
    notes: form ? `Comprovante digitalizado da ficha ${form.documentNumber}.` : "Comprovante digitalizado anexado à entrega de EPI.",
    actorUserId: input.actorUserId,
  });
  let receiptId: string;
  let previousReceiptId: string | null = null;
  try {
    receiptId = await prisma.$transaction(async (tx) => {
      const current = await tx.hrEpiDeliveryReceipt.findFirst({ where: { eventId: event.id, status: "CURRENT" }, select: { id: true } });
      if (current) {
        previousReceiptId = current.id;
        await tx.hrEpiDeliveryReceipt.update({ where: { id: current.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
      }
      const row = await tx.hrEpiDeliveryReceipt.create({
        data: {
          eventId: event.id,
          employeeId: input.employeeId,
          formId: form?.id ?? null,
          documentId: doc.id,
          fileSha256,
          originalFileName: input.file.originalName,
          mimeType: input.file.mimeType,
          fileSize: input.file.buffer.length,
          uploadedByUserId: input.actorUserId,
          batchId: input.batchId ?? null,
        },
        select: { id: true },
      });
      return row.id;
    });
  } catch (error) {
    // Outro envio simultâneo para a mesma entrega: o arquivo fica em Documentos, sem vínculo.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PeopleProfileAccessError("RECEIPT_CONFLICT", "Outro comprovante foi anexado a esta entrega ao mesmo tempo. Atualize e confira.", 409);
    }
    throw error;
  }
  logEmployeeHrAudit({
    event: "employee.epi.receipt.attach",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: {
      eventId: event.id,
      receiptId,
      documentId: doc.id,
      formId: form?.id ?? null,
      documentNumber: form?.documentNumber ?? null,
      fileSha256,
      previousReceiptId,
      batchId: input.batchId ?? null,
    },
  });
  return { receiptId, documentId: doc.id, formId: form?.id ?? null, documentNumber: form?.documentNumber ?? null, duplicate: false };
}

/**
 * Conferência do comprovante vigente por usuário autorizado: APROVADO ou REJEITADO (com observação).
 * Comprovante de revisão anterior não é conferido; conferência registrada não é refeita (anexe outro).
 */
export async function validateEpiReceipt(
  prisma: PrismaClient,
  input: { employeeId: string; eventId: string; result: unknown; note: unknown; actorUserId: string | null },
): Promise<{ validatedAt: string; result: "APPROVED" | "REJECTED" }> {
  assertIds(input.employeeId, input.eventId);
  const result = input.result === "REJECTED" ? "REJECTED" : input.result === "APPROVED" ? "APPROVED" : null;
  if (!result) throw new PeopleProfileAccessError("INVALID_RESULT", "Informe o resultado da conferência (aprovado ou rejeitado).", 400);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  if (result === "REJECTED" && (!note || note.length < 5)) {
    throw new PeopleProfileAccessError("INVALID_RESULT", "Ao rejeitar, informe o motivo (ex.: falta a assinatura do colaborador).", 400);
  }
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.hrEpiDeliveryReceipt.findFirst({
      where: { eventId: input.eventId, employeeId: input.employeeId, status: "CURRENT" },
      select: { id: true, formId: true, validationResult: true, documentId: true },
    });
    if (!receipt) throw new PeopleProfileAccessError("RECEIPT_REQUIRED", "Anexe a ficha assinada antes de conferir.", 409);
    if (receipt.validationResult) {
      throw new PeopleProfileAccessError("RECEIPT_ALREADY_VALIDATED", "Este comprovante já foi conferido. Para mudar, anexe um novo arquivo.", 409);
    }
    const active = await tx.hrEpiDeliveryForm.findFirst({ where: { eventId: input.eventId, status: "ACTIVE" }, select: { id: true } });
    if (active && receipt.formId && receipt.formId !== active.id) {
      throw new PeopleProfileAccessError("RECEIPT_OUTDATED", "O comprovante é de uma revisão anterior da ficha. Anexe a revisão vigente assinada.", 409);
    }
    const now = new Date();
    await tx.hrEpiDeliveryReceipt.update({
      where: { id: receipt.id },
      data: { validationResult: result, validatedAt: now, validatedByUserId: input.actorUserId, validationNote: note },
    });
    logEmployeeHrAudit({
      event: "employee.epi.receipt.validate",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { eventId: input.eventId, receiptId: receipt.id, documentId: receipt.documentId, result },
    });
    return { validatedAt: now.toISOString(), result };
  });
}

/** Situação documental do evento a partir das fichas e do comprovante vigente. */
export function epiEventDocumentState(
  forms: Array<{ id: string; status: string }>,
  receipts: Array<{ formId: string | null; status: string; validationResult: string | null }>,
): EpiDocumentState {
  const current = receipts.find((r) => r.status === "CURRENT") ?? null;
  return deriveEpiDocumentStatus({
    activeFormId: forms.find((f) => f.status === "ACTIVE")?.id ?? null,
    currentReceipt: current ? { formId: current.formId, validationResult: current.validationResult } : null,
  });
}

// ───────────────────────────── Envio em lote ─────────────────────────────

export type EpiBatchFileInput = { index: number; name: string; sha256: string; size: number; reference?: string | null };

export type EpiBatchRowStatus =
  | "READY"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "DUPLICATE_IN_BATCH"
  | "ALREADY_ATTACHED"
  | "CONFLICT";

export type EpiBatchRow = {
  index: number;
  name: string;
  reference: string | null;
  /** De onde veio o identificador: informado (digitado/QR) ou nome do arquivo. */
  referenceSource: "INFORMED" | "FILE_NAME" | null;
  status: EpiBatchRowStatus;
  message: string;
  documentNumber: string | null;
  employeeId: string | null;
  employeeName: string | null;
  eventId: string | null;
  deliveredOn: string | null;
  itemCount: number | null;
  /** O evento já tem comprovante vigente: o novo o substitui (o anterior fica no histórico). */
  replacesExisting: boolean;
};

/**
 * Plano do lote (sem gravar nada): identificador de cada arquivo (informado ou pelo nome), ficha vigente,
 * colaborador (respeitando o escopo de quem envia), duplicidades no lote e arquivos já anexados.
 * Só linhas READY são anexadas. Um arquivo = um documento: o sistema não separa páginas.
 */
export async function planEpiReceiptBatch(
  prisma: PrismaClient,
  files: EpiBatchFileInput[],
  canAccessEmployee: (employeeId: string) => Promise<boolean>,
): Promise<EpiBatchRow[]> {
  const rows: EpiBatchRow[] = [];
  for (const f of files) {
    const informed = typeof f.reference === "string" && f.reference.trim() ? f.reference.trim() : null;
    const fromName = informed ? null : epiFormReferenceFromFileName(f.name);
    const reference = informed ?? fromName;
    const base: EpiBatchRow = {
      index: f.index,
      name: f.name,
      reference,
      referenceSource: informed ? "INFORMED" : fromName ? "FILE_NAME" : null,
      status: "READY",
      message: "Pronto para anexar.",
      documentNumber: null,
      employeeId: null,
      employeeName: null,
      eventId: null,
      deliveredOn: null,
      itemCount: null,
      replacesExisting: false,
    };
    if (!reference) {
      rows.push({ ...base, status: "NEEDS_REVIEW", message: "Identificador não encontrado: informe o número impresso na ficha." });
      continue;
    }
    try {
      const r = await resolveEpiFormReference(prisma, reference);
      if (!(await canAccessEmployee(r.employeeId))) {
        rows.push({ ...base, status: "INVALID", message: "Nenhuma ficha de EPI com este identificador." });
        continue;
      }
      const row: EpiBatchRow = {
        ...base,
        documentNumber: r.documentNumber,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        eventId: r.eventId,
        deliveredOn: r.deliveredOn,
        itemCount: r.itemCount,
      };
      if (r.status !== "ACTIVE") {
        rows.push({ ...row, status: "INVALID", message: `Ficha substituída por ${r.activeDocumentNumber ?? "outra revisão"}: colha a assinatura na vigente.` });
        continue;
      }
      rows.push(row);
    } catch (error) {
      rows.push({
        ...base,
        status: "INVALID",
        message: error instanceof PeopleProfileAccessError ? error.message : "Não foi possível conferir o identificador.",
      });
    }
  }
  // Duplicidades dentro do lote: mesma ficha ou mesmo arquivo em mais de uma linha → nenhuma é anexada.
  const byForm = new Map<string, number[]>();
  const bySha = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.documentNumber) byForm.set(r.documentNumber, [...(byForm.get(r.documentNumber) ?? []), i]);
    const sha = files[i].sha256;
    bySha.set(sha, [...(bySha.get(sha) ?? []), i]);
  });
  for (const [num, idx] of byForm) {
    if (idx.length > 1) idx.forEach((i) => Object.assign(rows[i], { status: "DUPLICATE_IN_BATCH", message: `A ficha ${num} aparece em ${idx.length} arquivos deste envio. Mantenha só um.` }));
  }
  for (const idx of bySha.values()) {
    if (idx.length > 1) idx.forEach((i) => Object.assign(rows[i], { status: "DUPLICATE_IN_BATCH", message: `Arquivo repetido neste envio (${idx.length} cópias idênticas).` }));
  }
  // Arquivo já anexado (mesmo SHA-256 como comprovante vigente).
  const shas = [...new Set(files.map((f) => f.sha256).filter((s) => /^[0-9a-f]{64}$/.test(s)))];
  const existing = shas.length
    ? await prisma.hrEpiDeliveryReceipt.findMany({ where: { fileSha256: { in: shas }, status: "CURRENT" }, select: { fileSha256: true, eventId: true } })
    : [];
  const currentEvents = new Set(
    (
      await prisma.hrEpiDeliveryReceipt.findMany({
        where: { eventId: { in: rows.map((r) => r.eventId).filter((v): v is string => Boolean(v)) }, status: "CURRENT" },
        select: { eventId: true },
      })
    ).map((r) => r.eventId),
  );
  rows.forEach((r, i) => {
    if (r.status !== "READY") return;
    const hit = existing.find((e) => e.fileSha256 === files[i].sha256);
    if (hit && hit.eventId === r.eventId) Object.assign(r, { status: "ALREADY_ATTACHED", message: "Este arquivo já está anexado a esta entrega." });
    else if (hit) Object.assign(r, { status: "CONFLICT", message: "Este arquivo já é o comprovante de outra entrega." });
    else if (r.eventId && currentEvents.has(r.eventId)) r.replacesExisting = true;
  });
  return rows;
}
