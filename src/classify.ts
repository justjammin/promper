/**
 * classify.ts — deterministic domain classification.
 * Port of `_classify` (agent_map.py) and `_collect_matches` (domains.py).
 *
 * Priority chain (faithful to the Python reference):
 *   1. exact name match in ROLE_DOMAIN            → source "name"
 *   2. description keyword match (collectMatches) → source "description"
 *   3. fallback                                   → domain "unmapped"
 */

import { CATEGORY_PRIORITY, REGISTRY, ROLE_DOMAIN } from "./domains.js";

export type ClassifySource = "name" | "description" | "unmapped";

export interface Classification {
  domain: string;
  source: ClassifySource;
}

interface Match {
  role: string;
  category: string;
  trigger: string;
  priority: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Port of `_collect_matches`: scan registry triggers against the lowercased
 * text with word-boundary matching; one match per agent; stable-sorted by
 * category priority.
 */
export function collectMatches(text: string): Match[] {
  const t = text.toLowerCase();
  const matches: Match[] = [];
  for (const agent of REGISTRY) {
    if (agent.orchestrate) continue;
    for (const trigger of agent.triggers) {
      const re = new RegExp(`\\b${escapeRegExp(trigger)}\\b`);
      if (re.test(t)) {
        matches.push({
          role: agent.id,
          category: agent.category,
          trigger,
          priority: CATEGORY_PRIORITY[agent.category] ?? 99,
        });
        break;
      }
    }
  }
  // Array.prototype.sort is stable, matching Python's list.sort.
  matches.sort((a, b) => a.priority - b.priority);
  return matches;
}

/** Port of `_classify` — see priority chain above. */
export function classify(name: string, description: string): Classification {
  // Priority 1 — name match (certain, cheap)
  const byName = ROLE_DOMAIN[name];
  if (byName !== undefined) return { domain: byName, source: "name" };

  // Priority 2 — description keyword classification
  if (description) {
    const matches = collectMatches(description);
    if (matches.length > 0) {
      const first = matches[0];
      if (first !== undefined) {
        const domain = ROLE_DOMAIN[first.role];
        if (domain !== undefined) return { domain, source: "description" };
      }
    }
  }

  // Priority 3 — unmapped
  return { domain: "unmapped", source: "unmapped" };
}
