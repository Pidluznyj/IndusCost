/**
 * Campos automáticos do documento da política (browser-safe, sem Node).
 *
 * O texto gravado e o seu SHA-256 continuam com as lacunas do documento
 * original ("____/____/________", linhas de assinatura). Na hora de exibir ou
 * imprimir, as lacunas são preenchidas com dados reais do sistema:
 *  - data de aprovação  = data em que a versão foi publicada;
 *  - data de vigência   = vigência informada pelo administrador na publicação;
 *  - aprovação          = identificação de quem publicou (usuário autenticado);
 *  - termo de ciência   = usuário logado que assina, data e assinatura eletrônica;
 *  - Matriz de Referência do Anexo I = níveis comerciais congelados no snapshot
 *    normativo da versão (margem e comissão de referência de cada nível).
 * Ninguém digita nada: o usuário só confere e aceita.
 */
import type { PolicyBlock, PolicyChapter } from "./policyDocumentFormat.js";

export type PolicyAutoFieldContext = {
  versionLabel: string;
  /** ISO da publicação (= data de aprovação); nulo antes de publicar. */
  publishedAt: string | null;
  /** ISO da vigência; nulo enquanto não for informada na publicação. */
  effectiveFrom: string | null;
  /** Quem publicou a versão. */
  approver: { name: string; role: string } | null;
  /** Usuário logado que lê e assina; nulo em prévias administrativas. */
  signer: { name: string; email: string; role: string } | null;
  /** Aceite já registrado deste usuário para esta versão. */
  acceptance: { id: string; acceptedAt: string; evidenceHash: string } | null;
  /** Instante atual (ISO), para a data do termo antes da assinatura. */
  today: string;
  /**
   * Matriz de Referência da versão: a do snapshot normativo congelado na
   * publicação (ou a atual da Formação de Preço, em prévia antes de publicar).
   * Ausente/nula = ainda não disponível.
   */
  commissionMatrix?: PolicyCommissionMatrix | null;
};

/** Níveis comerciais de referência e a comissão de preço abaixo do Atacado. */
export type PolicyCommissionMatrix = {
  levels: Array<{ name: string; marginPercent: number; commissionPercent: number }>;
  belowLowestCommissionPercent: number;
};

/** Extrai a matriz de um snapshot normativo (de qualquer versão); nulo se o snapshot não a tiver. */
export function policyCommissionMatrixFromSnapshot(snapshot: unknown): PolicyCommissionMatrix | null {
  const matrix = (snapshot as { commissionMatrix?: unknown } | null | undefined)?.commissionMatrix as
    | { parameterized?: unknown; bands?: unknown; outOfTableCommissionPercent?: unknown }
    | undefined;
  if (!matrix || matrix.parameterized !== true || !Array.isArray(matrix.bands)) return null;
  const levels = matrix.bands.flatMap((band) => {
    const row = band as { name?: unknown; marginPercent?: unknown; commissionPercent?: unknown };
    return typeof row.name === "string" && typeof row.marginPercent === "number" && typeof row.commissionPercent === "number"
      ? [{ name: row.name, marginPercent: row.marginPercent, commissionPercent: row.commissionPercent }]
      : [];
  });
  if (levels.length === 0) return null;
  return {
    levels: [...levels].sort((a, b) => a.marginPercent - b.marginPercent),
    belowLowestCommissionPercent: typeof matrix.outOfTableCommissionPercent === "number" ? matrix.outOfTableCommissionPercent : 0,
  };
}

export function formatPolicyPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Cabeçalho da Matriz de Referência do Anexo I. */
export function isCommissionMatrixHeader(row: readonly string[] | undefined): boolean {
  return /^n[ií]vel comercial$/i.test((row?.[0] ?? "").trim());
}

const MATRIX_PENDING_ROW = ["definidos pela Formação de Preço vigente na publicação", "—", "—"];

/** Linhas da Matriz de Referência a partir do snapshot: os níveis e, por último, o preço abaixo do Atacado. */
export function commissionMatrixRows(matrix: PolicyCommissionMatrix | null | undefined): string[][] {
  if (!matrix || matrix.levels.length === 0) return [MATRIX_PENDING_ROW];
  const lowest = matrix.levels[0]!.name;
  return [
    ...matrix.levels.map((level) => [level.name, formatPolicyPercent(level.marginPercent), formatPolicyPercent(level.commissionPercent)]),
    [`Preço abaixo do ${lowest} (abaixo da tabela)`, "—", formatPolicyPercent(matrix.belowLowestCommissionPercent)],
  ];
}

const BLANK = /_{3,}(?:\s*\/\s*_{3,}\s*\/\s*_{3,})?/;
const isBlank = (text: string | undefined) => Boolean(text) && text!.replace(BLANK, "").trim() === "";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super administrador",
  ADMIN: "Administrador",
  SELLER: "Vendedor(a)",
  COMMERCIAL_MANAGER: "Gestor(a) comercial",
  VIEWER: "Usuário",
};

