import { fetchJsonOk, fetchOk } from "@/src/lib/http";

export type PendingPolicy = {
  id: string;
  version: number;
  title: string;
  content: string;
  summaryRules: string[];
  declarations: string[];
  questions: Array<{ id: string; prompt: string; reviewChapterId?: string; options: Array<{ id: string; text: string }> }>;
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string | null;
};

export type PendingResponse = {
  ok: true;
  pending: boolean;
  version: PendingPolicy | null;
  signer?: { name: string; email: string; role: string; externalSellerId: number | null };
};

export function loadPendingPolicy() {
  return fetchJsonOk<PendingResponse>("/api/commercial-policy/pending");
}

export function submitPolicyAttempt(policyVersionId: string, answers: Array<{ questionId: string; optionId: string }>) {
  return fetchJsonOk<{
    ok: true;
    attemptId: string;
    passed: boolean;
    results: Array<{ questionId: string; correct: boolean; explanation: string }>;
  }>("/api/commercial-policy/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyVersionId, answers }),
  });
}

export function reauthForPolicy(policyVersionId: string, password: string) {
  return fetchJsonOk<{ ok: true; challengeId: string; expiresAt: string }>("/api/commercial-policy/reauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyVersionId, password }),
  });
}

export function uploadPolicyPhoto(input: {
  policyVersionId: string;
  challengeId: string;
  mimeType: string;
  imageBase64: string;
}) {
  return fetchJsonOk<{ ok: true; photoId: string; photoHash: string }>("/api/commercial-policy/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function signPolicy(input: {
  policyVersionId: string;
  challengeId: string;
  photoId: string;
  declarations: string[];
}) {
  return fetchJsonOk<{ ok: true; acceptanceId: string; acceptedAt: string; evidenceHash: string }>(
    "/api/commercial-policy/accept",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

export function loadMyPolicyAcceptances() {
  return fetchJsonOk<{
    acceptances: Array<{ id: string; acceptedAt: string; evidenceHash: string; policyContentHash: string }>;
  }>("/api/commercial-policy/acceptances/mine");
}

export async function downloadAuthenticatedFile(path: string, fileName: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    await fetchOk(path);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
