/**
 * Autorização self-service de tablets do Stock Collector.
 *
 * O que está sob prova, em uma frase: SOLICITAR NÃO É ESTAR AUTORIZADO.
 *
 * O fluxo novo deixa o próprio tablet pedir acesso — o que seria perigoso se
 * em algum ponto o pedido virasse permissão sozinho. Então os testes atacam
 * exatamente isso: pedir não cria dispositivo, insistir não reabre recusa,
 * expirar não vira autorização, WhoIs falhando não vira liberação, e o
 * administrador nunca consegue injetar a identidade pelo corpo da requisição.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  approveCollectorDeviceEnrollment,
  assertNoIdentityFieldsInBody,
  COLLECTOR_ENROLLMENT_DEVICE_INACTIVE,
  COLLECTOR_ENROLLMENT_FORBIDDEN_BODY_FIELDS,
  COLLECTOR_ENROLLMENT_TTL_MS,
  getCollectorDeviceEnrollmentStatus,
  listCollectorDeviceEnrollments,
  normalizeRequestedSectorSlug,
  parseApproveCollectorEnrollmentBody,
  rejectCollectorDeviceEnrollment,
  requestCollectorDeviceEnrollment,
} from "./collectorDeviceEnrollment.server.js";
import { resolveInventoryCollectorPeerIdentity } from "./collectorPeerIdentity.server.js";
import type { CollectorPeerIdentity } from "./collectorPeerIdentity.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Comentários explicam a regra citando os termos proibidos — só código conta. */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
    })
    .join("\n");
}

/** O comentário da migration cita os comandos proibidos; só o DDL conta. */
function sqlOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const ROUTES = "src/lib/inventory/collector/collectorRoutes.server.ts";
const SERVICE = "src/lib/inventory/collector/collectorDeviceEnrollment.server.ts";
const ADMIN_ROUTES = "src/lib/inventoryRoutes.ts";
const GATE = "src/components/inventory/collector/CollectorEnrollmentGate.tsx";
const ADMIN_TAB = "src/components/inventory/InventoryCollectorDevicesTab.tsx";

const IDENTITY: CollectorPeerIdentity = {
  stableNodeId: "nTESTnode1234",
  nodeName: "tablet-teste",
  loginName: "operador@example.com",
  peerAddress: "100.64.1.5",
};

const ADMIN = { userId: "user-1", permissions: ["inventory.count.approve"] };
const NOT_ADMIN = { userId: "user-2", permissions: ["inventory.view"] };

// ---------------------------------------------------------------------------
// Fake Prisma — o suficiente para exercitar as regras sem banco.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function createFakePrisma(seed: { devices?: Row[]; enrollments?: Row[] } = {}) {
  const devices: Row[] = [...(seed.devices ?? [])];
  const enrollments: Row[] = [...(seed.enrollments ?? [])];
  const auditLogs: Row[] = [];
  let seq = 0;

  const applyData = (target: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as Row)) {
        target[key] = ((target[key] as number) ?? 0) + Number((value as Row).increment);
      } else {
        target[key] = value;
      }
    }
  };

  const table = (rows: Row[], prefix: string) => ({
    findUnique: async ({ where }: { where: Row }) => {
      const [field, value] = Object.entries(where)[0]!;
      return rows.find((r) => r[field] === value) ?? null;
    },
    findMany: async () => [...rows],
    create: async ({ data }: { data: Row }) => {
      seq += 1;
      const row: Row = { id: `${prefix}-${seq}`, active: true, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const [field, value] = Object.entries(where)[0]!;
      const row = rows.find((r) => r[field] === value);
      if (!row) throw new Error("row not found");
      applyData(row, data);
      return row;
    },
  });

  const client = {
    inventoryCollectorDevice: table(devices, "device"),
    inventoryCollectorDeviceEnrollment: table(enrollments, "enr"),
    inventoryAuditLog: table(auditLogs, "audit"),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };

  return { client: client as never, devices, enrollments, auditLogs };
}

