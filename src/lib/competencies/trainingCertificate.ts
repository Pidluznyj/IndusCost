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

export type CertificateSettingsInput = {
  signerName: string;
  signerRole: string;
  issuePlace: string;
  numberPrefix: string;
};

export type CertificateSettingsDto = {
  signerName: string | null;
  signerRole: string | null;
  issuePlace: string | null;
  numberPrefix: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

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
  const signerName = cleanText(b.signerName, CERTIFICATE_SIGNER_MAX);
  if (!signerName) return { ok: false, code: "INVALID_SIGNER", message: "Informe o nome de quem assina o certificado." };
  const signerRole = cleanText(b.signerRole, CERTIFICATE_SIGNER_MAX);
  if (!signerRole) return { ok: false, code: "INVALID_SIGNER_ROLE", message: "Informe o cargo de quem assina." };
  const issuePlace = cleanText(b.issuePlace, CERTIFICATE_PLACE_MAX);
  if (!issuePlace) return { ok: false, code: "INVALID_PLACE", message: "Informe o local de emissão (ex.: cidade – UF)." };
  const numberPrefix = typeof b.numberPrefix === "string" ? b.numberPrefix.trim().toUpperCase() : "";
  if (!CERTIFICATE_PREFIX_PATTERN.test(numberPrefix)) {
    return {
      ok: false,
      code: "INVALID_PREFIX",
      message: "Prefixo da numeração: até 16 caracteres entre letras, números e hífen (ex.: LK-TR).",
    };
  }
  return { ok: true, value: { signerName, signerRole, issuePlace, numberPrefix } };
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
  settings: Pick<CertificateSettingsDto, "signerName" | "signerRole" | "issuePlace" | "numberPrefix"> | null;
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
  if (!s?.signerName || !s.signerRole || !s.issuePlace || !s.numberPrefix) {
    out.push("Configure o signatário, o local de emissão e o prefixo da numeração dos certificados.");
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
// HTML do certificado (fiel ao modelo "Certificado Lazarios Koppetel")
// ---------------------------------------------------------------------------

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
  if (name.length > 48) return 32;
  if (name.length > 34) return 38;
  return 44;
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

function renderCertificatePage(p: TrainingCertificatePayload, index: number): string {
  const ringId = `sealRing-${index + 1}`;
  const logo = safeImageSrc(p.company.logoDataUrl);
  const hoursShort = formatHoursShort(p.training.workloadHours);
  const issueLine = `${p.issuePlace}, ${formatLongDatePtBr(p.issuedOn)}`;
  const footerIssueLine = `${p.issuePlace} · ${formatLongDatePtBr(p.issuedOn)}`;
  const seal = `${p.company.name.toUpperCase()} ◆ DESENVOLVIMENTO DE PESSOAS ◆ `;
  const aside = asideRows(p);
  const site = websiteLabel(p.company.website);
  const nameSize = participantNameSize(p.participant.name);

  const brand = logo
    ? `<img src="${esc(logo)}" alt="${esc(p.company.name)}" style="height:12mm;width:auto;max-width:70mm;object-fit:contain;display:block">`
    : `<span style="font-family:Ubuntu,sans-serif;font-size:18px;font-weight:500;letter-spacing:0.04em;color:#1254E0">${esc(p.company.name)}</span>`;

  const secondSignature = p.training.instructorName
    ? `<span style="font-family:Ubuntu,sans-serif;font-size:12px;font-weight:500;color:#343434">${esc(p.training.instructorName)}</span>
          <span style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#7A8290">Instrutor responsável</span>`
    : `<span style="font-family:Ubuntu,sans-serif;font-size:12px;font-weight:500;color:#343434">${esc(issueLine)}</span>
          <span style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#7A8290">Local e data</span>`;

  const rows = aside.rows
    .map(
      (r) => `<div style="display:grid;grid-template-columns:7mm minmax(0,1fr) auto;gap:2.5mm;align-items:baseline;padding:2.6mm 0;border-bottom:1px solid #E2EAFA">
            <span style="font-family:Ubuntu,sans-serif;font-size:10px;font-weight:500;color:#0A87F0">${esc(r.n)}</span>
            <span style="font-size:10.5px;line-height:1.35;color:#343434">${esc(r.title)}</span>
            <span style="font-family:Ubuntu,sans-serif;font-size:9.5px;color:#7A8290">${esc(r.hours)}</span>
          </div>`,
    )
    .join("\n          ");
  const note = aside.note
    ? `<p style="margin:3mm 0 0;font-size:9.5px;line-height:1.5;color:#5E6570">${esc(aside.note)}</p>`
    : "";

  return `<section class="page" data-certificate-number="${esc(p.number)}" style="position:relative;display:flex;flex-direction:column;width:297mm;height:210mm;padding:9mm 9mm 0;box-sizing:border-box;background-color:#0D3FB0;background-image:repeating-radial-gradient(circle at 0% 100%, rgba(255,255,255,0.07) 0 1px, transparent 1px 5px),repeating-radial-gradient(circle at 100% 0%, rgba(0,189,255,0.10) 0 1px, transparent 1px 5px);font-family:Lato,sans-serif;color:#343434;overflow:hidden">
  <div style="position:relative;flex:1;background:#FFFFFF;display:grid;grid-template-columns:minmax(0,1fr) 70mm;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,0.05)">
    <div style="position:absolute;inset:4.5mm;border:1px solid #C7D5F4;pointer-events:none"></div>
    <div style="position:absolute;inset:5.5mm;border:0.5px solid #E2EAFA;pointer-events:none"></div>
    <div style="position:absolute;left:4.5mm;top:4.5mm;width:2.4mm;height:2.4mm;background:#1254E0;transform:translate(-50%,-50%) rotate(45deg)"></div>
    <div style="position:absolute;right:4.5mm;top:4.5mm;width:2.4mm;height:2.4mm;background:#1254E0;transform:translate(50%,-50%) rotate(45deg)"></div>
    <div style="position:absolute;left:4.5mm;bottom:4.5mm;width:2.4mm;height:2.4mm;background:#1254E0;transform:translate(-50%,50%) rotate(45deg)"></div>
    <div style="position:absolute;right:4.5mm;bottom:4.5mm;width:2.4mm;height:2.4mm;background:#1254E0;transform:translate(50%,50%) rotate(45deg)"></div>
    <div style="position:absolute;left:-38mm;bottom:-38mm;width:90mm;height:90mm;border:1px solid #E2EAFA;transform:rotate(45deg)"></div>
    <div style="position:absolute;left:-30mm;bottom:-30mm;width:74mm;height:74mm;border:1px solid #EDF2F5;background:#F5F8FD;transform:rotate(45deg)"></div>

    <div style="position:relative;display:flex;flex-direction:column;padding:13mm 12mm 11mm 18mm;min-width:0">
      <div style="position:relative;display:flex;justify-content:space-between;align-items:center;gap:24px">
        ${brand}
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          <span style="font-family:Ubuntu,sans-serif;font-size:8px;font-weight:500;letter-spacing:0.22em;text-transform:uppercase;color:#7A8290">Registro nº</span>
          <span data-field="number" style="font-family:Ubuntu,sans-serif;font-size:11.5px;font-weight:500;color:#1254E0;letter-spacing:0.06em">${esc(p.number)}</span>
        </div>
      </div>

      <div style="position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4.5mm">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2mm">
          <span style="font-family:Ubuntu,sans-serif;font-size:42px;font-weight:300;line-height:1;letter-spacing:0.3em;text-transform:uppercase;color:#1254E0;padding-left:0.3em">Certificado</span>
          <span style="font-family:Ubuntu,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.42em;text-transform:uppercase;color:#0A87F0;padding-left:0.42em">de conclusão de curso</span>
        </div>
        <div style="display:flex;align-items:center;gap:3mm;width:70mm">
          <span style="flex:1;height:1px;background:#C7D5F4"></span>
          <span style="width:1.8mm;height:1.8mm;background:#00BDFF;transform:rotate(45deg)"></span>
          <span style="width:2.6mm;height:2.6mm;background:#1254E0;transform:rotate(45deg)"></span>
          <span style="width:1.8mm;height:1.8mm;background:#00BDFF;transform:rotate(45deg)"></span>
          <span style="flex:1;height:1px;background:#C7D5F4"></span>
        </div>
        <span style="font-size:13.5px;font-style:italic;color:#5E6570">A ${esc(p.company.name)} certifica que</span>
        <span data-field="participant" style="font-family:Lato,sans-serif;font-size:${nameSize}px;font-weight:300;line-height:1.05;letter-spacing:-0.01em;color:#0D2F80;text-wrap:balance;max-width:170mm">${esc(p.participant.name)}</span>
        <p style="margin:0;font-size:13px;line-height:1.7;color:#4A4F57;max-width:160mm;text-wrap:pretty">concluiu com êxito o curso <strong data-field="title" style="font-family:Ubuntu,sans-serif;font-weight:500;color:#1254E0">${esc(p.training.title)}</strong>, com carga horária total de <strong data-field="workload" style="font-weight:700;color:#343434">${esc(formatHoursLong(p.training.workloadHours))}</strong>, concluído em <strong data-field="completed" style="font-weight:700;color:#343434">${esc(formatLongDatePtBr(p.training.completedOn))}</strong>, demonstrando dedicação e compromisso com a excelência.</p>
      </div>

      <div style="position:relative;display:grid;grid-template-columns:minmax(0,1fr) 30mm minmax(0,1fr);gap:8mm;align-items:end">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:8px;border-top:1px solid #343434;text-align:center">
          <span data-field="signer" style="font-family:Ubuntu,sans-serif;font-size:12px;font-weight:500;color:#343434">${esc(p.signer.name)}</span>
          <span style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#7A8290">${esc(p.signer.role)}</span>
        </div>

        <div style="position:relative;width:30mm;height:30mm;justify-self:center">
          <svg viewBox="0 0 200 200" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
            <defs><path id="${ringId}" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"></path></defs>
            <circle cx="100" cy="100" r="98" fill="#1254E0"></circle>
            <circle cx="100" cy="100" r="92" fill="none" stroke="#00BDFF" stroke-width="1.2"></circle>
            <circle cx="100" cy="100" r="64" fill="#0D3FB0"></circle>
            <circle cx="100" cy="100" r="60" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-dasharray="2 3"></circle>
            <text style="font-family:Ubuntu,sans-serif;font-size:12.5px;font-weight:500;letter-spacing:2px;fill:#FFFFFF"><textPath href="#${ringId}" textLength="486" lengthAdjust="spacingAndGlyphs">${esc(seal)}</textPath></text>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#FFFFFF">
            <span style="font-family:Ubuntu,sans-serif;font-size:${hoursShort.length > 4 ? 18 : 24}px;font-weight:700;line-height:1">${esc(hoursShort)}</span>
            <span style="font-size:6.5px;letter-spacing:0.2em;text-transform:uppercase">formação</span>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:8px;border-top:1px solid #343434;text-align:center">
          ${secondSignature}
        </div>
      </div>
    </div>
    <aside style="position:relative;background:#F5F8FD;border-left:1px solid #E2EAFA;padding:13mm 9mm 11mm 9mm;display:flex;flex-direction:column;gap:5mm;overflow:hidden">
      <div style="position:absolute;right:-26mm;top:-26mm;width:56mm;height:56mm;border:1px solid #DCE5F7;transform:rotate(45deg)"></div>
      <div style="position:relative;display:flex;flex-direction:column;gap:2.5mm">
        <span style="font-family:Ubuntu,sans-serif;font-size:8px;font-weight:500;letter-spacing:0.28em;text-transform:uppercase;color:#0A87F0">${esc(aside.heading)}</span>
        <div style="display:flex;gap:1.6mm;align-items:center"><span style="width:1.8mm;height:1.8mm;background:#1254E0;transform:rotate(45deg)"></span><span style="width:1.3mm;height:1.3mm;background:#00BDFF;transform:rotate(45deg)"></span></div>
      </div>
      <div style="position:relative;flex:1;display:flex;flex-direction:column;justify-content:center">
          ${rows}
          ${note}
      </div>
      <div style="position:relative;display:flex;justify-content:space-between;align-items:baseline;gap:3mm;padding-top:2mm;border-top:2px solid #1254E0">
        <span style="font-family:Ubuntu,sans-serif;font-size:8px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#343434">Total</span>
        <span style="font-family:Ubuntu,sans-serif;font-size:14px;font-weight:700;color:#1254E0">${esc(hoursShort)}</span>
      </div>
    </aside>
  </div>

  <div style="height:9mm;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2mm;font-family:Ubuntu,sans-serif;font-size:7.5px;font-weight:500;letter-spacing:0.24em;text-transform:uppercase;color:#FFFFFF">
    <span>${esc(p.company.slogan ?? "")}</span>
    ${p.training.instructorName ? `<span>${esc(footerIssueLine)}</span>` : ""}
    <span>${esc(site ?? "")}</span>
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
