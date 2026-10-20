/**
 * Relatório SOMENTE LEITURA da hierarquia efetiva (gestor do cadastro + liderança das unidades).
 * Não grava nada: só `findMany` em Employee, HrDirectorate e HrDepartment. Pode rodar em produção.
 *
 * Uso (com o DATABASE_URL do ambiente):
 *   npx tsx scripts/auditOrgHierarchy.ts                      # tabela com TODOS os ativos
 *   npx tsx scripts/auditOrgHierarchy.ts --name="Eduardo" --name="Paulo"
 *   npx tsx scripts/auditOrgHierarchy.ts --json > hierarquia.json
 *   npx tsx scripts/auditOrgHierarchy.ts --csv  > hierarquia.csv
 *
 * Para cada colaborador ativo: gestor do cadastro, unidade, líder da unidade, liderança superior,
 * superior efetivo, origem, liderados diretos, conflito, topo, e a classificação:
 *   CORRETO · TOPO_HIERARQUICO · CONFLITO · SEM_SUPERIOR · REFERENCIA_INVALIDA · CICLO_HIERARQUICO
 * Quem não tem `managerId` mas é líder de unidade NÃO é inconsistência: a classificação vem do resolvedor.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { MANAGER_REASON_LABELS, MANAGER_SOURCE_LABELS, MANAGER_WARNING_LABELS, type EffectiveManagerResolution } from "../src/lib/orgHierarchy.js";
import { loadOrgHierarchy } from "../src/lib/orgHierarchy.server.js";

const args = process.argv.slice(2);
const names = args.filter((a) => a.startsWith("--name=")).map((a) => a.slice("--name=".length).toLowerCase());
const asJson = args.includes("--json");
const asCsv = args.includes("--csv");

type Classification = "CORRETO" | "TOPO_HIERARQUICO" | "CONFLITO" | "SEM_SUPERIOR" | "REFERENCIA_INVALIDA" | "CICLO_HIERARQUICO";

function classify(r: EffectiveManagerResolution): Classification {
  if (r.status === "RESOLVED") return "CORRETO";
  if (r.status === "TOP") return "TOPO_HIERARQUICO";
  if (r.status === "AMBIGUOUS") return "CONFLITO";
  if (r.status === "CYCLE") return "CICLO_HIERARQUICO";
  if (r.reason === "LEADER_NOT_FOUND" || r.reason === "LEADER_INACTIVE" || r.reason === "DEPARTMENT_NOT_FOUND" || r.reason === "DEPARTMENT_INACTIVE") return "REFERENCIA_INVALIDA";
  return "SEM_SUPERIOR";
}

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
    const [hierarchy, people, departments, directorates] = await Promise.all([
      loadOrgHierarchy(prisma),
      prisma.employee.findMany({ select: { id: true, name: true, socialName: true, status: true, managerId: true, departmentId: true, department: true } }),
      prisma.hrDepartment.findMany({ select: { id: true, name: true, status: true, leaderEmployeeId: true, parentDepartmentId: true, directorateId: true } }),
      prisma.hrDirectorate.findMany({ select: { id: true, name: true, status: true, leaderEmployeeId: true, parentDirectorateId: true } }),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.socialName?.trim() || p.name]));
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const dirById = new Map(directorates.map((d) => [d.id, d]));
    const active = people.filter((p) => (p.status ?? "ACTIVE").toUpperCase() !== "INACTIVE");
    const activeIds = new Set(active.map((p) => p.id));
    const referenceAt = new Date().toISOString();

    const unitInfo = (p: (typeof people)[number]) => {
      const dept = p.departmentId ? deptById.get(p.departmentId) : undefined;
      const dir = dept ? dirById.get(dept.directorateId) : undefined;
      const parentDept = dept?.parentDepartmentId ? deptById.get(dept.parentDepartmentId) : undefined;
      return {
        unidade: dept ? `Departamento ${dept.name}` : p.department ? `(${p.department}: sem departamento oficial)` : null,
        liderDaUnidade: dept ? nameOf.get(dept.leaderEmployeeId) ?? dept.leaderEmployeeId : null,
        liderancaSuperior: parentDept ? `Departamento ${parentDept.name} → ${nameOf.get(parentDept.leaderEmployeeId) ?? "?"}` : dir ? `Diretoria ${dir.name} → ${nameOf.get(dir.leaderEmployeeId) ?? "?"}` : null,
      };
    };

    const rows = active.map((p) => {
      const r = hierarchy.resolve(p.id);
      const reports = hierarchy.directReports(p.id).filter((id) => activeIds.has(id));
      const u = unitInfo(p);
      return {
        colaborador: nameOf.get(p.id) ?? p.name,
        classificacao: classify(r),
        gestorNoCadastro: p.managerId ? nameOf.get(p.managerId) ?? p.managerId : null,
        unidade: u.unidade,
        liderDaUnidade: u.liderDaUnidade,
        liderancaSuperior: u.liderancaSuperior,
        lidera: r.ledUnits.map((x) => `${x.kind === "directorate" ? "Dir." : "Dep."} ${x.name}`).join("; ") || null,
        superiorEfetivo: r.managerName,
        origem: MANAGER_SOURCE_LABELS[r.source],
        unidadeDaDecisao: r.unit ? `${r.unit.kind === "directorate" ? "Diretoria" : "Departamento"} ${r.unit.name}` : null,
        caminho: r.path.map((x) => x.name).join(" → ") || null,
        cadeiaDePessoas: hierarchy.leadershipChain(p.id).map((id) => nameOf.get(id) ?? id).join(" → ") || null,
        liderados: reports.length,
        eLider: reports.length > 0,
        topo: r.status === "TOP",
        conflito: r.status === "AMBIGUOUS",
        candidatos: r.candidates.map((c) => `${c.managerName ?? "topo"} (pela ${c.via.name})`).join("; ") || null,
        motivo: r.reason ? MANAGER_REASON_LABELS[r.reason] : null,
        alertas: r.warnings.map((w) => MANAGER_WARNING_LABELS[w]).join(" ") || null,
        referencia: referenceAt,
      };
    });

    const count = (c: Classification) => rows.filter((x) => x.classificacao === c).length;
    const summary = {
      banco: host(process.env.DATABASE_URL),
      geradoEm: referenceAt,
      ativos: rows.length,
      CORRETO: count("CORRETO"),
      TOPO_HIERARQUICO: count("TOPO_HIERARQUICO"),
      CONFLITO: count("CONFLITO"),
      SEM_SUPERIOR: count("SEM_SUPERIOR"),
      REFERENCIA_INVALIDA: count("REFERENCIA_INVALIDA"),
      CICLO_HIERARQUICO: count("CICLO_HIERARQUICO"),
      lideres: rows.filter((x) => x.eLider).length,
      lideresSemManagerId: rows.filter((x) => x.eLider && !x.gestorNoCadastro).length,
      divergenciasCadastroOrganograma: rows.filter((x) => (x.alertas ?? "").includes(MANAGER_WARNING_LABELS.EXPLICIT_DIVERGES_FROM_ORG)).length,
    };
    const selected = names.length > 0 ? rows.filter((x) => names.some((n) => x.colaborador.toLowerCase().includes(n))) : rows;

    if (asCsv) {
      const cols = Object.keys(rows[0] ?? { colaborador: "" });
      const cell = (v: unknown) => {
        const s = v == null ? "" : String(v);
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      console.log(`﻿${cols.join(",")}\n${selected.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(",")).join("\n")}`);
      return;
    }
    if (asJson) {
      console.log(JSON.stringify({ summary, colaboradores: selected }, null, 2));
      return;
    }
    console.log("Hierarquia efetiva — relatório somente leitura (nada é gravado)");
    console.table([summary]);
    console.log(`\nTodos os ativos${names.length ? " (filtrados)" : ""}:`);
    console.table(selected.map((r) => ({ colaborador: r.colaborador, classificacao: r.classificacao, superiorEfetivo: r.superiorEfetivo, origem: r.origem, lidera: r.lidera, liderados: r.liderados, motivo: r.motivo ?? r.alertas ?? "" })));
    const attention = rows.filter((r) => r.classificacao !== "CORRETO" && r.classificacao !== "TOPO_HIERARQUICO");
    if (attention.length > 0) {
      console.log(`\nPrecisam de decisão do RH (${attention.length}):`);
      console.table(attention.map((r) => ({ colaborador: r.colaborador, classificacao: r.classificacao, motivo: r.motivo, candidatos: r.candidatos })));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
