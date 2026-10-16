/**
 * Certificados de treinamento — serviço (Prisma ou banco simulado).
 *
 * Fonte dos dados (nada digitado no certificado):
 *   participante (Employee), treinamento/competência (HrTraining/HrCompetency), conclusão do
 *   participante (HrTrainingParticipant.completedAt), empresa/logo/slogan/site (BrandingSettings),
 *   signatário/local/prefixo (HrTrainingCertificateSettings), instrutor e conteúdo programático
 *   (HrTraining). Emitir congela tudo em `payload` + sha256; reabrir devolve o gravado.
 */
import { sha256Hex, stableStringify } from "../commercialPolicy/commercialPolicyRules";
import {
  CompetencyServiceError,
  assertWritable,
  notFound,
  toIsoDate,
  trainingValidityExpiresOn,
  visibleTrainingIds,
  type CompetencyDb,
} from "./competency.server";
import { businessTodayIso } from "./competencyDomain";
import { canSeeEmployee, canWriteEmployee, COMPETENCY_SCOPE_ALL, type CompetencyScope } from "./competencyScope";
import {
  TRAINING_CERTIFICATE_PAYLOAD_VERSION,
  formatCertificateNumber,
  readStoredSyllabus,
  syllabusMatchesWorkload,
  trainingCertificateBlockers,
  type CertificateSettingsDto,
  type CertificateSettingsInput,
  type SyllabusModule,
  type TrainingCertificatePayload,
} from "./trainingCertificate";
import { certificateValidity, type EmployeeCertificateItemDto } from "../hrEmployeeCertificates";
import type {
  TrainingCertificateBoardDto,
  TrainingCertificateDocumentDto,
  TrainingCertificateIssueResult,
} from "./competencyTypes";

export type CertificateActor = { userId: string | null; name: string | null };

const SETTINGS_ID = "GLOBAL";
const ACTIVE = "ACTIVE";
const CANCELED = "CANCELED";
const MAX_NUMBER_RETRIES = 3;

type TrainingRow = {
  id: string;
  title: string;
  competencyId: string;
  modality: string;
  workloadHours: number;
  startDate: Date;
  status: string;
  completedAt: Date | null;
  instructorName?: string | null;
  syllabus?: unknown;
};

type ParticipantRow = { trainingId: string; employeeId: string; completedAt: Date | null };

type CertificateRow = {
  id: string;
  number: string;
  year: number;
  sequence: number;
  trainingId: string;
  employeeId: string;
  status: string;
  issuedAt: Date;
  issuedByName: string;
  payload: unknown;
  payloadSha256: string;
  canceledAt: Date | null;
  canceledByName: string | null;
  cancelReason: string | null;
};

type SettingsRow = {
  signerName: string;
  signerRole: string;
  issuePlace: string;
  numberPrefix: string;
  updatedAt: Date | null;
  updatedByName: string | null;
};

