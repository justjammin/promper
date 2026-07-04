/**
 * frontmatter.ts — leading `---` YAML block parsing.
 * Port of `_parse_frontmatter` in invokerai/agent_invoker/agent_map.py.
 */

import yaml from "js-yaml";

export type Frontmatter = Record<string, unknown>;

/** Return the parsed YAML frontmatter object, or null if absent/invalid. */
export function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end).trim();
  let data: unknown;
  try {
    data = yaml.load(block);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Frontmatter;
}

/** Collapse a multiline description into a single line. */
export function flattenDescription(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim();
}

/** Normalise a tools field from either "a, b, c" string or YAML list. */
export function normalizeTools(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter((t) => t.length > 0);
  }
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
