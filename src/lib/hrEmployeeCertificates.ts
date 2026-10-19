/**
 * Ficha › Certificados — regras puras (browser-safe).
 *
 * A aba junta duas origens:
 *   - SYSTEM: certificados emitidos pelos treinamentos do sistema (Competências; conteúdo congelado);
 *   - UPLOAD: certificados externos anexados pelo RH (arquivo no dossiê + dados estruturados).
 * Certificado externo é informativo: não altera nível nem reciclagem na engine de Competências.
 */

export const EXTERNAL_CERTIFICATE_DOCUMENT_TYPE = "TRAINING_CERTIFICATE";
export const EXTERNAL_CERTIFICATE_TITLE_MAX = 160;
export const EXTERNAL_CERTIFICATE_INSTITUTION_MAX = 120;
export const EXTERNAL_CERTIFICATE_NOTES_MAX = 1000;
export const EXTERNAL_CERTIFICATE_MAX_HOURS = 2000;
export const EXTERNAL_CERTIFICATE_MAX_BYTES = 10 * 1024 * 1024;
/** "A vencer": validade nos próximos 30 dias. */
export const CERTIFICATE_EXPIRING_DAYS = 30;

export type ExternalCertificateFileKind = "pdf" | "jpeg" | "png";

export type ExternalCertificateInput = {
  title: string;
  institution: string;
  workloadHours: number | null;
  completedOn: string;
  expiresOn: string | null;
  competencyId: string | null;
  notes: string | null;
};

export type CertificateValidity = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED";

export type EmployeeCertificateItemDto = {
  /** `system:<id>` ou `upload:<id>` — chave estável na lista unificada. */
  key: string;
  origin: "SYSTEM" | "UPLOAD";
  id: string;
  title: string;
  /** Empresa emissora (SYSTEM) ou instituição informada (UPLOAD). */
  issuer: string;
  number: string | null;
  competencyId: string | null;
  competencyName: string | null;
  workloadHours: number | null;
  completedOn: string;
  expiresOn: string | null;
  validity: CertificateValidity;
  /** SYSTEM: para imprimir o conteúdo congelado. */
  trainingId: string | null;
  /** UPLOAD: arquivo no dossiê. */
  documentId: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max ? t : null;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Dados do certificado externo (multipart: tudo chega como texto).
 * Conclusão obrigatória e não futura; validade opcional e não anterior à conclusão;
 * carga opcional em passos de 0,5 h.
 */
export function parseExternalCertificateInput(body: unknown, todayIso: string): Parsed<ExternalCertificateInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_BODY", message: "Dados inválidos." };
  }
  const b = body as Record<string, unknown>;
  const title = cleanText(b.title, EXTERNAL_CERTIFICATE_TITLE_MAX);
  if (!title) {
    return { ok: false, code: "INVALID_TITLE", message: `Informe o nome do curso (até ${EXTERNAL_CERTIFICATE_TITLE_MAX} caracteres).` };
  }
  const institution = cleanText(b.institution, EXTERNAL_CERTIFICATE_INSTITUTION_MAX);
  if (!institution) {
    return {
      ok: false,
      code: "INVALID_INSTITUTION",
      message: `Informe a instituição (até ${EXTERNAL_CERTIFICATE_INSTITUTION_MAX} caracteres).`,
    };
  }
  let workloadHours: number | null = null;
  if (!blank(b.workloadHours)) {
    const n = typeof b.workloadHours === "string" ? Number(b.workloadHours.replace(",", ".")) : b.workloadHours;
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      n <= 0 ||
      n > EXTERNAL_CERTIFICATE_MAX_HOURS ||
      Math.round(n * 10) % 5 !== 0
    ) {
      return { ok: false, code: "INVALID_WORKLOAD", message: "Carga horária: maior que zero, em passos de 0,5 h." };
    }
    workloadHours = Math.round(n * 10) / 10;
  }
  if (!isIsoDate(b.completedOn)) return { ok: false, code: "INVALID_COMPLETED", message: "Informe a data de conclusão." };
  if (b.completedOn > todayIso) {
    return { ok: false, code: "INVALID_COMPLETED", message: "A data de conclusão não pode ser futura." };
  }
  let expiresOn: string | null = null;
  if (!blank(b.expiresOn)) {
    if (!isIsoDate(b.expiresOn)) return { ok: false, code: "INVALID_EXPIRES", message: "Validade inválida." };
    if (b.expiresOn < b.completedOn) {
      return { ok: false, code: "INVALID_EXPIRES", message: "A validade não pode ser anterior à conclusão." };
    }
    expiresOn = b.expiresOn;
  }
  let competencyId: string | null = null;
  if (!blank(b.competencyId)) {
    if (typeof b.competencyId !== "string" || !UUID_RE.test(b.competencyId.trim())) {
      return { ok: false, code: "INVALID_COMPETENCY", message: "Competência inválida." };
    }
    competencyId = b.competencyId.trim().toLowerCase();
  }
  let notes: string | null = null;
  if (!blank(b.notes)) {
    if (typeof b.notes !== "string" || b.notes.trim().length > EXTERNAL_CERTIFICATE_NOTES_MAX) {
      return { ok: false, code: "INVALID_NOTES", message: `Observações: até ${EXTERNAL_CERTIFICATE_NOTES_MAX} caracteres.` };
    }
    notes = b.notes.trim();
  }
  return { ok: true, value: { title, institution, workloadHours, completedOn: b.completedOn, expiresOn, competencyId, notes } };
}

/** Tipo real pelo conteúdo (magic bytes), não pela extensão nem pelo MIME do navegador. */
export function detectCertificateFileKind(buffer: Uint8Array): ExternalCertificateFileKind | null {
  if (buffer.length >= 5 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d) {
    return "pdf";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}

export const CERTIFICATE_FILE_MIME: Record<ExternalCertificateFileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};

function dayNumber(iso: string): number {
  return Math.round(new Date(`${iso}T00:00:00.000Z`).getTime() / 86_400_000);
}

export function certificateValidity(expiresOn: string | null, todayIso: string): CertificateValidity {
  if (!expiresOn) return "NO_EXPIRY";
  const days = dayNumber(expiresOn) - dayNumber(todayIso);
  if (days < 0) return "EXPIRED";
  if (days <= CERTIFICATE_EXPIRING_DAYS) return "EXPIRING";
  return "VALID";
}

export const CERTIFICATE_VALIDITY_LABELS: Record<CertificateValidity, string> = {
  NO_EXPIRY: "Sem validade",
  VALID: "Vigente",
  EXPIRING: "A vencer",
  EXPIRED: "Vencido",
};

/** Lista unificada: conclusão mais recente primeiro; empate pelo título. */
export function sortEmployeeCertificates(items: EmployeeCertificateItemDto[]): EmployeeCertificateItemDto[] {
  return [...items].sort(
    (a, b) => b.completedOn.localeCompare(a.completedOn) || a.title.localeCompare(b.title, "pt-BR"),
  );
}

export function summarizeEmployeeCertificates(items: readonly EmployeeCertificateItemDto[]) {
  return {
    total: items.length,
    system: items.filter((i) => i.origin === "SYSTEM").length,
    upload: items.filter((i) => i.origin === "UPLOAD").length,
    expiring: items.filter((i) => i.validity === "EXPIRING").length,
    expired: items.filter((i) => i.validity === "EXPIRED").length,
    hours: Math.round(items.reduce((sum, i) => sum + (i.workloadHours ?? 0), 0) * 10) / 10,
  };
}
