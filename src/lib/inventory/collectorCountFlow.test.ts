/**
 * FASE 3 — máquina de estados da contagem no Collector (contrato 2B no cliente).
 *
 * Prova sem DOM: operationId por intenção, retry idempotente, conflito sem
 * overwrite, justificativa preservando quantidade, replay como sucesso e o
 * ciclo scan → quantidade → confirmar → próximo QR.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyFailure,
  applyReloadedLine,
  applySuccess,
  beginCount,
  createCollectorFlow,
  parseQuantityText,
  prepareSubmission,
  readyForNextScan,
  setJustification,
  setQuantity,
  type CollectorLineInfo,
} from "../../components/inventory/collector/collectorCountFlow.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const LINE: CollectorLineInfo = {
  lineId: "line-1",
  expectedVersion: 3,
  alreadyCounted: false,
  itemCode: "MP-001",
  itemDescription: "Resina ABS",
  itemUnit: "KG",
  warehouseCode: "ALM1",
  warehouseName: "Central",
  locationCode: "A-01",
  locationName: "Corredor A",
};

function countingState(quantity = "80") {
  return setQuantity(beginCount(createCollectorFlow(), LINE), quantity);
}

describe("F3 flow — envio e intenção", () => {
  it("17/18. envio carrega expectedVersion e operationId", () => {
    const prepared = prepareSubmission(countingState());
    assert.ok(prepared);
    assert.equal(prepared.submission.expectedVersion, 3);
    assert.equal(prepared.submission.lineId, "line-1");
    assert.equal(prepared.submission.countedQuantity, 80);
    assert.ok(prepared.submission.operationId.length > 8);
    assert.equal(prepared.state.phase, "saving");
  });

  it("19. double-submit bloqueado: estado saving não prepara segundo envio", () => {
    const prepared = prepareSubmission(countingState());
    assert.ok(prepared);
    assert.equal(prepareSubmission(prepared.state), null);
  });

  it("20. falha de rede preserva a intenção → retry reutiliza a MESMA operationId", () => {
    const first = prepareSubmission(countingState());
    assert.ok(first);
    const afterNetworkFailure = applyFailure(first.state, {
      status: null,
      code: null,
      message: "timeout",
    });
    assert.equal(afterNetworkFailure.phase, "counting");
    const retry = prepareSubmission(afterNetworkFailure);
    assert.ok(retry);
    assert.equal(retry.submission.operationId, first.submission.operationId);
  });

  it("21. alterar quantidade/justificativa/versão cria NOVA operationId", () => {
    const first = prepareSubmission(countingState("80"));
    assert.ok(first);
    const failed = applyFailure(first.state, { status: null, code: null, message: null });

    const changedQty = prepareSubmission(setQuantity(failed, "79"));
    assert.ok(changedQty);
    assert.notEqual(changedQty.submission.operationId, first.submission.operationId);

    const changedJust = prepareSubmission(
      setJustification(setQuantity(failed, "80"), "avaria")
    );
    assert.ok(changedJust);
    assert.notEqual(changedJust.submission.operationId, first.submission.operationId);
  });

  it("22. replay é sucesso normal — o cliente não distingue", () => {
    // Estrutural: o client trata `replayed` apenas como flag informativa e a
    // página aplica applySuccess sem ramificação de erro.
    const client = read("src/components/inventory/collector/collectorClient.ts");
    assert.match(client, /replayed: data\.replayed === true/);
    const page = read("src/components/inventory/collector/CollectorPage.tsx");
    assert.match(page, /applySuccess/);
    assert.doesNotMatch(page, /replayed\s*\?/);

    const done = applySuccess(countingState());
    assert.equal(done.phase, "success");
    assert.equal(done.message, "Contagem registrada");
  });
});

describe("F3 flow — conflito e justificativa", () => {
  it("23/24. 409 de versão: sem overwrite, sem retry automático, decisão nova", () => {
    const first = prepareSubmission(countingState());
    assert.ok(first);
    const conflicted = applyFailure(first.state, {
      status: 409,
      code: "COUNT_LINE_VERSION_CONFLICT",
      message: "conflito",
    });
    assert.equal(conflicted.phase, "conflict");
    // Intenção descartada: nada de reaproveitar a chave num retry automático.
    assert.equal(conflicted.attempt, null);
    assert.match(conflicted.message ?? "", /outro dispositivo|atualizado/);

    // Recarga do vigente: quantidade zerada, versão nova, intenção nova.
    const reloaded = applyReloadedLine(conflicted, { ...LINE, expectedVersion: 4 });
    assert.equal(reloaded.phase, "counting");
    assert.equal(reloaded.quantityText, "");
    assert.equal(reloaded.line?.expectedVersion, 4);
    const resubmit = prepareSubmission(setQuantity(reloaded, "80"));
    assert.ok(resubmit);
    assert.equal(resubmit.submission.expectedVersion, 4);
    assert.notEqual(resubmit.submission.operationId, first.submission.operationId);
  });

  it("25/26. JUSTIFICATION_REQUIRED preserva quantidade e reenvia com chave nova", () => {
    const first = prepareSubmission(countingState("78"));
    assert.ok(first);
    const needs = applyFailure(first.state, {
      status: 400,
      code: "JUSTIFICATION_REQUIRED",
      message: "precisa justificar",
    });
    assert.equal(needs.phase, "needs-justification");
    // Quantidade digitada NÃO se perde.
    assert.equal(needs.quantityText, "78");

    const withJust = setJustification(needs, "Falta confirmada fisicamente");
    const resent = prepareSubmission(withJust);
    assert.ok(resent);
    assert.equal(resent.submission.countedQuantity, 78);
    assert.equal(resent.submission.justification, "Falta confirmada fisicamente");
    // Payload mudou (ganhou justificativa) → intenção nova → chave nova.
    assert.notEqual(resent.submission.operationId, first.submission.operationId);
  });

  it("idempotency conflict descarta a intenção e devolve à digitação", () => {
    const first = prepareSubmission(countingState());
    assert.ok(first);
    const after = applyFailure(first.state, {
      status: 409,
      code: "COUNT_OPERATION_IDEMPOTENCY_CONFLICT",
      message: null,
    });
    assert.equal(after.phase, "counting");
    assert.equal(after.attempt, null);
  });
});

describe("F3 flow — quantidade e ciclo", () => {
  it("Decimal(20,6): vírgula, 6 casas e rejeição de negativos/lixo", () => {
    assert.equal(parseQuantityText("80"), 80);
    assert.equal(parseQuantityText("10,5"), 10.5);
    assert.equal(parseQuantityText("0.000001"), 0.000001);
    assert.equal(parseQuantityText("1.0000009"), 1.000001);
    assert.equal(parseQuantityText("-1"), null);
    assert.equal(parseQuantityText(""), null);
    assert.equal(parseQuantityText("abc"), null);
  });

  it("48/51/52/54. estados: scanner → item → sucesso → próximo scan", () => {
    const initial = createCollectorFlow();
    assert.equal(initial.phase, "scanning");
    assert.equal(initial.line, null);

    const counting = beginCount(initial, LINE);
    assert.equal(counting.phase, "counting");
    assert.equal(counting.quantityText, "");

    const prepared = prepareSubmission(setQuantity(counting, "80"));
    assert.ok(prepared);
    assert.equal(prepared.state.phase, "saving");

    const success = applySuccess(prepared.state);
    assert.equal(success.phase, "success");
    // Estado anterior limpo.
    assert.equal(success.line, null);
    assert.equal(success.quantityText, "");
    assert.equal(success.attempt, null);

    const next = readyForNextScan(success);
    assert.equal(next.phase, "scanning");
  });

  it("item já contado avisa sem mostrar o valor anterior (cego)", () => {
    const counting = beginCount(createCollectorFlow(), { ...LINE, alreadyCounted: true });
    assert.match(counting.message ?? "", /já foi contado/);
    assert.doesNotMatch(counting.message ?? "", /\d/);
  });

  it("49/50. UI tem retentativa de câmera, entrada manual e erro de API visível", () => {
    const scanner = read("src/components/inventory/collector/CollectorQrScanner.tsx");
    assert.match(scanner, /Tentar câmera novamente/);
    assert.match(scanner, /collector-manual-qr/);
    assert.match(scanner, /Câmera indisponível/);
    const page = read("src/components/inventory/collector/CollectorPage.tsx");
    assert.match(page, /resolveError/);
    assert.match(page, /Verificando dispositivo/);
    // O aparelho desconhecido nao morre mais numa tela sem saida: cai na
    // tela de espera, que pede autorizacao e aguarda a decisao humana.
    assert.match(page, /CollectorEnrollmentScreen/);
    const gate = read(
      "src/components/inventory/collector/CollectorEnrollmentGate.tsx"
    );
    assert.match(gate, /Dispositivo aguardando autorização/);
    assert.match(page, /Nenhuma conferência ativa/);
  });

  it("página Collector é standalone: sem shell administrativo, sem login humano", () => {
    const app = read("src/App.tsx");
    const idx = app.indexOf('path="/collector"');
    assert.ok(idx > 0, "rota /collector não registrada");
    assert.doesNotMatch(app.slice(idx, idx + 120), /ModulePageShell/);
    const page = read("src/components/inventory/collector/CollectorPage.tsx");
    assert.doesNotMatch(page, /useAuth|AuthContext|requireAppAuth/);
  });
});
