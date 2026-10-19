// Limpa só as tabelas HrPerformance* num banco LOCAL descartável, para repetir o roteiro do navegador.
import { PrismaClient } from "@prisma/client";
const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error("recusado: DATABASE_URL não é local");
const prisma = new PrismaClient();
const tables = ["HrPerformanceLeadershipResult", "HrPerformanceReportIssue", "HrPerformanceReminder", "HrPerformanceAuditEvent", "HrPerformanceConductCase", "HrPerformancePdiCheckin", "HrPerformancePdi", "HrPerformanceFeedback", "HrPerformanceResult", "HrPerformanceSession", "HrPerformanceInvite", "HrPerformanceAnswer", "HrPerformanceAssignment", "HrPerformanceParticipant", "HrPerformanceCycle", "HrPerformanceQuestion", "HrPerformanceModel", "HrPerformanceGraphLock"];
for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
console.log("módulo limpo em perf_e2e");
await prisma.$disconnect();