type BrandingRow = {
  companyName?: string | null;
  slogan?: string | null;
  website?: string | null;
  proposalLogoDataUrl?: string | null;
  systemExpandedLogoDataUrl?: string | null;
  systemCompactLogoDataUrl?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function isImageDataUrl(src: string | null | undefined): src is string {
  return typeof src === "string" && src.trim().toLowerCase().startsWith("data:image/");
}

/** Mesma ordem de logo dos documentos de projeto (fundo claro). */
export function companyFromBranding(row: BrandingRow | null): TrainingCertificatePayload["company"] & { name: string | null } {
  const logo = [row?.proposalLogoDataUrl, row?.systemExpandedLogoDataUrl, row?.systemCompactLogoDataUrl].find(isImageDataUrl);
  return {
    name: clean(row?.companyName),
    slogan: clean(row?.slogan),
    website: clean(row?.website),
    logoDataUrl: logo ? logo.trim() : null,
  };
}

export function hashCertificatePayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export async function loadCertificateSettings(db: CompetencyDb): Promise<CertificateSettingsDto> {
  const row = (await db.hrTrainingCertificateSettings.findUnique({ where: { id: SETTINGS_ID } })) as SettingsRow | null;
  return {
    signerName: row?.signerName ?? null,
    signerRole: row?.signerRole ?? null,
    issuePlace: row?.issuePlace ?? null,
    numberPrefix: row?.numberPrefix ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    updatedByName: row?.updatedByName ?? null,
  };
}

/** Configuração global: só o RH (escopo ALL) altera — líder não troca o signatário da empresa. */
export async function updateCertificateSettings(
  db: CompetencyDb,
  input: CertificateSettingsInput,
  actor: CertificateActor,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<CertificateSettingsDto> {
  if (scope.kind !== "ALL") {
    throw new CompetencyServiceError("OUT_OF_SCOPE", "Só o RH altera a configuração dos certificados.", 403);
  }
  const data = { ...input, updatedByUserId: actor.userId, updatedByName: actor.name };
  const existing = await db.hrTrainingCertificateSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) {
    await db.hrTrainingCertificateSettings.update({ where: { id: SETTINGS_ID }, data: { ...data, updatedAt: new Date() } });
  } else {
    await db.hrTrainingCertificateSettings.create({ data: { id: SETTINGS_ID, ...data } });
  }
  return loadCertificateSettings(db);
}

async function findVisibleTraining(db: CompetencyDb, id: string, scope: CompetencyScope): Promise<TrainingRow> {
  const row = (await db.hrTraining.findUnique({ where: { id } })) as TrainingRow | null;
  if (!row) notFound("Treinamento");
  if (!(await visibleTrainingIds(db, scope, [id])).has(id)) notFound("Treinamento");
  return row;
}

async function loadBranding(db: CompetencyDb): Promise<BrandingRow | null> {
  return (await db.brandingSettings.findFirst({ orderBy: { updatedAt: "desc" } })) as BrandingRow | null;
}

/** Painel de certificados do treinamento: impedimentos, participantes e emissões. */
export async function getTrainingCertificateBoard(
  db: CompetencyDb,
  trainingId: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<TrainingCertificateBoardDto> {
  const training = await findVisibleTraining(db, trainingId, scope);
  const [participants, certificates, competency, settings, branding] = await Promise.all([
    db.hrTrainingParticipant.findMany({ where: { trainingId } }) as Promise<ParticipantRow[]>,
    db.hrTrainingCertificate.findMany({ where: { trainingId } }) as Promise<CertificateRow[]>,
    db.hrCompetency.findUnique({ where: { id: training.competencyId } }) as Promise<{ name: string } | null>,
    loadCertificateSettings(db),
    loadBranding(db),
  ]);
  const visible = participants.filter((p) => canSeeEmployee(scope, p.employeeId));
  const employeeIds = [...new Set([...visible.map((p) => p.employeeId), ...certificates.map((c) => c.employeeId)])];
  const employees = employeeIds.length
    ? ((await db.employee.findMany({ where: { id: { in: employeeIds } } })) as { id: string; name: string }[])
    : [];
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const syllabus = readStoredSyllabus(training.syllabus);
  const company = companyFromBranding(branding);
  const activeCount = certificates.filter((c) => c.status === ACTIVE).length;
  return {
    training: {
      id: training.id,
      title: training.title,
      status: training.status,
      competencyName: competency?.name ?? "—",
      workloadHours: training.workloadHours,
      completedOn: toIsoDate(training.completedAt),
      instructorName: training.instructorName ?? null,
      syllabus,
      contentLocked: activeCount > 0,
    },
    settings,
    company: { name: company.name, hasLogo: Boolean(company.logoDataUrl) },
    blockers: trainingCertificateBlockers({
      training: { status: training.status, workloadHours: training.workloadHours, syllabus },
      settings,
      companyName: company.name,
    }),
    participants: visible
      .map((p) => {
        const active = certificates.find((c) => c.employeeId === p.employeeId && c.status === ACTIVE) ?? null;
        return {
          employeeId: p.employeeId,
          employeeName: names.get(p.employeeId) ?? "—",
          completedOn: toIsoDate(p.completedAt),
          writable: canWriteEmployee(scope, p.employeeId),
          certificate: active
            ? { id: active.id, number: active.number, issuedAt: new Date(active.issuedAt).toISOString(), issuedByName: active.issuedByName }
            : null,
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR")),
    canceled: certificates
      .filter((c) => c.status === CANCELED && canSeeEmployee(scope, c.employeeId))
      .map((c) => ({
        id: c.id,
        number: c.number,
        employeeName: names.get(c.employeeId) ?? "—",
        canceledAt: c.canceledAt ? new Date(c.canceledAt).toISOString() : null,
        canceledByName: c.canceledByName,
        reason: c.cancelReason ?? "",
      }))
      .sort((a, b) => a.number.localeCompare(b.number)),
  };
}

/**
 * Instrutor e conteúdo programático. Editável também com o treinamento concluído, enquanto não
 * houver certificado vigente (para emissões futuras não divergirem das já entregues).
 */
export async function updateTrainingCertificateContent(
  db: CompetencyDb,
  trainingId: string,
  input: { instructorName: string | null; syllabus: SyllabusModule[] },
  actor: CertificateActor,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  const training = await findVisibleTraining(db, trainingId, scope);
  const parts = (await db.hrTrainingParticipant.findMany({ where: { trainingId } })) as ParticipantRow[];
  assertWritable(scope, parts.map((p) => p.employeeId));
  const active = (await db.hrTrainingCertificate.findMany({ where: { trainingId, status: ACTIVE } })) as CertificateRow[];
  if (active.length > 0) {
    throw new CompetencyServiceError(
      "CERTIFICATE_CONTENT_LOCKED",
      "Há certificados emitidos: cancele-os antes de alterar o instrutor ou o conteúdo programático.",
      409,
    );
  }
  if (!syllabusMatchesWorkload(input.syllabus, training.workloadHours)) {
    throw new CompetencyServiceError(
      "SYLLABUS_WORKLOAD_MISMATCH",
      `A soma dos módulos precisa ser igual à carga horária do treinamento (${training.workloadHours} h).`,
      400,
    );
  }
  await db.hrTraining.update({
    where: { id: trainingId },
    data: { instructorName: input.instructorName, syllabus: input.syllabus, updatedByUserId: actor.userId },
  });
  return { id: trainingId };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Emite um certificado por participante concluído e ainda sem certificado vigente.
 * Numeração `{prefixo}-{ano}/{sequência}` por ano da emissão; corrida → nova tentativa.
 */
export async function issueTrainingCertificates(
  db: CompetencyDb,
  trainingId: string,
  params: { employeeIds: string[] | null },
  actor: CertificateActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<TrainingCertificateIssueResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await issueOnce(db, trainingId, params, actor, now, scope);
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_NUMBER_RETRIES) continue;
      throw error;
    }
  }
}

async function issueOnce(
  db: CompetencyDb,
  trainingId: string,
  params: { employeeIds: string[] | null },
  actor: CertificateActor,
  now: Date,
  scope: CompetencyScope,
): Promise<TrainingCertificateIssueResult> {
  const training = await findVisibleTraining(db, trainingId, scope);
  const [participants, settings, branding, competency] = await Promise.all([
    db.hrTrainingParticipant.findMany({ where: { trainingId } }) as Promise<ParticipantRow[]>,
    loadCertificateSettings(db),
    loadBranding(db),
    db.hrCompetency.findUnique({ where: { id: training.competencyId } }) as Promise<{
      name: string;
      description: string | null;
    } | null>,
  ]);
  const syllabus = readStoredSyllabus(training.syllabus);
  const company = companyFromBranding(branding);
  const blockers = trainingCertificateBlockers({
    training: { status: training.status, workloadHours: training.workloadHours, syllabus },
    settings,
    companyName: company.name,
  });
  if (blockers.length > 0) throw new CompetencyServiceError("CERTIFICATE_BLOCKED", blockers.join(" "), 409);

  const byEmployee = new Map(participants.map((p) => [p.employeeId, p]));
  let targets: string[];
  if (params.employeeIds) {
    for (const id of params.employeeIds) {
      if (!byEmployee.has(id) || !canSeeEmployee(scope, id)) {
        throw new CompetencyServiceError("INVALID_PARTICIPANTS", "Colaborador não participa deste treinamento.", 400);
      }
    }
    assertWritable(scope, params.employeeIds);
    targets = params.employeeIds;
  } else {
    targets = participants.map((p) => p.employeeId).filter((id) => canWriteEmployee(scope, id));
  }

  const employees = targets.length
    ? ((await db.employee.findMany({ where: { id: { in: targets } } })) as { id: string; name: string }[])
    : [];
  const names = new Map(employees.map((e) => [e.id, e.name.trim()]));
  const issuedOn = businessTodayIso(now);
  const year = Number(issuedOn.slice(0, 4));
  const issuedByName = actor.name?.trim() || "Usuário do sistema";

  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const existing = (await t.hrTrainingCertificate.findMany({ where: { trainingId, status: ACTIVE } })) as CertificateRow[];
    const yearRows = (await t.hrTrainingCertificate.findMany({ where: { year } })) as CertificateRow[];
    let sequence = yearRows.reduce((max, r) => Math.max(max, r.sequence), 0);
    const issued: TrainingCertificateIssueResult["issued"] = [];
    const skipped: TrainingCertificateIssueResult["skipped"] = [];
    for (const employeeId of [...targets].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "pt-BR"))) {
      const participant = byEmployee.get(employeeId)!;
      const name = names.get(employeeId);
      if (existing.some((c) => c.employeeId === employeeId)) {
        skipped.push({ employeeId, reason: "ALREADY_ISSUED" });
        continue;
      }
      const completedOn = toIsoDate(participant.completedAt);
      if (!completedOn) {
        skipped.push({ employeeId, reason: "NOT_COMPLETED" });
        continue;
      }
      if (!name) {
        skipped.push({ employeeId, reason: "EMPLOYEE_NOT_FOUND" });
        continue;
      }
      sequence += 1;
      const number = formatCertificateNumber(settings.numberPrefix!, year, sequence);
      const payload: TrainingCertificatePayload = {
        version: TRAINING_CERTIFICATE_PAYLOAD_VERSION,
        number,
        issuedOn,
        company: { name: company.name!, slogan: company.slogan, website: company.website, logoDataUrl: company.logoDataUrl },
        participant: { employeeId, name },
        training: {
          id: training.id,
          title: training.title,
          competencyName: competency?.name ?? "—",
          competencyDescription: clean(competency?.description),
          modality: training.modality,
          workloadHours: training.workloadHours,
          startDate: toIsoDate(training.startDate) ?? "",
          completedOn,
          instructorName: clean(training.instructorName),
        },
        syllabus,
        signer: { name: settings.signerName!, role: settings.signerRole! },
        issuePlace: settings.issuePlace!,
      };
      const row = (await t.hrTrainingCertificate.create({
        data: {
          number,
          year,
          sequence,
          trainingId,
          employeeId,
          status: ACTIVE,
          issuedAt: now,
          issuedByUserId: actor.userId,
          issuedByName,
          payload,
          payloadSha256: hashCertificatePayload(payload),
        },
      })) as { id: string };
      issued.push({ id: row.id, number, employeeId });
    }
    return { issued, skipped };
  });
}

