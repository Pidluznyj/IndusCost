/**
 * Certificados de treinamento — regras puras (browser-safe).
 *
 * Todo conteúdo do certificado vem do sistema:
 *   - participante, treinamento, competência, carga horária e conclusão → Competências;
 *   - empresa, logo, slogan e site → Identidade Visual (BrandingSettings);
 *   - signatário, local de emissão e prefixo da numeração → configuração de certificados;
 *   - conteúdo programático e instrutor → cadastro do treinamento.
 * A emissão congela esse conteúdo (payload + sha256); reabrir nunca reconsulta o cadastro.
 */

import { CERTIFICATE_BRAND_LOGO_DATA_URL, CERTIFICATE_BRAND_SYMBOL_DATA_URL } from "./trainingCertificateBrand";

export const CERTIFICATE_SYLLABUS_MAX_MODULES = 12;
export const CERTIFICATE_SYLLABUS_TITLE_MAX = 90;
export const CERTIFICATE_INSTRUCTOR_MAX = 120;
export const CERTIFICATE_SIGNER_MAX = 120;
export const CERTIFICATE_PLACE_MAX = 80;
export const CERTIFICATE_CANCEL_REASON_MAX = 500;
/** Prefixo da numeração: letras maiúsculas, dígitos e hífen (ex.: LK-TR → LK-TR-2026/0001). */
export const CERTIFICATE_PREFIX_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,14}[A-Z0-9])?$/;
export const TRAINING_CERTIFICATE_PAYLOAD_VERSION = 1;

export type SyllabusModule = { title: string; hours: number };

/** Local de emissão: sempre Curitiba – PR (não configurável). */
export const CERTIFICATE_ISSUE_PLACE = "Curitiba – PR";

/**
 * Quem assina: uma pessoa do sistema (nome e cargo vêm do cadastro) ou digitado manualmente.
 * Local e numeração não são informados: o local é fixo e o prefixo é gerado pelo sistema.
 */
export type CertificateSettingsInput =
  | { signerEmployeeId: string; signerName: null; signerRole: null }
  | { signerEmployeeId: null; signerName: string; signerRole: string };

export type CertificateSettingsDto = {
  signerSource: "EMPLOYEE" | "MANUAL" | null;
  signerEmployeeId: string | null;
  signerName: string | null;
  signerRole: string | null;
  /** Pessoa selecionada que deixou de estar ativa: emissão bloqueada até trocar. */
  signerInactive: boolean;
  issuePlace: string;
  /** Gerado na 1ª gravação e nunca mais alterado (numeração única e sequencial). */
  numberPrefix: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type CertificateSignerOptionDto = {
  employeeId: string;
  name: string;
  roleName: string | null;
  departmentName: string | null;
};

const PREFIX_STOPWORDS = new Set(["da", "de", "do", "das", "dos", "e", "ltda", "me", "sa", "s/a", "eireli"]);

/**
 * Prefixo da numeração a partir do nome da empresa (Identidade Visual):
 * iniciais sem acento + "-TR". "Lazarios Koppetel" → "LK-TR".
 */
export function deriveCertificatePrefix(companyName: string | null | undefined): string | null {
  const words = (companyName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Za-z0-9/]+/)
    .filter((w) => w && !PREFIX_STOPWORDS.has(w.toLowerCase()));
  const initials = words
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /[A-Z0-9]/.test(c))
    .join("")
    .slice(0, 6);
  if (!initials) return null;
  const prefix = `${initials}-TR`;
  return CERTIFICATE_PREFIX_PATTERN.test(prefix) ? prefix : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max ? t : null;
}

/** Horas em décimos (0,5 h = 5): soma exata, sem ponto flutuante. */
function toTenths(hours: number): number {
  return Math.round(hours * 10);
}

/**
 * Conteúdo programático: até 12 módulos, horas em passos de 0,5 h.
 * Lista vazia = sem conteúdo programático (o certificado mostra a competência desenvolvida).
 */
