/**
 * Prompt 60 — integração E2E completa da Tesouraria em banco de teste seguro.
 * Fluxo: conta → saldo → AR/AP → expectativa → promessa → programação →
 * projeção → exceção → fechamento → OFX → conciliar → reverter → reabrir → relatório.
 * Também cobre TX/rollback, idempotência e auditoria. Não toca produção.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTreasuryExceptionUpsertInput,
  parseTreasuryPayablesListQuery,
  parseTreasuryReceivablesListQuery,
} from "./contracts/treasurySchemas.js";
import { assertTreasuryReportTotalsConsistent } from "./domain/treasuryReportRules.js";
import {
  createTreasuryFullFlowHarness,
  FULL_FLOW_AP_ID,
  FULL_FLOW_AR_ID,
  FULL_FLOW_CLOSING_DATE,
  FULL_FLOW_COMPANY,
  FULL_FLOW_SOURCE_HASH,
} from "./testing/treasuryFullFlowHarness.js";
import {
  isTreasurySafeTestDatabaseEnabled,
  resolveTreasurySafeTestDatabaseMode,
} from "./testing/treasurySafeTestDatabase.js";

const REF = new Date(Date.UTC(2026, 6, 20));

describe("treasurySafeTestDatabase — modo de execução", () => {
  it("resolve in-process por padrão (sem tocar produção)", () => {
    const mode = resolveTreasurySafeTestDatabaseMode({
      TREASURY_TEST_DATABASE_URL: undefined,
      DATABASE_URL: "postgresql://prod.induscost.local/app",
    });
    assert.equal(mode.mode, "in_process");
    assert.equal(
      isTreasurySafeTestDatabaseEnabled({
        TREASURY_TEST_DATABASE_URL: undefined,
      }),
      false
    );
  });
});

describe("treasuryFullFlow — integração E2E (banco seguro in-process)", () => {
  it("executa fluxo completo + audita etapas críticas", async () => {
    const h = createTreasuryFullFlowHarness();
    assert.equal(h.dbMode.mode, "in_process");
    const { actor, services, audits } = h;

    // 1) criar conta
    const account = await services.accountService.createAccount(actor, {
      companyCode: FULL_FLOW_COMPANY,
      code: "CXFF",
      name: "Conta Full Flow",
      institutionName: "Banco Teste",
      accountType: "CHECKING",
      agencyMasked: "****1",
      accountNumberMasked: "****9999",
      sortOrder: 1,
      allowNegativeBalance: true,
    });
    h.bindAccountId(account.id);
    assert.equal(account.code, "CXFF");
    assert.ok(audits.some((a) => a.action === "CREATE" && a.entityType));

    // 2) registrar saldo (com chave de idempotência)
    const balance = await services.balanceService.createBalanceSnapshot(
      actor,
      account.id,
      {
        referenceAt: "2026-07-20T12:00:00.000Z",
        availableBalance: "1000.00",
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        origin: "MANUAL",
        idempotencyKey: "full-flow-balance-1",
        justification: "abertura E2E",
      }
    );
    assert.equal(balance.created, true);
    assert.equal(balance.snapshot.availableBalance, "1000.00");

    // 3) listar AR/AP
    const arList = await services.receivableQueryService.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ page: "1", pageSize: "20" }),
      REF
    );
    assert.equal(arList.pagination.totalRows, 1);
    assert.equal(arList.rows[0]?.titleId, FULL_FLOW_AR_ID);

    const apList = await services.payableQueryService.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ page: "1", pageSize: "20" }),
      REF
    );
    assert.equal(apList.pagination.totalRows, 1);
    assert.equal(apList.rows[0]?.titleId, FULL_FLOW_AP_ID);

    // 4) alterar expectativa
    const expectation = await services.expectationService.putExpectation(
      actor,
      FULL_FLOW_AR_ID,
      {
        expectedDate: "2026-07-28",
        plannedAccountId: account.id,
        responsibleUserId: actor.userId,
        priority: "HIGH",
        nextAction: "Cobrar",
        reason: "Acordo E2E",
        notes: "full-flow",
        expectedVersion: 0,
      }
    );
    assert.equal(
      expectation.receivable.complement?.expectedDate,
      "2026-07-28"
    );
    assert.equal(expectation.receivable.official.dueDate, "2026-07-15");
    assert.equal(expectation.projectionRecalc.accepted, true);

    const arAfter = await services.receivableQueryService.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ page: "1" }),
      REF
    );
    assert.equal(arAfter.rows[0]?.complement?.expectedDate, "2026-07-28");

    // 5) criar promessa
    const promise = await services.promiseService.createForReceivable(
      actor,
      FULL_FLOW_AR_ID,
      {
        promisedDate: "2026-07-29",
        promisedAmount: "100.00",
        contactNote: "Cliente",
        channel: "WhatsApp",
        notes: "E2E",
        responsibleUserId: actor.userId,
        confirmAboveBalance: false,
        justification: null,
      }
    );
    assert.equal(promise.promise.status, "ACTIVE");
    assert.equal(promise.projectionRecalc.accepted, true);

    // 6) programar pagamento
    const programmed = await services.payableProgrammingService.programPayment(
      actor,
      FULL_FLOW_AP_ID,
      {
        scheduledDate: "2026-07-30",
        plannedAccountId: account.id,
        scheduledAmount: "100.00",
        priority: "NORMAL",
        responsibleUserId: actor.userId,
        justification: "Programação E2E",
        notes: null,
        status: "PROGRAMMED",
        expectedVersion: 0,
      }
    );
    assert.equal(programmed.programming.status, "PROGRAMMED");
    assert.equal(programmed.programming.scheduledAmount, "100.00");

    // 7) recalcular projeção
    const projection = await services.projectionService.calculate(actor, {
      companyCode: FULL_FLOW_COMPANY,
      baseDate: "2026-07-20",
      endDate: "2026-07-22",
      scenario: "PROBABLE",
      accountIds: null,
      consolidated: true,
      includeDayDetail: true,
      notes: "full-flow",
      idempotencyKey: "proj-full-flow-1",
    });
    assert.equal(projection.ok, true);
    assert.equal(projection.status, "SUCCEEDED");
    assert.ok((projection.dayLines?.length ?? 0) > 0);

    // 8) criar exceção
    const exception = await services.exceptionService.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput({
        companyCode: FULL_FLOW_COMPANY,
        uniqueKey: `BALANCE_DIVERGENCE|${account.id}|${FULL_FLOW_CLOSING_DATE}`,
        type: "BALANCE_DIVERGENCE",
        severity: "WARNING",
        entityKind: "ACCOUNT",
        entityId: account.id,
        accountId: account.id,
        nomusExternalId: null,
        title: "Divergência E2E",
        description: "Detectada no fluxo completo",
        amount: "10.00",
        dueAt: "2026-07-21",
        responsibleUserId: actor.userId,
        metadata: { flow: "full" },
      })
    );
    assert.equal(exception.created, true);
    assert.equal(exception.exception.status, "OPEN");

    // 9) fechar dia
    const closed = await services.closingService.close(actor, {
      companyCode: FULL_FLOW_COMPANY,
      date: FULL_FLOW_CLOSING_DATE,
      sourceHash: FULL_FLOW_SOURCE_HASH,
      accountIds: null,
      notes: "E2E close",
      caveats: [],
    });
    assert.equal(closed.closing.status, "CLOSED");
    assert.ok(audits.some((a) => a.action === "CLOSE"));

    // 10) importar OFX
    const preview = h.issueOfxPreview(account.id);
    const applied = await services.ofxApplyService.apply(actor, {
      previewToken: preview.previewToken,
      contentHash: preview.contentHash,
      notes: "E2E OFX",
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.idempotent, false);
    assert.equal(applied.created.count, 2);
    assert.ok(audits.some((a) => a.action === "IMPORT"));

    // 11) conciliar (crédito OFX × título AR)
    const creditMovementId = applied.created.movementIds[0]!;
    h.seedMatchMovementsFromOfx(
      account.id,
      [creditMovementId],
      ["150.00"]
    );
    const matched = await services.reconciliationService.accept(actor, {
      companyCode: FULL_FLOW_COMPANY,
      accountId: account.id,
      matchedCivilDate: "2026-07-15",
      justification: "Match E2E",
      movements: [{ bankMovementId: creditMovementId, amount: "150.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "150.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: FULL_FLOW_AR_ID,
          nomusExternalId: 88001,
          openBalance: "150.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(matched.match.status, "MATCHED");
    assert.ok(audits.some((a) => a.entityType === "RECONCILIATION_MATCH"));

    // 12) reverter
    const reversed = await services.reconciliationService.reverse(
      actor,
      matched.match.id,
      {
        expectedVersion: matched.match.version,
        reason: "Reversão E2E controlada",
        confirmPhrase: "REVERTER",
      }
    );
    assert.equal(reversed.match.isReversed, true);
    assert.equal(reversed.match.status, "UNMATCHED");
    assert.ok(audits.some((a) => a.action === "REVERSE"));

    // 13) reabrir
    const reopened = await services.closingService.reopen(
      actor,
      closed.closing.id,
      { reason: "Reabertura E2E após ajuste de conciliação" }
    );
    assert.equal(reopened.previous.status, "REOPENED");
    assert.equal(reopened.next.status, "OPEN");
    assert.ok(audits.some((a) => a.action === "REOPEN"));

    // 14) gerar relatório
    const report = await services.reportService.getReport(actor, {
      reportKey: "daily-position",
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: [account.id],
      scenario: "PROBABLE",
      companyCode: FULL_FLOW_COMPANY,
      page: 1,
      pageSize: 50,
      status: null,
      severity: null,
      search: null,
    });
    assert.equal(report.reportKey, "daily-position");
    assertTreasuryReportTotalsConsistent(report);

    assert.ok(
      h.listProjectionRecalcRequests().length >= 1,
      "espera ao menos um pedido de recálculo no fluxo"
    );
    assert.ok(audits.length >= 6, "fluxo deve gerar trilha de auditoria");
  });

  it("idempotência: saldo e OFX não duplicam", async () => {
    const h = createTreasuryFullFlowHarness();
    const { actor, services } = h;

    const account = await services.accountService.createAccount(actor, {
      companyCode: FULL_FLOW_COMPANY,
      code: "CXID",
      name: "Conta Idem",
      institutionName: "Banco",
      accountType: "CHECKING",
      agencyMasked: "****2",
      accountNumberMasked: "****8888",
    });
    h.bindAccountId(account.id);

    const first = await services.balanceService.createBalanceSnapshot(
      actor,
      account.id,
      {
        referenceAt: "2026-07-20T10:00:00.000Z",
        availableBalance: "50.00",
        idempotencyKey: "idem-balance",
      }
    );
    const auditAfterFirst = h.audits.length;
    const second = await services.balanceService.createBalanceSnapshot(
      actor,
      account.id,
      {
        referenceAt: "2026-07-20T11:00:00.000Z",
        availableBalance: "999.00",
        idempotencyKey: "idem-balance",
      }
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.snapshot.id, first.snapshot.id);
    assert.equal(h.audits.length, auditAfterFirst);
    assert.equal(h.stores.balanceStore.snapshots.length, 1);

    const p1 = h.issueOfxPreview(account.id);
    const apply1 = await services.ofxApplyService.apply(actor, {
      previewToken: p1.previewToken,
      contentHash: p1.contentHash,
      notes: null,
    });
    assert.equal(apply1.idempotent, false);
    assert.equal(apply1.created.count, 2);

    const p2 = h.issueOfxPreview(account.id);
    const apply2 = await services.ofxApplyService.apply(actor, {
      previewToken: p2.previewToken,
      contentHash: p2.contentHash,
      notes: null,
    });
    assert.equal(apply2.idempotent, true);
    assert.equal(apply2.batchId, apply1.batchId);
    assert.equal(h.stores.ofxMovementRepo.batches.length, 1);
    assert.equal(h.stores.ofxMovementRepo.movements.length, 2);
  });

  it("TX/rollback: falha restaura estado do banco de teste", async () => {
    const h = createTreasuryFullFlowHarness();
    const before = h.snapshotStores();

    await assert.rejects(
      () =>
        h.runTransactionWithRollback(async () => {
          h.stores.exceptionStore.rows.push({
            id: "exc-temp",
          } as never);
          h.audits.push({ action: "TEMP", entityType: "EXCEPTION" });
          throw new Error("FORCED_TX_ROLLBACK");
        }),
      /FORCED_TX_ROLLBACK/
    );

    assert.equal(h.stores.exceptionStore.rows.length, before.exceptions.length);
    assert.equal(h.audits.length, before.audits.length);
  });

  it("auditoria: CREATE de conta e saldo são append-only no fluxo", async () => {
    const h = createTreasuryFullFlowHarness();
    const { actor, services } = h;
    const account = await services.accountService.createAccount(actor, {
      companyCode: FULL_FLOW_COMPANY,
      code: "CXAU",
      name: "Conta Audit",
      institutionName: "Banco",
      accountType: "CASH",
      agencyMasked: "****3",
      accountNumberMasked: "****7777",
    });
    await services.balanceService.createBalanceSnapshot(actor, account.id, {
      referenceAt: "2026-07-20T09:00:00.000Z",
      availableBalance: "1.00",
      idempotencyKey: "audit-bal",
    });

    const createActions = h.audits.filter((a) => a.action === "CREATE");
    assert.ok(createActions.length >= 2);
    const frozen = h.audits.length;
    // não há API de update/delete de audit — trilha só cresce
    await services.balanceService.createBalanceSnapshot(actor, account.id, {
      referenceAt: "2026-07-20T09:00:00.000Z",
      availableBalance: "1.00",
      idempotencyKey: "audit-bal",
    });
    assert.equal(h.audits.length, frozen);
  });
});

describe("treasuryFullFlow — Postgres externo gated", () => {
  it("só habilita com TREASURY_TEST_DATABASE_URL segura (skip sem env)", async (t) => {
    if (!isTreasurySafeTestDatabaseEnabled()) {
      t.skip(
        "Sem TREASURY_TEST_DATABASE_URL segura — suite Prisma externa não executa (produção intacta)."
      );
      return;
    }
    const mode = resolveTreasurySafeTestDatabaseMode();
    assert.equal(mode.mode, "external");
    // Suite Prisma real fica opt-in; neste ambiente o harness in-process cobre o fluxo.
    assert.ok(mode.url.includes("test") || mode.url.includes("localhost"));
  });
});
