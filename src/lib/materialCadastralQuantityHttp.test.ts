/**
 * Testes de rota POST/PUT /api/materials para a política de Material.quantity.
 * Não sobe o server.ts completo: monta o mesmo contrato HTTP usado pelo cadastro.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { describe, it } from "node:test";
import express from "express";
import {
  MATERIAL_QUANTITY_NOT_EDITABLE,
  MATERIAL_QUANTITY_NOT_EDITABLE_MESSAGE,
} from "./materialQuantityWriteGuard.js";
import {
  materialCreateQuantityHttpResult,
  materialUpdateQuantityHttpResult,
} from "./materialCadastralQuantityHttp.js";

const root = process.cwd();

function registerCadastralQuantityRoutes(
  app: express.Express,
  deps: {
    create: (data: { quantity: number }) => Promise<{ id: string; quantity: number }>;
    find: (id: string) => Promise<{ id: string; quantity: number } | null>;
    update: (id: string, data: Record<string, unknown>) => Promise<{ id: string; quantity: number }>;
  }
) {
  app.use(express.json());
  app.post("/api/materials", async (req, res) => {
    const result = materialCreateQuantityHttpResult(req.body?.quantity);
    if (result.ok === false) {
      return res.status(result.status).json(result.body);
    }
    const created = await deps.create({ quantity: result.quantity });
    return res.status(200).json(created);
  });
  app.put("/api/materials/:id", async (req, res) => {
    const existing = await deps.find(String(req.params.id));
    if (!existing) return res.status(404).json({ error: "Material não encontrado." });
    const result = materialUpdateQuantityHttpResult(req.body?.quantity, existing.quantity);
    if (result.ok === false) {
      return res.status(result.status).json(result.body);
    }
    const { quantity: _ignored, ...rest } = (req.body ?? {}) as Record<string, unknown>;
    const updated = await deps.update(existing.id, rest);
    return res.status(200).json(updated);
  });
}

async function withServer(
  register: (app: express.Express) => void,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  register(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe("POST/PUT /api/materials — bloqueio de Material.quantity", () => {
  it("server.ts aplica o mesmo contrato HTTP e omite quantity no PUT", () => {
    const server = readFileSync(join(root, "server.ts"), "utf8");
    assert.match(server, /materialCreateQuantityHttpResult/);
    assert.match(server, /materialUpdateQuantityHttpResult/);
    assert.doesNotMatch(server, /quantity:\s*body\.quantity/);
    assert.doesNotMatch(server, /quantity:\s*parsedNumeric\.quantity/);
    assert.match(server, /quantity:\s*quantityPolicy\.quantity/);
  });

  it("POST omite quantity → persiste 0", async () => {
    const created: Array<{ quantity: number }> = [];
    await withServer(
      (app) =>
        registerCadastralQuantityRoutes(app, {
          create: async (data) => {
            created.push(data);
            return { id: "m1", quantity: data.quantity };
          },
          find: async () => null,
          update: async () => {
            throw new Error("update não deveria ser chamado");
          },
        }),
      async (base) => {
        const res = await fetch(`${base}/api/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "X", description: "Y" }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { quantity: number };
        assert.equal(body.quantity, 0);
        assert.equal(created[0]?.quantity, 0);
      }
    );
  });

  it("POST quantity=0 é permitido", async () => {
    await withServer(
      (app) =>
        registerCadastralQuantityRoutes(app, {
          create: async (data) => ({ id: "m1", quantity: data.quantity }),
          find: async () => null,
          update: async () => {
            throw new Error("update não deveria ser chamado");
          },
        }),
      async (base) => {
        const res = await fetch(`${base}/api/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: 0 }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { quantity: number };
        assert.equal(body.quantity, 0);
      }
    );
  });

  it("POST quantity ≠ 0 é rejeitado e não cria", async () => {
    let createCalls = 0;
    await withServer(
      (app) =>
        registerCadastralQuantityRoutes(app, {
          create: async (data) => {
            createCalls += 1;
            return { id: "m1", quantity: data.quantity };
          },
          find: async () => null,
          update: async () => {
            throw new Error("update não deveria ser chamado");
          },
        }),
      async (base) => {
        const res = await fetch(`${base}/api/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: 1100 }),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as {
          error: string;
          field: string;
          message: string;
        };
        assert.equal(body.error, MATERIAL_QUANTITY_NOT_EDITABLE);
        assert.equal(body.field, "quantity");
        assert.equal(body.message, MATERIAL_QUANTITY_NOT_EDITABLE_MESSAGE);
        assert.equal(createCalls, 0);
      }
    );
  });

  it("PUT com quantity diferente é rejeitado e não atualiza", async () => {
    let updateCalls = 0;
    await withServer(
      (app) =>
        registerCadastralQuantityRoutes(app, {
          create: async () => {
            throw new Error("create não deveria ser chamado");
          },
          find: async () => ({ id: "m1", quantity: 6525 }),
          update: async () => {
            updateCalls += 1;
            return { id: "m1", quantity: 6525 };
          },
        }),
      async (base) => {
        const res = await fetch(`${base}/api/materials/m1`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: 1100, description: "PP" }),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: string; field: string };
        assert.equal(body.error, MATERIAL_QUANTITY_NOT_EDITABLE);
        assert.equal(body.field, "quantity");
        assert.equal(updateCalls, 0);
      }
    );
  });

  it("PUT omite quantity ou envia o valor atual e não grava quantity", async () => {
    const updates: Array<Record<string, unknown>> = [];
    await withServer(
      (app) =>
        registerCadastralQuantityRoutes(app, {
          create: async () => {
            throw new Error("create não deveria ser chamado");
          },
          find: async () => ({ id: "m1", quantity: 6525 }),
          update: async (_id, data) => {
            updates.push(data);
            return { id: "m1", quantity: 6525 };
          },
        }),
      async (base) => {
        const omit = await fetch(`${base}/api/materials/m1`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: "PP" }),
        });
        assert.equal(omit.status, 200);
        const same = await fetch(`${base}/api/materials/m1`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: 6525, description: "PP" }),
        });
        assert.equal(same.status, 200);
        assert.equal(updates.length, 2);
        for (const payload of updates) {
          assert.equal("quantity" in payload, false);
        }
      }
    );
  });
});
