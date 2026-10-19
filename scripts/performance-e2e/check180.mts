// Integridade da avaliação 180° no PostgreSQL LOCAL depois da parte 9 (somente leitura).
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error("recusado: DATABASE_URL não é local");
const prisma = new PrismaClient();
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
};

const cycle = await prisma.hrPerformanceCycle.findFirstOrThrow({ where: { name: "Ciclo piloto 180° 2026-S2" }, orderBy: { createdAt: "desc" } });
const participants = await prisma.hrPerformanceParticipant.findMany({ where: { cycleId: cycle.id } });
const byId = new Map(participants.map((p) => [p.id, p]));
const assignments = await prisma.hrPerformanceAssignment.findMany({ where: { participantId: { in: participants.map((p) => p.id) } } });
const kinds = assignments.filter((a) => a.active).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {});
check("9.18a tarefas por perspectiva", kinds.LEADERSHIP_SELF === 3 && kinds.LEADERSHIP_SUPERIOR === 2 && kinds.LEADERSHIP_UPWARD === 9, JSON.stringify(kinds));

const upward = assignments.filter((a) => a.active && a.kind === "LEADERSHIP_UPWARD");
const wrongSubject = upward.filter((a) => {
  const subject = a.subjectParticipantId ? byId.get(a.subjectParticipantId) : null;
  const respondent = byId.get(a.participantId);
  return !subject || !respondent || respondent.managerId !== subject.employeeId || a.modelId !== cycle.leadershipModelId;
});
check("9.18b avaliação da equipe aponta o líder efetivo de quem responde", wrongSubject.length === 0, `${upward.length} tarefas, ${wrongSubject.length} inconsistentes`);
check("9.18c todas as tarefas de liderança enviadas", assignments.filter((a) => a.active && a.kind.startsWith("LEADERSHIP_") && a.status !== "SUBMITTED").length === 0);

const leaders = participants.filter((p) => p.isLeader);
check(
  "9.18d retrato da liderança gravado na abertura",
  leaders.length === 3 && leaders.every((p) => p.leadershipSnapshotAt !== null),
  leaders.map((p) => `${p.employeeName.replace("[DEMO] ", "")}=${p.directReportCount}`).join(", ")
);

const extreme = await prisma.hrPerformanceAnswer.findMany({ where: { assignmentId: { in: upward.map((a) => a.id) }, kind: "score", score: { in: [1, 4] } } });
check("9.18e nota extrema da equipe tem comentário guardado (não exposto pelas rotas)", extreme.length >= 2 && extreme.every((a) => (a.evidence ?? "").replace(/[^\p{L}]/gu, "").length >= 15), `${extreme.length} respostas extremas`);

const lr = await prisma.hrPerformanceLeadershipResult.findMany({ where: { cycleId: cycle.id } });
const active = lr.filter((r) => r.active);
const perLeader = new Map<string, number>();
for (const r of active) perLeader.set(r.participantId, (perLeader.get(r.participantId) ?? 0) + 1);
check("9.18f um resultado de liderança ativo por líder, oficial após homologar", active.length === 3 && [...perLeader.values()].every((n) => n === 1) && active.every((r) => r.official), `${lr.length} versões, ${active.length} ativas`);
const scoresOk = active.every((r) => Object.values(r.scores as Record<string, number>).every((s) => Number.isInteger(s) && s >= 1 && s <= 4));
check("9.18g notas calibradas inteiras de 1 a 4", scoresOk);
const carla = participants.find((p) => p.employeeName.includes("Carla"))!;
const carlaResult = active.find((r) => r.participantId === carla.id);
check("9.18h topo calibrado com exceção registrada", carla.managerSource === "TOPO" && (carlaResult?.exceptionReason ?? "").length >= 15, `managerSource=${carla.managerSource}`);

const nineBox = await prisma.hrPerformanceResult.findMany({ where: { participantId: { in: participants.map((p) => p.id) }, active: true } });
check("9.18i Nine-Box não recebe liderança", nineBox.every((r) => !String(r.quadrant).includes("Lideran")), `${nineBox.length} resultados individuais`);

const events = await prisma.hrPerformanceAuditEvent.findMany({ where: { OR: [{ entityId: cycle.id }, { entityId: { in: participants.map((p) => p.id) } }] }, select: { action: true } });
const actions = new Set(events.map((e) => e.action));
check("9.18j trilha de auditoria da 180°", ["LEADERSHIP_ASSIGNMENTS_CREATED", "RESULTS_HOMOLOGATED"].every((a) => actions.has(a)) && [...actions].some((a) => a.startsWith("LEADERSHIP_CALIBRATED")), [...actions].filter((a) => a.includes("LEADERSHIP") || a.includes("HOMOLOG")).join(", "));

await prisma.$disconnect();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
