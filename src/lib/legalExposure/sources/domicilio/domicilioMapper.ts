/**
 * Mapper do contrato oficial (`RespostaPaginadaComunicacaoProcessualViewModel`).
 * Defensivo: campo ausente vira null, item sem identificador é descartado e
 * comunicação de outro destinatário nunca é atribuída à conta consultada.
 *
 * Destinatário: só o CNPJ completo da conta, que é o documento do perfil que o CNJ
 * devolveu em GET /api/v1/eu. Mesma raiz (filial, outro estabelecimento) não basta:
 * o contrato não comprova, pelas operações permitidas, que o tenant representa
 * outro CNPJ. Sem essa prova documental não há exceção.
 *
 * Os links devolvidos em `linksDocumentos` levam ao documento completo; abri-los
 * gera ciência. Eles não são guardados, devolvidos nem seguidos — só a contagem.
 */

import type {
  DomicilioRejection,
  NormalizedCaseObservation,
  NormalizedCommunicationObservation,
} from "../../legalExposureContracts.js";
import { normalizeExposureCnpj, normalizeProcessNumber } from "../../legalExposureNormalization.js";
import type { DomicilioInstitution } from "./domicilioContracts.js";

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Row;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

type RecipientCheck =
  | { ok: true }
  | { ok: false; rejection: Omit<DomicilioRejection, "communicationRef">; invalid: boolean };

/**
 * Compara o destinatário com o CNPJ da conta, dígito a dígito.
 * Ausente ou malformado não se resolve por aproximação: é registro inválido.
 */
function checkRecipient(raw: unknown, accountCnpj: string): RecipientCheck {
  const scalar = typeof raw === "string" || typeof raw === "number";
  const source = scalar ? String(raw).trim() : "";
  if (raw == null || (scalar && !source)) {
    return { ok: false, invalid: true, rejection: { reason: "RECIPIENT_MISSING", recipientKind: "NONE", sameRoot: false } };
  }
  const onlyDigits = digits(source);
  const wellFormed =
    scalar && /^[\d.\-/\s]+$/.test(source) && (onlyDigits.length === 11 || onlyDigits.length === 14);
  if (!wellFormed || (onlyDigits.length === 14 && !normalizeExposureCnpj(onlyDigits))) {
    return { ok: false, invalid: true, rejection: { reason: "RECIPIENT_MALFORMED", recipientKind: "OTHER", sameRoot: false } };
  }
  if (onlyDigits === accountCnpj) return { ok: true };
  return {
    ok: false,
    invalid: false,
    rejection: {
      reason: "RECIPIENT_MISMATCH",
      recipientKind: onlyDigits.length === 14 ? "CNPJ" : "CPF",
      sameRoot: onlyDigits.length === 14 && onlyDigits.slice(0, 8) === accountCnpj.slice(0, 8),
    },
  };
}

function communicationRef(value: string | null): string | null {
  return value ? value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || null : null;
}

/** Perfis institucionais de `GET /api/v1/eu`. */
export function mapDomicilioInstitutions(body: unknown): DomicilioInstitution[] {
  const profiles = asRecord(body)?.perfis;
  if (!Array.isArray(profiles)) return [];
  const out: DomicilioInstitution[] = [];
  for (const item of profiles) {
    const row = asRecord(item);
    const tenantId = row ? text(row.tenantId) : null;
    const document = row ? digits(row.documento) : "";
    if (!row || !tenantId || !document) continue;
    out.push({ tenantId, document, institution: text(row.tenantName) ?? "" });
  }
  return out;
}

