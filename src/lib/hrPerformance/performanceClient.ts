const NO_STORE = { cache: "no-store" as const, credentials: "same-origin" as const };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...NO_STORE, ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Não foi possível concluir.");
  return body as T;
}

export function fetchPerformanceFeatureStatus(): Promise<{ enabled: boolean }> {
  return json("/api/hr/performance/feature-status");
}

export function fetchPerformanceModels() {
  return json<{ models: { id: string; name: string; status: string; version: number; governance: string; homologated: boolean; questionCount: number }[] }>("/api/hr/performance/models");
}

export function createPerformanceModel(name: string) {
  return json<{ modelId: string }>("/api/hr/performance/models", { method: "POST", body: JSON.stringify({ name }) });
}

export function publishPerformanceModel(id: string) {
  return json("/api/hr/performance/models/" + id + "/publish", { method: "POST", body: "{}" });
}

export function fetchPerformanceCycles() {
  return json<{ cycles: { id: string; name: string; status: string; periodLabel: string; selfDueAt: string; leaderDueAt: string }[]; counts: Record<string, Record<string, number>> }>("/api/hr/performance/cycles");
}

export function createPerformanceCycle(input: { name: string; periodLabel: string; modelId: string; selfDueAt: string; leaderDueAt: string }) {
  return json<{ cycleId: string }>("/api/hr/performance/cycles", { method: "POST", body: JSON.stringify(input) });
}

export function transitionPerformanceCycle(id: string, to: string, reason?: string, pilotAck?: boolean, acceptPending?: boolean) {
  return json("/api/hr/performance/cycles/" + id + "/transition", { method: "POST", body: JSON.stringify({ to, reason, pilotAck, acceptPending }) });
}

export function searchPerformanceDirectory(query: string) {
  return json<{ employees: { id: string; name: string; status: string | null; roleName: string; departmentName: string; managerId: string | null; managerName: string | null }[] }>(
    "/api/hr/performance/directory?q=" + encodeURIComponent(query)
  );
}

export function savePerformanceParticipants(cycleId: string, employeeIds: string[], exceptions: Record<string, string>) {
  return json<{ eligible: number; notEligible: number; insufficient: number }>("/api/hr/performance/cycles/" + cycleId + "/participants", {
    method: "POST",
    body: JSON.stringify({ employeeIds, exceptions }),
  });
}

export type CycleWorkspace = {
  cycle: { id: string; name: string; status: string; periodLabel: string; selfDueAt: string; leaderDueAt: string };
  questions: { code: string; pillar: string; selfText: string; leaderText: string; hint: string | null }[];
  people: {
    participant: { id: string; employeeId: string; employeeName: string; eligibility: string; eligibilityReason: string | null; roleName: string; departmentName: string; managerId: string | null; managerName: string | null };
    self: { id: string; status: string } | null;
    leader: { id: string; status: string; evaluatorEmployeeId: string } | null;
    result: { quadrant: string; official: boolean; reviewStatus: string; technicalValidation: string; cultureBand: string; technicalSum: number; technicalCount: number; potentialSum: number; potentialCount: number } | null;
    feedback: { id: string; strength: string; improvement: string; acknowledgedAt: string | null; agreedAt: string | null; contestation: string | null } | null;
    pdis: { id: string; title: string; status: string; dueAt: string | null; ownerName: string; priority: boolean }[];
    inviteStatus: string;
    divergences: { questionCode: string; gap: number }[];
  }[];
};

export function fetchCycleWorkspace(id: string) {
  return json<CycleWorkspace>("/api/hr/performance/cycles/" + id + "/workspace");
}

export function fetchPerformanceModel(id: string) {
  return json<{ model: { id: string; name: string; status: string; version: number }; questions: { code: string; selfText: string; leaderText: string; hint: string | null; pillar: string }[] }>("/api/hr/performance/models/" + id);
}

export function savePerformanceQuestion(modelId: string, code: string, selfText: string, leaderText: string, hint: string) {
  return json("/api/hr/performance/models/" + modelId + "/questions/" + code, { method: "PUT", body: JSON.stringify({ selfText, leaderText, hint }) });
}

export function duplicatePerformanceModel(id: string) {
  return json<{ modelId: string }>("/api/hr/performance/models/" + id + "/duplicate", { method: "POST", body: "{}" });
}

export function archivePerformanceModel(id: string) {
  return json("/api/hr/performance/models/" + id + "/archive", { method: "POST", body: "{}" });
}

export function issuePerformanceInvite(assignmentId: string) {
  return json<{ url: string; otp: string; inviteId: string }>("/api/hr/performance/assignments/" + assignmentId + "/invites", { method: "POST", body: "{}" });
}

export function openAssistedPerformance(assignmentId: string) {
  return json<{ sessionToken: string }>("/api/hr/performance/assignments/" + assignmentId + "/assist", { method: "POST", body: "{}" });
}

export function returnPerformanceAssignment(assignmentId: string, reason: string) {
  return json("/api/hr/performance/assignments/" + assignmentId + "/return", { method: "POST", body: JSON.stringify({ reason }) });
}

export function reassignPerformanceLeader(participantId: string, managerId: string, managerName: string) {
  return json("/api/hr/performance/participants/" + participantId + "/leader", { method: "POST", body: JSON.stringify({ managerId, managerName }) });
}

export function validatePerformanceTechnical(participantId: string, decision: "VALIDATED" | "INSUFFICIENT", note: string) {
  return json("/api/hr/performance/participants/" + participantId + "/validation", { method: "POST", body: JSON.stringify({ decision, note }) });
}

