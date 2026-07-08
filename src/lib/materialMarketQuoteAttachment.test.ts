import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  deleteAppLocalFile,
  readAppLocalFile,
  resolveAppUploadAbsolutePath,
  saveAppLocalFile,
} from "./appLocalFileStorage.js";
import {
  computeQuoteSuggestedReliabilityLevel,
  detectMaterialMarketQuoteAttachmentType,
  isAllowedMaterialMarketQuoteAttachmentMime,
  suggestReliabilityForAttachment,
  validateMaterialMarketQuoteUploadFile,
  MaterialMarketQuoteAttachmentError,
} from "./materialMarketQuoteAttachment.js";

describe("materialMarketQuoteAttachment", () => {
  it("aceita PDF, imagem, planilha e e-mail", () => {
    assert.equal(isAllowedMaterialMarketQuoteAttachmentMime("application/pdf", "cotacao.pdf"), true);
    assert.equal(isAllowedMaterialMarketQuoteAttachmentMime("image/png", "foto.png"), true);
    assert.equal(
      isAllowedMaterialMarketQuoteAttachmentMime(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "precos.xlsx"
      ),
      true
    );
    assert.equal(isAllowedMaterialMarketQuoteAttachmentMime("message/rfc822", "email.eml"), true);
    assert.equal(isAllowedMaterialMarketQuoteAttachmentMime("application/zip", "arquivo.zip"), false);
  });

  it("rejeita arquivo vazio e tipo inválido com mensagem amigável", () => {
    assert.throws(
      () =>
        validateMaterialMarketQuoteUploadFile({
          originalName: "x.pdf",
          mimeType: "application/pdf",
          size: 0,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MaterialMarketQuoteAttachmentError);
        assert.equal(error.code, "ATTACHMENT_FILE_EMPTY");
        return true;
      }
    );

    assert.throws(
      () =>
        validateMaterialMarketQuoteUploadFile({
          originalName: "virus.exe",
          mimeType: "application/x-msdownload",
          size: 100,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MaterialMarketQuoteAttachmentError);
        assert.equal(error.code, "ATTACHMENT_INVALID_TYPE");
        assert.match(error.message, /não permitido/i);
        return true;
      }
    );
  });

  it("detecta tipo e confiabilidade sugerida", () => {
    assert.equal(
      detectMaterialMarketQuoteAttachmentType({
        mimeType: "application/pdf",
        fileName: "proposta.pdf",
      }),
      "PDF"
    );
    assert.equal(
      suggestReliabilityForAttachment({
        attachmentType: "PDF",
        mimeType: "application/pdf",
        fileName: "proposta.pdf",
      }),
      "ALTA"
    );
    assert.equal(
      suggestReliabilityForAttachment({
        attachmentType: "IMAGE",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      }),
      "MEDIA"
    );
  });

  it("eleva confiabilidade da cotação com PDF ou múltiplos anexos", () => {
    assert.equal(
      computeQuoteSuggestedReliabilityLevel([
        { attachmentType: "IMAGE", suggestedReliabilityLevel: "MEDIA" },
        { attachmentType: "IMAGE", suggestedReliabilityLevel: "MEDIA" },
        { attachmentType: "OTHER", suggestedReliabilityLevel: "BAIXA" },
      ]),
      "MEDIA"
    );
    assert.equal(
      computeQuoteSuggestedReliabilityLevel([
        { attachmentType: "SPREADSHEET", suggestedReliabilityLevel: "MEDIA" },
        { attachmentType: "PDF", suggestedReliabilityLevel: "ALTA" },
      ]),
      "ALTA"
    );
    assert.equal(computeQuoteSuggestedReliabilityLevel([]), "MANUAL");
  });
});

describe("appLocalFileStorage", () => {
  let previousUploadsDir: string | undefined;
  let tempRoot: string;

  before(() => {
    previousUploadsDir = process.env.APP_UPLOADS_DIR;
    tempRoot = mkdtempSync(join(tmpdir(), "induscost-uploads-"));
    process.env.APP_UPLOADS_DIR = tempRoot;
  });

  after(() => {
    if (previousUploadsDir === undefined) delete process.env.APP_UPLOADS_DIR;
    else process.env.APP_UPLOADS_DIR = previousUploadsDir;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("salva, lê e remove arquivo por storageKey", async () => {
    const saved = await saveAppLocalFile({
      namespace: "material-market-quotes",
      entityId: "quote-1",
      originalFileName: "cotacao.pdf",
      buffer: Buffer.from("%PDF-mock"),
    });
    assert.ok(saved.storageKey.includes("material-market-quotes/quote-1/"));
    const absolute = resolveAppUploadAbsolutePath(saved.storageKey);
    assert.equal(readFileSync(absolute, "utf8"), "%PDF-mock");

    const loaded = await readAppLocalFile(saved.storageKey);
    assert.equal(loaded.toString("utf8"), "%PDF-mock");

    await deleteAppLocalFile(saved.storageKey);
    await assert.rejects(() => readAppLocalFile(saved.storageKey));
  });
});