export function parseSyllabus(value: unknown): Parsed<SyllabusModule[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, code: "INVALID_SYLLABUS", message: "Conteúdo programático inválido." };
  if (value.length > CERTIFICATE_SYLLABUS_MAX_MODULES) {
    return {
      ok: false,
      code: "INVALID_SYLLABUS",
      message: `Conteúdo programático aceita até ${CERTIFICATE_SYLLABUS_MAX_MODULES} módulos.`,
    };
  }
  const out: SyllabusModule[] = [];
  for (const [i, item] of value.entries()) {
    const raw = (item ?? {}) as { title?: unknown; hours?: unknown };
    const title = cleanText(raw.title, CERTIFICATE_SYLLABUS_TITLE_MAX);
    if (!title) {
      return {
        ok: false,
        code: "INVALID_SYLLABUS",
        message: `Módulo ${i + 1}: título obrigatório (até ${CERTIFICATE_SYLLABUS_TITLE_MAX} caracteres).`,
      };
    }
    const hours = typeof raw.hours === "string" ? Number(raw.hours.replace(",", ".")) : raw.hours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > 2000 || toTenths(hours) % 5 !== 0) {
      return {
        ok: false,
        code: "INVALID_SYLLABUS",
        message: `Módulo ${i + 1}: carga em horas maior que zero, em passos de 0,5 h.`,
      };
    }
    out.push({ title, hours: toTenths(hours) / 10 });
  }
  return { ok: true, value: out };
}

/** Leitura tolerante do JSON gravado (linhas inválidas são descartadas). */
export function readStoredSyllabus(value: unknown): SyllabusModule[] {
  const parsed = parseSyllabus(Array.isArray(value) ? value.slice(0, CERTIFICATE_SYLLABUS_MAX_MODULES) : null);
  return parsed.ok ? parsed.value : [];
}

export function syllabusTotalHours(modules: readonly SyllabusModule[]): number {
  return modules.reduce((sum, m) => sum + toTenths(m.hours), 0) / 10;
}

/** Com módulos, a soma precisa fechar com a carga horária do treinamento. */
export function syllabusMatchesWorkload(modules: readonly SyllabusModule[], workloadHours: number): boolean {
  return modules.length === 0 || modules.reduce((sum, m) => sum + toTenths(m.hours), 0) === toTenths(workloadHours);
}

export function parseInstructorName(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, value: null };
  }
  const name = cleanText(value, CERTIFICATE_INSTRUCTOR_MAX);
  return name
    ? { ok: true, value: name }
    : { ok: false, code: "INVALID_INSTRUCTOR", message: `Instrutor: até ${CERTIFICATE_INSTRUCTOR_MAX} caracteres.` };
}

export function parseCertificateSettingsBody(body: unknown): Parsed<CertificateSettingsInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_BODY", message: "Corpo da requisição inválido." };
  }
  const b = body as Record<string, unknown>;
  // Local e prefixo não são aceitos do cliente (fixo / gerado pelo sistema): campos extras são ignorados.
  if (b.signerEmployeeId !== undefined && b.signerEmployeeId !== null && b.signerEmployeeId !== "") {
    const id = typeof b.signerEmployeeId === "string" ? b.signerEmployeeId.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      return { ok: false, code: "INVALID_SIGNER", message: "Pessoa inválida." };
    }
    return { ok: true, value: { signerEmployeeId: id, signerName: null, signerRole: null } };
  }
  const signerName = cleanText(b.signerName, CERTIFICATE_SIGNER_MAX);
  if (!signerName) return { ok: false, code: "INVALID_SIGNER", message: "Selecione uma pessoa ou informe o nome de quem assina." };
  const signerRole = cleanText(b.signerRole, CERTIFICATE_SIGNER_MAX);
  if (!signerRole) return { ok: false, code: "INVALID_SIGNER_ROLE", message: "Informe o cargo de quem assina." };
  return { ok: true, value: { signerEmployeeId: null, signerName, signerRole } };
}

