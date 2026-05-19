import { fetchJsonOk } from "@/src/lib/http";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import type {
  NomusParentCodeOption,
  NomusParentCodeOptionsResponse,
  ResolveNomusParentCodeResult,
} from "@/src/lib/nomusParentCodeOptionsTypes";

export type { NomusParentCodeOption, ResolveNomusParentCodeResult };
export { NOMUS_PARENT_CODE_NOT_FOUND_MSG } from "@/src/lib/nomusParentCodeOptionsTypes";

export async function fetchNomusParentCodeOptions(
  search: string,
  limit = 50
): Promise<NomusParentCodeOptionsResponse> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", String(limit));
  return fetchJsonOk<NomusParentCodeOptionsResponse>(
    `/api/nomus/parent-code-options?${params.toString()}`
  );
}

export async function resolveNomusParentCode(
  search: string,
  limit = 50
): Promise<ResolveNomusParentCodeResult> {
  const term = search.trim();
  if (!term) return { kind: "empty" };

  const { rows } = await fetchNomusParentCodeOptions(term, limit);
  if (rows.length === 0) return { kind: "none", search: term };

  const wanted = normalizeSku(term);
  const exactMatches = rows.filter((row) => normalizeSku(row.parentCode) === wanted);
  if (exactMatches.length === 1) {
    const option = exactMatches[0]!;
    return { kind: "single", search: term, parentCode: option.parentCode, option };
  }
  if (exactMatches.length > 1) {
    return { kind: "multiple", search: term, options: exactMatches };
  }

  if (rows.length === 1) {
    const option = rows[0]!;
    return { kind: "single", search: term, parentCode: option.parentCode, option };
  }

  return { kind: "multiple", search: term, options: rows };
}
