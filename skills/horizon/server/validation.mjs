import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const APPROVAL_KEYS = [
  "positioning",
  "evidence",
  "domainModel",
  "patterns",
  "risks",
  "openQuestions",
  "scope",
];

function schemaResult(validate, value) {
  if (validate(value)) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "schema validation failed",
      keyword: error.keyword,
    })),
  };
}

function semanticError(code, message) {
  return { code, path: "/", message };
}

export async function createHorizonValidators(horizonRoot) {
  const root = resolve(horizonRoot);
  const schemaPaths = {
    plan: join(root, "schemas", "plan.schema.json"),
    feedback: join(root, "schemas", "feedback.schema.json"),
    status: join(root, "..", "orbit", "viz", "status.schema.json"),
  };
  const schemas = Object.fromEntries(
    await Promise.all(Object.entries(schemaPaths).map(async ([name, path]) => [
      name,
      JSON.parse(await readFile(path, "utf8")),
    ])),
  );

  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const compiled = {
    plan: ajv.compile(schemas.plan),
    feedback: ajv.compile(schemas.feedback),
    status: ajv.compile(schemas.status),
  };

  return {
    plan(value) {
      return schemaResult(compiled.plan, value);
    },
    status(value) {
      return schemaResult(compiled.status, value);
    },
    feedback(value, plan) {
      const schema = schemaResult(compiled.feedback, value);
      if (!schema.ok) return schema;

      const errors = [];
      if (value.slug !== plan?.meta?.slug) {
        errors.push(semanticError("slug_mismatch", "feedback slug must match plan.meta.slug"));
      }

      const changes = APPROVAL_KEYS.filter((key) => value.approvals[key] === "change");
      if (value.verdict === "approved" && changes.length > 0) {
        errors.push(semanticError("approved_with_changes", "approved feedback cannot mark a section change"));
      }
      if (value.verdict === "changes-requested" && changes.length === 0) {
        errors.push(semanticError("changes_without_section", "changes-requested must mark at least one section change"));
      }

      if (value.verdict === "approved") {
        const answers = new Map(
          value.decisions
            .filter((decision) => typeof decision.answer === "string")
            .map((decision) => [decision.ref, decision.answer.trim()]),
        );
        for (const question of plan.openQuestions ?? []) {
          if (question.blocking && !answers.get(question.id)) {
            errors.push(semanticError(
              "unanswered_blocking_question",
              `blocking open question ${question.id} requires a non-empty answer`,
            ));
          }
        }
      }

      return { ok: errors.length === 0, errors };
    },
  };
}

export { APPROVAL_KEYS };
