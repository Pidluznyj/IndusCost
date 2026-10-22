/**
 * Radar de relacionamentos. Nome, Gmail, CEP e escritório não confirmam grupo.
 * A varredura em dry-run não grava. O crédito só recebe relação formal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidCnpj } from "../companyCnpjFormat.js";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import { assessCorporateLinkReview } from "./corporateLinkReview.js";
import {
  classifyCorporateEmail,
  cnpjRoot,
  correlateCorporatePair,
  isMatrizCnpj,
  normalizeBrazilPhone,
  sameRootPeers,
  scanCorporateRadar,
  type RadarParty,
} from "./corporateRadar.js";
import {
  observeCustomerSyncRadar,
  persistRadarSignals,
  resetCorporateRadarForTests,
  runCorporateRadar,
  scheduleCorporateRadar,
  selectPeriodicSeeds,
  radarQueueSize,
  withRadarRetry,
} from "./corporateRadar.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = new Date(2026, 9, 22, 12, 0, 0);
const recovered = { attempts: 0 };

function cnpj(base12: string): string {
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const first = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(base12 + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${first}${second}`;
}

const MATRIZ = cnpj("123456780001");
const FILIAL = cnpj("123456780002");
const OTHER = cnpj("998887770001");

function party(customerId: string, taxId: string, extra: Partial<RadarParty> = {}): RadarParty {
  return { customerId, cnpj: taxId, companyName: customerId, ...extra };
}

describe("normalização do radar", () => {
  it("T01 a T08 CNPJ, nome, telefone, e-mail e endereço", () => {
    assert.equal(isValidCnpj(MATRIZ), true);
    assert.equal(cnpjRoot(`12.345.678/0001-${MATRIZ.slice(12)}`), cnpjRoot(MATRIZ));
    assert.equal(cnpjRoot(MATRIZ), cnpjRoot(FILIAL));
    assert.equal(isMatrizCnpj(MATRIZ), true);
    assert.equal(isMatrizCnpj(FILIAL), false);
    assert.equal(cnpjRoot(MATRIZ) === cnpjRoot(OTHER), false);
    const named = correlateCorporatePair({
      left: party(A, MATRIZ),
      right: party(B, OTHER),
      memberships: [
        { subjectCustomerId: A, nameKey: "JOAO DA SILVA", displayName: "João da Silva" },
        { subjectCustomerId: B, nameKey: "JOAO DA SILVA", displayName: "Joao da Silva" },
      ],
    });
    assert.equal(named.patterns.some((pattern) => pattern.code === "REL-04"), true);
    assert.equal(normalizeBrazilPhone("+55 (83) 98888-1234"), normalizeBrazilPhone("83988881234"));
    assert.equal(normalizeBrazilPhone("0000000000"), null);
    assert.equal(normalizeBrazilPhone("08001234567"), null);
    assert.equal(classifyCorporateEmail("Maria@Empresa.com.br").email, "maria@empresa.com.br");
    assert.equal(classifyCorporateEmail("contador@empresa.com.br").emailClass, "GENERIC");
    assert.equal(classifyCorporateEmail("joao@gmail.com").emailClass, "PUBLIC");
    const address = correlateCorporatePair({
      left: party(A, MATRIZ, { address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010-000" }),
      right: party(B, OTHER, { address: "Rua das Flores, 10", city: "Joao Pessoa", state: "Paraíba", zipCode: "58010000" }),
      memberships: [],
    });
    assert.equal(address.patterns.some((pattern) => pattern.code === "REL-05"), true);
    const cep = correlateCorporatePair({
      left: party(A, MATRIZ, { address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010-000" }),
      right: party(B, OTHER, { address: "Avenida Brasil, 500", city: "João Pessoa", state: "PB", zipCode: "58010-000" }),
      memberships: [],
    });
    assert.equal(cep.patterns.some((pattern) => pattern.code === "REL-09"), true);
    assert.equal(cep.review, false);
    assert.equal(cep.propagationEligible, false);
  });
});

describe("correlação do radar", () => {
  it("T09 a T18 identidade, contatos, combinação e escritório", () => {
    const identity = correlateCorporatePair({
      left: party(A, MATRIZ),
      right: party(B, OTHER),
      memberships: [
        { subjectCustomerId: A, identityKey: "cpf:abc", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA" },
        { subjectCustomerId: B, identityKey: "cpf:abc", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA" },
      ],
    });
    assert.equal(identity.classification, "FORMAL");
    assert.equal(identity.patterns.some((pattern) => pattern.code === "REL-02"), true);
    assert.equal(identity.evidenceSummary.includes("cpf:abc"), false);
    const partner = correlateCorporatePair({
      left: party(A, MATRIZ),
      right: party(B, OTHER),
      memberships: [{ subjectCustomerId: A, memberCnpj: OTHER }],
    });
    assert.equal(partner.patterns.some((pattern) => pattern.code === "REL-03"), true);
    assert.equal(partner.direction, "PARTICIPATION");
    const phone = correlateCorporatePair({
      left: party(A, MATRIZ, { phone: "+55 83 98888-1234" }),
      right: party(B, OTHER, { phone: "83988881234" }),
      memberships: [],
    });
    assert.equal(phone.patterns.some((pattern) => pattern.code === "REL-06"), true);
    assert.equal(phone.propagationEligible, false);
    const email = correlateCorporatePair({
      left: party(A, MATRIZ, { email: "ana.souza@oficina.com.br" }),
      right: party(B, OTHER, { email: "Ana.Souza@Oficina.com.br" }),
      memberships: [],
    });
    assert.equal(email.patterns.some((pattern) => pattern.code === "REL-07"), true);
    const gmail = correlateCorporatePair({
      left: party(A, MATRIZ, { email: "joao@gmail.com" }),
      right: party(B, OTHER, { email: "joao@gmail.com" }),
      memberships: [],
    });
    assert.equal(gmail.review, false);
    assert.equal(gmail.propagationEligible, false);
    const combined = scanCorporateRadar({
      parties: [
        party(A, MATRIZ, { phone: "83988881234", address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010000", restricted: true }),
        party(B, OTHER, { phone: "83988881234", address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010000" }),
      ],
      memberships: [
        { subjectCustomerId: A, nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" },
        { subjectCustomerId: B, nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" },
      ],
    });
    assert.equal(combined.reviewQueue[0]?.classification, "HIGH_REVIEW");
    assert.equal(combined.reviewQueue[0]?.priorityRank, 1);
    assert.equal(combined.reviewQueue[0]?.propagationEligible, false);
    const office = correlateCorporatePair({
      left: party(A, MATRIZ, { phone: "83988881234", phoneKind: "ACCOUNTING", email: "contador@escritorio.com.br", address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010000" }),
      right: party(B, OTHER, { phone: "83988881234", phoneKind: "ACCOUNTING", email: "contador@escritorio.com.br", address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58010000" }),
      memberships: [],
    });
    assert.equal(office.classification, "COMPLEMENTARY");
    assert.equal(office.patterns.filter((pattern) => pattern.independent).length, 0);
    const surname = correlateCorporatePair({
      left: party(A, MATRIZ),
      right: party(B, OTHER),
      memberships: [
        { subjectCustomerId: A, nameKey: "ANA SILVA" },
        { subjectCustomerId: B, nameKey: "BRUNO SILVA" },
      ],
    });
    assert.equal(surname.review, false);
    assert.equal(surname.propagationEligible, false);
  });

  it("raiz comum é formal e não duplica o par", () => {
    const scan = scanCorporateRadar({
      parties: [party(A, MATRIZ), party(B, FILIAL), party(C, OTHER)],
    });
    assert.equal(scan.formal.length, 1);
    assert.equal(scan.formal[0]?.propagationEligible, true);
    assert.equal(scan.formal[0]?.patterns[0]?.code, "REL-01");
    assert.equal(sameRootPeers({ customerId: A, cnpj: MATRIZ }, [{ customerId: B, cnpj: FILIAL }, { customerId: C, cnpj: OTHER }]).includes(C), false);
  });
});

describe("governança e rotinas do radar", () => {
  it("T19 a T26 confirmação, rejeição, simetria e candidato rejeitado", async () => {
    const denied = assessCorporateLinkReview({
      actor: { role: "SUPER_ADMIN", assignedPermissions: [] },
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "Justificativa objetiva do vínculo societário.",
    });
    assert.equal(denied.ok, false);
    const allowed = assessCorporateLinkReview({
      actor: { role: "ADMIN", assignedPermissions: ["commercial.credit.exception.grant"] },
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "Contrato social confere o mesmo administrador.",
    });
    assert.equal(allowed.ok, true);
    const scan = scanCorporateRadar({
      parties: [party(A, MATRIZ, { phone: "83988881234" }), party(B, OTHER, { phone: "83988881234" })],
    });
    const pair = scan.reviewQueue[0]!;
    const rejected = scanCorporateRadar({
      parties: [party(A, MATRIZ, { phone: "83988881234" }), party(B, OTHER, { phone: "83988881234" })],
      rejected: [{ pairKey: pair.pairKey, fingerprint: pair.fingerprint }],
    });
    assert.equal(rejected.reviewQueue.length, 0);
    assert.equal(rejected.correlations[0]?.classification, "REJECTED");
    const rootPair = scanCorporateRadar({ parties: [party(A, MATRIZ), party(B, FILIAL)] }).formal[0]!.pairKey;
    const closed = scanCorporateRadar({
      parties: [party(A, MATRIZ), party(B, FILIAL)],
      closedPairKeys: [rootPair],
    });
    assert.equal(closed.formal.length, 0);
    assert.equal(closed.correlations[0]?.classification, "CLOSED");
    const writes: string[] = [];
    const saved = await persistRadarSignals(
      {
        commercialCorporateRadarSignal: {
          findUnique: async () => null,
          upsert: async () => {
            writes.push("upsert");
            return { id: "1", pairKey: pair.pairKey, status: "OPEN", evidenceFingerprint: pair.fingerprint, evidenceSummary: pair.evidenceSummary };
          },
          findMany: async () => [],
        },
      },
      [pair],
      NOW,
      "TEST"
    );
    assert.equal(saved.created, 1);
    const again = await persistRadarSignals(
      {
        commercialCorporateRadarSignal: {
          findUnique: async () => ({ id: "1", pairKey: pair.pairKey, status: "REJECTED", evidenceFingerprint: pair.fingerprint, evidenceSummary: pair.evidenceSummary }),
          upsert: async () => {
            writes.push("again");
            return { id: "1", pairKey: pair.pairKey, status: "REJECTED", evidenceFingerprint: pair.fingerprint, evidenceSummary: pair.evidenceSummary };
          },
          findMany: async () => [],
        },
      },
      [pair],
      NOW,
      "TEST"
    );
    assert.equal(again.unchanged, 1);
    assert.equal(writes.includes("again"), false);
  });

  it("T27 a T38 varredura, incremental, periódica, concorrência e falha isolada", async () => {
    resetCorporateRadarForTests();
    const parties = [party(A, MATRIZ, { phone: "83988881234", updatedAt: NOW }), party(B, OTHER, { phone: "83988881234", updatedAt: new Date(2026, 0, 1) })];
    const dry = await runCorporateRadar({ parties, mode: "dry-run", dryRun: true, persist: false });
    assert.equal(dry.created, 0);
    assert.equal(dry.queued > 0, true);
    const incremental = await runCorporateRadar({ parties, seeds: [A], mode: "incremental", dryRun: true, persist: false });
    assert.equal(incremental.examined, 1);
    assert.equal(incremental.queued, 1);
    const since = new Date(2026, 8, 1);
    assert.deepEqual(selectPeriodicSeeds(parties, [], since), [A]);
    scheduleCorporateRadar(C, "CUSTOMER_CREATE");
    assert.equal(radarQueueSize(), 1);
    resetCorporateRadarForTests();
    const retried = await withRadarRetry(async () => {
      if (recovered.attempts === 0) {
        recovered.attempts += 1;
        throw new Error("transitória");
      }
      return "ok";
    });
    assert.equal(retried, "ok");
    const first = runCorporateRadar({ parties, mode: "portfolio", dryRun: true, persist: false });
    const second = await runCorporateRadar({ parties, mode: "portfolio", dryRun: true, persist: false });
    await first;
    assert.equal(second.skipped, true);
    assert.equal(await observeCustomerSyncRadar(async () => {
      throw new Error("radar");
    }), "failed");
    const radarSource = readFileSync(join(here, "corporateRadar.ts"), "utf8");
    const serverSource = readFileSync(join(here, "corporateRadar.server.ts"), "utf8");
    const syncSource = readFileSync(join(here, "../../../scripts/nomusCustomersSyncV1.ts"), "utf8");
    assert.equal(radarSource.includes("NomusAccountsReceivable"), false);
    assert.equal(radarSource.includes("commission"), false);
    assert.equal(serverSource.includes("ieptb"), false);
    assert.ok(syncSource.indexOf("runCommissionMaterializationAfterNomusSync") < syncSource.indexOf("observeCustomerSyncRadar"));
  });
});

describe("integração do radar com o crédito", () => {
  it("T39 a T45 suspeita não bloqueia como grupo e a relação formal fica disponível", () => {
    const suspicious = correlateCorporatePair({
      left: party(A, MATRIZ),
      right: party(B, OTHER),
      memberships: [
        { subjectCustomerId: A, nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" },
        { subjectCustomerId: B, nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" },
      ],
    });
    assert.equal(suspicious.propagationEligible, false);
    const before = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular(),
      pendingRelatedPartyCount: suspicious.review ? 1 : 0,
      relatedParties: [],
      now: NOW,
    });
    assert.equal(before.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(before.evidence.relatedParties.length, 0);
    const formal = sameRootPeers({ customerId: A, cnpj: MATRIZ }, [{ customerId: B, cnpj: FILIAL }]);
    const after = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular(),
      relatedParties: [{ customerId: formal[0]!, delinquency: overdue() }],
      now: NOW,
    });
    assert.equal(after.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(JSON.stringify(after.evidence).includes("6560"), false);
    const own = decideCommercialCredit({
      customerId: C,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: overdue(),
      now: NOW,
    });
    assert.equal(own.reason, "OVERDUE_OPEN_BALANCE");
    const decisionSource = readFileSync(join(here, "commercialCreditDecision.ts"), "utf8");
    assert.equal(decisionSource.includes("fetch("), false);
  });
});

describe("desempenho do radar", () => {
  it("mede varredura de 1.000, 10.000 e 50.000 cadastros sintéticos", () => {
    for (const size of [1000, 10000, 50000]) {
      const parties: RadarParty[] = [];
      for (let index = 0; index < size; index += 1) {
        const base = String(100000000000 + index).padStart(12, "0").slice(0, 12);
        parties.push(party(`p${index}`, cnpj(base), { phone: `11${String(900000000 + index).slice(0, 9)}` }));
      }
      parties.push(party("shared-a", MATRIZ, { phone: "11999990000" }));
      parties.push(party("shared-b", FILIAL, { phone: "11999990000" }));
      const scan = scanCorporateRadar({ parties });
      console.info(`corporate-radar size=${size} ms=${scan.durationMs} candidates=${scan.reviewQueue.length} formal=${scan.formal.length} genericSkipped=${scan.genericKeysSkipped}`);
      assert.equal(scan.durationMs < (size === 50000 ? 15000 : 8000), true);
      assert.equal(scan.formal.some((row) => row.patterns.some((pattern) => pattern.code === "REL-01")), true);
    }
  });
});

function regular() {
  return {
    status: "REGULAR" as const,
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: "2026-10-05T12:00:00.000Z",
    evidence: blankEvidence(),
  };
}

function overdue() {
  return {
    status: "OVERDUE" as const,
    unknownReason: null,
    overdueTitleCount: 2,
    overdueAmount: 6560,
    openAmount: 6560,
    maxDaysOverdue: 40,
    lastSyncedAt: "2026-10-05T12:00:00.000Z",
    evidence: blankEvidence(),
  };
}

function blankEvidence() {
  return {
    source: "NOM" as never,
    toleranceDays: 3,
    toleranceUnit: "CALENDAR_DAYS" as const,
    referenceDate: "2026-10-22",
    cnpj: null,
    nomusPersonId: null,
    identity: "RESOLVED" as const,
    syncRunStatus: null,
    payloadComplete: true,
    sourceMaxSyncedAt: null,
    includedTitleIds: [],
    overdueTitleIds: [],
    protestedTitleIds: [],
    protestReading: "NOT_IN_SOURCE" as const,
    exclusions: [],
  };
}
