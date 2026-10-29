import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideProposalSalesOrderLink,
  type CurrentProposalLink,
  type ExplicitProposalReferenceResolution,
  type ProposalLinkCandidateInfo,
  type ProposalLinkDecisionInput,
  type ProposalLinkLineEvidence,
} from "./proposalSalesOrderLinkPolicy.ts";

const ORDER = "so-1";
const CUSTOMER = "cust-A";
const ISSUE = new Date("2026-10-10T12:00:00Z");

function info(proposalId: string, customerId = CUSTOMER, date = "2026-10-01T12:00:00Z"): ProposalLinkCandidateInfo {
  return { proposalId, customerId, commercialDate: new Date(date) };
}

function line(lineKey: string, ...candidateProposalIds: string[]): ProposalLinkLineEvidence {
  return { lineKey, productId: `prod-${lineKey}`, candidateProposalIds };
}

function input(overrides: Partial<ProposalLinkDecisionInput> = {}): ProposalLinkDecisionInput {
  const proposals = new Map<string, ProposalLinkCandidateInfo>(
    ["P1", "P2", "P3"].map((id) => [id, info(id)] as const)
  );
  return {
    salesOrderId: ORDER,
    orderCustomerId: CUSTOMER,
    orderIssueDate: ISSUE,
    current: { proposalId: null, source: null, status: null },
    explicit: { kind: "NONE" },
    lines: [],
    proposals,
    slotOwnerByProposalId: new Map(),
    ...overrides,
  };
}

const none: CurrentProposalLink = { proposalId: null, source: null, status: null };

