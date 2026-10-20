/**
 * Registro de ocorrências de crédito.
 * Grava somente a ocorrência e a evidência. Não altera Contas a Receber.
 * A baixa do título não encerra protesto confirmado.
 */

import { randomUUID } from "node:crypto";
import { fingerprintAppLocalFile, saveAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import { resolveCommercialCreditExceptionPermission } from "./commercialCreditDecision.js";
import {
  activeOccurrenceDedupeKey,
  initialOccurrenceStatus,
  nomusProtestDedupeKey,
  presentCommercialCreditOccurrence,
  validateOccurrenceDraft,
  type CommercialCreditOccurrenceOrigin,
  type CommercialCreditOccurrenceView,
} from "./commercialCreditOccurrence.js";

const EVIDENCE_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;
const EVIDENCE_MAX_FILES = 3;

export class CommercialCreditOccurrenceError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "CommercialCreditOccurrenceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type OccurrenceEvidenceInput = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

type OccurrenceRow = {
  id: string;
  customerId: string;
  titleExternalId: number | null;
  kind: string;
  status: string;
  origin: string;
  occurredAt: Date;
  responsibleUserId: string;
  justification: string;
  dedupeKey: string;
  closesOccurrenceId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EvidenceRow = {
  id: string;
  occurrenceId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  contentHash: string;
  uploadedByUserId: string;
  createdAt: Date;
};

type OccurrenceDelegate = {
  findMany(args: {
    where: { customerId: string };
    orderBy?: { occurredAt: "asc" | "desc" };
  }): Promise<OccurrenceRow[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<OccurrenceRow | null>;
  findUnique?(args: { where: { id: string } }): Promise<OccurrenceRow | null>;
  create(args: { data: Omit<OccurrenceRow, "createdAt" | "updatedAt"> & { createdAt?: Date; updatedAt?: Date } }): Promise<OccurrenceRow>;
  update(args: { where: { id: string }; data: Partial<OccurrenceRow> }): Promise<OccurrenceRow>;
};

type EvidenceDelegate = {
  findMany(args: { where: { occurrenceId?: string; id?: string } }): Promise<EvidenceRow[]>;
  findFirst?(args: { where: { id: string; occurrenceId: string } }): Promise<EvidenceRow | null>;
  create(args: { data: Omit<EvidenceRow, "createdAt"> & { createdAt?: Date } }): Promise<EvidenceRow>;
};

export type CommercialCreditOccurrenceStore = {
  customer: {
    findUnique(args: {
      where: { id: string };
      select?: { id?: true; nomusExternalPersonId?: true };
    }): Promise<{ id: string; nomusExternalPersonId: number | null } | null>;
  };
  nomusAccountsReceivable: {
    findFirst(args: {
      where: { externalId: number; personId: number };
      select?: { externalId?: true };
    }): Promise<{ externalId: number } | null>;
  };
  commercialCreditOccurrence: OccurrenceDelegate;
  commercialCreditOccurrenceEvidence: EvidenceDelegate;
  $transaction<T>(fn: (tx: CommercialCreditOccurrenceStore) => Promise<T>): Promise<T>;
};

type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  performedBy?: string | null;
};

type Actor = { id: string; role: string; assignedPermissions: readonly string[] };

type FileStore = (input: {
  occurrenceId: string;
  fileName: string;
  buffer: Buffer;
}) => Promise<{ storageKey: string; fileName: string; fileSize: number }>;

async function writeAudit(writer: ((entry: AuditEntry) => Promise<void>) | undefined, entry: AuditEntry) {
  if (writer) {
    await writer(entry);
    return;
  }
  const { writeCommercialAuditLog } = await import("@/src/lib/commercialAuditLog.js");
  await writeCommercialAuditLog(entry);
}

function permissionOrThrow(actor: Actor): string {
  const permission = resolveCommercialCreditExceptionPermission(actor);
  if (permission.ok === false) {
    if (permission.code === "EXCEPTION_IMPLICIT_SUPER_ADMIN") {
      throw new CommercialCreditOccurrenceError(
        "OCCURRENCE_IMPLICIT_SUPER_ADMIN",
        "SUPER_ADMIN não registra ocorrência de crédito. É necessária a permissão explícita de Financeiro ou Diretoria.",
        403
      );
    }
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_FORBIDDEN",
      "Ocorrência de crédito restrita a Financeiro ou Diretoria.",
      403
    );
  }
  return permission.permission;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export function parseOccurrenceEvidences(value: unknown): OccurrenceEvidenceInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_EVIDENCE", "Evidências em formato inválido.");
  }
  if (value.length > EVIDENCE_MAX_FILES) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_EVIDENCE", "Limite de comprovantes excedido.");
  }
  return value.map((item) => {
    const row = item as { fileName?: unknown; mimeType?: unknown; contentBase64?: unknown };
    const mimeType = typeof row.mimeType === "string" ? row.mimeType : "";
    const buffer = Buffer.from(typeof row.contentBase64 === "string" ? row.contentBase64 : "", "base64");
    return {
      fileName: typeof row.fileName === "string" && row.fileName.trim() ? row.fileName.trim() : "comprovante",
      mimeType,
      buffer,
    };
  });
}

