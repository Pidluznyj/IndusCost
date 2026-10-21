import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDirectDataHttpResponse,
  classifyDirectDataNetworkError,
  paidQueryCodeFromProvider,
} from "./classifyProviderResponse.js";
import { paidConsultationHttpStatus, paidConsultationMessage } from "./paidConsultationMessages.js";

describe("classificação Direct Data", () => {
  it("SaldoInsuficiente em 200 não cobra", () => {
    const result = classifyDirectDataHttpResponse(200, {
      metaDados: { resultado: "SaldoInsuficiente", mensagem: "Saldo insuficiente." },
    });
    assert.equal(result.outcome, "INSUFFICIENT_BALANCE");
    assert.equal(result.charge, "no");
    assert.deepEqual(paidQueryCodeFromProvider(result), {
      code: "INSUFFICIENT_BALANCE",
      persist: "failed_not_sent",
    });
    assert.equal(paidConsultationHttpStatus("INSUFFICIENT_BALANCE"), 402);
    assert.match(paidConsultationMessage("INSUFFICIENT_BALANCE"), /Saldo insuficiente na Direct Data/);
  });

  it("mensagem de plano ativo também é saldo do provedor", () => {
    const result = classifyDirectDataHttpResponse(400, {
      metaDados: { mensagem: "Não existe um plano ativo" },
    });
    assert.equal(result.outcome, "INSUFFICIENT_BALANCE");
    assert.equal(result.charge, "no");
  });

  it("401 é autenticação sem cobrança", () => {
    const result = classifyDirectDataHttpResponse(401, {});
    assert.equal(result.outcome, "AUTH");
    assert.equal(result.charge, "no");
  });

  it("503 e SistemaRemotoIndisponivel são indisponibilidade sem cobrança", () => {
    assert.equal(classifyDirectDataHttpResponse(503, null).outcome, "UNAVAILABLE");
    const body = classifyDirectDataHttpResponse(200, {
      metaDados: { resultado: "SistemaRemotoIndisponivel", mensagem: "Fonte indisponível" },
    });
    assert.equal(body.outcome, "UNAVAILABLE");
    assert.equal(body.charge, "no");
  });

  it("408 e TempoEsgotado são timeout do provedor sem cobrança", () => {
    assert.equal(classifyDirectDataHttpResponse(408, null).outcome, "TIMEOUT");
    assert.equal(classifyDirectDataHttpResponse(408, null).charge, "no");
    const body = classifyDirectDataHttpResponse(200, { metaDados: { resultado: "TempoEsgotado" } });
    assert.equal(body.outcome, "TIMEOUT");
    assert.equal(body.charge, "no");
  });

  it("timeout local (AbortError) fica cobrança indeterminada", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    const result = classifyDirectDataNetworkError(error);
    assert.equal(result.outcome, "TIMEOUT");
    assert.equal(result.charge, "unknown");
    assert.equal(paidQueryCodeFromProvider(result).persist, "unknown");
  });

  it("Sucesso cobra; 5xx sem resultado fica indeterminado", () => {
    const ok = classifyDirectDataHttpResponse(200, { metaDados: { resultado: "Sucesso" }, retorno: {} });
    assert.equal(ok.outcome, "SUCCESS");
    assert.equal(ok.charge, "yes");
    const fail = classifyDirectDataHttpResponse(500, null);
    assert.equal(fail.outcome, "HTTP_ERROR");
    assert.equal(fail.charge, "unknown");
  });

  it("não usa Erro HTTP 409 como mensagem de negócio", () => {
    for (const code of ["IN_FLIGHT", "UNKNOWN_BILLING", "INSUFFICIENT_BALANCE", "AUTH", "TIMEOUT", "PARTIAL"]) {
      assert.doesNotMatch(paidConsultationMessage(code), /Erro HTTP 409/);
    }
  });
});
