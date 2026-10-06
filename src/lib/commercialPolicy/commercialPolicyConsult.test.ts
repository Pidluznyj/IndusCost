/**
 * Consulta da Política Comercial vigente (Comercial → Política Comercial).
 * Cobre autorização, vigência, PDF oficial reutilizado e ausência de hardcode no front.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import express from "express";
import http from "node:http";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import {
  createPolicyDraft,
  publishPolicyVersion,
  type PolicyActor,
} from "./commercialPolicyService.js";
import { registerCommercialPolicyRoutes } from "./commercialPolicyRoutes.js";
import { canConsultCommercialPolicy } from "./commercialPolicyConsultAccess.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { buildCurrentCommercialPolicyNormativeSnapshot } from "./commercialPolicyNormative.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const RELEASE = { releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true };
const PRICING = {
  tiers: [
    { code: "ATACADO", name: "Atacado", marginPercent: 30, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", marginPercent: 35, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", marginPercent: 40, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", marginPercent: 50, commissionPercent: 4 },
  ],
  outOfTableCommissionPercent: 1,
  engineRuleActive: true,
};
const SNAPSHOT = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING);

const SHORT_BODY = {
  title: "Política de teste vigente",
  content: JSON.stringify([
    {
      id: "1-objetivo",
      title: "1. Objetivo",
      blocks: [{ type: "paragraph", text: "Texto oficial do objetivo da política de teste." }],
    },
  ]),
  summaryRules: ["Regra"],
  declarations: ["Declaro ciência."],
  questions: [
    {
      id: "q1",
      prompt: "Pergunta",
      explanation: "Porque",
      correctOptionId: "a",
      options: [
        { id: "a", text: "Sim" },
        { id: "b", text: "Não" },
      ],
    },
  ],
};

function actor(partial: Partial<PolicyActor> & Pick<PolicyActor, "id" | "role">): PolicyActor {
  return {
    name: partial.name ?? "Usuário",
    email: partial.email ?? `${partial.id}@test.local`,
    isActive: partial.isActive ?? true,
    mustChangePassword: partial.mustChangePassword ?? false,
    externalSellerId: partial.externalSellerId ?? null,
    sessionId: partial.sessionId ?? "s",
    mustAcceptCommercialPolicy: partial.mustAcceptCommercialPolicy ?? false,
    ...partial,
  };
}

async function serve(store = createMemoryCommercialPolicyStore(), current: PolicyActor) {
  const app = express();
  app.use(express.json());
  registerCommercialPolicyRoutes(app, {
    requireAppAuth: (_req, _res, next) => next(),
    getCurrentAppUser: async () => current,
    store,
    now: () => NOW,
    verifyPassword: async () => true,
    saveFile: async () => ({ storageKey: "k" }),
    readFile: async () => Buffer.from(""),
    loadRelease: async () => RELEASE,
    loadCommissionMatrix: async () => PRICING,
    loadUserIdentity: async () => null,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}`, store };
}

describe("canConsultCommercialPolicy", () => {
  it("libera SELLER, COMMERCIAL_MANAGER, ADMIN e SUPER_ADMIN", () => {
    for (const role of ["SELLER", "COMMERCIAL_MANAGER", "ADMIN", "SUPER_ADMIN"] as const) {
      assert.equal(canConsultCommercialPolicy({ role }), true, role);
    }
  });

  it("nega VIEWER sem flag de audiência", () => {
    assert.equal(canConsultCommercialPolicy({ role: "VIEWER" }), false);
  });

  it("libera audiência marcada manualmente", () => {
    assert.equal(
      canConsultCommercialPolicy({ role: "VIEWER", mustAcceptCommercialPolicy: true }),
      true
    );
  });
});

describe("GET /api/commercial-policy/current", () => {
  it("SELLER lê a versão vigente e não acessa endpoints de edição", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const seller = await serve(store, actor({ id: "seller-1", role: "SELLER", name: "Ana Vendedora" }));
    try {
      const res = await fetch(`${seller.url}/api/commercial-policy/current`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: true;
        version: { id: string; content: string; contentHash: string; version: number };
        myAcceptance: null;
      };
      assert.equal(body.version.id, published.version.id);
      assert.equal(body.version.content, SHORT_BODY.content);
      assert.equal(body.version.contentHash, published.version.contentHash);
      assert.equal(body.myAcceptance, null);

      const denyEdit = await fetch(`${seller.url}/api/admin/commercial-policy/integrity`);
      assert.equal(denyEdit.status, 403);
    } finally {
      seller.server.close();
    }
  });

  it("usuário sem permissão recebe 403", async () => {
    const { server, url } = await serve(
      createMemoryCommercialPolicyStore(),
      actor({ id: "viewer-1", role: "VIEWER" })
    );
    try {
      const res = await fetch(`${url}/api/commercial-policy/current`);
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });

  it("ADMIN e SUPER_ADMIN consultam a vigente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });

    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
      const session = await serve(store, actor({ id: `${role}-1`, role }));
      try {
        const res = await fetch(`${session.url}/api/commercial-policy/current`);
        assert.equal(res.status, 200, role);
        const body = (await res.json()) as { version: { id: string } | null };
        assert.ok(body.version);
      } finally {
        session.server.close();
      }
    }
  });

  it("nova versão vigente passa a ser retornada automaticamente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const firstDraft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(firstDraft.ok, true);
    if (!firstDraft.ok) return;
    const first = await publishPolicyVersion(store, firstDraft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const future = new Date("2026-10-15T12:00:00.000Z");
    const secondDraft = await createPolicyDraft(
      store,
      {
        ...SHORT_BODY,
        title: "Política 1.1",
        content: JSON.stringify([
          {
            id: "1-objetivo",
            title: "1. Objetivo",
            blocks: [{ type: "paragraph", text: "Texto da versão 1.1 vigente." }],
          },
        ]),
      },
      NOW
    );
    assert.equal(secondDraft.ok, true);
    if (!secondDraft.ok) return;
    const second = await publishPolicyVersion(store, secondDraft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
      effectiveFrom: future,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const before = await serve(store, actor({ id: "seller-1", role: "SELLER" }));
    try {
      // Congela o "agora" do servidor em NOW: 1.0 ainda vigente; 1.1 só no futuro.
      const res = await fetch(`${before.url}/api/commercial-policy/current`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { version: { id: string; title: string } };
      assert.equal(body.version.id, first.version.id);
      assert.equal(body.version.title, SHORT_BODY.title);
    } finally {
      before.server.close();
    }

    const app = express();
    app.use(express.json());
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => actor({ id: "seller-1", role: "SELLER" }),
      store,
      now: () => future,
      verifyPassword: async () => true,
      saveFile: async () => ({ storageKey: "k" }),
      readFile: async () => Buffer.from(""),
      loadRelease: async () => RELEASE,
      loadCommissionMatrix: async () => PRICING,
      loadUserIdentity: async () => null,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${url}/api/commercial-policy/current`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { version: { id: string; title: string; content: string } };
      assert.equal(body.version.id, second.version.id);
      assert.equal(body.version.title, "Política 1.1");
      assert.match(body.version.content, /versão 1\.1 vigente/);
    } finally {
      server.close();
    }
  });

  it("política futura ainda não vigente não é retornada como current", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const future = new Date("2026-12-01T12:00:00.000Z");
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
      effectiveFrom: future,
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const { server, url } = await serve(store, actor({ id: "seller-1", role: "SELLER" }));
    try {
      const res = await fetch(`${url}/api/commercial-policy/current`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { version: null };
      assert.equal(body.version, null);
    } finally {
      server.close();
    }
  });
});

describe("PDF oficial na consulta", () => {
  it("SELLER gera PDF da mesma versão vigente exibida na tela", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const { server, url } = await serve(
      store,
      actor({ id: "seller-1", role: "SELLER", name: "Ana Vendedora", email: "ana@test.local" })
    );
    try {
      const currentRes = await fetch(`${url}/api/commercial-policy/current`);
      assert.equal(currentRes.status, 200);
      const current = (await currentRes.json()) as { version: { id: string; contentHash: string } };
      assert.equal(current.version.id, published.version.id);

      const pdfRes = await fetch(`${url}/api/commercial-policy/versions/${current.version.id}/document`);
      assert.equal(pdfRes.status, 200);
      assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
      const bytes = Buffer.from(await pdfRes.arrayBuffer());
      assert.ok(bytes.length > 100);
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "%PDF");
    } finally {
      server.close();
    }
  });

  it("VIEWER sem consult não acessa PDF da vigente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, {
      currentSnapshot: SNAPSHOT,
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const { server, url } = await serve(store, actor({ id: "viewer-1", role: "VIEWER" }));
    try {
      const pdfRes = await fetch(`${url}/api/commercial-policy/versions/${published.version.id}/document`);
      assert.equal(pdfRes.status, 404);
    } finally {
      server.close();
    }
  });
});

describe("fonte única — front não hardcoda a política", () => {
  it("módulo de consulta carrega API e não embute POL_COM_001_CHAPTERS", () => {
    const source = readFileSync(
      new URL("../../components/commercial/CommercialPolicyConsultModule.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /loadCurrentCommercialPolicy/);
    assert.match(source, /parsePolicyChapters/);
    assert.match(source, /\/api\/commercial-policy\/versions\/\$\{version\.id\}\/document/);
    assert.doesNotMatch(source, /POL_COM_001_CHAPTERS/);
    assert.doesNotMatch(source, /officialCommercialPolicyContent|polCom001V1Document/);
    assert.doesNotMatch(source, /mode=["']acceptance["']/);
  });

  it("módulo commercial-policy abre no menu por papel SELLER", () => {
    assert.equal(
      canAccessModule("commercial-policy", {
        hasPermission: () => false,
        hasAnyPermission: () => false,
        authUser: { role: "SELLER", effectivePermissions: [] },
      }),
      true
    );
    assert.equal(
      canAccessModule("commercial-policy", {
        hasPermission: () => false,
        hasAnyPermission: () => false,
        authUser: { role: "VIEWER", effectivePermissions: [] },
      }),
      false
    );
  });
});