export function policyRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const SAO_PAULO = "America/Sao_Paulo";

export function formatPolicyDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, dateStyle: "short" }).format(date);
}

export function formatPolicyDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, dateStyle: "short", timeStyle: "short" }).format(date).replace(", ", " ");
}

const PENDING_PUBLICATION = "definida na publicação";

function signatureText(context: PolicyAutoFieldContext): string {
  const { signer, acceptance } = context;
  if (!signer) return "assinatura eletrônica do usuário logado, registrada ao concluir o aceite";
  const identity = `${signer.name} (${signer.email})`;
  if (!acceptance) {
    return `assinatura eletrônica de ${identity}, registrada ao concluir o aceite com reautenticação por senha e registro visual`;
  }
  return `assinado eletronicamente por ${identity} em ${formatPolicyDateTime(acceptance.acceptedAt)}, com reautenticação por senha e registro visual · aceite ${acceptance.id} · SHA-256 ${acceptance.evidenceHash}`;
}

function fillParagraph(text: string, context: PolicyAutoFieldContext): string {
  if (!BLANK.test(text)) return text;
  const { signer, acceptance, approver } = context;
  const effective = context.effectiveFrom ? formatPolicyDate(context.effectiveFrom) : `data ${PENDING_PUBLICATION}`;
  if (/^Profissional:/i.test(text)) return `Profissional: ${signer?.name ?? "usuário logado que assina (preenchido automaticamente)"}`;
  if (/^Função:/i.test(text)) return `Função: ${signer ? policyRoleLabel(signer.role) : "perfil do usuário que assina (preenchido automaticamente)"}`;
  if (/^Versão recebida:/i.test(text)) {
    const date = acceptance ? formatPolicyDate(acceptance.acceptedAt) : signer ? formatPolicyDate(context.today) : "data do aceite";
    return `Versão recebida: ${context.versionLabel}    Data: ${date}`;
  }
  if (/^Assinatura:/i.test(text)) return `Assinatura: ${signatureText(context)}`;
  if (/^Responsável pela apresentação\/entrega:/i.test(text)) {
    return `Responsável pela apresentação/entrega: IndusCost — publicação eletrônica${approver ? ` por ${approver.name}` : ""}`;
  }
  if (/vigente a partir de\s+_{3,}/i.test(text)) return text.replace(BLANK, effective);
  return text;
}

function fillRow(row: string[], context: PolicyAutoFieldContext): string[] {
  const label = (row[0] ?? "").trim();
  const rest = row.slice(1);
  if (rest.length === 0 || !rest.every(isBlank)) return row;
  if (/^data de aprova/i.test(label)) {
    return [row[0], context.publishedAt ? formatPolicyDate(context.publishedAt) : PENDING_PUBLICATION];
  }
  if (/^data de vig/i.test(label)) {
    return [row[0], context.effectiveFrom ? formatPolicyDate(context.effectiveFrom) : PENDING_PUBLICATION];
  }
  if (rest.length === 2 && /^diretoria$/i.test(label)) {
    const { approver, publishedAt } = context;
    return [
      row[0],
      approver ? `${approver.name} — ${policyRoleLabel(approver.role)}` : "quem publicar a versão (preenchido automaticamente)",
      approver && publishedAt
        ? `${formatPolicyDateTime(publishedAt)} · aprovação eletrônica por usuário autenticado no IndusCost`
        : "aprovação eletrônica registrada na publicação",
    ];
  }
  if (rest.length === 2 && /^supervisor comercial$/i.test(label)) {
    return [row[0], "—", "não se aplica: aprovação eletrônica única, registrada na publicação"];
  }
  return row;
}

function fillBlock(block: PolicyBlock, context: PolicyAutoFieldContext): PolicyBlock {
  if (block.type === "paragraph") {
    const text = fillParagraph(block.text, context);
    return text === block.text ? block : { ...block, text };
  }
  if (block.type === "table") {
    // Matriz de Referência: as linhas em branco dão lugar aos níveis do snapshot da versão.
    if (isCommissionMatrixHeader(block.rows[0]) && block.rows.slice(1).some((row) => row.every(isBlank))) {
      const filled = block.rows.slice(1).filter((row) => !row.every(isBlank));
      return { ...block, rows: [block.rows[0]!, ...filled, ...commissionMatrixRows(context.commissionMatrix)] };
    }
    const rows = block.rows.map((row) => fillRow(row, context));
    return rows.every((row, index) => row === block.rows[index]) ? block : { ...block, rows };
  }
  return block;
}

/** Capítulos com as lacunas preenchidas. Não altera o conteúdo gravado nem o hash. */
export function applyPolicyAutoFields(chapters: readonly PolicyChapter[], context: PolicyAutoFieldContext): PolicyChapter[] {
  return chapters.map((chapter) => {
    const blocks = chapter.blocks.map((block) => fillBlock(block, context));
    return blocks.every((block, index) => block === chapter.blocks[index]) ? chapter : { ...chapter, blocks };
  });
}
