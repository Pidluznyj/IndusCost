import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selectNomusProposalCandidates,
  type DiscoveredProposalRaw,
} from "./nomusProposalsCandidateSelection.js";

describe("nomusProposalsCandidateSelection — Matriz de testes P0", () => {
  const overlapFrom = new Date("2026-08-07T14:12:45.384Z");

  it("P0-A (Caso CP 01382): Proposta antiga/fora da janela e inexistente localmente → CANDIDATA (missing_locally)", () => {
    const cp01382: DiscoveredProposalRaw = {
      id: 1382,
      proposta: "CP 01382",
      dataHoraAbertura: "07/08/2026 08:11:00", // Fora da janela (08:11 < 14:12)
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [cp01382],
      existingExternalIds: new Set(), // NÃO existe no banco local
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 1);
    assert.equal(result.missingLocallyCount, 1);
    assert.equal(result.classifications[0].isCandidate, true);
    assert.equal(result.classifications[0].reason, "missing_locally");
    assert.equal(result.missingLocallyPreview[0].externalProposalCode, "CP 01382");
  });

  it("P0-B: Proposta criada hoje antes do checkpoint e inexistente localmente → CANDIDATA (missing_locally)", () => {
    const prop: DiscoveredProposalRaw = {
      id: 2001,
      proposta: "NOMUS-002001",
      dataHoraAbertura: "07/08/2026 12:00:00", // Antes de 14:12
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop],
      existingExternalIds: new Set(),
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 1);
    assert.equal(result.missingLocallyCount, 1);
    assert.equal(result.classifications[0].reason, "missing_locally");
  });

  it("P0-C: Proposta existente localmente com alteração DENTRO da janela → CANDIDATA (changed_in_window)", () => {
    const prop: DiscoveredProposalRaw = {
      id: 3001,
      proposta: "NOMUS-003001",
      dataHoraAbertura: "07/08/2026 08:00:00",
      dataHoraAlteracao: "07/08/2026 14:30:00", // Dentro da janela (> 14:12)
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop],
      existingExternalIds: new Set([3001]), // Já existe no banco
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 1);
    assert.equal(result.changedInWindowCount, 1);
    assert.equal(result.classifications[0].isCandidate, true);
    assert.equal(result.classifications[0].reason, "changed_in_window");
  });

  it("P0-D: Proposta existente localmente com alteração FORA da janela → NÃO candidata (unchanged_outside_window)", () => {
    const prop: DiscoveredProposalRaw = {
      id: 4001,
      proposta: "NOMUS-004001",
      dataHoraAbertura: "07/08/2026 08:00:00",
      dataHoraAlteracao: "07/08/2026 10:00:00", // Fora da janela (< 14:12)
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop],
      existingExternalIds: new Set([4001]), // Já existe
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 0);
    assert.equal(result.existingOutsideWindowCount, 1);
    assert.equal(result.classifications[0].isCandidate, false);
    assert.equal(result.classifications[0].reason, "unchanged_outside_window");
  });

  it("P0-E: Proposta existente localmente criada há 60 dias mas alterada AGORA → CANDIDATA (changed_in_window)", () => {
    const prop: DiscoveredProposalRaw = {
      id: 5001,
      proposta: "NOMUS-005001",
      dataHoraAbertura: "07/06/2026 08:00:00", // 60 dias atrás
      dataHoraAlteracao: "07/08/2026 14:40:00", // Alterada agora (> 14:12)
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop],
      existingExternalIds: new Set([5001]),
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 1);
    assert.equal(result.changedInWindowCount, 1);
    assert.equal(result.classifications[0].isCandidate, true);
    assert.equal(result.classifications[0].reason, "changed_in_window");
  });

  it("P0-F: Proposta duplicada na paginação → deduplicada por externalProposalId", () => {
    const prop1: DiscoveredProposalRaw = {
      id: 6001,
      proposta: "NOMUS-006001",
      dataHoraAbertura: "07/08/2026 08:00:00",
    };
    const prop2: DiscoveredProposalRaw = {
      id: 6001,
      proposta: "NOMUS-006001",
      dataHoraAbertura: "07/08/2026 08:00:00",
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop1, prop2],
      existingExternalIds: new Set(),
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.totalDiscovered, 1);
    assert.equal(result.candidatesFound, 1);
    assert.equal(result.classifications.length, 1);
  });

  it("P0-G: Zero candidatos → retorna métricas zeradas sem candidatos", () => {
    const prop: DiscoveredProposalRaw = {
      id: 7001,
      proposta: "NOMUS-007001",
      dataHoraAbertura: "07/08/2026 08:00:00",
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop],
      existingExternalIds: new Set([7001]), // Já existe e não mudou na janela
      isIncremental: true,
      startDate: overlapFrom,
    });

    assert.equal(result.candidatesFound, 0);
    assert.equal(result.missingLocallyCount, 0);
    assert.equal(result.changedInWindowCount, 0);
    assert.equal(result.existingOutsideWindowCount, 1);
  });

  it("P0-K: Daily full → todas as propostas descobertas são candidatas", () => {
    const prop1: DiscoveredProposalRaw = {
      id: 8001,
      proposta: "NOMUS-008001",
      dataHoraAbertura: "07/08/2026 08:00:00",
    };
    const prop2: DiscoveredProposalRaw = {
      id: 8002,
      proposta: "NOMUS-008002",
      dataHoraAbertura: "01/01/2025 08:00:00",
    };

    const result = selectNomusProposalCandidates({
      discoveredProposals: [prop1, prop2],
      existingExternalIds: new Set([8001]), // 8001 existe, 8002 não
      isIncremental: false, // Daily full!
      startDate: null,
    });

    assert.equal(result.candidatesFound, 2);
    assert.equal(result.totalDiscovered, 2);
    assert.equal(result.classifications[0].isCandidate, true);
    assert.equal(result.classifications[1].isCandidate, true);
  });
});
