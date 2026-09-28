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
  "Ç": "\\307",
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

export function buildTextPdf(lines: string[]): Buffer {
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
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
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

export function buildControlledPolicyPdf(input: {
  lines: string[];
  copyId: string;
  recipientName: string;
  recipientEmail: string;
  generatedAt: string;
}): Buffer {
  const chunkSize = 26;
  const chunks: string[][] = [];
  for (let i = 0; i < input.lines.length; i += chunkSize) chunks.push(input.lines.slice(i, i + chunkSize));
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
      `(${escapePdfText("KOPPETEL / LAZARIOS")}) Tj T*`,
      `(${escapePdfText("POLÍTICA COMERCIAL E DE COMISSIONAMENTO")}) Tj T*`,
      `(${escapePdfText("POL-COM-001  VERSÃO 1.0")}) Tj T*`,
      `(${escapePdfText("DOCUMENTO CONTROLADO  ·  USO INTERNO E RESTRITO")}) Tj T*`,
      "ET",
      "BT /F1 9 Tf 40 748 Td 13 TL",
    ];
    for (const line of chunk) commands.push(`(${escapePdfText(line)}) Tj`, "T*");
    commands.push(
      "ET",
      "BT /F1 8 Tf 40 46 Td 10 TL",
      `(${escapePdfText("USO INTERNO E RESTRITO")}) Tj T*`,
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
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
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

export function policyDocumentLines(input: {
  title: string;
  version: number;
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string | null;
  content: string;
  summaryRules: string[];
}): string[] {
  return [
    "IndusCost — Política Comercial",
    input.title,
    `Versão ${input.version}`,
    `Vigência: ${input.effectiveFrom}`,
    `Publicação: ${input.publishedAt ?? "—"}`,
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
  version: number;
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
}): string[] {
  return [
    "IndusCost — Comprovante de aceite eletrônico",
    "Koppetel Comercio de Plásticos LTDA",
    "CNPJ 14.055.501/0001-80",
    "Documento controlado — uso interno e restrito",
    "Política Comercial",
    `Aceite: ${input.acceptanceId}`,
    `Documento: ${input.title}`,
    `Versão: ${input.version}`,
    `SHA-256 da política: ${input.policyHash}`,
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
