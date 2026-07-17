import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireStockDocumentsSyncLock,
  parseStockDocumentsSyncLockPayload,
  releaseStockDocumentsSyncLock,
} from "./nomusStockDocumentsSyncLock.js";
import {
  buildStockDocumentPresenceOnlyUpdate,
  buildStockDocumentsCheckpoint,
  buildStockDocumentsSyncAuditRecord,
  classifyStockDocumentsSyncCompleteness,
  parseStockDocumentsCheckpoint,
  resolveStockDocumentsLifecycleExitCode,
  serializeStockDocumentsCheckpoint,
  shouldAdvanceStockDocumentsCheckpoint,
  shouldMarkStockDocumentsAbsent,
} from "./nomusStockDocumentsSyncLifecycle.js";
import { buildStockDocumentsIntegrationRunData } from "./nomusStockDocumentsIntegrationRun.js";
import {
  emptyStockDocumentsSyncCounters,
  parseStockDocumentsSyncCli,
  planStockDocumentPersist,
  shouldWriteStockDocuments,
} from "./nomusStockDocumentsSyncLogic.js";
import { mapNomusStockDocumentPayload } from "./nomusStockDocumentsMapper.js";

const sampleDoc = {
  id: 7951,
  idNfe: 6937,
  tipoDocumentoEstoque: "DocumentoSaida",
  data: "13/05/2026 08:10:33",
  itensDocumentoEstoque: [
    { id: 1, idProduto: 456, qtde: "3.000", valorUnitario: "4,92" },
  ],
};