export function parseCancelReason(body: unknown): Parsed<string> {
  const reason = cleanText((body as { reason?: unknown } | null)?.reason, CERTIFICATE_CANCEL_REASON_MAX);
  return reason
    ? { ok: true, value: reason }
    : { ok: false, code: "INVALID_REASON", message: "Informe o motivo do cancelamento." };
}

export function formatCertificateNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}/${String(sequence).padStart(4, "0")}`;
}

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10-10" → "10 de outubro de 2026" (determinístico, sem Intl). */
export function formatLongDatePtBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MONTHS_PT[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

function hoursNumber(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours).replace(".", ",");
}

/** 16 → "16h"; 1.5 → "1,5h". */
export function formatHoursShort(hours: number): string {
  return `${hoursNumber(hours)}h`;
}

/** 16 → "16 horas"; 1 → "1 hora"; 1.5 → "1,5 hora". */
export function formatHoursLong(hours: number): string {
  return `${hoursNumber(hours)} ${hours >= 2 ? "horas" : "hora"}`;
}

export type TrainingCertificatePayload = {
  version: typeof TRAINING_CERTIFICATE_PAYLOAD_VERSION;
  number: string;
  /** Data de negócio da emissão (America/Sao_Paulo). */
  issuedOn: string;
  company: {
    name: string;
    slogan: string | null;
    website: string | null;
    logoDataUrl: string | null;
  };
  participant: { employeeId: string; name: string };
  training: {
    id: string;
    title: string;
    competencyName: string;
    competencyDescription: string | null;
    modality: string;
    workloadHours: number;
    startDate: string;
    completedOn: string;
    instructorName: string | null;
  };
  syllabus: SyllabusModule[];
  signer: { name: string; role: string };
  issuePlace: string;
};

export type CertificateTrainingFacts = {
  status: string;
  workloadHours: number;
  syllabus: SyllabusModule[];
};

/** Impedimentos de emissão do treinamento (iguais para todos os participantes). */
export function trainingCertificateBlockers(input: {
  training: CertificateTrainingFacts;
  settings: Pick<CertificateSettingsDto, "signerName" | "signerRole" | "signerInactive" | "numberPrefix"> | null;
  companyName: string | null;
}): string[] {
  const out: string[] = [];
  if (input.training.status !== "COMPLETED") out.push("O treinamento ainda não foi concluído.");
  if (!(input.training.workloadHours > 0)) out.push("O treinamento não tem carga horária.");
  if (!syllabusMatchesWorkload(input.training.syllabus, input.training.workloadHours)) {
    out.push(
      `A soma do conteúdo programático (${formatHoursShort(syllabusTotalHours(input.training.syllabus))}) difere da carga horária (${formatHoursShort(input.training.workloadHours)}).`,
    );
  }
  const s = input.settings;
  if (s?.signerInactive) {
    out.push("A pessoa selecionada para assinar não está mais ativa. Escolha outra em Assinatura e numeração.");
  } else if (!s?.signerName || !s.signerRole || !s.numberPrefix) {
    out.push("Configure quem assina os certificados (Assinatura e numeração).");
  }
  if (!input.companyName) out.push("Cadastre o nome da empresa em Administração › Identidade Visual.");
  return out;
}

export function websiteLabel(website: string | null | undefined): string | null {
  const t = website?.trim();
  if (!t) return null;
  return t.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null;
}

// ---------------------------------------------------------------------------
// HTML do certificado — layout premium na identidade Lazarios Koppetel
// (azul profundo #1455E0 → azul #0A8CFF → ciano #00BDFF, Ubuntu + Lato, logo oficial).
// ---------------------------------------------------------------------------

const BRAND = {
  deep: "#1455E0",
  blue: "#0A8CFF",
  cyan: "#00BDFF",
  navy: "#0B2A6F",
  ink: "#2B3240",
  muted: "#6B7383",
  hair: "#D6E3FA",
  mist: "#F4F8FF",
};

const MODALITY_LABELS: Record<string, string> = {
  IN_PERSON: "Presencial",
  ONLINE: "Online",
  ON_THE_JOB: "No posto de trabalho",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só data:image/* entra no `src` (nunca URL externa). */
function safeImageSrc(src: string | null): string | null {
  return src && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(src.trim()) ? src.trim() : null;
}

function participantNameSize(name: string): number {
  if (name.length > 48) return 34;
  if (name.length > 34) return 40;
  return 48;
}

function formatShortDateBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

type AsideRow = { n: string; title: string; hours: string };

function asideRows(p: TrainingCertificatePayload): { heading: string; rows: AsideRow[]; note: string | null } {
  if (p.syllabus.length > 0) {
    return {
      heading: "Conteúdo programático",
      rows: p.syllabus.map((m, i) => ({ n: String(i + 1).padStart(2, "0"), title: m.title, hours: formatHoursShort(m.hours) })),
      note: null,
    };
  }
  return {
    heading: "Competência desenvolvida",
    rows: [{ n: "01", title: p.training.competencyName, hours: formatHoursShort(p.training.workloadHours) }],
    note: p.training.competencyDescription,
  };
}

/** Borda recortada do selo (roseta): `teeth` dentes entre os raios `outer` e `inner`. */
function rosettePath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / teeth - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Guilhoché: elipses finas girando em torno do centro (fundo de segurança, bem discreto). */
function guillochePattern(id: string): string {
  const rings: string[] = [];
  for (let i = 0; i < 36; i++) {
    rings.push(`<ellipse cx="0" cy="0" rx="150" ry="58" transform="rotate(${i * 5})" />`);
  }
  return `<svg viewBox="-160 -160 320 320" preserveAspectRatio="xMidYMid slice" style="position:absolute;left:96mm;top:22mm;width:150mm;height:150mm;opacity:0.35" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.cyan}" /><stop offset="1" stop-color="${BRAND.deep}" /></linearGradient></defs>
      <g fill="none" stroke="url(#${id})" stroke-width="0.3" opacity="0.12">${rings.join("")}</g>
    </svg>`;
}

function renderSeal(p: TrainingCertificatePayload, idx: number): string {
  const hours = formatHoursShort(p.training.workloadHours);
  const ring = `sealRing-${idx}`;
  const grad = `sealGrad-${idx}`;
  const seal = `${p.company.name.toUpperCase()} ◆ DESENVOLVIMENTO DE PESSOAS ◆ `;
  return `<div style="position:relative;width:34mm;height:34mm;justify-self:center">
          <svg viewBox="0 0 200 200" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" aria-hidden="true">
            <defs>
              <linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="${BRAND.cyan}" />
                <stop offset="0.5" stop-color="${BRAND.blue}" />
                <stop offset="1" stop-color="${BRAND.deep}" />
              </linearGradient>
              <path id="${ring}" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0"></path>
            </defs>
            <path d="${rosettePath(100, 100, 99, 92, 36)}" fill="url(#${grad})" />
            <circle cx="100" cy="100" r="88" fill="none" stroke="#FFFFFF" stroke-opacity="0.75" stroke-width="0.8" />
            <circle cx="100" cy="100" r="60" fill="${BRAND.navy}" fill-opacity="0.25" />
            <circle cx="100" cy="100" r="58" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-dasharray="1.5 2.5" />
            <text style="font-family:Ubuntu,sans-serif;font-size:11.5px;font-weight:500;letter-spacing:1.6px;fill:#FFFFFF"><textPath href="#${ring}" textLength="462" lengthAdjust="spacingAndGlyphs">${esc(seal)}</textPath></text>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#FFFFFF">
            <span style="font-family:Ubuntu,sans-serif;font-size:${hours.length > 4 ? 18 : 25}px;font-weight:700;line-height:1">${esc(hours)}</span>
            <span style="margin-top:2px;font-family:Ubuntu,sans-serif;font-size:6px;font-weight:500;letter-spacing:0.28em;text-transform:uppercase">formação</span>
          </div>
        </div>`;
}

function fact(label: string, value: string, field: string): string {
  return `<div style="display:flex;flex-direction:column;gap:1.2mm;padding:0 6mm;border-left:1px solid ${BRAND.hair}">
            <span style="font-family:Ubuntu,sans-serif;font-size:7px;font-weight:500;letter-spacing:0.24em;text-transform:uppercase;color:${BRAND.muted}">${esc(label)}</span>
            <span data-field="${field}-fact" style="font-family:Ubuntu,sans-serif;font-size:12.5px;font-weight:500;color:${BRAND.navy}">${esc(value)}</span>
          </div>`;
}

function signature(name: string, role: string, field?: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:1mm;text-align:center">
          <span style="width:100%;height:1px;background:linear-gradient(90deg,transparent,${BRAND.navy} 18%,${BRAND.navy} 82%,transparent);margin-bottom:2mm"></span>
          <span ${field ? `data-field="${field}" ` : ""}style="font-family:Ubuntu,sans-serif;font-size:12.5px;font-weight:500;color:${BRAND.ink}">${esc(name)}</span>
          <span style="font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND.muted}">${esc(role)}</span>
        </div>`;
}

