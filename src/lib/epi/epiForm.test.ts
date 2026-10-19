import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EPI_FORM_DECLARATION,
  checkEpiReceiptFile,
  deriveEpiDocumentStatus,
  epiFormQrPayload,
  epiFormReferenceFromFileName,
  formatEpiFormCode,
  formatEpiFormDocumentNumber,
  parseEpiFormReference,
  type EpiFormItem,
  type EpiFormPayload,
} from "./epiForm";
import { buildEpiDeliveryFormPdf, epiDeliveryFormPdfFilename } from "./epiDeliveryFormPdf";
import { qrMatrix } from "./epiQr.server";

const FORM_ID = "3f1c2b4a-1111-4222-8333-444455556666";

describe("identificador da ficha", () => {
  it("código anual sequencial + número por revisão", () => {
    assert.equal(formatEpiFormCode(2026, 1), "FE-2026-00001");
    assert.equal(formatEpiFormDocumentNumber("FE-2026-00001", 2), "FE-2026-00001-R02");
    assert.equal(epiFormQrPayload("FE-2026-00001-R01", FORM_ID), `INDUSCOST-HR-EPI:FE-2026-00001-R01:${FORM_ID}`);
  });

  it("aceita número impresso, código e texto do QR; recusa o resto (sem busca aproximada)", () => {
    assert.deepEqual(parseEpiFormReference(" fe-2026-00001-r01 "), { formCode: "FE-2026-00001", revision: 1, formId: null });
    assert.deepEqual(parseEpiFormReference("FE-2026-00001"), { formCode: "FE-2026-00001", revision: null, formId: null });
    assert.deepEqual(parseEpiFormReference(`INDUSCOST-HR-EPI:FE-2026-00001-R03:${FORM_ID}`), {
      formCode: "FE-2026-00001",
      revision: 3,
      formId: FORM_ID,
    });
    for (const bad of ["", "FE-26-1", "FE-2026-0001", "2026-00001-R01", "FE-2026-00001-R1", `INDUSCOST-HR-EPI:FE-2026-00001:${FORM_ID}`, "INDUSCOST-HR-EPI:FE-2026-00001-R01:xyz", null, 42]) {
      assert.equal(parseEpiFormReference(bad), null, String(bad));
    }
  });

  it("identificador pelo nome do arquivo: só com exatamente um número", () => {
    assert.equal(epiFormReferenceFromFileName("FE-2026-00012-R01 assinada.pdf"), "FE-2026-00012-R01");
    assert.equal(epiFormReferenceFromFileName("scan_fe-2026-00012-r02.jpg"), "FE-2026-00012-R02");
    assert.equal(epiFormReferenceFromFileName("FE-2026-00012-R01 e FE-2026-00013-R01.pdf"), null);
    assert.equal(epiFormReferenceFromFileName("digitalizacao_0001.pdf"), null);
    assert.equal(epiFormReferenceFromFileName("FE-2026-00012.pdf"), null);
  });
});

describe("situação documental do evento", () => {
  it("emitir não comprova; anexar não valida; rejeitado ou de revisão anterior volta a aguardar", () => {
    assert.equal(deriveEpiDocumentStatus({ activeFormId: null, currentReceipt: null }).status, "NOT_ISSUED");
    assert.equal(deriveEpiDocumentStatus({ activeFormId: "f1", currentReceipt: null }).status, "AWAITING_SIGNATURE");
    assert.equal(deriveEpiDocumentStatus({ activeFormId: "f1", currentReceipt: { formId: "f1", validationResult: null } }).status, "ATTACHED");
    assert.equal(deriveEpiDocumentStatus({ activeFormId: "f1", currentReceipt: { formId: "f1", validationResult: "APPROVED" } }).status, "VALIDATED");
    assert.deepEqual(deriveEpiDocumentStatus({ activeFormId: "f1", currentReceipt: { formId: "f1", validationResult: "REJECTED" } }), {
      status: "AWAITING_SIGNATURE",
      outdatedReceipt: false,
      rejected: true,
    });
    assert.deepEqual(deriveEpiDocumentStatus({ activeFormId: "f2", currentReceipt: { formId: "f1", validationResult: "APPROVED" } }), {
      status: "AWAITING_SIGNATURE",
      outdatedReceipt: true,
      rejected: false,
    });
    assert.equal(deriveEpiDocumentStatus({ activeFormId: null, currentReceipt: { formId: null, validationResult: null } }).status, "ATTACHED");
  });
});

