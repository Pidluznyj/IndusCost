import { prisma } from "@/src/lib/prisma.js";
import {
  dec,
  OPEN_STATUSES,
  PROJECT_LIST_CURRENT_VERSION_INCLUDE,
  PROJECT_STATUSES,
  serializeProjectListRow,
} from "@/src/lib/projectsService.js";
import { sanitizeFinite } from "@/src/lib/projectsCalculations.js";
import type { ProjectDashboardPayload, ProjectStatus } from "@/src/types/projects.js";

export function buildEmptyStatusCounts(): Record<ProjectStatus, number> {
  return PROJECT_STATUSES.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<ProjectStatus, number>
  );
}

export async function buildProjectsDashboard(): Promise<ProjectDashboardPayload> {
  const [projects, recent] = await Promise.all([
    prisma.project.findMany({
      include: {
        versions: PROJECT_LIST_CURRENT_VERSION_INCLUDE,
      },
    }),
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        versions: PROJECT_LIST_CURRENT_VERSION_INCLUDE,
      },
    }),
  ]);

  const statusCounts = buildEmptyStatusCounts();
  let openCount = 0;
  let waitingEngineeringCount = 0;
  let waitingQuotationCount = 0;
  let sentToCustomerCount = 0;
  let approvedCount = 0;
  let potentialValue = 0;
  let moldInvestment = 0;
  let marginSum = 0;
  let marginCount = 0;

  for (const p of projects) {
    const status = p.status as ProjectStatus;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    if (OPEN_STATUSES.includes(status)) openCount += 1;
    if (status === "TECHNICAL_ANALYSIS") waitingEngineeringCount += 1;
    if (status === "WAITING_QUOTATION") waitingQuotationCount += 1;
    if (status === "SENT_TO_CUSTOMER") sentToCustomerCount += 1;
    if (status === "APPROVED") approvedCount += 1;

    const current = p.versions[0];
    if (current) {
      const suggested = dec(current.suggestedPrice);
      if (suggested != null) potentialValue += suggested;
      const mold = dec(current.totalMoldCost);
      if (mold != null) moldInvestment += mold;
      const margin = dec(current.marginPercent);
      if (margin != null) {
        marginSum += margin;
        marginCount += 1;
      }
    }
  }

  const recentProjects = await Promise.all(recent.map(serializeProjectListRow));

  return {
    openCount,
    waitingEngineeringCount,
    waitingQuotationCount,
    sentToCustomerCount,
    approvedCount,
    potentialValue: sanitizeFinite(potentialValue) ?? 0,
    moldInvestment: sanitizeFinite(moldInvestment) ?? 0,
    averageMarginPercent:
      marginCount > 0 ? sanitizeFinite(marginSum / marginCount) : null,
    statusCounts,
    recentProjects,
  };
}
