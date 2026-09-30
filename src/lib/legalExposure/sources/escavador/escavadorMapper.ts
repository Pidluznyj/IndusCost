/**
 * Mapper complementar Escavador. Não inventa campo ausente.
 */

import type {
  LegalCasePole,
  NormalizedAttorney,
  NormalizedCaseObservation,
  NormalizedHearing,
  NormalizedMovement,
  NormalizedParty,
  NormalizedSourceBatch,
  NormalizedSubject,
} from "../../legalExposureContracts.js";
import { sanitizePayload } from "../../legalExposureNormalization.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function poleFrom(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (folded.includes("ATIVO") || folded.includes("AUTOR") || folded.includes("RECLAMANTE")) return "ACTIVE";
  if (folded.includes("PASSIVO") || folded.includes("REU") || folded.includes("RECLAMAD")) return "PASSIVE";
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}

function money(value: unknown): string | null {
  const rec = asRecord(value);
  if (rec) return money(rec.valor ?? rec.amount);
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  const raw = text(value);
  if (!raw) return null;
  if (raw.includes(",")) {
    const amount = Number(raw.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(amount) ? amount.toFixed(2) : null;
  }
  const amount = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

function fontesOf(root: Record<string, unknown>): Record<string, unknown>[] {
  const list = Array.isArray(root.fontes) ? root.fontes : [];
  return list.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => Boolean(row));
}

function collectEnvolvidos(root: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const top = root.envolvidos ?? root.partes;
  if (Array.isArray(top)) out.push(...top);
  for (const fonte of fontesOf(root)) {
    if (Array.isArray(fonte.envolvidos)) out.push(...fonte.envolvidos);
    const capa = asRecord(fonte.capa);
    if (capa && Array.isArray(capa.envolvidos)) out.push(...capa.envolvidos);
  }
  return out;
}

function partiesFrom(root: Record<string, unknown>): NormalizedParty[] {
  const out: NormalizedParty[] = [];
  const seen = new Set<string>();
  function push(name: string, document: string | null, pole: LegalCasePole, partyType: string | null) {
    const key = `${normalize(name)}:${(document ?? "").replace(/\D/g, "")}:${pole}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name,
      document,
      partyType,
      personType:
        document && document.replace(/\D/g, "").length === 14
          ? "COMPANY"
          : document && document.replace(/\D/g, "").length === 11
            ? "PERSON"
            : "UNKNOWN",
      pole,
    });
  }
  function normalize(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  for (const item of collectEnvolvidos(root)) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome) ?? text(row.nome_normalizado);
    if (!name) continue;
    const document = text(row.cpf) ?? text(row.cnpj) ?? text(row.documento) ?? text(asRecord(row.documento)?.numero);
    const poloRaw = row.polo ?? row.tipo_polo ?? row.tipo_normalizado ?? row.tipo;
    if (poleFrom(poloRaw) === "UNKNOWN" && foldIncludes(poloRaw, "ADVOGADO")) continue;
    push(name, document, poleFrom(poloRaw), text(row.tipo) ?? text(row.polo) ?? text(row.titulo));
  }
  if (!out.some((row) => row.pole === "ACTIVE")) {
    const title =
      text(root.titulo_polo_ativo) ??
      fontesOf(root)
        .map((fonte) => text(fonte.titulo_polo_ativo) ?? text(asRecord(fonte.capa)?.titulo_polo_ativo))
        .find(Boolean) ??
      null;
    if (title) push(title, null, "ACTIVE", "titulo_polo_ativo");
  }
  if (!out.some((row) => row.pole === "PASSIVE")) {
    const title =
      text(root.titulo_polo_passivo) ??
      fontesOf(root)
        .map((fonte) => text(fonte.titulo_polo_passivo) ?? text(asRecord(fonte.capa)?.titulo_polo_passivo))
        .find(Boolean) ??
      null;
    if (title) push(title, null, "PASSIVE", "titulo_polo_passivo");
  }
  return out;
}

function foldIncludes(value: unknown, token: string): boolean {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .includes(token);
}

function attorneysFrom(root: Record<string, unknown>): NormalizedAttorney[] {
  const buckets: unknown[] = Array.isArray(root.advogados) ? [...root.advogados] : [];
  for (const item of collectEnvolvidos(root)) {
    const row = asRecord(item);
    if (!row) continue;
    if (Array.isArray(row.advogados)) buckets.push(...row.advogados);
    if (foldIncludes(row.polo ?? row.tipo, "ADVOGADO") && text(row.nome)) buckets.push(row);
  }
  const out: NormalizedAttorney[] = [];
  const seen = new Set<string>();
  for (const item of buckets) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome);
    if (!name) continue;
    const oab = asRecord(row.oab) ?? row;
    const oabNumber = text(oab.numero) ?? text(row.oab_numero) ?? text(row.oab);
    const key = `${name}:${oabNumber ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      document: text(row.cpf) ?? text(row.documento),
      oabNumber,
      oabState: text(oab.uf) ?? text(row.oab_uf) ?? text(row.uf),
      representedPartyName: text(row.parte) ?? text(row.representado) ?? text(row.nome_parte),
      representedPartyDocument: text(row.documento_parte),
    });
  }
  return out;
}

function hearingsFrom(root: Record<string, unknown>): NormalizedHearing[] {
  const buckets: unknown[] = Array.isArray(root.audiencias) ? [...root.audiencias] : [];
  for (const fonte of fontesOf(root)) {
    if (Array.isArray(fonte.audiencias)) buckets.push(...fonte.audiencias);
    const capa = asRecord(fonte.capa);
    if (capa && Array.isArray(capa.audiencias)) buckets.push(...capa.audiencias);
  }
  const out: NormalizedHearing[] = [];
  for (const item of buckets) {
    const row = asRecord(item);
    if (!row) continue;
    out.push({
      type: text(row.tipo) ?? text(row.titulo),
      scheduledAt: isoDate(row.data) ?? isoDate(row.data_hora),
      status: text(row.situacao) ?? text(row.status),
      courtUnit: text(row.orgao) ?? text(row.unidade),
    });
  }
  return out;
}