function pendingRow(overrides: Row = {}): Row {
  const now = new Date("2026-09-01T10:00:00Z");
  return {
    id: "enr-seed",
    tailscaleStableNodeId: IDENTITY.stableNodeId,
    tailscaleNodeName: IDENTITY.nodeName,
    tailscaleLoginName: IDENTITY.loginName,
    lastSeenIp: IDENTITY.peerAddress,
    requestedSectorSlug: null,
    status: "PENDING",
    requestCount: 1,
    firstRequestedAt: now,
    lastRequestedAt: now,
    expiresAt: new Date(now.getTime() + COLLECTOR_ENROLLMENT_TTL_MS),
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    approvedDeviceId: null,
    ...overrides,
  };
}

const at = (iso: string) => () => new Date(iso);

// ===========================================================================
// 1) Cadeia de identidade — fail-closed em toda etapa
// ===========================================================================

describe("enrollment · identidade do peer", () => {
  const resolver = (identity: unknown) => ({ resolve: async () => identity as never });

  it("1. sem peer no socket → null", async () => {
    const req = { socket: { remoteAddress: null }, headers: {} } as never;
    assert.equal(
      await resolveInventoryCollectorPeerIdentity(req, { identityResolver: resolver(IDENTITY) }),
      null
    );
  });

  it("2. WhoIs sem resposta → null (nunca libera por IP)", async () => {
    const req = { socket: { remoteAddress: "100.64.1.5" }, headers: {} } as never;
    assert.equal(
      await resolveInventoryCollectorPeerIdentity(req, { identityResolver: resolver(null) }),
      null
    );
  });

  it("3. WhoIs com stable id implausível → null", async () => {
    const req = { socket: { remoteAddress: "100.64.1.5" }, headers: {} } as never;
    const result = await resolveInventoryCollectorPeerIdentity(req, {
      identityResolver: resolver({ stableNodeId: "", nodeName: "x", loginName: "y" }),
    });
    assert.equal(result, null);
  });

  it("4. WhoIs lançando exceção → null, sem fallback permissivo", async () => {
    const req = { socket: { remoteAddress: "100.64.1.5" }, headers: {} } as never;
    const result = await resolveInventoryCollectorPeerIdentity(req, {
      identityResolver: {
        resolve: async () => {
          throw new Error("whois offline");
        },
      },
    });
    assert.equal(result, null);
  });

  it("5. header genérico não desloca o peer para outro endereço", async () => {
    const req = {
      socket: { remoteAddress: "203.0.113.9" },
      headers: {
        "x-forwarded-for": "100.64.1.5",
        "x-real-ip": "100.64.1.5",
        "cf-connecting-ip": "100.64.1.5",
      },
    } as never;
    const result = await resolveInventoryCollectorPeerIdentity(req, {
      identityResolver: resolver(IDENTITY),
    });
    // XFF / X-Real-IP / CF-Connecting-IP não participam: o peer é o socket.
    assert.equal(result?.peerAddress, "203.0.113.9");
  });

  it("6. peer válido devolve identidade + endereço de origem", async () => {
    const req = { socket: { remoteAddress: "::ffff:100.64.1.5" }, headers: {} } as never;
    const result = await resolveInventoryCollectorPeerIdentity(req, {
      identityResolver: resolver({
        stableNodeId: IDENTITY.stableNodeId,
        nodeName: IDENTITY.nodeName,
        loginName: IDENTITY.loginName,
      }),
    });
    assert.deepEqual(result, { ...IDENTITY, peerAddress: "100.64.1.5" });
  });
});

// ===========================================================================
// 2) Contrato: cliente não fala de identidade
// ===========================================================================

describe("enrollment · identidade nunca vem do cliente", () => {
  it("7. cada campo de identidade no corpo é recusado", () => {
    for (const field of COLLECTOR_ENROLLMENT_FORBIDDEN_BODY_FIELDS) {
      assert.throws(
        () => assertNoIdentityFieldsInBody({ [field]: "qualquer" }),
        /Identidade do dispositivo/,
        `campo ${field} deveria ser recusado`
      );
    }
  });

  it("8. corpo legítimo passa", () => {
    assert.doesNotThrow(() => assertNoIdentityFieldsInBody({ sector: "materia-prima" }));
    assert.doesNotThrow(() => assertNoIdentityFieldsInBody(undefined));
  });

  it("9. approve do admin também recusa identidade e exige nome", () => {
    assert.throws(
      () => parseApproveCollectorEnrollmentBody({ name: "X", tailscaleStableNodeId: "nFAKE" }),
      /Identidade do dispositivo/
    );
    assert.throws(() => parseApproveCollectorEnrollmentBody({ name: "   " }), /obrigatório/);
    assert.deepEqual(parseApproveCollectorEnrollmentBody({ name: " Tablet A " }), {
      name: "Tablet A",
      canManageCountSessions: true,
      canApplyCountAdjustments: true,
    });
  });
});