function assertEvidenceFiles(files: readonly OccurrenceEvidenceInput[]) {
  for (const file of files) {
    if (!EVIDENCE_MIME.has(file.mimeType)) {
      throw new CommercialCreditOccurrenceError(
        "OCCURRENCE_EVIDENCE",
        "Comprovante deve ser PDF, JPG ou PNG."
      );
    }
    if (file.buffer.byteLength <= 0 || file.buffer.byteLength > EVIDENCE_MAX_BYTES) {
      throw new CommercialCreditOccurrenceError("OCCURRENCE_EVIDENCE", "Comprovante vazio ou acima do limite.");
    }
  }
}

async function defaultFileStore(input: {
  occurrenceId: string;
  fileName: string;
  buffer: Buffer;
}) {
  return saveAppLocalFile({
    namespace: "commercial-credit",
    entityId: input.occurrenceId,
    originalFileName: input.fileName,
    buffer: input.buffer,
  });
}

async function assertOfficialTitle(
  db: CommercialCreditOccurrenceStore,
  customerId: string,
  titleExternalId: number | null
) {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, nomusExternalPersonId: true },
  });
  if (!customer) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_CUSTOMER", "Cliente não encontrado.", 404);
  }
  if (titleExternalId == null) return customer;
  if (customer.nomusExternalPersonId == null || customer.nomusExternalPersonId <= 0) {
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_TITLE",
      "O cliente não tem vínculo oficial com o título informado."
    );
  }
  const title = await db.nomusAccountsReceivable.findFirst({
    where: { externalId: titleExternalId, personId: customer.nomusExternalPersonId },
    select: { externalId: true },
  });
  if (!title) {
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_TITLE",
      "Título oficial não encontrado para este cliente."
    );
  }
  return customer;
}

function auditValue(row: {
  kind: string;
  status: string;
  origin: string;
  titleExternalId: number | null;
  permission?: string;
}): string {
  return JSON.stringify({
    kind: row.kind,
    status: row.status,
    origin: row.origin,
    titleExternalId: row.titleExternalId,
    permission: row.permission ?? null,
  });
}

async function stageEvidence(
  occurrenceId: string,
  files: readonly OccurrenceEvidenceInput[],
  fileStore: FileStore
) {
  const staged: Array<OccurrenceEvidenceInput & { storageKey: string; fileSize: number; contentHash: string }> = [];
  for (const file of files) {
    const stored = await fileStore({
      occurrenceId,
      fileName: file.fileName,
      buffer: file.buffer,
    });
    staged.push({
      ...file,
      storageKey: stored.storageKey,
      fileSize: stored.fileSize,
      contentHash: fingerprintAppLocalFile(file.buffer),
    });
  }
  return staged;
}

async function insertEvidence(
  db: CommercialCreditOccurrenceStore,
  occurrenceId: string,
  actorId: string,
  files: Awaited<ReturnType<typeof stageEvidence>>,
  now: Date
) {
  for (const file of files) {
    await db.commercialCreditOccurrenceEvidence.create({
      data: {
        id: randomUUID(),
        occurrenceId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        storageKey: file.storageKey,
        contentHash: file.contentHash,
        uploadedByUserId: actorId,
        createdAt: now,
      },
    });
  }
}

async function auditOrCompensate(
  db: CommercialCreditOccurrenceStore,
  writer: ((entry: AuditEntry) => Promise<void>) | undefined,
  entries: AuditEntry[],
  compensate: () => Promise<void>
) {
  try {
    for (const entry of entries) await writeAudit(writer, entry);
  } catch {
    await compensate();
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_AUDIT",
      "A ocorrência não foi mantida porque a auditoria falhou.",
      500
    );
  }
}

