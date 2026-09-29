/** PDF textual simples (Helvetica/WinAnsi). A foto não entra no comprovante; só o hash. */

const WINANSI: Record<string, string> = {
  "á": "\\341",
  "à": "\\340",
  "â": "\\342",
  "ã": "\\343",
  "é": "\\351",
  "ê": "\\352",
  "í": "\\355",
  "ó": "\\363",
  "ô": "\\364",
  "õ": "\\365",
  "ú": "\\372",
  "ü": "\\374",
  "ç": "\\347",
  "Á": "\\301",
  "À": "\\300",
  "Â": "\\302",
  "Ã": "\\303",
  "É": "\\311",
  "Ê": "\\312",
  "Í": "\\315",
  "Ó": "\\323",
  "Ô": "\\324",
  "Õ": "\\325",
  "Ú": "\\332",
  "Ü": "\\334",
  "Ç": "\\307",
  "º": "\\272",
  "ª": "\\252",
  "§": "\\247",
  "·": "\\267",
  "×": "\\327",
  "–": "\\226",
  "—": "\\227",
  "‘": "\\221",
  "’": "\\222",
  "“": "\\223",
  "”": "\\224",
  "…": "\\205",
  "•": "\\225",
  "€": "\\200",
};

function escapePdfText(line: string): string {
  let out = "";
  for (const char of line) {
    if (char === "\\") out += "\\\\";
    else if (char === "(") out += "\\(";
    else if (char === ")") out += "\\)";
    else if (WINANSI[char]) out += WINANSI[char];
    else if (char.charCodeAt(0) < 128) out += char;
    else out += "?";
  }
  return out;
}