// ===========================================================================
// 3) Solicitar não autoriza
// ===========================================================================

describe("enrollment · solicitar", () => {
  it("10. pedido novo cria UMA linha pendente e NENHUM dispositivo", async () => {
    const db = createFakePrisma();
    const result = await requestCollectorDeviceEnrollment(db.client, IDENTITY, {}, {
      now: at("2026-09-01T10:00:00Z"),
    });

    assert.equal(result.status, "PENDING");
    assert.equal(db.enrollments.length, 1);
    assert.equal(db.devices.length, 0, "pedir acesso NUNCA cria dispositivo");
    assert.equal(db.enrollments[0]!.status, "PENDING");
    assert.equal(db.enrollments[0]!.tailscaleStableNodeId, IDENTITY.stableNodeId);
  });

  it("11. insistir é idempotente: 1 linha, contador sobe", async () => {
    const db = createFakePrisma();
    for (let i = 0; i < 3; i += 1) {
      await requestCollectorDeviceEnrollment(db.client, IDENTITY, {}, {
        now: at("2026-09-01T10:00:00Z"),
      });
    }
    assert.equal(db.enrollments.length, 1);
    assert.equal(db.enrollments[0]!.requestCount, 3);
    assert.equal(db.devices.length, 0);
  });

  it("12. auditoria só na criação — polling não inunda a trilha", async () => {
    const db = createFakePrisma();
    for (let i = 0; i < 4; i += 1) {
      await requestCollectorDeviceEnrollment(db.client, IDENTITY);
    }
    const requested = db.auditLogs.filter((l) => l.action === "DEVICE_ENROLLMENT_REQUESTED");
    assert.equal(requested.length, 1);
    assert.equal(requested[0]!.userId, null, "ator é o DEVICE, jamais um usuário fictício");
  });

  it("13. recusado não reabre sozinho por insistência", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow({ status: "REJECTED" })] });
    const result = await requestCollectorDeviceEnrollment(db.client, IDENTITY);
    assert.equal(result.status, "REJECTED");
    assert.equal(db.enrollments[0]!.status, "REJECTED");
    assert.equal(db.devices.length, 0);
  });

  it("14. dispositivo já ativo entra direto, sem virar pedido", async () => {
    const db = createFakePrisma({
      devices: [{ id: "d1", tailscaleStableNodeId: IDENTITY.stableNodeId, active: true }],
    });
    const result = await requestCollectorDeviceEnrollment(db.client, IDENTITY);
    assert.equal(result.status, "AUTHORIZED");
    assert.equal(db.enrollments.length, 0);
  });

  it("15. aprovado antes e revogado depois volta para a fila como pendente", async () => {
    const db = createFakePrisma({
      devices: [{ id: "d1", tailscaleStableNodeId: IDENTITY.stableNodeId, active: false }],
      enrollments: [pendingRow({ status: "APPROVED", approvedDeviceId: "d1" })],
    });
    const result = await requestCollectorDeviceEnrollment(db.client, IDENTITY);
    assert.equal(result.status, "PENDING");
    assert.equal(db.enrollments[0]!.status, "PENDING");
    assert.equal(db.enrollments[0]!.approvedDeviceId, null);
    assert.equal(db.devices.length, 1, "não recria dispositivo");
    assert.equal(db.devices[0]!.active, false, "revogação continua valendo");
  });

  it("16. setor inválido não impede o pedido — é só contexto", async () => {
    const db = createFakePrisma();
    const result = await requestCollectorDeviceEnrollment(db.client, IDENTITY, {
      requestedSectorSlug: "setor-que-nao-existe",
    });
    assert.equal(result.status, "PENDING");
    assert.equal(db.enrollments[0]!.requestedSectorSlug, null);
  });
});

// ===========================================================================
// 4) Consulta de status pelo tablet
// ===========================================================================

