/**
 * Relatório SOMENTE LEITURA da hierarquia efetiva (gestor do cadastro + liderança das unidades).
 * Não grava nada: só `findMany` em Employee, HrDirectorate e HrDepartment.
 *
 * Uso (no servidor de homologação, com o DATABASE_URL do ambiente):
 *   npx tsx scripts/auditOrgHierarchy.ts
 *   npx tsx scripts/auditOrgHierarchy.ts --name="Eduardo Cardoso" --name="Joseane" --name="Paulo Pidluznyj"
 *   npx tsx scripts/auditOrgHierarchy.ts --json > /tmp/org-hierarchy.json
 *
 * Mostra: quantos resolvem, topo, pendências (com motivo), ambiguidades (com candidatos),
 * ciclos, divergências entre o gestor do cadastro e o organograma, e líderes sem superior.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { MANAGER_REASON_LABELS, MANAGER_SOURCE_LABELS, MANAGER_WARNING_LABELS, type EffectiveManagerResolution } from "../src/lib/orgHierarchy.js";
import { loadOrgHierarchy } from "../src/lib/orgHierarchy.server.js";

const args = process.argv.slice(2);
const names = args.filter((a) => a.startsWith("--name=")).map((a) => a.slice("--name=".length).toLowerCase());
const asJson = args.includes("--json");

function host(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL ausente ou inválida)";
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [hierarchy, people] = await Promise.all([
      loadOrgHierarchy(prisma),
      prisma.employee.findMany({ select: { id: true, name: true, socialName: true, status: true, managerId: true } }),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.socialName?.trim() || p.name]));
    const active = people.filter((p) => (p.status ?? "ACTIVE").toUpperCase() !== "INACTIVE");
    const rows = active.map((p) => ({ person: p, r: hierarchy.resolve(p.id) }));
    const line = (p: { id: string; name: string; managerId: string | null }, r: EffectiveManagerResolution) => ({
      colaborador: nameOf.get(p.id) ?? p.name,
      superior: r.managerName,
      situacao: r.status,
      origem: MANAGER_SOURCE_LABELS[r.source],
      unidade: r.unit ? `${r.unit.kind === "directorate" ? "Diretoria" : "Departamento"} ${r.unit.name}` : null,
      cadeia: hierarchy.leadershipChain(p.id).map((id) => nameOf.get(id) ?? id).join(" → ") || null,
      lidera: r.ledUnits.map((u) => u.name).join(", ") || null,
      gestorNoCadastro: p.managerId ? nameOf.get(p.managerId) ?? p.managerId : null,
      motivo: r.reason ? MANAGER_REASON_LABELS[r.reason] : null,
      alertas: r.warnings.map((w) => MANAGER_WARNING_LABELS[w]),
      candidatos: r.candidates.map((c) => `${c.managerName ?? "topo"} (pela ${c.via.name})`),
    });

    const count = (status: string) => rows.filter((x) => x.r.status === status).length;
    const summary = {
      banco: host(process.env.DATABASE_URL),
      geradoEm: new Date().toISOString(),
      ativos: rows.length,
      resolvidos: count("RESOLVED"),
      topo: count("TOP"),
      pendentes: count("UNRESOLVED"),
      ambiguos: count("AMBIGUOUS"),
      ciclos: count("CYCLE"),
      lideresComManagerIdNulo: rows.filter((x) => x.r.ledUnits.length > 0 && !x.person.managerId).length,
      divergenciasCadastroOrganograma: rows.filter((x) => x.r.warnings.includes("EXPLICIT_DIVERGES_FROM_ORG")).length,
    };

    const selected = names.length > 0 ? rows.filter((x) => names.some((n) => (nameOf.get(x.person.id) ?? "").toLowerCase().includes(n) || x.person.name.toLowerCase().includes(n))) : [];
    const problems = rows.filter((x) => x.r.status !== "RESOLVED" || x.r.warnings.length > 0);

    if (asJson) {
      console.log(JSON.stringify({ summary, selecionados: selected.map((x) => line(x.person, x.r)), atencao: problems.map((x) => line(x.person, x.r)), todos: rows.map((x) => line(x.person, x.r)) }, null, 2));
      return;
    }
    console.log("Hierarquia efetiva — relatório somente leitura");
    console.table([summary]);
    if (selected.length > 0) {
      console.log("\nPessoas pedidas:");
      for (const x of selected) console.log(JSON.stringify(line(x.person, x.r), null, 2));
    }
    console.log(`\nPrecisam de atenção (${problems.length}): topo, pendência, ambiguidade, ciclo ou alerta.`);
    console.table(problems.map((x) => {
      const l = line(x.person, x.r);
      return { colaborador: l.colaborador, situacao: l.situacao, superior: l.superior, motivo: l.motivo ?? l.alertas.join(" ") };
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
