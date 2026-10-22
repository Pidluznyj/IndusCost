/**
 * Auditoria SOMENTE LEITURA da identidade de pessoas (Pessoa canônica × papéis).
 * Nada é gravado: só `findMany`. Pode rodar em produção com o DATABASE_URL do ambiente.
 *
 * Responde "temos uma pessoa canônica por pessoa e todo mundo tem cadastro?":
 *   1. Pessoas canônicas repetidas (mesmo CPF; mesmo e-mail corporativo).
 *   2. Usuários ativos sem Pessoa canônica, sem colaborador, ou apontando para
 *      uma Pessoa diferente da do colaborador vinculado.
 *   3. Colaboradores ativos sem Pessoa canônica.
 *   4. Comissionados, motoristas e clientes PF ativos sem Pessoa canônica.
 *   5. Pessoas canônicas sem nenhum papel (órfãs).
 *   6. Usuário e colaborador com o mesmo e-mail ainda não vinculados (vínculo pendente).
 *
 * CPF nunca sai inteiro: só mascarado.
 *
 * Uso:
 *   npx tsx scripts/auditPeopleIdentity.ts           # resumo + tabelas
 *   npx tsx scripts/auditPeopleIdentity.ts --json    # tudo em JSON
 *   npx tsx scripts/auditPeopleIdentity.ts --csv     # uma linha por achado
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { classifyCustomerDocument, maskCpf, normalizeEmailLoose } from "../src/lib/canonicalPerson.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const asCsv = args.includes("--csv");
/** --only=CATEGORIA[,CATEGORIA] restringe a saída (o resumo continua completo). */
const onlyArg = args.find((a) => a.startsWith("--only="));
const onlyCategories = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((c) => c.trim()).filter(Boolean)) : null;

type Finding = {
  categoria:
    | "PESSOA_CPF_REPETIDO"
    | "PESSOA_EMAIL_REPETIDO"
    | "USUARIO_SEM_PESSOA"
    | "USUARIO_SEM_COLABORADOR"
    | "USUARIO_PESSOA_DIVERGE_DO_COLABORADOR"
    | "USUARIO_COLABORADOR_PESSOA_INATIVA"
    | "USUARIO_EMAIL_DIVERGE_DO_COLABORADOR"
    | "USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO"
    | "COLABORADOR_SEM_PESSOA"
    | "COMISSIONADO_SEM_PESSOA"
    | "MOTORISTA_SEM_PESSOA"
    | "CLIENTE_PF_SEM_PESSOA"
    | "PESSOA_SEM_PAPEL"
    | "VINCULO_USUARIO_COLABORADOR_PENDENTE";
  quem: string;
  detalhe: string;
  ids: string;
};

function host(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL ausente ou inválida)";
  }
}

const short = (id: string) => id.slice(0, 8);
const isActive = (status: string | null | undefined) => (status ?? "ACTIVE").toUpperCase() !== "INACTIVE";

