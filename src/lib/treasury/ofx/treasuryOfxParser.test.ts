import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  TREASURY_OFX_MAX_FILE_BYTES,
  TREASURY_OFX_PARSER_LIBRARY,
} from "./treasuryOfxConstants.js";
import {
  assertTreasuryOfxIntake,
  detectTreasuryOfxFormat,
  hashTreasuryOfxBuffer,
  isAllowedTreasuryOfxMimeType,
} from "./treasuryOfxIntakeRules.js";
import { inspectTreasuryOfxUpload } from "./treasuryOfxInspection.server.js";
import { parseTreasuryOfxBuffer, parseTreasuryOfxText } from "./treasuryOfxParser.js";
import {
  createTreasuryOfxTempStorage,
  ensureTreasuryOfxTempBase,
} from "./treasuryOfxTempStorage.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

function loadFixture(name: string): Buffer {
  return readFileSync(join(fixtures, name));
}

describe("treasuryOfx — intake e política", () => {
  it("define limite, MIME e biblioteca estável", () => {
    assert.equal(TREASURY_OFX_MAX_FILE_BYTES, 5 * 1024 * 1024);
    assert.equal(TREASURY_OFX_PARSER_LIBRARY, "ofx-data-extractor");
    assert.equal(
      isAllowedTreasuryOfxMimeType("application/x-ofx", "a.ofx"),
      true
    );
    assert.equal(
      isAllowedTreasuryOfxMimeType("application/octet-stream", "a.ofx"),
      true
    );
    assert.equal(
      isAllowedTreasuryOfxMimeType("application/octet-stream", "a.exe"),
      false
    );
    assert.equal(
      isAllowedTreasuryOfxMimeType("application/pdf", "a.ofx"),
      false
    );
  });

  it("detecta OFX1 / OFX2 e rejeita sem cabeçalho", () => {
    assert.equal(
      detectTreasuryOfxFormat(loadFixture("sample-ofx1.ofx").toString("utf8")),
      "OFX1"
    );
    assert.equal(
      detectTreasuryOfxFormat(loadFixture("sample-ofx2.ofx").toString("utf8")),
      "OFX2"
    );
    assert.throws(
      () =>
        assertTreasuryOfxIntake(Buffer.from("hello world"), {
          originalName: "x.ofx",
          mimeType: "application/x-ofx",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
  });

  it("protege contra NUL e tamanho excessivo", () => {
    assert.throws(
      () =>
        assertTreasuryOfxIntake(Buffer.from("OFXHEADER:100\0<OFX>"), {
          originalName: "x.ofx",
          mimeType: "application/x-ofx",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /nulos/i.test((err as Error).message)
    );
    const huge = Buffer.alloc(TREASURY_OFX_MAX_FILE_BYTES + 1, 0x41);
    huge.write("OFXHEADER:100\n<OFX>", 0);
    assert.throws(
      () =>
        assertTreasuryOfxIntake(huge, {
          originalName: "x.ofx",
          mimeType: "application/x-ofx",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "PAYLOAD_TOO_LARGE"
    );
  });

  it("hash SHA-256 estável", () => {
    const buf = loadFixture("sample-ofx1.ofx");
    assert.equal(hashTreasuryOfxBuffer(buf), hashTreasuryOfxBuffer(buf));
    assert.match(hashTreasuryOfxBuffer(buf), /^[a-f0-9]{64}$/);
  });
});

describe("treasuryOfx — parser isolado com fixtures", () => {
  it("parseia OFX 1 (SGML) e normaliza dinheiro em string", () => {
    const parsed = parseTreasuryOfxBuffer(loadFixture("sample-ofx1.ofx"));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.persisted, false);
    assert.equal(parsed.format, "OFX1");
    assert.equal(parsed.library, "ofx-data-extractor");
    assert.equal(parsed.transactions.length, 2);
    assert.equal(parsed.transactions[0]!.fitId, "FIT-OFX1-001");
    assert.equal(parsed.transactions[0]!.amount, "150.00");
    assert.equal(parsed.transactions[0]!.direction, "CREDIT");
    assert.equal(parsed.transactions[0]!.postedCivilDate, "2026-07-15");
    assert.equal(parsed.transactions[1]!.amount, "-40.50");
    assert.equal(parsed.transactions[1]!.direction, "DEBIT");
    assert.equal(parsed.account.bankId, "341");
    assert.equal(parsed.account.accountId, "12345-6");
  });

  it("parseia OFX 2 (XML)", () => {
    const parsed = parseTreasuryOfxText(
      loadFixture("sample-ofx2.ofx").toString("utf8")
    );
    assert.equal(parsed.format, "OFX2");
    assert.equal(parsed.transactions.length, 2);
    assert.equal(parsed.transactions[0]!.fitId, "FIT-OFX2-001");
    assert.equal(parsed.transactions[1]!.amount, "-3.25");
    assert.equal(parsed.account.bankId, "001");
  });

  it("rejeita OFX malformado sem extrato", () => {
    assert.throws(
      () => parseTreasuryOfxBuffer(loadFixture("malformed.ofx")),
      (err: unknown) => err instanceof TreasuryDomainError
    );
  });
});

describe("treasuryOfx — temp storage e descarte", () => {
  it("stageia, relê, parseia e descarta sem persistir", () => {
    const base = ensureTreasuryOfxTempBase(
      mkdtempSync(join(tmpdir(), "treasury-ofx-test-base-"))
    );
    const temp = createTreasuryOfxTempStorage({ baseTempDir: base });
    const buffer = loadFixture("sample-ofx1.ofx");

    const result = inspectTreasuryOfxUpload(
      {
        buffer,
        originalName: "extrato.ofx",
        mimeType: "application/octet-stream",
      },
      { tempStorage: temp }
    );

    assert.equal(result.ok, true);
    assert.equal(result.discarded, true);
    assert.equal(result.stagedPathWasUsed, true);
    assert.equal(result.persisted, false);
    assert.equal(result.transactions.length, 2);
    assert.equal(result.fileSha256, hashTreasuryOfxBuffer(buffer));

    // Diretórios temporários do stage devem ter sido removidos.
    // (rootDir era exclusivo; após discard não deve restar o arquivo staged)
    // Verificamos que um stage manual + discard remove path.
    const staged = temp.stage({ buffer, originalName: "x.ofx" });
    assert.equal(existsSync(staged.filePath), true);
    temp.discard(staged);
    assert.equal(existsSync(staged.filePath), false);
    assert.equal(existsSync(staged.rootDir), false);
  });

  it("falha de MIME não cria arquivo temporário útil", () => {
    assert.throws(
      () =>
        inspectTreasuryOfxUpload({
          buffer: loadFixture("sample-ofx1.ofx"),
          originalName: "extrato.exe",
          mimeType: "application/octet-stream",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.field === "originalName"
    );
  });
});
