"use strict";
/**
 * frontmatter.ts — leading `---` YAML block parsing.
 * Port of `_parse_frontmatter` in invokerai/agent_invoker/agent_map.py.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFrontmatter = parseFrontmatter;
exports.flattenDescription = flattenDescription;
exports.normalizeTools = normalizeTools;
const js_yaml_1 = __importDefault(require("js-yaml"));
/** Return the parsed YAML frontmatter object, or null if absent/invalid. */
function parseFrontmatter(text) {
    if (!text.startsWith("---"))
        return null;
    const end = text.indexOf("\n---", 3);
    if (end === -1)
        return null;
    const block = text.slice(3, end).trim();
    let data;
    try {
        data = js_yaml_1.default.load(block);
    }
    catch {
        return null;
    }
    if (data === null || typeof data !== "object" || Array.isArray(data))
        return null;
    return data;
}
/** Collapse a multiline description into a single line. */
function flattenDescription(raw) {
    if (typeof raw !== "string")
        return "";
    return raw.replace(/\s+/g, " ").trim();
}
/** Normalise a tools field from either "a, b, c" string or YAML list. */
function normalizeTools(raw) {
    if (raw === null || raw === undefined)
        return [];
    if (Array.isArray(raw)) {
        return raw.map((t) => String(t).trim()).filter((t) => t.length > 0);
    }
    return String(raw)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}