async function main() {
  const prisma = new PrismaClient();
  try {
    const [people, employees, users, commissionPeople, drivers, customers] = await Promise.all([
      prisma.person.findMany({
        select: {
          id: true,
          displayName: true,
          status: true,
          origin: true,
          cpfNormalized: true,
          corporateEmail: true,
          employees: { select: { id: true } },
          appUsers: { select: { id: true } },
          commissionPeople: { select: { id: true } },
          fleetDrivers: { select: { id: true } },
          customersAsIdentity: { select: { id: true } },
          customersAsContact: { select: { id: true } },
        },
      }),
      prisma.employee.findMany({ select: { id: true, name: true, status: true, corporateEmail: true, personId: true } }),
      prisma.appUser.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true, personId: true, employeeId: true } }),
      prisma.commissionPerson.findMany({ select: { id: true, name: true, active: true, personId: true } }),
      prisma.fleetDriver.findMany({ select: { id: true, name: true, status: true, personId: true } }),
      prisma.customer.findMany({ select: { id: true, companyName: true, taxId: true, status: true, personId: true } }),
    ]);

    const findings: Finding[] = [];
    const personById = new Map(people.map((p) => [p.id, p]));
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    // 1. Pessoas repetidas
    const byCpf = new Map<string, typeof people>();
    const byEmail = new Map<string, typeof people>();
    for (const p of people) {
      if (p.cpfNormalized) byCpf.set(p.cpfNormalized, [...(byCpf.get(p.cpfNormalized) ?? []), p]);
      const email = normalizeEmailLoose(p.corporateEmail);
      if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), p]);
    }
    for (const [cpf, group] of byCpf) {
      if (group.length < 2) continue;
      findings.push({
        categoria: "PESSOA_CPF_REPETIDO",
        quem: group.map((p) => `${p.displayName}${isActive(p.status) ? "" : " (inativa)"}`).join(" | "),
        detalhe: `CPF ${maskCpf(cpf)} em ${group.length} pessoas canônicas`,
        ids: group.map((p) => short(p.id)).join(","),
      });
    }
    for (const [email, group] of byEmail) {
      if (group.length < 2) continue;
      findings.push({
        categoria: "PESSOA_EMAIL_REPETIDO",
        quem: group.map((p) => `${p.displayName}${isActive(p.status) ? "" : " (inativa)"}`).join(" | "),
        detalhe: `${email} em ${group.length} pessoas canônicas`,
        ids: group.map((p) => short(p.id)).join(","),
      });
    }

    // 2. Usuários
    const employeesByEmail = new Map<string, typeof employees>();
    for (const e of employees) {
      const email = normalizeEmailLoose(e.corporateEmail);
      if (email && isActive(e.status)) employeesByEmail.set(email, [...(employeesByEmail.get(email) ?? []), e]);
    }
    const linkedEmployeeIds = new Set(users.map((x) => x.employeeId).filter(Boolean));
    for (const u of users) {
      if (!u.isActive) continue;
      const who = `${u.name} <${u.email}> · ${u.role}`;
      if (!u.personId) findings.push({ categoria: "USUARIO_SEM_PESSOA", quem: who, detalhe: "usuário ativo sem Pessoa canônica", ids: short(u.id) });
      if (!u.employeeId && u.personId) {
        // Caso do avaliador "sem acesso": a conta é da Pessoa certa, mas não está ligada ao colaborador dela.
        const samePerson = employees.filter((e) => e.personId === u.personId && isActive(e.status) && !linkedEmployeeIds.has(e.id));
        if (samePerson.length > 0) {
          findings.push({
            categoria: "USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO",
            quem: who,
            detalhe: `conta da mesma Pessoa do colaborador ${samePerson.map((e) => e.name).join(", ")} sem employeeId — não responde avaliações; regularizar em Pessoas 360° (${samePerson.length > 1 ? "mais de um colaborador: revisão" : "inequívoco"})`,
            ids: `${short(u.id)}→${samePerson.map((e) => short(e.id)).join(",")}`,
          });
        }
      }
      if (!u.employeeId) {
        const sameEmail = employeesByEmail.get(normalizeEmailLoose(u.email) ?? "") ?? [];
        if (sameEmail.length > 0) {
          findings.push({
            categoria: "VINCULO_USUARIO_COLABORADOR_PENDENTE",
            quem: who,
            detalhe: `colaborador com o mesmo e-mail: ${sameEmail.map((e) => e.name).join(", ")} (vincular em Acesso ao sistema)`,
            ids: `${short(u.id)}→${sameEmail.map((e) => short(e.id)).join(",")}`,
          });
        } else {
          findings.push({ categoria: "USUARIO_SEM_COLABORADOR", quem: who, detalhe: "usuário ativo sem colaborador vinculado e sem colaborador com o mesmo e-mail", ids: short(u.id) });
        }
      } else {
        const emp = employeeById.get(u.employeeId);
        if (emp && emp.personId) {
          const empPerson = personById.get(emp.personId);
          if (empPerson && !isActive(empPerson.status)) {
            findings.push({
              categoria: "USUARIO_COLABORADOR_PESSOA_INATIVA",
              quem: who,
              detalhe: `colaborador ${emp.name} (${String(emp.status)}) aponta para Pessoa "${empPerson.displayName}" com situação ${empPerson.status} — reativar a Pessoa antes de regularizar a conta`,
              ids: `${short(u.id)}→${short(emp.personId)}`,
            });
          }
        }
        if (emp) {
          const loginEmail = normalizeEmailLoose(u.email);
          const corpEmail = normalizeEmailLoose(emp.corporateEmail);
          if (loginEmail && corpEmail && loginEmail !== corpEmail) {
            findings.push({
              categoria: "USUARIO_EMAIL_DIVERGE_DO_COLABORADOR",
              quem: who,
              detalhe: `e-mail de login difere do e-mail corporativo do colaborador ${emp.name} (vínculo por employeeId continua válido; confirmar ao regularizar)`,
              ids: `${short(u.id)}→${short(emp.id)}`,
            });
          }
        }
        if (emp && u.personId && emp.personId && emp.personId !== u.personId) {
          findings.push({
            categoria: "USUARIO_PESSOA_DIVERGE_DO_COLABORADOR",
            quem: who,
            detalhe: `usuário → "${personById.get(u.personId)?.displayName ?? "?"}", colaborador ${emp.name} → "${personById.get(emp.personId)?.displayName ?? "?"}"`,
            ids: `${short(u.personId)}≠${short(emp.personId)}`,
          });
        }
      }
    }

    // 3–4. Papéis sem Pessoa
    for (const e of employees) {
      if (isActive(e.status) && !e.personId) findings.push({ categoria: "COLABORADOR_SEM_PESSOA", quem: e.name, detalhe: "colaborador ativo sem Pessoa canônica", ids: short(e.id) });
    }
    for (const c of commissionPeople) {
      if (c.active && !c.personId) findings.push({ categoria: "COMISSIONADO_SEM_PESSOA", quem: c.name, detalhe: "comissionado ativo sem Pessoa canônica", ids: short(c.id) });
    }
    for (const d of drivers) {
      if (String(d.status) !== "INACTIVE" && !d.personId) findings.push({ categoria: "MOTORISTA_SEM_PESSOA", quem: d.name, detalhe: `motorista ${String(d.status)} sem Pessoa canônica`, ids: short(d.id) });
    }
    for (const c of customers) {
      if (isActive(c.status) && classifyCustomerDocument(c.taxId) === "PF" && !c.personId) {
        findings.push({ categoria: "CLIENTE_PF_SEM_PESSOA", quem: c.companyName, detalhe: "cliente pessoa física ativo sem Pessoa canônica", ids: short(c.id) });
      }
    }

    // 5. Órfãs
    for (const p of people) {
      const roles = p.employees.length + p.appUsers.length + p.commissionPeople.length + p.fleetDrivers.length + p.customersAsIdentity.length + p.customersAsContact.length;
      if (roles === 0 && isActive(p.status)) findings.push({ categoria: "PESSOA_SEM_PAPEL", quem: p.displayName, detalhe: `origem ${p.origin}, sem nenhum papel ligado`, ids: short(p.id) });
    }

    const count = (c: Finding["categoria"]) => findings.filter((f) => f.categoria === c).length;
    const summary = {
      banco: host(process.env.DATABASE_URL),
      geradoEm: new Date().toISOString(),
      pessoasCanonicas: people.length,
      pessoasAtivas: people.filter((p) => isActive(p.status)).length,
      colaboradoresAtivos: employees.filter((e) => isActive(e.status)).length,
      usuariosAtivos: users.filter((u) => u.isActive).length,
      PESSOA_CPF_REPETIDO: count("PESSOA_CPF_REPETIDO"),
      PESSOA_EMAIL_REPETIDO: count("PESSOA_EMAIL_REPETIDO"),
      USUARIO_SEM_PESSOA: count("USUARIO_SEM_PESSOA"),
      USUARIO_SEM_COLABORADOR: count("USUARIO_SEM_COLABORADOR"),
      VINCULO_USUARIO_COLABORADOR_PENDENTE: count("VINCULO_USUARIO_COLABORADOR_PENDENTE"),
      USUARIO_PESSOA_DIVERGE_DO_COLABORADOR: count("USUARIO_PESSOA_DIVERGE_DO_COLABORADOR"),
      USUARIO_COLABORADOR_PESSOA_INATIVA: count("USUARIO_COLABORADOR_PESSOA_INATIVA"),
      USUARIO_EMAIL_DIVERGE_DO_COLABORADOR: count("USUARIO_EMAIL_DIVERGE_DO_COLABORADOR"),
      USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO: count("USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO"),
      COLABORADOR_SEM_PESSOA: count("COLABORADOR_SEM_PESSOA"),
      COMISSIONADO_SEM_PESSOA: count("COMISSIONADO_SEM_PESSOA"),
      MOTORISTA_SEM_PESSOA: count("MOTORISTA_SEM_PESSOA"),
      CLIENTE_PF_SEM_PESSOA: count("CLIENTE_PF_SEM_PESSOA"),
      PESSOA_SEM_PAPEL: count("PESSOA_SEM_PAPEL"),
    };

    if (onlyCategories) {
      const kept = findings.filter((f) => onlyCategories.has(f.categoria));
      findings.length = 0;
      findings.push(...kept);
    }

    if (asCsv) {
      const cell = (v: unknown) => {
        const s = v == null ? "" : String(v);
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      console.log(`﻿categoria,quem,detalhe,ids\n${findings.map((f) => [f.categoria, f.quem, f.detalhe, f.ids].map(cell).join(",")).join("\n")}`);
      return;
    }
    if (asJson) {
      console.log(JSON.stringify({ summary, achados: findings }, null, 2));
      return;
    }
    console.log("Identidade de pessoas — auditoria somente leitura (nada é gravado)");
    console.table([summary]);
    const order: Finding["categoria"][] = [
      "PESSOA_CPF_REPETIDO",
      "PESSOA_EMAIL_REPETIDO",
      "USUARIO_PESSOA_DIVERGE_DO_COLABORADOR",
      "VINCULO_USUARIO_COLABORADOR_PENDENTE",
      "USUARIO_SEM_PESSOA",
      "USUARIO_SEM_COLABORADOR",
      "COLABORADOR_SEM_PESSOA",
      "COMISSIONADO_SEM_PESSOA",
      "MOTORISTA_SEM_PESSOA",
      "CLIENTE_PF_SEM_PESSOA",
      "PESSOA_SEM_PAPEL",
    ];
    for (const categoria of order) {
      const rows = findings.filter((f) => f.categoria === categoria);
      if (rows.length === 0) continue;
      console.log(`\n${categoria} (${rows.length}):`);
      console.table(rows.map((r) => ({ quem: r.quem, detalhe: r.detalhe, ids: r.ids })));
    }
    if (findings.length === 0) console.log("\nNenhum achado: uma pessoa canônica por pessoa e todos os papéis ligados.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
