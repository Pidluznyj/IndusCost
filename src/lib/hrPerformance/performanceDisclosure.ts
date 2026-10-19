/**
 * Corte de conteúdo por capacidade, aplicado às leituras de toda a organização.
 *
 * O alcance operacional (acompanhar, preparar, convidar) mostra QUEM e QUANDO; o conteúdo (nota,
 * Nine-Box, faixa de cultura, divergência, devolutiva, PDI, índice de liderança) só sai para quem
 * pode ver o resultado daquela pessoa (`canSeeResultOf`). Distribuições agregadas só com
 * `reports` (ou `results`) e com o mínimo de pessoas no recorte, para filtro não isolar alguém.
 */
import { LOW_SAMPLE_THRESHOLD } from "./performanceDomain.js";
import type { describeCycle, dashboard, calibrationQueue } from "./performanceInsights.js";
import type { leadershipCalibrationList } from "./performanceLeadershipService.js";

type Workspace = NonNullable<ReturnType<typeof describeCycle>>;
type Board = NonNullable<ReturnType<typeof dashboard>>;
type Queue = NonNullable<ReturnType<typeof calibrationQueue>>;
type LeadershipRows = NonNullable<ReturnType<typeof leadershipCalibrationList>>;

export type ResultGate = (participant: { employeeId: string; managerId: string | null }) => boolean;

/** Mesa do ciclo: situação fica; conteúdo some para quem não pode ver o resultado da pessoa. */
export function redactWorkspace(ws: Workspace, canSee: ResultGate): Workspace & { redacted: boolean } {
  let redacted = false;
  const people = ws.people.map((person) => {
    if (canSee(person.participant)) return person;
    redacted = true;
    const r = person.result;
    const f = person.feedback;
    return {
      ...person,
      result: r
        ? ({
            id: r.id,
            version: r.version,
            official: r.official,
            reviewStatus: r.reviewStatus,
            technicalValidation: r.technicalValidation,
            calibratedAt: r.calibratedAt,
            hidden: true,
          } as unknown as typeof r)
        : null,
      feedback: f
        ? ({ id: f.id, createdAt: f.createdAt, viewedAt: f.viewedAt, acknowledgedAt: f.acknowledgedAt, agreedAt: f.agreedAt, dueAt: f.dueAt, conversationAt: f.conversationAt, ownerName: f.ownerName, hidden: true } as unknown as typeof f)
        : null,
      pdis: person.pdis.map((p) => ({ id: p.id, status: p.status, dueAt: p.dueAt, ownerName: p.ownerName, checkins: p.checkins, hidden: true }) as unknown as typeof p),
      divergences: [],
    };
  });
  return { ...ws, people, redacted };
}

/** Painel: Nine-Box só com quem a pessoa pode ver; distribuições só com relatório e amostra mínima. */
export function redactDashboard(board: Board, canSee: ResultGate, aggregates: boolean): Board & { redacted: boolean } {
  const cells = board.cells.filter((c) => canSee({ employeeId: c.employeeId, managerId: c.managerId }));
  const all = cells.length === board.cells.length;
  if (all) return { ...board, redacted: false };
  const enough = board.cells.length >= LOW_SAMPLE_THRESHOLD;
  return {
    ...board,
    cells,
    culture: aggregates && enough ? board.culture : ({} as Board["culture"]),
    pdiByStatus: aggregates && enough ? board.pdiByStatus : {},
    leadership: board.leadership ? { ...board.leadership, byCompetency: aggregates ? board.leadership.byCompetency : null } : null,
    redacted: true,
  };
}

/** Acompanhar calibrações: situação de cada pessoa, sem médias, divergências nem evidências. */
export function redactCalibrationQueue(queue: Queue): Queue & { redacted: true } {
  return {
    ...queue,
    rows: queue.rows.map((row) => ({
      ...row,
      self: {} as typeof row.self,
      leader: {} as typeof row.leader,
      divergences: [],
      evidences: [],
      result: row.result
        ? ({ id: row.result.id, version: row.result.version, official: row.result.official, reviewStatus: row.result.reviewStatus, technicalValidation: row.result.technicalValidation, calibratedAt: row.result.calibratedAt, hidden: true } as unknown as typeof row.result)
        : null,
    })),
    redacted: true,
  };
}

/** Lista de liderança sem o índice calibrado (situação e cobertura ficam). */
export function redactLeadershipRows(rows: LeadershipRows): LeadershipRows {
  return rows.map((r) => ({ ...r, calibratedIndex: null }));
}