describe("enrollment · status para o tablet", () => {
  it("17. sem pedido → NONE", async () => {
    const db = createFakePrisma();
    const r = await getCollectorDeviceEnrollmentStatus(db.client, IDENTITY);
    assert.equal(r.status, "NONE");
  });

  it("18. pendente vencido → NONE (expirar não autoriza)", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    const r = await getCollectorDeviceEnrollmentStatus(db.client, IDENTITY, {
      now: at("2026-09-03T10:00:00Z"),
    });
    assert.equal(r.status, "NONE");
  });

  it("19. APPROVED sem dispositivo ativo NÃO vira AUTHORIZED", async () => {
    const db = createFakePrisma({
      devices: [{ id: "d1", tailscaleStableNodeId: IDENTITY.stableNodeId, active: false }],
      enrollments: [pendingRow({ status: "APPROVED", approvedDeviceId: "d1" })],
    });
    const r = await getCollectorDeviceEnrollmentStatus(db.client, IDENTITY, {
      now: at("2026-09-01T11:00:00Z"),
    });
    assert.equal(r.status, "PENDING");
  });

  it("20. só dispositivo ativo devolve AUTHORIZED", async () => {
    const db = createFakePrisma({
      devices: [{ id: "d1", tailscaleStableNodeId: IDENTITY.stableNodeId, active: true }],
    });
    const r = await getCollectorDeviceEnrollmentStatus(db.client, IDENTITY);
    assert.equal(r.status, "AUTHORIZED");
  });

  it("21. resposta ao tablet não vaza dado interno", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    const r = await getCollectorDeviceEnrollmentStatus(db.client, IDENTITY, {
      now: at("2026-09-01T11:00:00Z"),
    });
    assert.deepEqual(Object.keys(r).sort(), ["message", "status"]);
    assert.doesNotMatch(JSON.stringify(r), new RegExp(IDENTITY.stableNodeId));
  });
});

// ===========================================================================
// 5) Decisão humana
// ===========================================================================

describe("enrollment · decisão do administrador", () => {
  it("22. autorizar cria o dispositivo com o stable id do PEDIDO", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    const { device, enrollment } = await approveCollectorDeviceEnrollment(
      db.client,
      "enr-seed",
      { name: "Tablet Matéria-Prima" },
      ADMIN,
      { now: at("2026-09-01T12:00:00Z") }
    );

    assert.equal(device.tailscaleStableNodeId, IDENTITY.stableNodeId);
    assert.equal(device.name, "Tablet Matéria-Prima");
    assert.equal(enrollment.status, "APPROVED");
    assert.equal(enrollment.approvedDeviceId, device.id);
    assert.equal(db.devices.length, 1);
    assert.ok(db.auditLogs.some((l) => l.action === "DEVICE_REGISTERED"));
    assert.ok(db.auditLogs.some((l) => l.action === "DEVICE_ENROLLMENT_APPROVED"));
  });

  it("23. dispositivo desativado não é ressuscitado por aprovação", async () => {
    const db = createFakePrisma({
      devices: [{ id: "d1", tailscaleStableNodeId: IDENTITY.stableNodeId, active: false }],
      enrollments: [pendingRow()],
    });
    await assert.rejects(
      () =>
        approveCollectorDeviceEnrollment(db.client, "enr-seed", { name: "X" }, ADMIN),
      (e: unknown) =>
        (e as { code?: string }).code === COLLECTOR_ENROLLMENT_DEVICE_INACTIVE
    );
    assert.equal(db.devices[0]!.active, false);
  });

  it("24. aprovar duas vezes não duplica dispositivo", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    await approveCollectorDeviceEnrollment(db.client, "enr-seed", { name: "A" }, ADMIN);
    await approveCollectorDeviceEnrollment(db.client, "enr-seed", { name: "B" }, ADMIN);
    assert.equal(db.devices.length, 1);
    assert.equal(db.devices[0]!.name, "A", "renomear não é efeito colateral de aprovar");
  });

  it("25. recusar registra a decisão e NÃO cria dispositivo", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    const updated = await rejectCollectorDeviceEnrollment(
      db.client,
      "enr-seed",
      { decisionNote: "  tablet de outro setor  " },
      ADMIN,
      { now: at("2026-09-01T12:00:00Z") }
    );
    assert.equal(updated.status, "REJECTED");
    assert.equal(updated.decisionNote, "tablet de outro setor");
    assert.equal(db.devices.length, 0);
    assert.ok(db.auditLogs.some((l) => l.action === "DEVICE_ENROLLMENT_REJECTED"));
  });

  it("26. recusada não pode ser aprovada sem nova decisão do dispositivo", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow({ status: "REJECTED" })] });
    await assert.rejects(
      () => approveCollectorDeviceEnrollment(db.client, "enr-seed", { name: "X" }, ADMIN),
      /já foi recusada/
    );
    assert.equal(db.devices.length, 0);
  });

  it("27. sem permissão de aprovar conferência, nada é administrável", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    for (const call of [
      () => listCollectorDeviceEnrollments(db.client, NOT_ADMIN),
      () => approveCollectorDeviceEnrollment(db.client, "enr-seed", { name: "X" }, NOT_ADMIN),
      () => rejectCollectorDeviceEnrollment(db.client, "enr-seed", {}, NOT_ADMIN),
    ]) {
      await assert.rejects(call, (e: unknown) => (e as { code?: string }).code === "NOT_AUTHORIZED");
    }
    assert.equal(db.devices.length, 0);
  });

  it("28. listagem marca vencidos sem apagá-los", async () => {
    const db = createFakePrisma({ enrollments: [pendingRow()] });
    const rows = await listCollectorDeviceEnrollments(db.client, ADMIN, {
      now: at("2026-09-03T10:00:00Z"),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.expired, true);
    assert.equal(rows[0]!.row.status, "PENDING");
  });
});