/** Conteúdo congelado para impressão (vigentes do treinamento ou os ids pedidos). */
export async function getTrainingCertificatesDocument(
  db: CompetencyDb,
  trainingId: string,
  params: { ids: string[] | null },
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<TrainingCertificateDocumentDto> {
  await findVisibleTraining(db, trainingId, scope);
  const rows = (await db.hrTrainingCertificate.findMany({ where: { trainingId } })) as CertificateRow[];
  const picked = params.ids
    ? rows.filter((r) => params.ids!.includes(r.id))
    : rows.filter((r) => r.status === ACTIVE);
  if (params.ids && picked.length !== params.ids.length) notFound("Certificado");
  return {
    certificates: picked
      .filter((r) => canSeeEmployee(scope, r.employeeId))
      .sort((a, b) => a.number.localeCompare(b.number))
      .map((r) => {
        const sha256 = hashCertificatePayload(r.payload);
        return {
          id: r.id,
          number: r.number,
          status: r.status,
          payload: r.payload as TrainingCertificatePayload,
          integrity: { sha256: r.payloadSha256, verified: sha256 === r.payloadSha256 },
        };
      }),
  };
}

export async function cancelTrainingCertificate(
  db: CompetencyDb,
  certificateId: string,
  reason: string,
  actor: CertificateActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  const row = (await db.hrTrainingCertificate.findUnique({ where: { id: certificateId } })) as CertificateRow | null;
  if (!row || !canSeeEmployee(scope, row.employeeId)) notFound("Certificado");
  assertWritable(scope, [row.employeeId]);
  if (row.status !== ACTIVE) {
    throw new CompetencyServiceError("CERTIFICATE_ALREADY_CANCELED", "Certificado já cancelado.", 409);
  }
  await db.hrTrainingCertificate.update({
    where: { id: certificateId },
    data: {
      status: CANCELED,
      canceledAt: now,
      canceledByUserId: actor.userId,
      canceledByName: actor.name?.trim() || "Usuário do sistema",
      cancelReason: reason,
    },
  });
  return { id: certificateId, number: row.number };
}

/**
 * Ficha › Certificados: certificados vigentes emitidos pelo sistema para o colaborador.
 * Dados do conteúdo congelado; a validade segue a do treinamento (meses a partir da conclusão).
 */
export async function listEmployeeTrainingCertificates(
  db: CompetencyDb,
  employeeId: string,
  todayIso: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<EmployeeCertificateItemDto[]> {
  if (!canSeeEmployee(scope, employeeId)) notFound("Colaborador");
  const rows = (await db.hrTrainingCertificate.findMany({ where: { employeeId, status: ACTIVE } })) as CertificateRow[];
  const trainingIds = [...new Set(rows.map((r) => r.trainingId))];
  const trainings = trainingIds.length
    ? ((await db.hrTraining.findMany({ where: { id: { in: trainingIds } } })) as { id: string; validityMonths: number; competencyId: string }[])
    : [];
  const byId = new Map(trainings.map((t) => [t.id, t]));
  return rows.map((r) => {
    const p = r.payload as TrainingCertificatePayload;
    const training = byId.get(r.trainingId);
    const expiresOn = training ? trainingValidityExpiresOn(p.training.completedOn, training.validityMonths) : null;
    return {
      key: `system:${r.id}`,
      origin: "SYSTEM" as const,
      id: r.id,
      title: p.training.title,
      issuer: p.company.name,
      number: r.number,
      competencyId: training?.competencyId ?? null,
      competencyName: p.training.competencyName,
      workloadHours: p.training.workloadHours,
      completedOn: p.training.completedOn,
      expiresOn,
      validity: certificateValidity(expiresOn, todayIso),
      trainingId: r.trainingId,
      documentId: null,
      downloadUrl: null,
      fileName: null,
      mimeType: null,
      notes: null,
      createdByName: r.issuedByName,
      createdAt: new Date(r.issuedAt).toISOString(),
    };
  });
}
