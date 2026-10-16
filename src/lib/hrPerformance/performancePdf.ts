/**
 * PDF texto simples, sem biblioteca externa.
 * O conteúdo fica no fluxo da página para o teste conferir o texto.
 */

const WIN1252: Record<string, number> = {
  á: 0xe1, à: 0xe0, â: 0xe2, ã: 0xe3, ä: 0xe4,
  é: 0xe9, è: 0xe8, ê: 0xea, ë: 0xeb,
  í: 0xed, ì: 0xec, î: 0xee,
  ó: 0xf3, ò: 0xf2, ô: 0xf4, õ: 0xf5,
  ú: 0xfa, ù: 0xf9, û: 0xfb, ü: 0xfc,
  ç: 0xe7, ñ: 0xf1,
  Á: 0xc1, À: 0xc0, Â: 0xc2, Ã: 0xc3,
  É: 0xc9, Ê: 0xca, Í: 0xcd, Ó: 0xd3, Ô: 0xd4, Õ: 0xd5,
  Ú: 0xda, Ç: 0xc7,
  "º": 0xba, "ª": 0xaa,
};

function encodeLine(text: string): Buffer {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const bytes: number[] = [];
  for (const char of escaped) {
    const code = char.codePointAt(0) ?? 63;
    if (code < 128) bytes.push(code);
    else if (WIN1252[char] != null) bytes.push(WIN1252[char]);
    else bytes.push(63);
  }
  return Buffer.from(bytes);
}

export function buildPlainPdf(title: string, lines: readonly string[]): Buffer {
  const body = [title, "IndusCost · documento interno de RH · regras de corte em proposta", "", ...lines];
  const chunks: string[][] = [];
  for (let index = 0; index < body.length; index += 40) chunks.push(body.slice(index, index + 40));
  if (chunks.length === 0) chunks.push([title]);

  const objects: Buffer[] = [];
  const add = (source: string | Buffer) => {
    objects.push(Buffer.isBuffer(source) ? source : Buffer.from(source, "latin1"));
  };

  add("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = chunks.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  add(`<< /Type /Pages /Count ${chunks.length} /Kids [${kids}] >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  chunks.forEach((pageLines, index) => {
    const commands: Buffer[] = [Buffer.from("BT /F1 11 Tf 48 800 Td 14 TL\n", "latin1")];
    pageLines.forEach((line, lineIndex) => {
      commands.push(Buffer.concat([Buffer.from("(", "latin1"), encodeLine(line.slice(0, 110)), Buffer.from(lineIndex === 0 ? ") Tj T*\n" : ") Tj T*\n", "latin1")]));
    });
    commands.push(Buffer.from(`ET\nBT /F1 9 Tf 48 40 Td (${index + 1}/${chunks.length}) Tj ET`, "latin1"));
    const stream = Buffer.concat(commands);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
  });

  let cursor = Buffer.from("%PDF-1.4\n", "latin1").length;
  const offsets = [0];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  objects.forEach((object, index) => {
    offsets.push(cursor);
    const header = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const footer = Buffer.from("\nendobj\n", "latin1");
    const block = Buffer.concat([header, object, footer]);
    parts.push(block);
    cursor += block.length;
  });
  const xrefAt = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
