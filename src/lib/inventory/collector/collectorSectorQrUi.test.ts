import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLLECTOR_PUBLIC_BASE_URL_INVALID,
  COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
} from "./collectorPublicBaseUrl.js";
import {
  buildCollectorSectorQrEndpoint,
  classifyCollectorSectorQrError,
  CollectorSectorQrPayloadError,
  COLLECTOR_SECTOR_QR_DEFAULT_SECTOR,
  parseCollectorSectorQrPayload,
} from "./collectorSectorQrUi.js";

describe("buildCollectorSectorQrEndpoint", () => {
  it("aponta para o endpoint real do backend com o setor padrão", () => {
    assert.equal(
      buildCollectorSectorQrEndpoint(),
      "/api/inventory/collector/sector-qr?sector=RAW_MATERIAL"
    );
    assert.equal(COLLECTOR_SECTOR_QR_DEFAULT_SECTOR, "RAW_MATERIAL");
  });

  it("aceita outro setor sem hardcodar RAW_MATERIAL (future-proof)", () => {
    assert.equal(
      buildCollectorSectorQrEndpoint("FINISHED_GOODS"),
      "/api/inventory/collector/sector-qr?sector=FINISHED_GOODS"
    );
  });
});

describe("parseCollectorSectorQrPayload", () => {
  it("aceita o payload real do endpoint", () => {
    const parsed = parseCollectorSectorQrPayload({
      sector: "RAW_MATERIAL",
      label: "Matéria-prima",
      url: "https://collector.example.com/collector/sector/raw-material",
    });
    assert.deepEqual(parsed, {
      sector: "RAW_MATERIAL",
      label: "Matéria-prima",
      url: "https://collector.example.com/collector/sector/raw-material",
    });
  });

  it("rejeita payload sem url", () => {
    assert.throws(
      () => parseCollectorSectorQrPayload({ sector: "RAW_MATERIAL", label: "Matéria-prima" }),
      CollectorSectorQrPayloadError
    );
  });

  it("rejeita payload com url vazia/whitespace", () => {
    assert.throws(
      () =>
        parseCollectorSectorQrPayload({ sector: "RAW_MATERIAL", label: "Matéria-prima", url: "   " }),
      CollectorSectorQrPayloadError
    );
  });

  it("rejeita payload nulo/indefinido", () => {
    assert.throws(() => parseCollectorSectorQrPayload(null), CollectorSectorQrPayloadError);
    assert.throws(() => parseCollectorSectorQrPayload(undefined), CollectorSectorQrPayloadError);
  });

  it("nunca inventa URL — não há fallback local em nenhum caminho", () => {
    try {
      parseCollectorSectorQrPayload({ sector: "RAW_MATERIAL", label: "Matéria-prima" });
      assert.fail("deveria ter lançado");
    } catch (e) {
      assert.ok(e instanceof CollectorSectorQrPayloadError);
      assert.ok(!(e as Error).message.includes("http"));
    }
  });
});

describe("classifyCollectorSectorQrError", () => {
  it("401 classifica como forbidden", () => {
    const result = classifyCollectorSectorQrError({ status: 401, message: "Autenticação necessária." });
    assert.equal(result.kind, "forbidden");
    assert.equal(result.message, "Autenticação necessária.");
  });

  it("403 classifica como forbidden", () => {
    const result = classifyCollectorSectorQrError({ status: 403 });
    assert.equal(result.kind, "forbidden");
  });

  it("COLLECTOR_PUBLIC_BASE_URL_REQUIRED classifica como config e preserva mensagem oficial", () => {
    const result = classifyCollectorSectorQrError({
      code: COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
      message: "QR de setor indisponível: configure INVENTORY_COLLECTOR_PUBLIC_BASE_URL...",
    });
    assert.equal(result.kind, "config");
    assert.equal(
      result.message,
      "QR de setor indisponível: configure INVENTORY_COLLECTOR_PUBLIC_BASE_URL..."
    );
  });

  it("COLLECTOR_PUBLIC_BASE_URL_INVALID classifica como config", () => {
    const result = classifyCollectorSectorQrError({ code: COLLECTOR_PUBLIC_BASE_URL_INVALID });
    assert.equal(result.kind, "config");
  });

  it("config sem mensagem da API usa o texto administrativo padrão (nunca inventa URL)", () => {
    const result = classifyCollectorSectorQrError({ code: COLLECTOR_PUBLIC_BASE_URL_REQUIRED });
    assert.match(result.message, /URL pública do Collector não está configurada/);
  });

  it("qualquer outro erro (500, rede) classifica como generic", () => {
    const result = classifyCollectorSectorQrError({ status: 500, message: "Falha ao gerar QR." });
    assert.equal(result.kind, "generic");
    assert.equal(result.message, "Falha ao gerar QR.");
  });

  it("erro genérico sem mensagem usa fallback padrão", () => {
    const result = classifyCollectorSectorQrError({});
    assert.equal(result.kind, "generic");
    assert.equal(result.message, "Erro ao gerar o QR do Collector.");
  });
});