/** Quebra por palavra para caber na largura útil. Linhas longas sem espaço são cortadas. */
export function wrapPdfLines(lines: string[], maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (raw.length <= maxChars) {
      out.push(raw);
      continue;
    }
    let current = "";
    for (const word of raw.split(" ")) {
      let piece = word;
      while (piece.length > maxChars) {
        if (current) {
          out.push(current);
          current = "";
        }
        out.push(piece.slice(0, maxChars));
        piece = piece.slice(maxChars);
      }
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= maxChars) current = `${current} ${piece}`;
      else {
        out.push(current);
        current = piece;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function finishPdf(objects: string[], pageIds: number[], fontId: number, nextId: number): Buffer {
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  const lastId = nextId - 1;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id <= lastId; id += 1) {
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${lastId + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let id = 1; id <= lastId; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

export function buildTextPdf(input: string[]): Buffer {
  const lines = wrapPdfLines(input, 100);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 42) pages.push(lines.slice(i, i + 42));
  if (pages.length === 0) pages.push(["(vazio)"]);
  const fontId = 3;
  const objects: string[] = [];
  const pageIds: number[] = [];
  let nextId = 4;
  for (const page of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);
    const commands = ["BT", "/F1 10 Tf", "40 800 Td", "14 TL"];
    for (const line of page) commands.push(`(${escapePdfText(line)}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  return finishPdf(objects, pageIds, fontId, nextId);
}

export type ControlledCopyHeader = {
  company: string;
  title: string;
  code: string;
  versionLabel: string;
  classification: string;
};

export const CONTROLLED_COPY_DEFAULT_HEADER: ControlledCopyHeader = {
  company: "KOPPETEL / LAZARIOS",
  title: "POLÍTICA COMERCIAL E DE COMISSIONAMENTO",
  code: "POL-COM-001",
  versionLabel: "1.0",
  classification: "DOCUMENTO CONTROLADO  ·  USO INTERNO E RESTRITO",
};

/**
 * Cópia controlada: marca d'água, cabeçalho com código/versão/classificação,
 * rodapé com paginação, destinatário e código da cópia em todas as páginas.
 * O texto entra integral (com quebra de linha por largura), nunca truncado.
 */
export function buildControlledPolicyPdf(input: {
  lines: string[];
  copyId: string;
  recipientName: string;
  recipientEmail: string;
  generatedAt: string;
  header?: Partial<ControlledCopyHeader>;
  /** Marca adicional no rodapé, ex.: "PRÉVIA — VERSÃO NÃO PUBLICADA". */
  stamp?: string | null;
}): Buffer {
  const header = { ...CONTROLLED_COPY_DEFAULT_HEADER, ...(input.header ?? {}) };
  const lines = wrapPdfLines(input.lines, 108);
  const chunkSize = 48;
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize));
  if (chunks.length === 0) chunks.push(["(vazio)"]);
  const pageCount = chunks.length;
  const fontId = 3;
  const objects: string[] = [];
  const pageIds: number[] = [];
  let nextId = 4;
  chunks.forEach((chunk, index) => {
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);
    const pageNumber = index + 1;
    const commands = [
      "q",
      "0.86 g",
      "BT /F1 28 Tf 0.70 0.70 -0.70 0.70 78 300 Tm (USO INTERNO) Tj ET",
      "BT /F1 14 Tf 0.70 0.70 -0.70 0.70 108 250 Tm (COPIA CONTROLADA) Tj ET",
      "BT /F1 14 Tf 0.70 0.70 -0.70 0.70 128 214 Tm (NAO DISTRIBUIR) Tj ET",
      "Q",
      "0 g",
      "BT /F1 8 Tf 40 812 Td 11 TL",
      `(${escapePdfText(header.company)}) Tj T*`,
      `(${escapePdfText(header.title)}) Tj T*`,
      `(${escapePdfText(`${header.code}  VERSÃO ${header.versionLabel}`)}) Tj T*`,
      `(${escapePdfText(header.classification)}) Tj T*`,
      "ET",
      "BT /F1 8 Tf 40 762 Td 11 TL",
    ];
    for (const line of chunk) commands.push(`(${escapePdfText(line)}) Tj`, "T*");
    commands.push(
      "ET",
      "BT /F1 7 Tf 40 78 Td 9 TL",
      `(${escapePdfText(input.stamp ? `${input.stamp}  ·  USO INTERNO E RESTRITO` : "USO INTERNO E RESTRITO")}) Tj T*`,
      `(${escapePdfText("Proibida divulgação ou reprodução não autorizada")}) Tj T*`,
      `(${escapePdfText(`Página ${pageNumber} de ${pageCount}`)}) Tj T*`,
      `(${escapePdfText(`Gerado para: ${input.recipientName}`)}) Tj T*`,
      `(${escapePdfText(`Usuário: ${input.recipientEmail}`)}) Tj T*`,
      `(${escapePdfText(`Gerado em: ${input.generatedAt}`)}) Tj T*`,
      `(${escapePdfText(`Código da cópia: ${input.copyId}`)}) Tj T*`,
      "ET"
    );
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });
  return finishPdf(objects, pageIds, fontId, nextId);
}

export function policyDocumentLines(input: {
  title: string;
  /** Rótulo documental ("1.0"), não o número interno. */
  versionLabel: string;
  code?: string;
  company?: string;
  cnpj?: string;
  classification?: string;
  contentHash: string;
  effectiveFrom: string | null;
  publishedAt: string | null;
  content: string;
  summaryRules: string[];
}): string[] {
  return [
    "IndusCost — Política Comercial",
    input.title,
    ...(input.code ? [`Código: ${input.code}`] : []),
    `Versão ${input.versionLabel}`,
    ...(input.company ? [`Empresa: ${input.company}`] : []),
    ...(input.cnpj ? [`CNPJ: ${input.cnpj}`] : []),
    ...(input.classification ? [`Classificação: ${input.classification}`] : []),
    `Vigência: ${input.effectiveFrom ?? "—"}`,
    `Publicação: ${input.publishedAt ?? "— (não publicada)"}`,
    `SHA-256 do conteúdo: ${input.contentHash}`,
    "",
    ...input.content.split(/\r?\n/),
    "",
    "Principais regras",
    ...input.summaryRules.map((rule, index) => `${index + 1}. ${rule}`),
  ];
}

export function acceptanceReceiptLines(input: {
  acceptanceId: string;
  title: string;
  versionLabel: string;
  policyHash: string;
  signerName: string;
  signerEmail: string;
  role: string;
  externalSellerId: number | null;
  acceptedAt: string;
  ipAddress: string | null;
  declarations: string[];
  quizPassed: boolean;
  challengeId: string;
  photoHash: string;
  evidenceHash: string;
  normativeSnapshotHash?: string | null;
  changeSetHash?: string | null;
}): string[] {
  return [
    "IndusCost — Comprovante de aceite eletrônico",
    "Koppetel Comercio de Plásticos LTDA",
    "CNPJ 14.055.501/0001-80",
    "Documento controlado — uso interno e restrito",
    "Política Comercial",
    `Aceite: ${input.acceptanceId}`,
    `Documento: ${input.title}`,
    `Versão: ${input.versionLabel}`,
    `SHA-256 da política: ${input.policyHash}`,
    ...(input.normativeSnapshotHash ? [`SHA-256 do snapshot normativo: ${input.normativeSnapshotHash}`] : []),
    ...(input.changeSetHash ? [`SHA-256 do changeset: ${input.changeSetHash}`] : []),
    `Signatário: ${input.signerName}`,
    `E-mail: ${input.signerEmail}`,
    `Perfil: ${input.role}`,
    `Identificação Nomus: ${input.externalSellerId ?? "—"}`,
    `Data/hora do servidor: ${input.acceptedAt}`,
    `IP observado pelo servidor: ${input.ipAddress ?? "—"}`,
    `Teste de compreensão aprovado: ${input.quizPassed ? "sim" : "não"}`,
    `Reautenticação: ${input.challengeId}`,
    "Identidade confirmada mediante reautenticação.",
    "Registro visual realizado.",
    "Evidência visual: imagem armazenada em área privada. A fotografia não é impressa neste comprovante.",
    `SHA-256 da imagem: ${input.photoHash}`,
    `SHA-256 do pacote: ${input.evidenceHash}`,
    "",
    "Declarações aceitas",
    ...input.declarations,
  ];
}
