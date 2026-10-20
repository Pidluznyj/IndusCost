import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";
import {
  CommercialCreditBypassError,
  CommercialCreditExceptionError,
  assertExistingNomusObligationMirror,
  classifyCommercialSaleTerms,
  decideCommercialCredit,
  resolveCommercialCreditExceptionPermission,
  validateCommercialCreditExceptionDraft,
  type CommercialCreditExceptionFact,
} from "./commercialCreditDecision.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const RELATED = "22222222-2222-4222-8222-222222222222";
const NOW = new Date(2026, 9, 19, 12, 0, 0);

function analysis(
  overrides: Partial<CommercialDelinquencyAnalysis> = {}
): CommercialDelinquencyAnalysis {
  const evidence = {
    source: "NomusAccountsReceivable" as const,
    toleranceDays: 0 as const,
    toleranceUnit: "CALENDAR_DAYS" as const,
    referenceDate: "2026-10-19",
    cnpj: "11444777000161",
    nomusPersonId: 100,
    identity: "RESOLVED" as const,
    syncRunStatus: "SUCCESS" as const,
    payloadComplete: true,
    sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
    includedTitleIds: [] as number[],
    overdueTitleIds: [] as number[],
    protestedTitleIds: [] as number[],
    protestReading: "NOT_IN_SOURCE" as const,
    exclusions: [],
  };
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    ...overrides,
    evidence: { ...evidence, ...overrides.evidence },
  };
}

function credit(overrides: Parameters<typeof decideCommercialCredit>[0] extends infer T ? Partial<T> : never = {}) {
  return decideCommercialCredit({
    customerId: CUSTOMER,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    delinquency: analysis(),
    now: NOW,
    ...overrides,
  });
}

function liveException(scope: string, id = "33333333-3333-4333-8333-333333333333"): CommercialCreditExceptionFact {
  return {
    id,
    scope,
    expiresAt: new Date(2026, 10, 19),
    revokedAt: null,
  };
}