export function calibratePerformance(participantId: string, note: string) {
  return json("/api/hr/performance/participants/" + participantId + "/calibration", { method: "POST", body: JSON.stringify({ note }) });
}

export function createPerformanceFeedback(input: { participantId: string; strength: string; improvement: string; action: string; ownerName: string; dueAt: string; conversationAt: string; leaderEmployeeId: string }) {
  return json<{ feedbackId: string }>("/api/hr/performance/participants/" + input.participantId + "/feedback", { method: "POST", body: JSON.stringify(input) });
}

export function acknowledgePerformanceFeedback(feedbackId: string, action: "VIEWED" | "ACKNOWLEDGED" | "AGREED" | "CONTESTED", note?: string) {
  return json("/api/hr/performance/feedbacks/" + feedbackId + "/ack", { method: "POST", body: JSON.stringify({ action, note }) });
}

export function createPerformancePdi(feedbackId: string, title: string, ownerName: string, dueAt: string) {
  return json<{ pdiId: string }>("/api/hr/performance/feedbacks/" + feedbackId + "/pdi", { method: "POST", body: JSON.stringify({ title, priority: true, ownerName, dueAt, justification: null }) });
}

export function updatePerformancePdi(pdiId: string, status: string) {
  return json("/api/hr/performance/pdis/" + pdiId + "/status", { method: "POST", body: JSON.stringify({ status }) });
}

export function addPerformanceCheckin(pdiId: string, note: string) {
  return json("/api/hr/performance/pdis/" + pdiId + "/checkins", { method: "POST", body: JSON.stringify({ note }) });
}

export function performanceReportUrl(cycleId: string, kind: string, participantId?: string) {
  const params = new URLSearchParams({ cycleId, kind });
  if (participantId) params.set("participantId", participantId);
  return "/api/hr/performance/reports/document.pdf?" + params.toString();
}

export function fetchPerformanceDashboard(id: string) {
  return json<{
    eligible: number; notEligible: number; insufficient: number; invited: number;
    selfStarted: number; selfSubmitted: number; leaderSubmitted: number; calibrated: number; feedback: number; pdiOpen: number;
    cells: { employeeId: string; name: string; quadrant: string; official: boolean; cultureBand: string | null; technicalValidation: string | null }[];
  }>("/api/hr/performance/cycles/" + id + "/dashboard");
}

export function fetchLeaderQueue() {
  return json<{ items: { assignmentId: string; employeeName: string; roleName: string; departmentName: string; status: string; version: number; selfVisible: boolean }[] }>("/api/hr/performance/team");
}

export type LeaderAnswerDraft = { kind: "pending" } | { kind: "notObserved" } | { kind: "score"; score: number; evidence?: string | null };

export function fetchLeaderAssignment(id: string) {
  return json<{
    assignment: { id: string; status: string; version: number };
    questions: { code: string; text: string; pillar: string; hint: string | null }[];
    answers: { questionCode: string; kind: string; score: number | null; evidence: string | null }[];
    selfAnswers: { questionCode: string; kind: string; score: number | null }[];
    divergences: { questionCode: string; selfScore: number; leaderScore: number; gap: number }[];
  }>("/api/hr/performance/assignments/" + id);
}

export function saveLeaderAnswers(id: string, expectedVersion: number, answers: { code: string; answer: LeaderAnswerDraft }[]) {
  return json<{ version: number }>("/api/hr/performance/assignments/" + id + "/answers", {
    method: "PUT",
    body: JSON.stringify({ expectedVersion, answers }),
  });
}

export function submitLeaderAssignment(id: string, expectedVersion: number) {
  return json<{ status: string }>("/api/hr/performance/assignments/" + id + "/submit", {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function fetchEmployeePerformanceHistory(employeeId: string) {
  return json<{ cycles: { cycleName: string; periodLabel: string; roleName: string; departmentName: string; eligibility: string; quadrant: string | null; cultureBand: string | null; feedback: { strength: string; improvement: string; acknowledgedAt: string | null; agreedAt: string | null; contestation: string | null } | null }[] }>(
    "/api/hr/performance/employees/" + employeeId + "/history"
  );
}

export async function openPerformanceInvite(token: string) {
  const response = await fetch("/api/public/performance/session", { ...NO_STORE, method: "POST", body: JSON.stringify({ token }) });
  return response.json() as Promise<{ ok: boolean; message?: string; phase?: string }>;
}

export async function verifyPerformanceOtp(otp: string) {
  const response = await fetch("/api/public/performance/verify", { ...NO_STORE, method: "POST", body: JSON.stringify({ otp }) });
  return response.json() as Promise<{ ok: boolean; message?: string }>;
}

export async function fetchPerformanceForm() {
  const response = await fetch("/api/public/performance/form", NO_STORE);
  return response.json() as Promise<{ ok: boolean; message?: string; employeeName?: string; periodLabel?: string; version?: number; questions?: { code: string; text: string; pillar: string }[]; answers?: { questionCode: string; kind: string; score: number | null }[] }>;
}

export async function savePerformanceForm(expectedVersion: number, answers: { code: string; answer: { kind: string; score?: number } }[]) {
  const response = await fetch("/api/public/performance/answers", { ...NO_STORE, method: "PUT", body: JSON.stringify({ expectedVersion, answers }) });
  return response.json() as Promise<{ ok: boolean; message?: string; version?: number }>;
}

export async function submitPerformanceForm(expectedVersion: number) {
  const response = await fetch("/api/public/performance/submit", { ...NO_STORE, method: "POST", body: JSON.stringify({ expectedVersion, confirm: true }) });
  return response.json() as Promise<{ ok: boolean; message?: string }>;
}
