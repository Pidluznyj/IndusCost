import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certificateValidity,
  detectCertificateFileKind,
  parseExternalCertificateInput,
  sortEmployeeCertificates,
  summarizeEmployeeCertificates,
  type EmployeeCertificateItemDto,
} from "./hrEmployeeCertificates";
import { createExternalCertificate } from "./hrEmployeeCertificates.server";
import { PeopleProfileAccessError } from "./peopleProfileErrors";

const TODAY = "2026-10-16";
const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);

const base = { title: " NR-35  Trabalho em altura ", institution: "SENAI", completedOn: "2026-09-10" };

describe("certificado externo — dados", () => {
  it("normaliza texto, aceita carga com vírgula e campos opcionais vazios", () => {
    const r = parseExternalCertificateInput({ ...base, workloadHours: "8,5", expiresOn: "", competencyId: "", notes: "  " }, TODAY);
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      title: "NR-35 Trabalho em altura",
      institution: "SENAI",
      workloadHours: 8.5,
      completedOn: "2026-09-10",
      expiresOn: null,
      competencyId: null,
      notes: null,
    });
  });

  it("recusa obrigatórios ausentes, datas inválidas, conclusão futura, validade anterior e carga fora de 0,5 h", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, title: "" }, "INVALID_TITLE"],
      [{ ...base, institution: " " }, "INVALID_INSTITUTION"],
      [{ ...base, completedOn: "2026-02-30" }, "INVALID_COMPLETED"],
      [{ ...base, completedOn: "2026-10-17" }, "INVALID_COMPLETED"],
      [{ ...base, expiresOn: "2026-09-09" }, "INVALID_EXPIRES"],
      [{ ...base, workloadHours: "0" }, "INVALID_WORKLOAD"],
      [{ ...base, workloadHours: "1,3" }, "INVALID_WORKLOAD"],
      [{ ...base, competencyId: "abc" }, "INVALID_COMPETENCY"],
      [{ ...base, notes: "x".repeat(1001) }, "INVALID_NOTES"],
    ];
    for (const [body, code] of cases) {
      const r = parseExternalCertificateInput(body, TODAY);
      assert.equal(r.ok, false, JSON.stringify(body));
      if (r.ok === false) assert.equal(r.code, code);
    }
  });

  it("identifica o arquivo pelo conteúdo, não pela extensão", () => {
    assert.equal(detectCertificateFileKind(PDF), "pdf");
    assert.equal(detectCertificateFileKind(PNG), "png");
    assert.equal(detectCertificateFileKind(JPG), "jpeg");
    assert.equal(detectCertificateFileKind(Buffer.from("MZ executável")), null);
    assert.equal(detectCertificateFileKind(Buffer.from("<html>")), null);
  });

  it("validade: sem validade, vigente, a vencer (≤ 30 dias) e vencido", () => {
    assert.equal(certificateValidity(null, TODAY), "NO_EXPIRY");
    assert.equal(certificateValidity("2026-11-16", TODAY), "VALID");
    assert.equal(certificateValidity("2026-11-15", TODAY), "EXPIRING");
    assert.equal(certificateValidity(TODAY, TODAY), "EXPIRING");
    assert.equal(certificateValidity("2026-10-15", TODAY), "EXPIRED");
  });

  it("lista unificada: mais recente primeiro; resumo por origem, validade e horas", () => {
    const item = (p: Partial<EmployeeCertificateItemDto>): EmployeeCertificateItemDto =>
      ({ key: p.id, origin: "UPLOAD", title: "x", completedOn: "2026-01-01", workloadHours: null, validity: "NO_EXPIRY", ...p }) as EmployeeCertificateItemDto;
    const sorted = sortEmployeeCertificates([
      item({ id: "a", completedOn: "2025-05-01", workloadHours: 4, validity: "EXPIRED" }),
      item({ id: "b", origin: "SYSTEM", completedOn: "2026-10-10", workloadHours: 8, validity: "EXPIRING" }),
      item({ id: "c", completedOn: "2026-03-01", workloadHours: 1.5 }),
    ]);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a"]);
    assert.deepEqual(summarizeEmployeeCertificates(sorted), { total: 3, system: 1, upload: 2, expiring: 1, expired: 1, hours: 13.5 });
  });
});

