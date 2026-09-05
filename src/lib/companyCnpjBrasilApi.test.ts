import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompanyIntelligenceError } from "./companyCnpjErrors.js";
import {
  BRASIL_API_REQUEST_HEADERS,
  BRASIL_API_USER_AGENT,
  fetchBrasilApiCnpj,
} from "./companyCnpjBrasilApi.js";

const VALID_CNPJ = "11444777000161";

describe("fetchBrasilApiCnpj — headers", () => {
  it("envia Accept e User-Agent estáveis na URL normalizada", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          cnpj: VALID_CNPJ,
          razao_social: "EMPRESA TESTE LTDA",
          descricao_situacao_cadastral: "ATIVA",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const payload = await fetchBrasilApiCnpj(VALID_CNPJ, fetchImpl);
    assert.equal(capturedUrl, `https://brasilapi.com.br/api/cnpj/v1/${VALID_CNPJ}`);
    assert.ok(capturedInit?.signal instanceof AbortSignal);

    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("User-Agent"), BRASIL_API_USER_AGENT);
    assert.equal(headers.get("User-Agent"), "IndusCost/1.0 Company Intelligence");
    assert.deepEqual(
      { ...BRASIL_API_REQUEST_HEADERS },
      {
        Accept: "application/json",
        "User-Agent": "IndusCost/1.0 Company Intelligence",
      }
    );
    assert.equal((payload as { razao_social?: string }).razao_social, "EMPRESA TESTE LTDA");
  });

  it("normaliza máscara na URL e mantém headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ cnpj: VALID_CNPJ, razao_social: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await fetchBrasilApiCnpj("11.444.777/0001-61", fetchImpl);
    assert.equal(capturedUrl, `https://brasilapi.com.br/api/cnpj/v1/${VALID_CNPJ}`);
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("User-Agent"), "IndusCost/1.0 Company Intelligence");
  });

  it("classifica HTTP 403 como UPSTREAM_ERROR (sem mudar contrato)", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "403", message: "Forbidden" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(
      () => fetchBrasilApiCnpj(VALID_CNPJ, fetchImpl),
      (e: unknown) =>
        e instanceof CompanyIntelligenceError &&
        e.code === "UPSTREAM_ERROR" &&
        e.message.includes("403")
    );
  });
});
