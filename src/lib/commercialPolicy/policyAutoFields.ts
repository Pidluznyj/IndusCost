/**
 * Campos automáticos do documento da política (browser-safe, sem Node).
 *
 * O texto gravado e o seu SHA-256 continuam com as lacunas do documento
 * original ("____/____/________", linhas de assinatura). Na hora de exibir ou
 * imprimir, as lacunas são preenchidas com dados reais do sistema:
 *  - data de aprovação  = data em que a versão foi publicada;
 *  - data de vigência   = vigência informada pelo administrador na publicação;
 *  - aprovação          = identificação de quem publicou (usuário autenticado);
 *  - termo de ciência   = usuário logado que assina, data e assinatura eletrônica.
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
};

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