describe("política do vínculo Pedido → Proposta", () => {
  it("referência explícita do Nomus, mesmo cliente, vaga livre → CONFIRMED / NOMUS_REFERENCE", () => {
    const explicit: ExplicitProposalReferenceResolution = { kind: "RESOLVED", field: "x", value: "10", proposalId: "P2" };
    // mesmo com inferência apontando outra proposta, a referência explícita prevalece
    const d = decideProposalSalesOrderLink(input({ explicit, lines: [line("1", "P1")] }));
    assert.equal(d.proposalId, "P2");
    assert.equal(d.source, "NOMUS_REFERENCE");
    assert.equal(d.status, "CONFIRMED");
    assert.equal(d.eventKind, "LINKED");
  });

  it("referência explícita para proposta de outro cliente → CONFLICT, nada vinculado", () => {
    const proposals = new Map([["PX", info("PX", "cust-B")]]);
    const d = decideProposalSalesOrderLink(
      input({ proposals, explicit: { kind: "RESOLVED", field: "x", value: "9", proposalId: "PX" } })
    );
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "CONFLICT");
    assert.equal(d.reason, "EXPLICIT_REFERENCE_OTHER_CUSTOMER");
    assert.equal(d.candidateProposalId, "PX");
  });

  it("referência explícita confirma um vínculo inferido existente (sem trocar a proposta)", () => {
    const d = decideProposalSalesOrderLink(
      input({
        current: { proposalId: "P1", source: "INFERRED_ITEMS", status: "INFERRED" },
        explicit: { kind: "RESOLVED", field: "x", value: "1", proposalId: "P1" },
      })
    );
    assert.equal(d.proposalId, "P1");
    assert.equal(d.source, "NOMUS_REFERENCE");
    assert.equal(d.status, "CONFIRMED");
    assert.equal(d.eventKind, "CONFIRMED");
  });

  it("referência explícita divergente do vínculo atual → CONFLICT, vínculo atual preservado", () => {
    const d = decideProposalSalesOrderLink(
      input({
        current: { proposalId: "P1", source: "LEGACY", status: "INFERRED" },
        explicit: { kind: "RESOLVED", field: "x", value: "2", proposalId: "P2" },
      })
    );
    assert.equal(d.proposalId, "P1");
    assert.equal(d.status, "CONFLICT");
    assert.equal(d.reason, "EXPLICIT_REFERENCE_DIVERGES_FROM_CURRENT");
    assert.equal(d.candidateProposalId, "P2");
  });

  it("referência explícita presente mas proposta não importada → sem inferência por cima", () => {
    const d = decideProposalSalesOrderLink(
      input({ explicit: { kind: "UNRESOLVED", field: "x", value: "77" }, lines: [line("1", "P1")] })
    );
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "NO_EVIDENCE");
    assert.equal(d.reason, "EXPLICIT_REFERENCE_PROPOSAL_NOT_IMPORTED");
  });

  it("cliente recorrente com o mesmo produto em duas propostas → AMBIGUOUS, sem vínculo", () => {
    const d = decideProposalSalesOrderLink(input({ lines: [line("1", "P1", "P2")] }));
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "AMBIGUOUS");
    assert.equal(d.reason, "MULTIPLE_PROPOSALS_MATCH");
  });

  it("pedido com vários itens: a única proposta que cobre todas as linhas é inferida", () => {
    // P1 tem os produtos 1 e 2; P2 só o produto 1
    const d = decideProposalSalesOrderLink(input({ lines: [line("1", "P1", "P2"), line("2", "P1")] }));
    assert.equal(d.proposalId, "P1");
    assert.equal(d.source, "INFERRED_ITEMS");
    assert.equal(d.status, "INFERRED");
    assert.equal(d.evidence.matchedLines, 2);
  });

  it("pedido parcial (só parte dos itens da proposta) e item extra fora da proposta → inferido, linha extra registrada", () => {
    const d = decideProposalSalesOrderLink(input({ lines: [line("1", "P1"), line("extra")] }));
    assert.equal(d.proposalId, "P1");
    assert.equal(d.evidence.unmatchedLines, 1);
  });

  it("1 proposta → N pedidos: proposta já ocupada por outro pedido → CONFLICT (evidência de cardinalidade B)", () => {
    const d = decideProposalSalesOrderLink(
      input({ lines: [line("1", "P1")], slotOwnerByProposalId: new Map([["P1", "so-other"]]) })
    );
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "CONFLICT");
    assert.equal(d.reason, "PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER");
    assert.equal(d.candidateProposalId, "P1");
  });

  it("N propostas → 1 pedido: linhas apontam propostas diferentes → AMBIGUOUS (evidência de cardinalidade C)", () => {
    const d = decideProposalSalesOrderLink(input({ lines: [line("1", "P1"), line("2", "P2")] }));
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "AMBIGUOUS");
    assert.equal(d.reason, "LINES_POINT_TO_DIFFERENT_PROPOSALS");
    assert.deepEqual(d.inference.kind === "AMBIGUOUS" ? d.inference.proposalIds : [], ["P1", "P2"]);
  });

  it("proposta emitida depois do pedido não é candidata", () => {
    const proposals = new Map([
      ["P1", info("P1")],
      ["P2", info("P2", CUSTOMER, "2026-10-20T12:00:00Z")],
    ]);
    const d = decideProposalSalesOrderLink(input({ proposals, lines: [line("1", "P1", "P2")] }));
    assert.equal(d.proposalId, "P1");
    assert.deepEqual(d.evidence.lines[0]!.excludedAfterOrderDate, ["P2"]);
  });

  it("candidata de outro cliente nunca entra (defesa contra vínculo entre clientes)", () => {
    const proposals = new Map([["PB", info("PB", "cust-B")]]);
    const d = decideProposalSalesOrderLink(input({ proposals, lines: [line("1", "PB")] }));
    assert.equal(d.proposalId, null);
    assert.equal(d.status, "NO_EVIDENCE");
  });

  it("vínculo existente nunca é apagado quando a inferência fica ambígua", () => {
    const d = decideProposalSalesOrderLink(
      input({ current: { proposalId: "P1", source: "INFERRED_ITEMS", status: "INFERRED" }, lines: [line("1", "P1", "P2")] })
    );
    assert.equal(d.proposalId, "P1");
    assert.equal(d.source, "INFERRED_ITEMS");
    assert.equal(d.status, "INFERRED");
    assert.equal(d.reason, "CURRENT_LINK_PRESERVED_WITHOUT_CORROBORATION");
    assert.equal(d.eventKind, null);
  });

  it("vínculo confirmado (manual/gerado) é mantido mesmo com inferência divergente", () => {
    for (const source of ["MANUAL", "INDUSCOST_GENERATED", "NOMUS_REFERENCE"] as const) {
      const d = decideProposalSalesOrderLink(
        input({ current: { proposalId: "P1", source, status: "CONFIRMED" }, lines: [line("1", "P2")] })
      );
      assert.equal(d.proposalId, "P1");
      assert.equal(d.status, "CONFIRMED");
      assert.equal(d.eventKind, null);
    }
  });

  it("vínculo legado (sem origem) com inferência divergente → CONFLICT registrado, vínculo preservado", () => {
    const d = decideProposalSalesOrderLink(
      input({ current: { proposalId: "P1", source: null, status: null }, lines: [line("1", "P2")] })
    );
    assert.equal(d.proposalId, "P1");
    assert.equal(d.source, "LEGACY");
    assert.equal(d.status, "CONFLICT");
    assert.equal(d.reason, "INFERENCE_DIVERGES_FROM_CURRENT");
    assert.equal(d.candidateProposalId, "P2");
    assert.equal(d.eventKind, "CONFLICT");
  });

  it("vínculo legado corroborado pelos itens → LEGACY / INFERRED (nunca CONFIRMED)", () => {
    const d = decideProposalSalesOrderLink(input({ current: { ...none, proposalId: "P1" }, lines: [line("1", "P1")] }));
    assert.equal(d.source, "LEGACY");
    assert.equal(d.status, "INFERRED");
    assert.equal(d.reason, "CURRENT_LINK_CORROBORATED_BY_ITEMS");
    // primeira classificação sem mudança de vínculo: só na linha do pedido, sem evento
    assert.equal(d.eventKind, null);
    const unlinked = decideProposalSalesOrderLink(input({ lines: [line("1", "P1", "P2")] }));
    assert.equal(unlinked.status, "AMBIGUOUS");
    assert.equal(unlinked.eventKind, null);
  });

  it("vínculo existente com proposta de outro cliente → CONFLICT, mas não é apagado", () => {
    const proposals = new Map([["PB", info("PB", "cust-B")]]);
    const d = decideProposalSalesOrderLink(
      input({ proposals, current: { proposalId: "PB", source: "LEGACY", status: "INFERRED" } })
    );
    assert.equal(d.proposalId, "PB");
    assert.equal(d.status, "CONFLICT");
    assert.equal(d.reason, "CURRENT_LINK_OTHER_CUSTOMER");
  });

  it("pedido sem linhas resolvidas (payload incompleto) → NO_EVIDENCE", () => {
    const d = decideProposalSalesOrderLink(input({ lines: [] }));
    assert.equal(d.status, "NO_EVIDENCE");
    assert.equal(d.reason, "ORDER_WITHOUT_RESOLVED_LINES");
  });

  it("decisão estável: mesma entrada aplicada sobre o resultado não gera novo evento (idempotência)", () => {
    const first = decideProposalSalesOrderLink(input({ lines: [line("1", "P1")] }));
    const second = decideProposalSalesOrderLink(
      input({
        lines: [line("1", "P1")],
        current: { proposalId: first.proposalId, source: first.source, status: first.status },
        slotOwnerByProposalId: new Map([["P1", ORDER]]),
      })
    );
    assert.equal(second.proposalId, "P1");
    assert.equal(second.eventKind, null);
    const unlinked = decideProposalSalesOrderLink(input({ lines: [line("1", "P1", "P2")] }));
    const again = decideProposalSalesOrderLink(
      input({ lines: [line("1", "P1", "P2")], current: { proposalId: null, source: null, status: unlinked.status } })
    );
    assert.equal(again.eventKind, null);
  });
});