function renderCertificatePage(p: TrainingCertificatePayload, index: number): string {
  const idx = index + 1;
  const logo = safeImageSrc(p.company.logoDataUrl) ?? CERTIFICATE_BRAND_LOGO_DATA_URL;
  const symbol = CERTIFICATE_BRAND_SYMBOL_DATA_URL;
  const issueLine = `${p.issuePlace}, ${formatLongDatePtBr(p.issuedOn)}`;
  const footerIssueLine = `${p.issuePlace} · ${formatLongDatePtBr(p.issuedOn)}`;
  const aside = asideRows(p);
  const site = websiteLabel(p.company.website);
  const nameSize = participantNameSize(p.participant.name);
  const modality = MODALITY_LABELS[p.training.modality] ?? p.training.modality;

  const second = p.training.instructorName
    ? signature(p.training.instructorName, "Instrutor responsável")
    : signature(issueLine, "Local e data");

  const rows = aside.rows
    .map(
      (r) => `<div style="display:grid;grid-template-columns:8mm minmax(0,1fr) auto;gap:2.5mm;align-items:baseline;padding:2.4mm 0;border-bottom:1px solid ${BRAND.hair}">
            <span style="font-family:Ubuntu,sans-serif;font-size:9.5px;font-weight:700;color:${BRAND.blue}">${esc(r.n)}</span>
            <span style="font-size:10.5px;line-height:1.35;color:${BRAND.ink}">${esc(r.title)}</span>
            <span style="font-family:Ubuntu,sans-serif;font-size:9.5px;font-weight:500;color:${BRAND.muted}">${esc(r.hours)}</span>
          </div>`,
    )
    .join("\n          ");
  const note = aside.note
    ? `<p style="margin:3mm 0 0;font-size:9.5px;line-height:1.55;color:${BRAND.muted}">${esc(aside.note)}</p>`
    : "";

  return `<section class="page" data-certificate-number="${esc(p.number)}" style="position:relative;width:297mm;height:210mm;box-sizing:border-box;overflow:hidden;background:#FFFFFF;font-family:Lato,sans-serif;color:${BRAND.ink}">
  ${guillochePattern(`guilloche-${idx}`)}
  <img src="${esc(symbol)}" alt="" aria-hidden="true" style="position:absolute;right:-14mm;bottom:-30mm;height:150mm;width:auto;opacity:0.045">

  <!-- faixa da marca -->
  <div style="position:absolute;left:0;top:0;bottom:0;width:13mm;background:linear-gradient(0deg,${BRAND.deep} 0%,${BRAND.blue} 55%,${BRAND.cyan} 100%)">
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
      <span style="writing-mode:vertical-rl;transform:rotate(180deg);font-family:Ubuntu,sans-serif;font-size:7.5px;font-weight:500;letter-spacing:0.5em;text-transform:uppercase;color:rgba(255,255,255,0.9);white-space:nowrap">${esc(p.company.name)} · Desenvolvimento de pessoas</span>
    </div>
  </div>
  <div style="position:absolute;left:13mm;top:0;bottom:0;width:1.1mm;background:linear-gradient(0deg,${BRAND.cyan},rgba(0,189,255,0.15))"></div>

  <!-- moldura fina -->
  <div style="position:absolute;top:8mm;right:8mm;bottom:8mm;left:21mm;border:0.35mm solid rgba(20,85,224,0.45);pointer-events:none"></div>
  <div style="position:absolute;top:9.6mm;right:9.6mm;bottom:9.6mm;left:22.6mm;border:0.2mm solid rgba(0,189,255,0.35);pointer-events:none"></div>

  <div style="position:absolute;top:8mm;right:8mm;bottom:8mm;left:21mm;display:grid;grid-template-columns:minmax(0,1fr) 66mm">
    <div style="position:relative;display:flex;flex-direction:column;padding:11mm 12mm 8mm 14mm;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
        <img src="${esc(logo)}" alt="${esc(p.company.name)}" style="height:16mm;width:auto;max-width:80mm;object-fit:contain;display:block">
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1.2mm;text-align:right">
          <span style="font-family:Ubuntu,sans-serif;font-size:7px;font-weight:500;letter-spacing:0.28em;text-transform:uppercase;color:${BRAND.muted}">Registro nº</span>
          <span data-field="number" style="font-family:Ubuntu,sans-serif;font-size:12.5px;font-weight:700;letter-spacing:0.08em;color:${BRAND.deep}">${esc(p.number)}</span>
          <span style="font-size:8px;color:${BRAND.muted}">Emitido em ${esc(formatShortDateBr(p.issuedOn))}</span>
        </div>
      </div>

      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:3.6mm">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2.2mm">
          <span style="font-family:Ubuntu,sans-serif;font-size:46px;font-weight:300;line-height:1;letter-spacing:0.32em;text-transform:uppercase;padding-left:0.32em;background:linear-gradient(90deg,${BRAND.deep},${BRAND.blue} 55%,${BRAND.cyan});-webkit-background-clip:text;background-clip:text;color:transparent">Certificado</span>
          <span style="font-family:Ubuntu,sans-serif;font-size:10.5px;font-weight:500;letter-spacing:0.46em;text-transform:uppercase;padding-left:0.46em;color:${BRAND.blue}">de conclusão de curso</span>
        </div>
        <div style="display:flex;align-items:center;gap:2.5mm;width:84mm" aria-hidden="true">
          <span style="flex:1;height:1px;background:linear-gradient(90deg,transparent,${BRAND.hair})"></span>
          <span style="width:1.6mm;height:1.6mm;background:${BRAND.cyan};transform:rotate(45deg)"></span>
          <span style="width:2.4mm;height:2.4mm;background:${BRAND.deep};transform:rotate(45deg)"></span>
          <span style="width:1.6mm;height:1.6mm;background:${BRAND.cyan};transform:rotate(45deg)"></span>
          <span style="flex:1;height:1px;background:linear-gradient(90deg,${BRAND.hair},transparent)"></span>
        </div>
        <span style="font-size:13px;font-style:italic;letter-spacing:0.02em;color:${BRAND.muted}">A ${esc(p.company.name)} certifica que</span>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2.4mm">
          <span data-field="participant" style="font-family:Lato,sans-serif;font-size:${nameSize}px;font-weight:300;line-height:1.05;letter-spacing:-0.01em;color:${BRAND.navy};text-wrap:balance;max-width:168mm">${esc(p.participant.name)}</span>
          <span style="width:96mm;height:0.5mm;border-radius:1mm;background:linear-gradient(90deg,transparent,${BRAND.blue} 20%,${BRAND.cyan} 80%,transparent)" aria-hidden="true"></span>
        </div>
        <p style="margin:0;font-size:12.5px;line-height:1.75;color:#4A5160;max-width:158mm;text-wrap:pretty">concluiu com êxito o curso <strong data-field="title" style="font-family:Ubuntu,sans-serif;font-weight:500;color:${BRAND.deep}">${esc(p.training.title)}</strong>, com carga horária total de <strong data-field="workload" style="font-weight:700;color:${BRAND.ink}">${esc(formatHoursLong(p.training.workloadHours))}</strong>, concluído em <strong data-field="completed" style="font-weight:700;color:${BRAND.ink}">${esc(formatLongDatePtBr(p.training.completedOn))}</strong>, demonstrando dedicação e compromisso com a excelência.</p>
        <div style="display:flex;align-items:stretch;justify-content:center;margin-top:1mm">
          ${fact("Carga horária", formatHoursLong(p.training.workloadHours), "workload")}
          ${fact("Concluído em", formatShortDateBr(p.training.completedOn), "completed")}
          ${fact("Modalidade", modality, "modality")}
          <span style="border-left:1px solid ${BRAND.hair}"></span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 34mm minmax(0,1fr);gap:9mm;align-items:end">
        ${signature(p.signer.name, p.signer.role, "signer")}
        ${renderSeal(p, idx)}
        ${second}
      </div>

      <div style="margin-top:5mm;display:flex;justify-content:space-between;align-items:center;gap:12px;font-family:Ubuntu,sans-serif;font-size:7px;font-weight:500;letter-spacing:0.22em;text-transform:uppercase;color:${BRAND.muted}">
        <span>${esc(p.company.slogan ?? "")}</span>
        <span>${esc(footerIssueLine)}</span>
        <span style="color:${BRAND.deep}">${esc(site ?? "")}</span>
      </div>
    </div>

    <aside style="position:relative;display:flex;flex-direction:column;gap:5mm;padding:12mm 8mm 10mm 8mm;background:linear-gradient(180deg,${BRAND.mist},#EAF2FF);border-left:1px solid ${BRAND.hair};overflow:hidden">
      <div style="display:flex;flex-direction:column;gap:2.5mm">
        <span style="font-family:Ubuntu,sans-serif;font-size:7.5px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${BRAND.blue}">${esc(aside.heading)}</span>
        <span style="width:12mm;height:0.6mm;background:linear-gradient(90deg,${BRAND.deep},${BRAND.cyan})" aria-hidden="true"></span>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-start;padding-top:3mm">
          ${rows}
          ${note}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:3mm;padding-top:2.5mm;border-top:0.5mm solid ${BRAND.deep}">
        <span style="font-family:Ubuntu,sans-serif;font-size:7.5px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${BRAND.ink}">Total</span>
        <span style="font-family:Ubuntu,sans-serif;font-size:15px;font-weight:700;color:${BRAND.deep}">${esc(formatHoursShort(p.training.workloadHours))}</span>
      </div>
    </aside>
  </div>
</section>`;
}

/**
 * Documento HTML A4 paisagem com uma página por certificado.
 * `fontFaceCss` traz as @font-face de Lato e Ubuntu (arquivos embutidos no sistema).
 */
export function renderTrainingCertificatesHtml(
  payloads: readonly TrainingCertificatePayload[],
  options: { title: string; fontFaceCss?: string },
): string {
  const pages = payloads.map((p, i) => renderCertificatePage(p, i)).join("\n");
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<title>${esc(options.title)}</title>
<style>${options.fontFaceCss ?? ""}
@page { size: A4 landscape; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { background: #E5E7EB; }
.page { margin: 0 auto 8mm; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
@media print { body { background: none; } .page { margin: 0; } }
</style>
</head><body>
${pages}
</body></html>`;
}
