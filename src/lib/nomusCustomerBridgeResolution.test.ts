import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveNomusCustomerBridge,
  clearCustomerBridgeMemoryCacheForTests,
} from "./nomusCustomerBridgeResolution.js";

describe("nomusCustomerBridgeResolution — Matriz P0 Customer Bridge", () => {
  beforeEach(() => {
    clearCustomerBridgeMemoryCacheForTests();
  });

  it("P0-01 & P0-06: externalCustomerId existe em SalesOrder → resolve Customer.id localmente com 0 HTTP requests", async () => {
    const mockPrisma = {
      salesOrder: {
        findMany: async (args: any) => {
          assert.deepEqual(args.where.externalCustomerId.in, [101]);
          return [
            {
              externalCustomerId: 101,
              Customer: {
                id: "cust-uuid-101",
                taxId: "12345678000190",
              },
            },
          ];
        },
      },
      customer: {
        findMany: async () => [],
      },
    };

    const result = await resolveNomusCustomerBridge(
      mockPrisma as any,
      "http://nomus.fake",
      [101]
    );

    assert.equal(result.metrics.requestedExternalCustomerIds, 1);
    assert.equal(result.metrics.resolvedFromSalesOrders, 1);
    assert.equal(result.metrics.peopleBatchRequests, 0); // ZERO HTTP requests!
    assert.equal(result.metrics.peopleFallbackRequests, 0);
    assert.equal(result.bridge.get(101)?.customerId, "cust-uuid-101");
    assert.equal(result.bridge.get(101)?.taxId, "12345678000190");
  });

  it("P0-02 & P0-03: Formatação de CNPJ diferente → normalizeTaxId resolve por taxId sem erro de campo inexistente", async () => {
    const mockPrisma = {
      salesOrder: {
        findMany: async () => [], // Não existe em SalesOrder
      },
      customer: {
        findMany: async (args: any) => {
          assert.deepEqual(args.where.taxId.in, ["98765432000100"]);
          return [
            {
              id: "cust-uuid-202",
              taxId: "98.765.432/0001-00", // Formatação com pontuação no banco
            },
          ];
        },
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
      return new Response(
        JSON.stringify([
          {
            id: 202,
            cnpj: "98.765.432/0001-00", // Formatação diferente
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      const result = await resolveNomusCustomerBridge(
        mockPrisma as any,
        "http://nomus.fake",
        [202]
      );

      assert.equal(result.metrics.resolvedFromSalesOrders, 0);
      assert.equal(result.metrics.peopleBatchRequests, 1);
      assert.equal(result.metrics.resolvedByTaxId, 1);
      assert.equal(result.bridge.get(202)?.customerId, "cust-uuid-202");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P0-04: 50 IDs em SalesOrder → 1 query SQL em lote, 0 N+1", async () => {
    let salesOrderQueryCount = 0;
    const mockPrisma = {
      salesOrder: {
        findMany: async (args: any) => {
          salesOrderQueryCount += 1;
          const ids = args.where.externalCustomerId.in;
          return ids.map((id: number) => ({
            externalCustomerId: id,
            Customer: { id: `cust-${id}`, taxId: `${id}00000000` },
          }));
        },
      },
      customer: { findMany: async () => [] },
    };

    const ids50 = Array.from({ length: 50 }, (_, i) => i + 1);
    const result = await resolveNomusCustomerBridge(
      mockPrisma as any,
      "http://nomus.fake",
      ids50
    );

    assert.equal(salesOrderQueryCount, 1); // Exatamente 1 query SQL em lote!
    assert.equal(result.metrics.resolvedFromSalesOrders, 50);
    assert.equal(result.metrics.peopleBatchRequests, 0);
  });

  it("P0-05: 20 taxIds restantes → 1 query SQL em lote no Customer, 0 N+1", async () => {
    let customerQueryCount = 0;
    const mockPrisma = {
      salesOrder: { findMany: async () => [] },
      customer: {
        findMany: async (args: any) => {
          customerQueryCount += 1;
          const taxIds = args.where.taxId.in;
          return taxIds.map((taxId: string, idx: number) => ({
            id: `cust-by-tax-${idx}`,
            taxId,
          }));
        },
      },
    };

    const ids20 = Array.from({ length: 20 }, (_, i) => i + 200);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
      const pessoas = ids20.map((id) => ({
        id,
        cnpj: `11223344000${id}`,
      }));
      return new Response(JSON.stringify(pessoas), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await resolveNomusCustomerBridge(
        mockPrisma as any,
        "http://nomus.fake",
        ids20
      );

      assert.equal(customerQueryCount, 1); // Exatamente 1 query SQL em lote!
      assert.equal(result.metrics.resolvedByTaxId, 20);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P0-08: Batch Nomus falha (HTTP 500) → Fallback seguro individual funciona sem abortar o sync", async () => {
    const mockPrisma = {
      salesOrder: { findMany: async () => [] },
      customer: {
        findMany: async (args: any) => [
          { id: "cust-fb-1", taxId: "990000000001" },
          { id: "cust-fb-2", taxId: "990000000002" },
        ],
      },
    };

    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("id=in=")) {
        // Simula falha do endpoint de batch
        return new Response("Batch error", { status: 500 });
      }
      if (urlStr.includes("id==1")) {
        return new Response(JSON.stringify([{ id: 1, cnpj: "990000000001" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ id: 2, cnpj: "990000000002" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await resolveNomusCustomerBridge(
        mockPrisma as any,
        "http://nomus.fake",
        [1, 2],
        { maxRetries: 0 }
      );

      assert.equal(result.metrics.peopleBatchRequests, 1);
      assert.equal(result.metrics.peopleFallbackRequests, 2);
      assert.equal(result.metrics.resolvedByTaxId, 2);
      assert.equal(result.bridge.get(1)?.customerId, "cust-fb-1");
      assert.equal(result.bridge.get(2)?.customerId, "cust-fb-2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P0-09 & P0-10: Pessoa sem CNPJ ou Customer não cadastrado → permanece customerId null (unresolved)", async () => {
    const mockPrisma = {
      salesOrder: { findMany: async () => [] },
      customer: { findMany: async () => [] },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify([{ id: 404, cnpj: null, cpf: null }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      const result = await resolveNomusCustomerBridge(
        mockPrisma as any,
        "http://nomus.fake",
        [404]
      );

      assert.equal(result.metrics.unresolvedFinal, 1);
      assert.equal(result.bridge.get(404)?.customerId, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P0-11: Conflito de identidade em SalesOrder → não escolhe arbitrariamente, marca como conflito", async () => {
    const mockPrisma = {
      salesOrder: {
        findMany: async () => [
          {
            externalCustomerId: 555,
            Customer: { id: "cust-A", taxId: "11111111000111" },
          },
          {
            externalCustomerId: 555,
            Customer: { id: "cust-B", taxId: "22222222000222" },
          },
        ],
      },
      customer: { findMany: async () => [] },
    };

    const result = await resolveNomusCustomerBridge(
      mockPrisma as any,
      "http://nomus.fake",
      [555]
    );

    assert.equal(result.metrics.conflicts, 1);
    assert.equal(result.metrics.resolvedFromSalesOrders, 0);
    assert.equal(result.metrics.peopleBatchRequests, 0); // Não busca no Nomus para ID em conflito!
    assert.equal(result.bridge.get(555)?.customerId, null);
    assert.equal(result.bridge.get(555)?.conflict, true);
  });

  it("P0-22 (PROTEÇÃO DE REGRESSÃO): Garante estritamente que Customer.sourceExternalId NÃO é acessado em propostas", () => {
    const rootDir = process.cwd();
    const proposalsSyncPath = path.join(rootDir, "scripts", "nomusProposalsSyncV1.ts");
    const bridgePath = path.join(rootDir, "src", "lib", "nomusCustomerBridgeResolution.ts");

    const proposalsSyncContent = fs.readFileSync(proposalsSyncPath, "utf-8");
    const bridgeContent = fs.readFileSync(bridgePath, "utf-8");

    // Remove JSDoc / comentários antes da verificação
    const proposalsCodeOnly = proposalsSyncContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    const bridgeCodeOnly = bridgeContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

    assert.equal(
      /Customer\s*:\s*\{[^}]*sourceExternalId/g.test(proposalsCodeOnly),
      false,
      "REGRESSÃO DETECTADA: scripts/nomusProposalsSyncV1.ts não pode consultar Customer.sourceExternalId"
    );
    assert.equal(
      /sourceExternalId/g.test(proposalsCodeOnly),
      false,
      "REGRESSÃO DETECTADA: scripts/nomusProposalsSyncV1.ts não pode referenciar sourceExternalId"
    );
    assert.equal(
      /sourceExternalId/g.test(bridgeCodeOnly),
      false,
      "REGRESSÃO DETECTADA: src/lib/nomusCustomerBridgeResolution.ts não pode referenciar sourceExternalId"
    );
  });
});