describe("decideCommercialCredit", () => {
  it("classifica à vista, prazo e antecipado sem usar a forma de pagamento", () => {
    assert.equal(classifyCommercialSaleTerms("À vista"), "CASH");
    assert.equal(classifyCommercialSaleTerms("0"), "CASH");
    assert.equal(classifyCommercialSaleTerms("30"), "CREDIT_TERM");
    assert.equal(classifyCommercialSaleTerms("30/60/90"), "CREDIT_TERM");
    assert.equal(classifyCommercialSaleTerms("antecipado"), "ADVANCE");
    assert.equal(classifyCommercialSaleTerms("entrada 50%"), "ADVANCE");
    assert.equal(classifyCommercialSaleTerms(null), "UNSPECIFIED");
    assert.equal(classifyCommercialSaleTerms("combinar"), "UNSPECIFIED");
  });

  it("cliente regular em prazo segue liberado", () => {
    const decision = credit();
    assert.equal(decision.status, "LIBERADO");
    assert.equal(decision.customerStatus, "LIBERADO");
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "REGULAR");
  });

  it("título em aberto com atraso bloqueia prazo e não é anulado por nota cadastral alta", () => {
    const overdue = analysis({
      status: "OVERDUE",
      overdueTitleCount: 1,
      overdueAmount: 987654.32,
      openAmount: 987654.32,
      maxDaysOverdue: 1,
      evidence: {
        source: "NomusAccountsReceivable",
        toleranceDays: 0,
        toleranceUnit: "CALENDAR_DAYS",
        referenceDate: "2026-10-19",
        cnpj: "11444777000161",
        nomusPersonId: 100,
        identity: "RESOLVED",
        syncRunStatus: "SUCCESS",
        payloadComplete: true,
        sourceMaxSyncedAt: null,
        includedTitleIds: [7],
        overdueTitleIds: [7],
        protestedTitleIds: [],
        protestReading: "NOT_IN_SOURCE",
        exclusions: [],
      },
    });
    const blocked = credit({
      delinquency: overdue,
      cadastral: { score: 99, verdict: "VENDA LIBERADA" },
    });
    const sameWithoutScore = credit({ delinquency: overdue, cadastral: { score: 10, verdict: "ATENÇÃO" } });
    assert.equal(blocked.status, "BLOQUEADO");
    assert.equal(blocked.customerStatus, "BLOQUEADO");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "OVERDUE_OPEN_BALANCE");
    assert.equal(blocked.cadastralIgnored, true);
    assert.equal(blocked.status, sameWithoutScore.status);
    assert.equal(blocked.customerStatus, sameWithoutScore.customerStatus);
    assert.equal(JSON.stringify(blocked).includes("987654"), false);
  });

  it("prazo ausente de inadimplente não é tratado como à vista", () => {
    const decision = credit({
      paymentTerms: null,
      delinquency: analysis({ status: "OVERDUE", overdueTitleCount: 1, maxDaysOverdue: 1 }),
    });
    assert.equal(decision.saleKind, "UNSPECIFIED");
    assert.equal(decision.status, "BLOQUEADO");
    assert.equal(decision.allowed, false);
  });

  it("à vista de inadimplente não é venda a prazo", () => {
    const decision = credit({
      paymentTerms: "À vista",
      delinquency: analysis({ status: "OVERDUE", overdueTitleCount: 1, maxDaysOverdue: 1 }),
    });
    assert.equal(decision.saleKind, "CASH");
    assert.equal(decision.status, "LIBERADO");
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "CASH_NOT_CREDIT");
  });

  it("antecipado sem confirmação persistida fica em análise, inclusive com corpo da requisição", () => {
    const regular = credit({ paymentTerms: "antecipado" });
    assert.equal(regular.status, "EM_ANALISE");
    assert.equal(regular.reason, "ADVANCE_NOT_CONFIRMED");
    assert.equal(regular.allowed, false);

    const forged = credit({
      paymentTerms: "sinal",
      advanceConfirmation: { approved: true, confirmed: true, source: "REQUEST_BODY" },
    });
    assert.equal(forged.allowed, false);
    assert.equal(forged.reason, "ADVANCE_NOT_CONFIRMED");

    const confirmed = credit({
      paymentTerms: "adiantamento",
      delinquency: analysis({ status: "OVERDUE", overdueTitleCount: 1, maxDaysOverdue: 2 }),
      advanceConfirmation: { approved: true, confirmed: true, source: "PERSISTED" },
    });
    assert.equal(confirmed.allowed, true);
    assert.equal(confirmed.status, "LIBERADO");
    assert.equal(confirmed.customerStatus, "BLOQUEADO");
    assert.equal(confirmed.reason, "ADVANCE_CONFIRMED");
  });

  it("protesto interno pendente é bloqueio crítico e a exceção de atraso não o remove", () => {
    const protested = analysis({
      status: "PROTESTED",
      overdueTitleCount: 1,
      overdueAmount: 400,
      maxDaysOverdue: 15,
      evidence: {
        source: "NomusAccountsReceivable",
        toleranceDays: 0,
        toleranceUnit: "CALENDAR_DAYS",
        referenceDate: "2026-10-19",
        cnpj: "11444777000161",
        nomusPersonId: 100,
        identity: "RESOLVED",
        syncRunStatus: "SUCCESS",
        payloadComplete: true,
        sourceMaxSyncedAt: null,
        includedTitleIds: [9],
        overdueTitleIds: [9],
        protestedTitleIds: [9],
        protestReading: "PROTESTED",
        exclusions: [],
      },
    });
    const critical = credit({
      delinquency: protested,
      cadastral: { score: 100, verdict: "VENDA LIBERADA" },
      exceptions: [liveException("OVERDUE")],
    });
    assert.equal(critical.status, "BLOQUEIO_CRITICO");
    assert.equal(critical.reason, "INTERNAL_PROTEST");
    assert.equal(critical.allowed, false);

    const stillOverdue = credit({
      delinquency: protested,
      exceptions: [liveException("INTERNAL_PROTEST")],
    });
    assert.equal(stillOverdue.status, "BLOQUEADO");
    assert.equal(stillOverdue.reason, "OVERDUE_OPEN_BALANCE");

    const lifted = credit({
      delinquency: protested,
      exceptions: [liveException("INTERNAL_PROTEST"), liveException("OVERDUE", "44444444-4444-4444-8444-444444444444")],
    });
    assert.equal(lifted.status, "LIBERADO");
    assert.equal(lifted.reason, "EXCEPTION_APPLIED");
    assert.equal(lifted.allowed, true);
  });

  it("protesto externo vigente bloqueia crédito mesmo com carteira interna regular", () => {
    const decision = credit({ externalProtest: "CONFIRMED_CURRENT" });
    assert.equal(decision.status, "BLOQUEADO");
    assert.equal(decision.reason, "EXTERNAL_PROTEST");
    assert.equal(decision.allowed, false);

    const lifted = credit({
      externalProtest: "CONFIRMED_CURRENT",
      exceptions: [liveException("EXTERNAL_PROTEST")],
    });
    assert.equal(lifted.allowed, true);
    assert.equal(lifted.reason, "EXCEPTION_APPLIED");
  });

  it("vínculo com inadimplente retém para análise e não transfere o saldo", () => {
    const decision = credit({
      relatedParties: [
        {
          customerId: RELATED,
          delinquency: analysis({
            status: "OVERDUE",
            overdueTitleCount: 2,
            overdueAmount: 987654.32,
            maxDaysOverdue: 40,
          }),
        },
      ],
    });
    assert.equal(decision.status, "EM_ANALISE");
    assert.equal(decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.deepEqual(decision.evidence.relatedParties, [{ customerId: RELATED, status: "OVERDUE" }]);
    assert.equal(JSON.stringify(decision).includes("987654"), false);
    assert.equal(decision.evidence.relatedParties[0] && "overdueAmount" in decision.evidence.relatedParties[0], false);
  });

  it("dado financeiro indisponível fica não verificado e não libera prazo", () => {
    const decision = credit({
      delinquency: analysis({
        status: "UNKNOWN",
        unknownReason: "SYNC_FAILED",
        overdueTitleCount: null,
        overdueAmount: null,
        openAmount: null,
        maxDaysOverdue: null,
        lastSyncedAt: null,
      }),
      cadastral: { score: 95, verdict: "VENDA LIBERADA" },
    });
    assert.equal(decision.status, "EM_ANALISE");
    assert.equal(decision.reason, "FINANCIAL_UNVERIFIED");
    assert.equal(decision.allowed, false);
  });

  it("exceção vencida não desbloqueia", () => {
    const decision = credit({
      delinquency: analysis({ status: "OVERDUE", overdueTitleCount: 1, maxDaysOverdue: 3 }),
      exceptions: [{ ...liveException("OVERDUE"), expiresAt: new Date(2026, 9, 1) }],
    });
    assert.equal(decision.status, "BLOQUEADO");
    assert.deepEqual(decision.appliedExceptionIds, []);
  });

  it("rascunho e obrigação já existente não são barrados", () => {
    const overdue = analysis({ status: "OVERDUE", overdueTitleCount: 1, maxDaysOverdue: 1 });
    const draft = credit({ enforcement: "DRAFT", delinquency: overdue });
    const existing = credit({ enforcement: "EXISTING_OBLIGATION", delinquency: overdue });
    assert.equal(draft.status, "BLOQUEADO");
    assert.equal(draft.allowed, true);
    assert.equal(existing.allowed, true);
  });

  it("espelho Nomus sem documento externo é tentativa de contorno", () => {
    assert.throws(
      () => assertExistingNomusObligationMirror({ sourceSystem: "NOMUS", externalDocumentId: null }),
      CommercialCreditBypassError
    );
    assert.throws(
      () => assertExistingNomusObligationMirror({ sourceSystem: "LOCAL", externalDocumentId: 10 }),
      CommercialCreditBypassError
    );
    assert.doesNotThrow(() =>
      assertExistingNomusObligationMirror({ sourceSystem: "NOMUS", externalDocumentId: 501 })
    );
  });

  it("SUPER_ADMIN sem chave explícita não concede exceção", () => {
    const implicit = resolveCommercialCreditExceptionPermission({
      role: "SUPER_ADMIN",
      assignedPermissions: [],
    });
    assert.equal(implicit.ok, false);
    if (!implicit.ok) assert.equal(implicit.code, "EXCEPTION_IMPLICIT_SUPER_ADMIN");

    const explicit = resolveCommercialCreditExceptionPermission({
      role: "SUPER_ADMIN",
      assignedPermissions: ["commercial.credit.exception.grant.board"],
    });
    assert.equal(explicit.ok, true);

    const finance = resolveCommercialCreditExceptionPermission({
      role: "ADMIN",
      assignedPermissions: ["commercial.credit.exception.grant"],
    });
    assert.equal(finance.ok, true);

    const seller = resolveCommercialCreditExceptionPermission({
      role: "SELLER",
      assignedPermissions: ["proposals.edit"],
    });
    assert.equal(seller.ok, false);
  });

  it("exceção exige justificativa, escopo e validade", () => {
    const base = {
      customerId: CUSTOMER,
      scope: "OVERDUE",
      justification: "Liberação pontual após conferência do recebimento.",
      expiresAt: new Date(2026, 10, 1),
      now: NOW,
    };
    assert.equal(validateCommercialCreditExceptionDraft(base).ok, true);
    assert.equal(validateCommercialCreditExceptionDraft({ ...base, justification: "curta" }).ok, false);
    assert.equal(validateCommercialCreditExceptionDraft({ ...base, scope: "TUDO" }).ok, false);
    assert.equal(validateCommercialCreditExceptionDraft({ ...base, expiresAt: new Date(2027, 6, 1) }).ok, false);
    assert.throws(() => {
      throw new CommercialCreditExceptionError("EXCEPTION_IMPLICIT_SUPER_ADMIN", "negado");
    }, CommercialCreditExceptionError);
  });

  it("o motor não consulta o score cadastral", () => {
    const source = readFileSync(new URL("./commercialCreditDecision.ts", import.meta.url), "utf8");
    assert.equal(source.includes("companyCommercialRiskScore"), false);
    assert.equal(source.includes("calculateCommercialRiskScore"), false);
    assert.equal(source.includes("VENDA LIBERADA"), false);
  });
});