describe("certificado externo — gravação", () => {
  const data = { title: "NR-35", institution: "SENAI", workloadHours: 8, completedOn: "2026-09-10", expiresOn: "2028-09-10", competencyId: null, notes: null };

  function fakePrisma(opts: { failCertificate?: boolean } = {}) {
    const created: { model: string; data: Record<string, unknown> }[] = [];
    const tx = {
      hrEmployeeDocument: { create: async ({ data }: { data: Record<string, unknown> }) => (created.push({ model: "document", data }), { id: "doc-1", ...data }) },
      hrEmployeeExternalCertificate: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (opts.failCertificate) throw new Error("falha simulada");
          created.push({ model: "certificate", data });
          return { id: "cert-1", ...data };
        },
      },
    };
    const prisma = {
      hrCompetency: { findUnique: async () => null },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    };
    return { prisma: prisma as never, created };
  }

  function fakeFiles() {
    const saved: string[] = [];
    const removed: string[] = [];
    return {
      saved,
      removed,
      store: {
        save: async (i: { originalFileName: string }) => (saved.push(i.originalFileName), { storageKey: `k/${i.originalFileName}`, fileName: i.originalFileName, fileSize: 10 }),
        remove: async (k: string) => void removed.push(k),
      },
    };
  }

  it("arquivo que não é PDF/JPG/PNG é recusado antes de gravar qualquer coisa", async () => {
    const { prisma, created } = fakePrisma();
    const files = fakeFiles();
    await assert.rejects(
      createExternalCertificate({ prisma, files: files.store, writeHistory: async () => null, employeeId: "e1", personId: null, data, file: { originalName: "cert.pdf", buffer: Buffer.from("MZ") }, actorUserId: "u1" }),
      (e: unknown) => e instanceof PeopleProfileAccessError && e.code === "INVALID_FILE",
    );
    assert.equal(files.saved.length, 0);
    assert.equal(created.length, 0);
  });

  it("grava documento do dossiê (tipo, MIME real, datas) + certificado + histórico", async () => {
    const { prisma, created } = fakePrisma();
    const files = fakeFiles();
    const history: unknown[] = [];
    const r = await createExternalCertificate({
      prisma,
      files: files.store,
      writeHistory: async (_db, input) => void history.push(input),
      employeeId: "e1",
      personId: "p1",
      data,
      file: { originalName: "nr35.png", buffer: PNG },
      actorUserId: "u1",
    });
    assert.deepEqual(r, { id: "cert-1", documentId: "doc-1" });
    const doc = created.find((c) => c.model === "document")!.data;
    assert.equal(doc.documentType, "TRAINING_CERTIFICATE");
    assert.equal(doc.mimeType, "image/png");
    assert.equal((doc.issuedAt as Date).toISOString(), "2026-09-10T00:00:00.000Z");
    assert.equal((doc.expiresAt as Date).toISOString(), "2028-09-10T00:00:00.000Z");
    const cert = created.find((c) => c.model === "certificate")!.data;
    assert.equal(cert.documentId, "doc-1");
    assert.equal(cert.institution, "SENAI");
    assert.equal(history.length, 1);
    assert.equal(files.removed.length, 0);
  });

  it("falha no banco remove o arquivo salvo (sem arquivo órfão)", async () => {
    const { prisma } = fakePrisma({ failCertificate: true });
    const files = fakeFiles();
    await assert.rejects(
      createExternalCertificate({ prisma, files: files.store, writeHistory: async () => null, employeeId: "e1", personId: null, data, file: { originalName: "x.pdf", buffer: PDF }, actorUserId: null }),
      /falha simulada/,
    );
    assert.deepEqual(files.removed, ["k/x.pdf"]);
  });

  it("competência arquivada ou inexistente é recusada", async () => {
    const { prisma } = fakePrisma();
    const files = fakeFiles();
    await assert.rejects(
      createExternalCertificate({ prisma, files: files.store, writeHistory: async () => null, employeeId: "e1", personId: null, data: { ...data, competencyId: "11111111-1111-4111-8111-111111111111" }, file: { originalName: "x.pdf", buffer: PDF }, actorUserId: null }),
      (e: unknown) => e instanceof PeopleProfileAccessError && e.code === "INVALID_COMPETENCY",
    );
    assert.equal(files.saved.length, 0);
  });
});