// ===========================================================================
// 6) Setor pedido — contexto, nunca capacidade
// ===========================================================================

describe("enrollment · setor solicitado", () => {
  it("29. slug conhecido é normalizado; desconhecido vira null", () => {
    assert.equal(normalizeRequestedSectorSlug("   "), null);
    assert.equal(normalizeRequestedSectorSlug(null), null);
    assert.equal(normalizeRequestedSectorSlug(42), null);
    assert.equal(normalizeRequestedSectorSlug("setor-inexistente"), null);
  });
});

// ===========================================================================
// 7) Fronteiras no código-fonte
// ===========================================================================

describe("enrollment · fronteiras do código", () => {
  it("30. rotas do tablet negam com 403 quando não há identidade", () => {
    const routes = codeOnly(read(ROUTES));
    assert.match(routes, /COLLECTOR_DEVICE_UNAUTHORIZED/);
    const denies = routes.match(/if \(!identity\) return denyEnrollment\(res\)/g) ?? [];
    assert.equal(denies.length, 2, "POST e GET precisam negar identicamente");
  });

  it("31. enrollment fica FORA do middleware que exige device autorizado", () => {
    const routes = codeOnly(read(ROUTES));
    const post = routes.indexOf('app.post("/api/inventory/collector/enrollment"');
    const get = routes.indexOf('app.get("/api/inventory/collector/enrollment"');
    assert.ok(post > 0 && get > 0);
    // A linha de registro não pode encadear deviceAuth: seria um beco sem saída
    // (só entra quem já está autorizado — exatamente quem não precisa pedir).
    for (const idx of [post, get]) {
      const line = routes.slice(idx, routes.indexOf("\n", idx));
      assert.doesNotMatch(line, /deviceAuth/);
    }
  });

  it("32. rotas administrativas exigem o mesmo guard do Device Registry", () => {
    const admin = codeOnly(read(ADMIN_ROUTES));
    for (const route of [
      '"/api/inventory/collector-device-enrollments"',
      '"/api/inventory/collector-device-enrollments/:id/approve"',
      '"/api/inventory/collector-device-enrollments/:id/reject"',
    ]) {
      const idx = admin.indexOf(route);
      assert.ok(idx > 0, `rota ausente: ${route}`);
      const window = admin.slice(idx, idx + 200);
      assert.match(window, /\.\.\.countApprove/, `${route} sem guard countApprove`);
    }
  });

  it("33. serviço nunca grava dispositivo fora da aprovação", () => {
    const service = codeOnly(read(SERVICE));
    const creates = service.match(/inventoryCollectorDevice\.create/g) ?? [];
    assert.equal(creates.length, 1, "só approve pode criar dispositivo");
    const approveIdx = service.indexOf("export async function approveCollectorDeviceEnrollment");
    assert.ok(service.indexOf("inventoryCollectorDevice.create") > approveIdx);
  });

  it("34. nenhum tablet específico está gravado no código", () => {
    // O tablet de homologação existe no mundo real; hardcodá-lo aqui criaria
    // uma autorização invisível que nenhum administrador consegue revogar.
    const forbidden = [/n1vB8yp1Jw11CNTRL/i, /materiaprima@grupolazarios\.com\.br/i];
    for (const file of [ROUTES, SERVICE, ADMIN_ROUTES, GATE, ADMIN_TAB]) {
      const source = read(file);
      for (const pattern of forbidden) {
        assert.doesNotMatch(source, pattern, `${file} não pode citar dispositivo específico`);
      }
    }
  });

  it("35. migration do enrollment é aditiva", () => {
    const sql = sqlOnly(
      read("prisma/migrations/20260919120000_collector_device_enrollment/migration.sql")
    ).toUpperCase();
    for (const destructive of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"]) {
      assert.ok(!sql.includes(destructive), `migration não pode conter ${destructive}`);
    }
    assert.ok(sql.includes("CREATE TABLE"));
  });
});