describe("stock documents sync lifecycle (DS-03.5)", () => {
  it("lock impede sobreposição e libera na segunda execução", () => {
    const dir = mkdtempSync(join(tmpdir(), "stock-docs-lock-"));
    const lockFile = join(dir, "sync.lock");
    try {
      const first = acquireStockDocumentsSyncLock({
        mode: "apply",
        lockFile,
        pid: process.pid,
      });
      assert.equal(first.ok, true);
      if (!first.ok) return;

      const second = acquireStockDocumentsSyncLock({
        mode: "preview",
        lockFile,
        pid: process.pid + 1,
      });
      assert.equal(second.ok, false);
      if (second.ok) return;
      assert.equal(second.code, "LOCK_HELD");

      releaseStockDocumentsSyncLock({ lockFile, token: first.token });
      const third = acquireStockDocumentsSyncLock({
        mode: "apply",
        lockFile,
        pid: process.pid,
      });
      assert.equal(third.ok, true);
      if (!third.ok) return;
      releaseStockDocumentsSyncLock({ lockFile, token: third.token });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lock órfão (PID morto) é reclaimado", () => {
    const dir = mkdtempSync(join(tmpdir(), "stock-docs-lock-stale-"));
    const lockFile = join(dir, "sync.lock");
    try {
      writeFileSync(
        lockFile,
        JSON.stringify({
          version: 1,
          token: "stale-token",
          pid: 999999001,
          mode: "apply",
          startedAt: new Date().toISOString(),
          hostname: "test",
        }),
        "utf8"
      );
      const acquired = acquireStockDocumentsSyncLock({
        mode: "preview",
        lockFile,
        pid: process.pid,
      });
      assert.equal(acquired.ok, true);
      if (!acquired.ok) return;
      releaseStockDocumentsSyncLock({ lockFile, token: acquired.token });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parse lock payload rejeita JSON inválido", () => {
    assert.equal(parseStockDocumentsSyncLockPayload("{"), null);
    assert.equal(parseStockDocumentsSyncLockPayload(null), null);
  });

  it("preview não habilita escrita; apply habilita", () => {
    const preview = parseStockDocumentsSyncCli([
      "--from=2025-07-01",
      "--to=2026-07-10",
    ]);
    assert.equal(preview.mode, "preview");
    assert.equal(shouldWriteStockDocuments(preview.mode), false);
    const apply = parseStockDocumentsSyncCli([
      "apply",
      "--from=2025-07-01",
      "--to=2026-07-10",
    ]);
    assert.equal(apply.mode, "apply");
    assert.equal(shouldWriteStockDocuments(apply.mode), true);
  });

  it("hash igual → unchanged (só presença); hash alterado → update", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDoc);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const same = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: mapped.row.payloadHash,
      itemCount: 1,
    });
    assert.equal(same.action, "unchanged");
    assert.equal(same.headerAction, "unchanged");
    assert.equal(same.itemsAction, "ignore");

    const presence = buildStockDocumentPresenceOnlyUpdate(new Date("2026-07-17T12:00:00Z"));
    assert.equal(presence.presentInLastPayload, true);
    assert.ok(presence.syncedAt);
    assert.ok(presence.lastSeenAt);

    const changed = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: "f".repeat(64),
      itemCount: 1,
    });
    assert.equal(changed.action, "update");
    assert.equal(changed.headerAction, "write");
    assert.equal(changed.itemsAction, "replace");
  });

  it("execução parcial não avança checkpoint nem marca ausência", () => {
    assert.equal(
      classifyStockDocumentsSyncCompleteness({
        fetchComplete: false,
        errors: 0,
      }),
      "partial"
    );
    assert.equal(
      shouldAdvanceStockDocumentsCheckpoint({
        mode: "apply",
        completeness: "partial",
        exitCode: 1,
      }),
      false
    );
    assert.equal(
      shouldMarkStockDocumentsAbsent({
        mode: "apply",
        completeness: "partial",
      }),
      false
    );
  });

  it("falha não avança checkpoint nem marca ausência", () => {
    assert.equal(
      classifyStockDocumentsSyncCompleteness({
        fetchComplete: true,
        errors: 2,
        fatalError: true,
      }),
      "failed"
    );
    assert.equal(
      shouldAdvanceStockDocumentsCheckpoint({
        mode: "apply",
        completeness: "failed",
        exitCode: 1,
      }),
      false
    );
    assert.equal(
      shouldMarkStockDocumentsAbsent({
        mode: "apply",
        completeness: "failed",
      }),
      false
    );
  });

  it("apply completo avança checkpoint; preview não", () => {
    assert.equal(
      shouldAdvanceStockDocumentsCheckpoint({
        mode: "apply",
        completeness: "complete",
        exitCode: 0,
      }),
      true
    );
    assert.equal(
      shouldAdvanceStockDocumentsCheckpoint({
        mode: "preview",
        completeness: "complete",
        exitCode: 0,
      }),
      false
    );
  });

  it("checkpoint serializa e parseia; segunda execução idempotente no plano", () => {
    const options = parseStockDocumentsSyncCli([
      "apply",
      "--from=2025-07-01",
      "--to=2026-07-10",
    ]);
    const counters = emptyStockDocumentsSyncCounters();
    counters.documentsReceived = 2;
    counters.documentsUnchanged = 2;
    const checkpoint = buildStockDocumentsCheckpoint({
      mode: "apply",
      options,
      counters,
      completedAt: new Date("2026-07-17T15:00:00.000Z"),
    });
    const raw = serializeStockDocumentsCheckpoint(checkpoint);
    const parsed = parseStockDocumentsCheckpoint(raw);
    assert.ok(parsed);
    assert.equal(parsed!.from, "2025-07-01");
    assert.equal(parsed!.documentsUnchanged, 2);

    const mapped = mapNomusStockDocumentPayload(sampleDoc);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const first = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: mapped.row.payloadHash,
      itemCount: 1,
    });
    const second = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: mapped.row.payloadHash,
      itemCount: 1,
    });
    assert.deepEqual(
      { action: first.action, headerAction: first.headerAction },
      { action: second.action, headerAction: second.headerAction }
    );
  });

  it("audit record e IntegrationRun data são auditáveis", () => {
    const options = parseStockDocumentsSyncCli([
      "apply",
      "--from=2025-07-01",
      "--to=2026-07-10",
    ]);
    const counters = emptyStockDocumentsSyncCounters();
    counters.documentsCreated = 1;
    counters.rateLimit429 = 2;
    const audit = buildStockDocumentsSyncAuditRecord({
      mode: "apply",
      options,
      startedAt: new Date("2026-07-17T12:00:00.000Z"),
      finishedAt: new Date("2026-07-17T12:00:05.000Z"),
      exitCode: 0,
      completeness: "complete",
      lockAcquired: true,
      lockSkipped: false,
      checkpointAdvanced: true,
      rateLimit429: 2,
      counters,
    });
    assert.equal(audit.durationMs, 5000);
    assert.equal(audit.rateLimit429, 2);
    assert.equal(audit.markAbsentApplied, false);

    const data = buildStockDocumentsIntegrationRunData({ audit });
    assert.equal(data.target, "stock_documents");
    assert.equal(data.mode, "apply");
    assert.equal(data.status, "SUCCESS");
    assert.equal(data.createdCount, 1);
  });

  it("exit code: lock skip=0; partial/failed=1; complete=0", () => {
    assert.equal(
      resolveStockDocumentsLifecycleExitCode({
        lockSkipped: true,
        completeness: "lock_skipped",
        errors: 0,
        invalidPayloads: 0,
      }),
      0
    );
    assert.equal(
      resolveStockDocumentsLifecycleExitCode({
        lockSkipped: false,
        completeness: "partial",
        errors: 0,
        invalidPayloads: 0,
      }),
      1
    );
    assert.equal(
      resolveStockDocumentsLifecycleExitCode({
        lockSkipped: false,
        completeness: "complete",
        errors: 0,
        invalidPayloads: 0,
      }),
      0
    );
  });

  it("grava checkpoint em disco apenas quando serializado explicitamente", () => {
    const dir = mkdtempSync(join(tmpdir(), "stock-docs-cp-"));
    const file = join(dir, "checkpoint.json");
    try {
      const options = parseStockDocumentsSyncCli([
        "apply",
        "--idNfe=6937",
      ]);
      const checkpoint = buildStockDocumentsCheckpoint({
        mode: "apply",
        options,
        counters: emptyStockDocumentsSyncCounters(),
        completedAt: new Date("2026-07-17T12:00:00.000Z"),
      });
      writeFileSync(file, serializeStockDocumentsCheckpoint(checkpoint), "utf8");
      assert.equal(existsSync(file), true);
      const parsed = parseStockDocumentsCheckpoint(readFileSync(file, "utf8"));
      assert.deepEqual(parsed?.idNfes, [6937]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
