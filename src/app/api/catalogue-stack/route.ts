import { NextRequest } from "next/server";

import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { authFailureResponse, privateJson } from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { resolveAccount } from "@/lib/dashboard/accounts";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";
import {
  buildCatalogueStack,
  CATALOGUE_TOP_COUNT,
} from "@/lib/store/analytics";
import type { CatalogueLevel, CatalogueNode } from "@/lib/store/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOGUE_LEVELS: CatalogueLevel[] = [
  "department",
  "subDepartment",
  "family",
  "product",
];

/** Guard the URL payload while keeping complete department/sub-department scopes. */
const MAX_COMPLETE_STACK_NODES = 100;

type StackNodeInput = Pick<CatalogueNode, "key" | "slug" | "label">;

function parseNodes(
  raw: string | null,
  maxNodes: number,
): StackNodeInput[] | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > maxNodes) {
    return null;
  }

  const nodes: StackNodeInput[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as StackNodeInput).key !== "string" ||
      typeof (entry as StackNodeInput).slug !== "string" ||
      typeof (entry as StackNodeInput).label !== "string"
    ) {
      return null;
    }
    nodes.push(entry as StackNodeInput);
  }

  return nodes;
}

export async function GET(request: NextRequest) {
  const auth = await resolveAuthContext(PILOT_CLIENT_SLUG);
  if (!auth.ok) return authFailureResponse(auth);

  const params = request.nextUrl.searchParams;
  const level = params.get("level");

  if (!CATALOGUE_LEVELS.includes(level as CatalogueLevel)) {
    return privateJson({ error: "Unknown catalogue level." }, { status: 400 });
  }

  const parentKeyParam = params.get("parentKey");
  const parentKey = parentKeyParam && parentKeyParam.length > 0 ? parentKeyParam : null;

  if (level === "department" && parentKey !== null) {
    return privateJson(
      { error: "Department is the top level and takes no parent." },
      { status: 400 },
    );
  }
  if (level !== "department" && parentKey === null) {
    return privateJson(
      { error: "This level requires the parent it was drilled into." },
      { status: 400 },
    );
  }

  const maxNodes =
    level === "family" || level === "product"
      ? CATALOGUE_TOP_COUNT
      : MAX_COMPLETE_STACK_NODES;
  const nodes = parseNodes(params.get("nodes"), maxNodes);
  if (nodes === null) {
    return privateJson(
      {
        error: `nodes must be a JSON array of {key, slug, label}, 1 to ${maxNodes} rows.`,
      },
      { status: 400 },
    );
  }

  const account = resolveAccount(params.get("account"));
  const referenceDate = currentDateInTimeZone(account.timezone);

  return privateJson(
    buildCatalogueStack(
      nodes,
      level as CatalogueLevel,
      parentKey,
      referenceDate,
      account.fixtureScale,
    ),
  );
}