// ===========================================================================
// 8) Telas
// ===========================================================================

describe("enrollment · telas", () => {
  it("36. tela do tablet separa erro de recusa", () => {
    const gate = read(GATE);
    assert.match(gate, /collector-enrollment-pending/);
    assert.match(gate, /collector-enrollment-rejected/);
    assert.match(gate, /collector-enrollment-error/);
    // Estados distintos: rede caindo não pode parecer decisão do administrador.
    assert.notEqual(
      gate.indexOf('phase === "rejected"'),
      gate.indexOf('phase === "error"')
    );
  });

  it("37. polling para ao desmontar e depois de decidido", () => {
    const gate = codeOnly(read(GATE));
    assert.match(gate, /clearInterval/);
    assert.match(gate, /aliveRef\.current = false/);
    assert.match(gate, /status === "AUTHORIZED" \|\| result\.status === "REJECTED"/);
  });

  it("38. as duas telas do Collector usam o mesmo gate", () => {
    for (const file of [
      "src/components/inventory/collector/CollectorPage.tsx",
      "src/components/inventory/collector/CollectorSectorPage.tsx",
    ]) {
      const source = read(file);
      assert.match(source, /useCollectorEnrollment/, `${file} sem o hook`);
      assert.match(source, /CollectorEnrollmentScreen/, `${file} sem a tela`);
      assert.doesNotMatch(
        source,
        /Dispositivo n[ãa]o autorizado/,
        `${file} manteve a tela sem saída`
      );
    }
  });

  it("39. aba administrativa é declarada com o mesmo recurso do servidor", () => {
    const tabs = read("src/lib/moduleTabResources.ts");
    const idx = tabs.indexOf('id: "collectorDevices"');
    assert.ok(idx > 0, "aba não registrada");
    assert.match(
      tabs.slice(idx, idx + 160),
      /resourceKey: "operations\.inventory\.counts"/
    );
    const nav = read("src/components/inventory/inventoryNavigation.ts");
    assert.match(nav, /"collectorDevices"/);
    assert.match(nav, /\/inventory\/collector-devices/);
    assert.match(read("src/App.tsx"), /path="inventory\/collector-devices"/);
  });

  it("40. tela administrativa envia só nome e capacidades ao aprovar", () => {
    const tab = codeOnly(read(ADMIN_TAB));
    const start = tab.indexOf("/approve`");
    assert.ok(start > 0, "chamada de aprovação não encontrada");
    const body = tab.slice(start, tab.indexOf("}),", start));
    // Identidade é exibida para conferência, nunca reenviada pelo admin.
    assert.doesNotMatch(body, /tailscale/i);
    assert.doesNotMatch(body, /lastSeenIp/);
    assert.match(body, /name: draft\.name/);
    assert.match(body, /canManageCountSessions/);
    assert.match(body, /canApplyCountAdjustments/);
  });
});
