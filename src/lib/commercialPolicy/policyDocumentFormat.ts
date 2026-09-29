/**
 * Formato textual do conteúdo de uma versão da política (browser-safe, sem Node).
 *
 * O `content` gravado na versão é uma marcação leve, linha a linha:
 *   `# Título`            início de capítulo (id = slug do título)
 *   `## Subtítulo`        título interno
 *   `- texto`             tópico
 *   `> Termo :: Definição` termo do glossário
 *   `| a | b |`           linha de tabela (linhas consecutivas formam uma tabela)
 *   `texto`               parágrafo
 * Linhas em branco separam blocos e encerram tabelas. Um conteúdo sem `# `
 * é lido como um único capítulo de parágrafos (versões manuais antigas).
 *
 * A mesma estrutura alimenta o leitor (vendedor e prévia), o editor
 * administrativo, o PDF e o texto plano usado nas conferências.
 */
import type { OfficialPolicyBlock, OfficialPolicyChapter } from "./official/polCom001V1Document.js";

export type PolicyBlock = OfficialPolicyBlock;
export type PolicyChapter = OfficialPolicyChapter;

export const POLICY_BLOCK_TYPE_LABELS: Record<PolicyBlock["type"], string> = {
  paragraph: "Parágrafo",
  heading: "Subtítulo",
  bullet: "Tópico",
  term: "Termo do glossário",
  table: "Tabela",
};

export function slugifyPolicyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Uma linha por bloco: quebras viram espaço; espaços internos são preservados (ex.: linhas de assinatura). */
function cleanLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}

export function serializePolicyChapters(chapters: readonly PolicyChapter[]): string {
  const lines: string[] = [];
  for (const chapter of chapters) {
    if (lines.length) lines.push("");
    lines.push(`# ${cleanLine(chapter.title)}`);
    for (const block of chapter.blocks) {
      if (block.type === "heading") lines.push(`## ${cleanLine(block.text)}`);
      else if (block.type === "bullet") lines.push(`- ${cleanLine(block.text)}`);
      else if (block.type === "term") lines.push(`> ${cleanLine(block.term)} :: ${cleanLine(block.definition)}`);
      else if (block.type === "table") {
        lines.push("");
        for (const row of block.rows) lines.push(`| ${row.map((cell) => cleanLine(cell).replace(/\|/g, "／")).join(" | ")} |`);
        lines.push("");
      } else lines.push(cleanLine(block.text));
    }
  }
  return lines.join("\n");
}

export function isPolicyMarkup(content: string): boolean {
  return /^# \S/m.test(content);
}

export function parsePolicyChapters(content: string): PolicyChapter[] {
  const chapters: PolicyChapter[] = [];
  let current: PolicyChapter | null = null;
  let table: string[][] | null = null;
  const ensureChapter = () => {
    if (!current) {
      current = { id: "documento", title: "Documento", blocks: [] };
      chapters.push(current);
    }
    return current;
  };
  const closeTable = () => {
    if (table && current) current.blocks.push({ type: "table", rows: table });
    table = null;
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("| ") || line === "|") {
      const cells = line.replace(/^\|\s?/, "").replace(/\s?\|$/, "").split(" | ").map((cell) => cell.trim());
      ensureChapter();
      table = table ?? [];
      table.push(cells);
      continue;
    }
    closeTable();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      current = { id: slugifyPolicyTitle(title) || `capitulo-${chapters.length + 1}`, title, blocks: [] };
      chapters.push(current);
      continue;
    }
    const chapter = ensureChapter();
    if (line.startsWith("## ")) chapter.blocks.push({ type: "heading", text: line.slice(3).trim() });
    else if (line.startsWith("- ")) chapter.blocks.push({ type: "bullet", text: line.slice(2).trim() });
    else if (line.startsWith("> ") && line.includes(" :: ")) {
      const [term, ...rest] = line.slice(2).split(" :: ");
      chapter.blocks.push({ type: "term", term: term.trim(), definition: rest.join(" :: ").trim() });
    } else chapter.blocks.push({ type: "paragraph", text: line.trim() });
  }
  closeTable();
  // Ids repetidos (títulos iguais) recebem sufixo para o índice e as perguntas continuarem endereçáveis.
  const seen = new Map<string, number>();
  for (const chapter of chapters) {
    const count = (seen.get(chapter.id) ?? 0) + 1;
    seen.set(chapter.id, count);
    if (count > 1) chapter.id = `${chapter.id}-${count}`;
  }
  return chapters;
}

/** Texto plano (uma célula/linha por linha), idêntico ao usado nas conferências com o DOCX. */
export function policyChaptersPlainText(chapters: readonly PolicyChapter[]): string {
  const lines: string[] = [];
  for (const chapter of chapters) {
    if (chapter.id !== "capa") lines.push(chapter.title);
    for (const block of chapter.blocks) {
      if (block.type === "term") lines.push(block.term, block.definition);
      else if (block.type === "table") for (const row of block.rows) lines.push(...row);
      else lines.push(block.text);
    }
  }
  return lines.join("\n");
}

/** Linhas para PDF/impressão a partir do conteúdo gravado (marcação ou texto plano). */
export function policyContentToPlainLines(content: string): string[] {
  if (!isPolicyMarkup(content)) return content.split(/\r?\n/);
  return policyChaptersPlainText(parsePolicyChapters(content)).split("\n");
}

export function emptyPolicyChapter(title = "Novo capítulo"): PolicyChapter {
  return { id: slugifyPolicyTitle(title), title, blocks: [{ type: "paragraph", text: "" }] };
}