describe("arquivo do comprovante (conteúdo, não só o nome)", () => {
  const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
  const pdf = enc("%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from("....IEND", "latin1"), 0xae, 0x42, 0x60, 0x82]);
  it("aceita PDF, JPG e PNG íntegros", () => {
    assert.deepEqual(checkEpiReceiptFile({ buffer: pdf, originalName: "ficha.pdf", mimeType: "application/pdf" }), { ok: true, kind: "pdf" });
    assert.deepEqual(checkEpiReceiptFile({ buffer: jpeg, originalName: "ficha.JPG", mimeType: "image/jpeg" }), { ok: true, kind: "jpeg" });
    assert.deepEqual(checkEpiReceiptFile({ buffer: png, originalName: "ficha.png", mimeType: null }), { ok: true, kind: "png" });
  });
  it("recusa vazio, outro conteúdo com extensão de PDF, extensão trocada, tipo divergente e arquivo truncado", () => {
    const code = (r: ReturnType<typeof checkEpiReceiptFile>) => (r.ok ? "ok" : (r as { code: string }).code);
    assert.equal(code(checkEpiReceiptFile({ buffer: new Uint8Array(), originalName: "a.pdf", mimeType: "application/pdf" })), "FILE_EMPTY");
    assert.equal(code(checkEpiReceiptFile({ buffer: enc("MZ\x90\x00 executavel"), originalName: "ficha.pdf", mimeType: "application/pdf" })), "FILE_TYPE");
    assert.equal(code(checkEpiReceiptFile({ buffer: pdf, originalName: "ficha.png", mimeType: "image/png" })), "FILE_TYPE");
    assert.equal(code(checkEpiReceiptFile({ buffer: pdf, originalName: "ficha.pdf", mimeType: "text/html" })), "FILE_TYPE");
    assert.equal(code(checkEpiReceiptFile({ buffer: enc("%PDF-1.4\n1 0 obj <<"), originalName: "ficha.pdf", mimeType: "application/pdf" })), "FILE_CORRUPTED");
    assert.equal(code(checkEpiReceiptFile({ buffer: jpeg.slice(0, 6), originalName: "ficha.jpg", mimeType: "image/jpeg" })), "FILE_CORRUPTED");
  });
});

const item = (n: number, over: Partial<EpiFormItem> = {}): EpiFormItem => ({
  deliveryId: `d${n}`,
  itemCode: `EPI-${String(n).padStart(4, "0")}`,
  item: `Item de proteção número ${n}`,
  itemType: "EPI",
  caNumber: String(1000 + n),
  unit: "UNIT",
  quantity: 1,
  size: null,
  replacementDays: 90,
  replacementDueDate: "2027-01-14",
  ...over,
});

function payload(items: EpiFormItem[]): EpiFormPayload {
  return {
    kind: "EPI_DELIVERY_FORM",
    version: 2,
    header: {
      formId: FORM_ID,
      formCode: "FE-2026-00001",
      revision: 1,
      documentNumber: "FE-2026-00001-R01",
      previousDocumentNumber: null,
      issuedAt: "2026-10-16T15:00:00.000Z",
      issuedByName: "Marina (RH)",
      issuer: { legalName: "Lazarios Koppetel Ltda", document: "12.345.678/0001-90", address: "Curitiba – PR", phone: null, email: null, website: null, logoDataUrl: null },
    },
    body: {
      employee: { id: "e1", name: "João Silva", registration: "e1", department: "Injeção", role: "Operador" },
      event: { id: "ev1", deliveredOn: "2026-10-16", responsibleName: "Marina (RH)", notes: null },
      items,
      declaration: EPI_FORM_DECLARATION,
    },
  };
}

/** Texto visível do PDF: strings dos operadores Tj (octal e escapes decodificados), na ordem do desenho. */
function visibleText(pdf: string): string {
  const parts: string[] = [];
  for (const m of pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) {
    parts.push(m[1].replace(/\\(\d{3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, "$1"));
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

/** Como o motor escreve o texto: parênteses escapados e acentos em octal (WinAnsi). */
function esc(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}

describe("PDF da ficha do evento", () => {
  it("uma ficha com vários itens: cabeçalho, número, QR, colaborador, itens com próxima troca, declaração e assinaturas", () => {
    const items = [
      item(1, { item: "Protetor auricular", caNumber: "5745", unit: "PAIR", replacementDueDate: "2027-04-14" }),
      item(2, { item: "Óculos de proteção", caNumber: "10346" }),
      item(3, { item: "Jaleco", itemType: "UNIFORM", caNumber: null, quantity: 2, size: "M", replacementDays: null, replacementDueDate: null }),
      item(4, { item: "Boné", itemType: "UNIFORM", caNumber: null, replacementDays: null, replacementDueDate: null }),
    ];
    const text = buildEpiDeliveryFormPdf(payload(items), { sha256: "a".repeat(64) }).toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.match(text, /\/MediaBox \[0 0 595 842\]/);
    for (const expected of [
      "FICHA DE ENTREGA DE EPI / UNIFORME",
      "FE-2026-00001-R01",
      "Lazarios Koppetel Ltda",
      "João Silva",
      "Operador",
      "Injeção",
      "16/10/2026",
      "ITENS ENTREGUES (4)",
      "Protetor auricular",
      "Óculos de proteção",
      "Jaleco (tam. M)",
      "Boné",
      "5745",
      "14/04/2027",
      "Sem troca programada",
      "Não se aplica",
      "Declaro que recebi os equipamentos e/ou uniformes relacionados neste documento",
      "Assinatura do colaborador",
      "Assinatura do responsável pela entrega",
      "Data do recebimento",
      "Página 1 de 1",
      "Verificação SHA-256: aaaaaaaaaaaaaaaa",
    ]) {
      assert.ok(visibleText(text).includes(expected), `PDF sem "${expected}"`);
    }
    assert.ok((text.match(/ re f/g) ?? []).length > 50, "QR em módulos");
    assert.ok(!/treinamento|orientado|ciência dos riscos/i.test(visibleText(text)), "sem declarações automáticas de treinamento");
  });

  it("muitos itens: pagina, repete o cabeçalho da tabela e o número em todas as páginas", () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i + 1));
    const text = buildEpiDeliveryFormPdf(payload(items), { sha256: "c".repeat(64) }).toString("latin1");
    const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(text)?.[1] ?? 0);
    assert.ok(pages >= 2, `esperava paginação, veio ${pages}`);
    assert.ok(text.includes(esc(`Página ${pages} de ${pages}`)));
    // Número no cabeçalho de cada página e cabeçalho da tabela repetido.
    assert.equal(text.split("(FE-2026-00001-R01) Tj").length - 1 >= pages, true);
    // Cabeçalho da tabela repetido nas páginas em que ela continua (o bloco de assinaturas não se divide).
    assert.ok(visibleText(text).split("Código Descrição Tipo Qtd. Unidade CA Próxima troca").length - 1 >= 2, "cabeçalho da tabela repetido");
    assert.ok(visibleText(text).includes("Assinatura do colaborador") && visibleText(text).includes("Data do recebimento"), "assinaturas presentes");
    assert.ok(visibleText(text).includes("Item de proteção número 40"));
  });

  it("revisão substituída sai com marca e aponta a vigente", () => {
    const text = buildEpiDeliveryFormPdf(payload([item(1)]), { sha256: "b".repeat(64), superseded: true, activeDocumentNumber: "FE-2026-00001-R02" }).toString("latin1");
    assert.ok(text.includes(esc("REVISÃO SUBSTITUÍDA")));
    assert.ok(text.includes("FE-2026-00001-R02"));
  });

  it("QR do servidor codifica módulos e nome de arquivo sem acentos", () => {
    const m = qrMatrix(epiFormQrPayload("FE-2026-00001-R01", FORM_ID));
    assert.ok(m.size >= 21 && m.rects.length > 0);
    assert.equal(epiDeliveryFormPdfFilename("FE-2026-00001-R01", "Ana Paula Ribeiro Côrtes"), "FE-2026-00001-R01-Ana-Paula-Ribeiro-Cortes.pdf");
  });
});