function subjectsFrom(root: Record<string, unknown>): NormalizedSubject[] {
  const out: NormalizedSubject[] = [];
  const pushName = (name: string, code: string | null, fullPath: string | null, isMain: boolean) => {
    if (out.some((subject) => subject.name === name)) return;
    out.push({ code, name, fullPath, isMain });
  };
  const main = text(root.assunto) ?? text(asRecord(root.assunto)?.nome);
  if (main) pushName(main, null, null, true);
  for (const fonte of fontesOf(root)) {
    const capa = asRecord(fonte.capa);
    const capaAssunto = capa ? text(capa.assunto) ?? text(asRecord(capa.assunto)?.nome) : null;
    if (capaAssunto) pushName(capaAssunto, null, null, out.length === 0);
  }
  const extras = root.assuntos_normalizados ?? root.assuntos;
  if (Array.isArray(extras)) {
    for (const item of extras) {
      const row = asRecord(item);
      const name = row ? text(row.nome) ?? text(row.titulo) : text(item);
      if (!name) continue;
      pushName(name, row ? text(row.codigo) : null, row ? text(row.caminho) : null, false);
    }
  }
  return out;
}

function movementsFrom(body: unknown): NormalizedMovement[] {
  const root = asRecord(body);
  const items = root?.items ?? root?.movimentacoes ?? (Array.isArray(body) ? body : []);
  if (!Array.isArray(items)) return [];
  const out: NormalizedMovement[] = [];
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.conteudo) ?? text(row.texto) ?? text(row.descricao) ?? text(row.tipo);
    if (!name) continue;
    out.push({
      sourceCode: text(row.id) ?? text(row.codigo),
      name,
      occurredAt: isoDate(row.data) ?? isoDate(row.datahora),
      courtUnit: text(row.orgao) ?? text(row.unidade_origem),
      complements: sanitizePayload(row.complemento ?? null),
    });
  }
  return out;
}

export function mapEscavadorProcess(capaBody: unknown, movementsBody: unknown): NormalizedSourceBatch {
  const root = asRecord(capaBody);
  const processNumber =
    text(root?.numero_cnj) ?? text(root?.numero) ?? text(asRecord(root?.processo)?.numero_cnj);
  if (!root || !processNumber) {
    return {
      source: "ESCAVADOR",
      outcome: "INVALID_RESPONSE",
      errorCode: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta Escavador sem número CNJ.",
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const fonte = asRecord(Array.isArray(root.fontes) ? root.fontes[0] : root.fonte);
  const capa = asRecord(fonte?.capa);
  const unidade = asRecord(root.unidade_origem);
  const observation: NormalizedCaseObservation = {
    processNumber,
    tribunal: text(asRecord(root.estado_origem)?.sigla) ?? text(unidade?.tribunal_sigla) ?? text(fonte?.sigla) ?? text(root.uf) ?? text(root.tribunal),
    jurisdiction: text(fonte?.grau_formatado) ?? text(root.grau),
    degree: text(fonte?.grau) ?? text(fonte?.grau_formatado) ?? text(root.grau),
    courtUnit: text(unidade?.nome) ?? text(capa?.orgao_julgador) ?? text(root.unidade_origem) ?? text(fonte?.orgao) ?? text(root.orgao_julgador),
    classCode: null,
    className: text(capa?.classe) ?? text(root.classe) ?? text(fonte?.classe),
    filedAt: isoDate(root.data_inicio) ?? isoDate(fonte?.data_inicio) ?? isoDate(root.data_distribuicao),
    currentStatus: text(fonte?.status_predito) ?? text(root.situacao) ?? text(fonte?.situacao),
    entityPole: "UNKNOWN",
    sourceIdentifier: processNumber,
    sourceUpdatedAt: isoDate(root.data_ultima_movimentacao) ?? isoDate(fonte?.data_ultima_movimentacao) ?? isoDate(root.atualizado_em),
    explicitCnpj: null,
    candidateName: null,
    officialIdentifier: processNumber,
    parties: partiesFrom(root),
    movements: movementsFrom(movementsBody),
    subjects: subjectsFrom(root),
    attorneys: attorneysFrom(root),
    hearings: hearingsFrom(root),
    systemName: text(fonte?.sistema) ?? text(root.sistema),
    area: text(capa?.area) ?? text(root.area),
    claimValue: money(capa?.valor_causa ?? root.valor_causa ?? fonte?.valor_causa),
    claimCurrency: "BRL",
    archivedAt:
      fonte?.arquivado === true
        ? isoDate(fonte?.data_ultima_movimentacao) ?? isoDate(root.data_ultima_movimentacao)
        : isoDate(root.data_arquivamento),
    secrecy: typeof fonte?.segredo_justica === "boolean" ? fonte.segredo_justica : typeof root.segredo_justica === "boolean" ? root.segredo_justica : null,
    priority: text(root.prioridade),
    rawMetadata: sanitizePayload({ capa: root, complementary: true }),
  };
  return {
    source: "ESCAVADOR",
    outcome: "SUCCESS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: true,
    cases: [observation],
    communications: [],
    candidates: [],
  };
}

export function notConfiguredEscavadorBatch(): NormalizedSourceBatch {
  return {
    source: "ESCAVADOR",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "NOT_CONFIGURED",
    errorMessageSanitized: "Escavador desligado ou sem credencial.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}
