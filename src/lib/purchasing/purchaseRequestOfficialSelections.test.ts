/**
 * Seleções oficiais da solicitação de compra — regra de derivação e espelho.
 *
 * O que se protege aqui:
 *  - o SERVIDOR deriva solicitante/setor/categoria dos cadastros (o texto do
 *    cliente nunca é autoridade — adeus "Faricação");
 *  - o CC financeiro é espelhado por `code` no cadastro operacional, com o
 *    nome do financeiro mandando;
 *  - inativo/inexistente falha com erro claro, não com dado sujo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mirrorFinancialCostCenter,
  PurchaseSelectionError,
  resolveOfficialHeaderSelections,
} from "@/src/lib/purchasing/purchaseRequestOfficialSelections.server.js";

type Row = Record<string, unknown>;

function makeTx(data: {
  employees?: Row[];
  categories?: Row[];
  financialCcs?: Row[];
  operationalCcs?: Row[];
}) {
  const ops = data.operationalCcs ?? [];
  const upserts: Row[] = [];
  return {
    tx: {
      employee: {
        async findUnique({ where }: { where: { id: string } }) {
          return data.employees?.find((e) => e.id === where.id) ?? null;
        },
      },
      purchaseRequestCategory: {
        async findUnique({ where }: { where: { id: string } }) {
          return data.categories?.find((c) => c.id === where.id) ?? null;
        },
      },
      financialCostCenter: {
        async findUnique({ where }: { where: { id: string } }) {
          return data.financialCcs?.find((c) => c.id === where.id) ?? null;
        },
      },
      costCenter: {
        async upsert({ where, create, update }: Row) {
          const code = (where as { code: string }).code;
          const existing = ops.find((c) => c.code === code);
          if (existing) {
            Object.assign(existing, update as Row);
            upserts.push({ code, action: "update" });
            return existing;
          }
          const created = { id: `op-${code}`, ...(create as Row) };
          ops.push(created);
          upserts.push({ code, action: "create" });
          return created;
        },
      },
    } as never,
    ops,
    upserts,
  };
}

const EMP = { id: "emp-1", name: " Carlos Santana ", department: " Fabricação ", status: "ACTIVE" };
const CAT = { id: "cat-1", name: "Matéria-Prima", isActive: true };
const FCC = { id: "fcc-1", code: "CC_FABRICACAO", name: "FABRICAÇÃO", status: "ACTIVE" };

describe("Compras — seleções oficiais", () => {
  it("deriva solicitante e setor do funcionário, com trim", async () => {
    const { tx } = makeTx({ employees: [EMP] });
    const out = await resolveOfficialHeaderSelections(tx, { requesterEmployeeId: "emp-1" });
    assert.equal(out.requester, "Carlos Santana");
    assert.equal(out.department, "Fabricação");
    assert.equal(out.requesterEmployeeId, "emp-1");
  });

  it("funcionário inativo é recusado", async () => {
    const { tx } = makeTx({ employees: [{ ...EMP, status: "INACTIVE" }] });
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { requesterEmployeeId: "emp-1" }),
      PurchaseSelectionError
    );
  });

  it("funcionário sem setor no cadastro é recusado com instrução", async () => {
    const { tx } = makeTx({ employees: [{ ...EMP, department: "  " }] });
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { requesterEmployeeId: "emp-1" }),
      /sem setor/
    );
  });

  it("categoria ativa vira snapshot pelo NOME da tabela de apoio", async () => {
    const { tx } = makeTx({ categories: [CAT] });
    const out = await resolveOfficialHeaderSelections(tx, { requestCategoryId: "cat-1" });
    assert.equal(out.requestCategory, "Matéria-Prima");
    assert.equal(out.requestCategoryId, "cat-1");
  });

  it("categoria inativa é recusada", async () => {
    const { tx } = makeTx({ categories: [{ ...CAT, isActive: false }] });
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { requestCategoryId: "cat-1" }),
      /inativa/
    );
  });

  it("CC financeiro é espelhado por code (create quando não existe)", async () => {
    const { tx, ops, upserts } = makeTx({ financialCcs: [FCC] });
    const out = await resolveOfficialHeaderSelections(tx, {
      defaultFinancialCostCenterId: "fcc-1",
    });
    assert.equal(out.defaultFinancialCostCenterId, "fcc-1");
    assert.equal(out.mirroredCostCenterId, "op-CC_FABRICACAO");
    assert.deepEqual(upserts, [{ code: "CC_FABRICACAO", action: "create" }]);
    assert.equal(ops[0]?.name, "FABRICAÇÃO");
  });

  it("espelho existente é atualizado — o nome do financeiro manda", async () => {
    const { tx, ops } = makeTx({
      financialCcs: [{ ...FCC, name: "FABRICAÇÃO (NOVO NOME)" }],
      operationalCcs: [{ id: "op-x", code: "CC_FABRICACAO", name: "nome velho", isActive: false }],
    });
    const out = await mirrorFinancialCostCenter(tx, "fcc-1");
    assert.equal(out.operationalId, "op-x");
    assert.equal(ops[0]?.name, "FABRICAÇÃO (NOVO NOME)");
    assert.equal(ops[0]?.isActive, true, "espelho reativado junto");
  });

  it("CC financeiro inativo é recusado", async () => {
    const { tx } = makeTx({ financialCcs: [{ ...FCC, status: "INACTIVE" }] });
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { defaultFinancialCostCenterId: "fcc-1" }),
      /inativo/
    );
  });

  it("payload legado (sem IDs) passa intocado — tudo nulo", async () => {
    const { tx, upserts } = makeTx({});
    const out = await resolveOfficialHeaderSelections(tx, {});
    assert.deepEqual(out, {
      requester: null,
      department: null,
      requestCategory: null,
      requesterEmployeeId: null,
      requestCategoryId: null,
      defaultFinancialCostCenterId: null,
      mirroredCostCenterId: null,
    });
    assert.equal(upserts.length, 0, "nenhum espelhamento sem seleção");
  });

  it("IDs inexistentes falham com erro claro", async () => {
    const { tx } = makeTx({});
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { requesterEmployeeId: "nao-existe" }),
      /não encontrado/
    );
    await assert.rejects(
      resolveOfficialHeaderSelections(tx, { defaultFinancialCostCenterId: "nao-existe" }),
      /não encontrado/
    );
  });
});