export async function listCommercialCreditOccurrences(
  db: CommercialCreditOccurrenceStore,
  customerId: string
): Promise<CommercialCreditOccurrenceView[]> {
  const rows = await db.commercialCreditOccurrence.findMany({
    where: { customerId },
    orderBy: { occurredAt: "desc" },
  });
  const views: CommercialCreditOccurrenceView[] = [];
  for (const row of rows) {
    const evidences = await db.commercialCreditOccurrenceEvidence.findMany({
      where: { occurrenceId: row.id },
    });
    views.push(
      presentCommercialCreditOccurrence({
        ...row,
        evidenceFileNames: evidences.map((file) => file.fileName),
      })
    );
  }
  return views;
}

export async function createCommercialCreditOccurrence(
  db: CommercialCreditOccurrenceStore,
  input: {
    customerId: string;
    kind: string;
    titleExternalId?: number | null;
    occurredAt: Date;
    justification: string;
    closesOccurrenceId?: string | null;
    evidences?: readonly OccurrenceEvidenceInput[];
    actor: Actor;
    now?: Date;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
    fileStore?: FileStore;
  }
): Promise<CommercialCreditOccurrenceView> {
  const now = input.now ?? new Date();
  const permission = permissionOrThrow(input.actor);
  const files = [...(input.evidences ?? [])];
  assertEvidenceFiles(files);
  let titleExternalId = input.titleExternalId ?? null;
  if (
    (input.kind === "REGULARIZATION" || input.kind === "PROTEST_WITHDRAWN") &&
    titleExternalId == null &&
    input.closesOccurrenceId
  ) {
    const linked = await db.commercialCreditOccurrence.findFirst({ where: { id: input.closesOccurrenceId } });
    titleExternalId = linked?.titleExternalId ?? null;
  }
  const draft = validateOccurrenceDraft({
    kind: input.kind,
    justification: input.justification,
    titleExternalId,
    evidenceCount: files.length,
    occurredAt: input.occurredAt,
    now,
  });
  if (draft.ok === false) throw new CommercialCreditOccurrenceError(draft.code, draft.message);
  await assertOfficialTitle(db, input.customerId, draft.titleExternalId);

  if (draft.kind === "PROTEST_WITHDRAWN" || draft.kind === "REGULARIZATION") {
    return closeConfirmedProtest(db, {
      ...input,
      kind: draft.kind,
      titleExternalId: draft.titleExternalId,
      justification: draft.justification,
      occurredAt: draft.occurredAt,
      permission,
      files,
      now,
    });
  }

  if (draft.kind === "PROTEST_CONFIRMED" || draft.kind === "PROTEST_FORWARDED") {
    const existing = await db.commercialCreditOccurrence.findFirst({
      where: {
        customerId: input.customerId,
        titleExternalId: draft.titleExternalId,
        kind: draft.kind,
        closedAt: null,
      },
    });
    if (existing) {
      throw new CommercialCreditOccurrenceError(
        "OCCURRENCE_DUPLICATE",
        "Já existe ocorrência vigente deste tipo para o título.",
        409
      );
    }
  }

  const id = randomUUID();
  const status = initialOccurrenceStatus(draft.kind);
  const dedupeKey =
    draft.kind === "PROTEST_CONFIRMED" || draft.kind === "PROTEST_FORWARDED"
      ? activeOccurrenceDedupeKey(input.customerId, draft.titleExternalId, draft.kind)
      : id;
  const store = input.fileStore ?? defaultFileStore;
  const staged = await stageEvidence(id, files, store);

  let created: OccurrenceRow;
  try {
    created = await db.$transaction(async (tx) => {
      const row = await tx.commercialCreditOccurrence.create({
        data: {
          id,
          customerId: input.customerId,
          titleExternalId: draft.titleExternalId,
          kind: draft.kind,
          status,
          origin: "MANUAL",
          occurredAt: draft.occurredAt,
          responsibleUserId: input.actor.id,
          justification: draft.justification,
          dedupeKey,
          closesOccurrenceId: null,
          closedAt: null,
          closedByUserId: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      await insertEvidence(tx, id, input.actor.id, staged, now);
      return row;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new CommercialCreditOccurrenceError(
        "OCCURRENCE_DUPLICATE",
        "Já existe ocorrência vigente deste tipo para o título.",
        409
      );
    }
    throw error;
  }

  await auditOrCompensate(
    db,
    input.auditWriter,
    [
      {
        entityType: "CommercialCreditOccurrence",
        entityId: created.id,
        action: "CREATE",
        fieldName: draft.kind,
        newValue: auditValue({ ...created, permission }),
        performedBy: input.actor.id,
      },
    ],
    async () => {
      await db.commercialCreditOccurrence.update({
        where: { id: created.id },
        data: {
          status: "CLOSED",
          closedAt: now,
          closedByUserId: input.actor.id,
          dedupeKey: created.id,
          updatedAt: now,
        },
      });
    }
  );

  return presentCommercialCreditOccurrence({ ...created, evidenceFileNames: files.map((file) => file.fileName) });
}

async function closeConfirmedProtest(
  db: CommercialCreditOccurrenceStore,
  input: {
    customerId: string;
    kind: "PROTEST_WITHDRAWN" | "REGULARIZATION";
    titleExternalId: number | null;
    occurredAt: Date;
    justification: string;
    closesOccurrenceId?: string | null;
    actor: Actor;
    permission: string;
    files: readonly OccurrenceEvidenceInput[];
    now: Date;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
    fileStore?: FileStore;
  }
): Promise<CommercialCreditOccurrenceView> {
  const target = input.closesOccurrenceId
    ? await db.commercialCreditOccurrence.findFirst({ where: { id: input.closesOccurrenceId } })
    : input.titleExternalId == null
      ? null
      : await db.commercialCreditOccurrence.findFirst({
          where: {
            customerId: input.customerId,
            titleExternalId: input.titleExternalId,
            kind: "PROTEST_CONFIRMED",
            status: "CONFIRMED_PENDING",
            closedAt: null,
          },
        });
  if (target && (target.customerId !== input.customerId || target.kind !== "PROTEST_CONFIRMED" || target.closedAt != null)) {
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_STATE",
      "O protesto informado não está pendente para este cliente."
    );
  }
  const titleExternalId = input.titleExternalId ?? target?.titleExternalId ?? null;
  if (titleExternalId == null) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_TITLE", "Informe o título oficial vinculado a esta ocorrência.");
  }

  const id = randomUUID();
  const store = input.fileStore ?? defaultFileStore;
  const staged = await stageEvidence(id, input.files, store);
  const previousDedupe = target?.dedupeKey ?? null;

  const created = await db.$transaction(async (tx) => {
    if (target) {
      await tx.commercialCreditOccurrence.update({
        where: { id: target.id },
        data: {
          status: "CLOSED",
          closedAt: input.now,
          closedByUserId: input.actor.id,
          dedupeKey: target.id,
          updatedAt: input.now,
        },
      });
    }
    const row = await tx.commercialCreditOccurrence.create({
      data: {
        id,
        customerId: input.customerId,
        titleExternalId,
        kind: input.kind,
        status: "CLOSED",
        origin: "MANUAL",
        occurredAt: input.occurredAt,
        responsibleUserId: input.actor.id,
        justification: input.justification,
        dedupeKey: id,
        closesOccurrenceId: target?.id ?? null,
        closedAt: input.now,
        closedByUserId: input.actor.id,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    await insertEvidence(tx, id, input.actor.id, staged, input.now);
    return row;
  });

  await auditOrCompensate(
    db,
    input.auditWriter,
    [
      ...(target
        ? [
            {
              entityType: "CommercialCreditOccurrence",
              entityId: target.id,
              action: input.kind === "REGULARIZATION" ? "REGULARIZE" : "WITHDRAW",
              fieldName: "status",
              oldValue: "CONFIRMED_PENDING",
              newValue: auditValue({ ...target, status: "CLOSED", permission: input.permission }),
              performedBy: input.actor.id,
            } satisfies AuditEntry,
          ]
        : []),
      {
        entityType: "CommercialCreditOccurrence",
        entityId: created.id,
        action: "CREATE",
        fieldName: input.kind,
        newValue: auditValue({ ...created, permission: input.permission }),
        performedBy: input.actor.id,
      },
    ],
    async () => {
      await db.commercialCreditOccurrence.update({
        where: { id: created.id },
        data: { closedAt: null, status: "OPEN", dedupeKey: created.id, updatedAt: input.now },
      });
      if (target && previousDedupe) {
        await db.commercialCreditOccurrence.update({
          where: { id: target.id },
          data: {
            status: "CONFIRMED_PENDING",
            closedAt: null,
            closedByUserId: null,
            dedupeKey: previousDedupe,
            updatedAt: input.now,
          },
        });
      }
    }
  );

  return presentCommercialCreditOccurrence({
    ...created,
    evidenceFileNames: input.files.map((file) => file.fileName),
  });
}

export async function updateCommercialCreditOccurrence(
  db: CommercialCreditOccurrenceStore,
  input: {
    customerId: string;
    occurrenceId: string;
    justification: string;
    actor: Actor;
    now?: Date;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
  }
): Promise<CommercialCreditOccurrenceView> {
  const now = input.now ?? new Date();
  const permission = permissionOrThrow(input.actor);
  const justification = input.justification.trim();
  if (justification.length < 20 || justification.length > 2000) {
    throw new CommercialCreditOccurrenceError(
      "OCCURRENCE_JUSTIFICATION",
      "A ocorrência exige justificativa objetiva."
    );
  }
  const current = await db.commercialCreditOccurrence.findFirst({ where: { id: input.occurrenceId } });
  if (!current || current.customerId !== input.customerId) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_STATE", "Ocorrência não encontrada.", 404);
  }
  if (current.closedAt != null) {
    throw new CommercialCreditOccurrenceError("OCCURRENCE_STATE", "Ocorrência encerrada não pode ser alterada.");
  }
  const updated = await db.commercialCreditOccurrence.update({
    where: { id: current.id },
    data: { justification, updatedAt: now },
  });
  await auditOrCompensate(
    db,
    input.auditWriter,
    [
      {
        entityType: "CommercialCreditOccurrence",
        entityId: current.id,
        action: "UPDATE",
        fieldName: "justification",
        oldValue: current.justification,
        newValue: JSON.stringify({ justification, permission }),
        performedBy: input.actor.id,
      },
    ],
    async () => {
      await db.commercialCreditOccurrence.update({
        where: { id: current.id },
        data: { justification: current.justification, updatedAt: now },
      });
    }
  );
  const evidences = await db.commercialCreditOccurrenceEvidence.findMany({ where: { occurrenceId: current.id } });
  return presentCommercialCreditOccurrence({
    ...updated,
    evidenceFileNames: evidences.map((file) => file.fileName),
  });
}

/** Idempotente. Não transforma encaminhamento em protesto e não duplica a chave Nomus. */
export async function upsertNomusConfirmedProtest(
  db: CommercialCreditOccurrenceStore,
  input: {
    customerId: string;
    titleExternalId: number;
    occurredAt: Date;
    justification: string;
    actor: Actor;
    now?: Date;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
  }
): Promise<{ created: boolean; occurrence: CommercialCreditOccurrenceView }> {
  const now = input.now ?? new Date();
  const permission = permissionOrThrow(input.actor);
  const draft = validateOccurrenceDraft({
    kind: "PROTEST_CONFIRMED",
    justification: input.justification,
    titleExternalId: input.titleExternalId,
    evidenceCount: 0,
    occurredAt: input.occurredAt,
    now,
  });
  if (draft.ok === false) throw new CommercialCreditOccurrenceError(draft.code, draft.message);
  await assertOfficialTitle(db, input.customerId, draft.titleExternalId);
  const dedupeKey = nomusProtestDedupeKey(input.customerId, input.titleExternalId);
  const existing = await db.commercialCreditOccurrence.findFirst({ where: { dedupeKey } });
  if (existing) {
    return { created: false, occurrence: presentCommercialCreditOccurrence(existing) };
  }
  const manual = await db.commercialCreditOccurrence.findFirst({
    where: {
      customerId: input.customerId,
      titleExternalId: input.titleExternalId,
      kind: "PROTEST_CONFIRMED",
      closedAt: null,
    },
  });
  if (manual) {
    return { created: false, occurrence: presentCommercialCreditOccurrence(manual) };
  }
  const id = randomUUID();
  let created: OccurrenceRow;
  try {
    created = await db.commercialCreditOccurrence.create({
      data: {
        id,
        customerId: input.customerId,
        titleExternalId: input.titleExternalId,
        kind: "PROTEST_CONFIRMED",
        status: "CONFIRMED_PENDING",
        origin: "NOMUS" satisfies CommercialCreditOccurrenceOrigin,
        occurredAt: draft.occurredAt,
        responsibleUserId: input.actor.id,
        justification: draft.justification,
        dedupeKey,
        closesOccurrenceId: null,
        closedAt: null,
        closedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await db.commercialCreditOccurrence.findFirst({ where: { dedupeKey } });
      if (raced) return { created: false, occurrence: presentCommercialCreditOccurrence(raced) };
    }
    throw error;
  }
  await auditOrCompensate(
    db,
    input.auditWriter,
    [
      {
        entityType: "CommercialCreditOccurrence",
        entityId: created.id,
        action: "UPSERT_NOMUS",
        fieldName: "PROTEST_CONFIRMED",
        newValue: auditValue({ ...created, permission }),
        performedBy: input.actor.id,
      },
    ],
    async () => {
      await db.commercialCreditOccurrence.update({
        where: { id: created.id },
        data: { status: "CLOSED", closedAt: now, closedByUserId: input.actor.id, dedupeKey: created.id, updatedAt: now },
      });
    }
  );
  return { created: true, occurrence: presentCommercialCreditOccurrence(created) };
}