/** Perfil da conta: o CNPJ do perfil é o da conta e, se o tenant foi configurado, é o mesmo. */
export function selectDomicilioInstitution(
  institutions: readonly DomicilioInstitution[],
  account: { cnpj: string; tenantId: string | null }
): DomicilioInstitution | null {
  const matches = institutions.filter((row) => row.document === account.cnpj);
  if (account.tenantId) {
    return matches.find((row) => row.tenantId.toLowerCase() === account.tenantId!.toLowerCase()) ?? null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** Metadados guardados: só o que a ficha exibe. Sem CPF, sem nome de servidor, sem link. */
function safeMetadata(row: Row): Row {
  const hearing = asRecord(row.audiencia);
  const links = Array.isArray(row.linksDocumentos) ? row.linksDocumentos.length : 0;
  const extraLinks = Array.isArray(row.linksDocumentosAdicionais) ? row.linksDocumentosAdicionais.length : 0;
  return {
    numeroComunicacao: text(row.numeroComunicacao),
    numeroProcesso: text(row.numeroProcesso),
    documentoDestinatario: normalizeExposureCnpj(text(row.documentoDestinatario)),
    nomeDestinatario: text(row.nomeDestinatario),
    uf: text(row.uf),
    tribunalOrigem: text(row.tribunalOrigem),
    varaJudicial: text(row.varaJudicial),
    orgaoLegal: text(row.orgaoLegal),
    instancia: text(row.instancia),
    classe: text(row.classe),
    assunto: text(row.assunto),
    assuntoComunicacao: text(row.assuntoComunicacao),
    tipoComunicacao: text(row.tipoComunicacao),
    tipoIntimacao: text(row.tipoIntimacao),
    parteInteressada: text(row.parteInteressada),
    meioEnvio: text(row.meioEnvio),
    dataComunicacao: isoDate(row.dataComunicacao),
    dataFinalCiencia: isoDate(row.dataFinalCiencia),
    dataCiente: isoDate(row.dataCiente),
    prazo: typeof row.prazo === "number" ? row.prazo : null,
    tipoPrazo: text(row.tipoPrazo),
    urgente: text(row.urgente),
    status: text(row.status),
    ciente: typeof row.ciente === "boolean" ? row.ciente : null,
    foiCienciaAutomatica: typeof row.foiCienciaAutomatica === "boolean" ? row.foiCienciaAutomatica : null,
    emCurso: typeof row.emCurso === "boolean" ? row.emCurso : null,
    segredoJustica: typeof row.segredoJustica === "boolean" ? row.segredoJustica : null,
    nivelSigilo: text(row.nivelSigilo),
    audiencia: hearing
      ? { data: text(hearing.data), hora: text(hearing.hora), tipo: text(hearing.tipo), formato: text(hearing.formato) }
      : null,
    atualizadoEm: isoDate(row.atualizadoEm),
    documentosDisponiveis: links + extraLinks,
  };
}

export type DomicilioMappedPage = {
  /** `null` quando o corpo não é a resposta paginada do contrato. */
  page: { pageNumber: number; totalPages: number; count: number } | null;
  communications: NormalizedCommunicationObservation[];
  /** Uma observação por processo, para a descoberta/conciliação existente vincular a conta. */
  cases: NormalizedCaseObservation[];
  /** Itens de outro destinatário (CNPJ completo diferente do da conta), descartados. */
  rejectedRecipient: number;
  /** Itens sem identificador ou com destinatário ausente/malformado, descartados. */
  invalid: number;
  /** Uma ocorrência sanitizada por item descartado. */
  rejections: DomicilioRejection[];
};

export function mapDomicilioCommunicationPage(
  body: unknown,
  context: { accountCnpj: string; tenantId: string }
): DomicilioMappedPage {
  const record = asRecord(body);
  const list = Array.isArray(record?.data) ? record.data : null;
  const paging = asRecord(record?.page);
  if (!record || !list) {
    return { page: null, communications: [], cases: [], rejectedRecipient: 0, invalid: 0, rejections: [] };
  }
  const communications: NormalizedCommunicationObservation[] = [];
  const cases = new Map<string, NormalizedCaseObservation>();
  let rejectedRecipient = 0;
  let invalid = 0;
  const rejections: DomicilioRejection[] = [];

  for (const item of list) {
    const row = asRecord(item);
    const sourceCommunicationId = row ? text(row.numeroComunicacao) : null;
    if (!row || !sourceCommunicationId) {
      invalid += 1;
      rejections.push({ reason: "MISSING_IDENTIFIER", communicationRef: null, recipientKind: "NONE", sameRoot: false });
      continue;
    }
    const recipientCheck = checkRecipient(row.documentoDestinatario, context.accountCnpj);
    if (recipientCheck.ok === false) {
      if (recipientCheck.invalid) invalid += 1;
      else rejectedRecipient += 1;
      rejections.push({ ...recipientCheck.rejection, communicationRef: communicationRef(sourceCommunicationId) });
      continue;
    }
    const metadata = safeMetadata(row);
    const processNumber = text(row.numeroProcesso);
    const tribunal = text(row.tribunalOrigem);
    const courtUnit = text(row.varaJudicial) ?? text(row.orgaoLegal);
    communications.push({
      sourceCommunicationId,
      tenantId: context.tenantId,
      processNumber,
      communicationType: text(row.tipoComunicacao) ?? "OUTRA",
      subject: text(row.assuntoComunicacao) ?? text(row.assunto),
      sourceStatus: text(row.status) ?? "",
      availableAt: isoDate(row.dataComunicacao),
      scienceDeadlineAt: isoDate(row.dataFinalCiencia),
      sourceScienceAt: isoDate(row.dataCiente),
      tribunal,
      courtUnit,
      rawMetadata: metadata,
    });

    const processKey = normalizeProcessNumber(processNumber);
    if (!processNumber || !processKey || cases.has(processKey)) continue;
    cases.set(processKey, {
      processNumber,
      tribunal,
      jurisdiction: null,
      degree: null,
      courtUnit,
      classCode: null,
      className: text(row.classe),
      filedAt: null,
      currentStatus: null,
      // O polo e o valor da causa seguem com as fontes processuais já homologadas.
      entityPole: "UNKNOWN",
      sourceIdentifier: processKey,
      sourceUpdatedAt: isoDate(row.atualizadoEm),
      explicitCnpj: context.accountCnpj,
      candidateName: text(row.nomeDestinatario),
      officialIdentifier: null,
      parties: [],
      movements: [],
      secrecy: typeof row.segredoJustica === "boolean" ? row.segredoJustica : null,
      rawMetadata: {
        numeroProcesso: processNumber,
        tribunalOrigem: tribunal,
        varaJudicial: text(row.varaJudicial),
        classe: text(row.classe),
        documentoDestinatario: context.accountCnpj,
      },
    });
  }

  const pageNumber = typeof paging?.pageNumber === "number" ? paging.pageNumber : 0;
  const totalPages = typeof paging?.totalPages === "number" ? paging.totalPages : list.length > 0 ? pageNumber + 1 : 0;
  const count = typeof paging?.count === "number" ? paging.count : list.length;
  return {
    page: { pageNumber, totalPages, count },
    communications,
    cases: [...cases.values()],
    rejectedRecipient,
    invalid,
    rejections,
  };
}
