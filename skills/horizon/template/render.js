// Horizon renderer. Server mode reads and writes the validated API. Export mode reads the
// embedded plan and downloads feedback JSON without making network requests.

const rootElement = document.getElementById("root");
const statusElement = document.getElementById("status");
const intentElement = document.getElementById("intent");
const canonicalSections = [
  "positioning",
  "evidence",
  "domainModel",
  "patterns",
  "risks",
  "openQuestions",
  "scope",
];

const state = {
  plan: null,
  embedded: Boolean(globalThis.__HORIZON_PLAN__),
  decisions: new Map(),
  approvals: Object.fromEntries(canonicalSections.map((key) => [key, "approve"])),
};

const renderers = {
  positioning: (positioning) => section("positioning", "Positioning", () => {
    const content = fragment();
    content.append(field("positioning.problem", "Problem", positioning.problem));
    content.append(field("positioning.audience", "Audience", positioning.audience));
    content.append(list("Success criteria", positioning.successCriteria));
    content.append(list("Non-goals", positioning.nonGoals));
    return content;
  }),

  evidence: (rows) => section("evidence", "Evidence", () =>
    table(["#", "Claim", "Source", "Conf."], rows.map((row) => [
      row.id,
      editable(row.id, row.claim),
      row.source,
      row.confidence,
    ]))),

  domainModel: (domainModel) => section("domainModel", "Domain model", () => {
    const content = fragment();
    content.append(table(
      ["Term", "Definition"],
      (domainModel.glossary ?? []).map((entry) => [entry.term, entry.definition]),
    ));
    content.append(table(
      ["Entity", "Responsibilities", "Relations"],
      (domainModel.entities ?? []).map((entity) => [
        entity.name,
        (entity.responsibilities ?? []).join("; "),
        (entity.relations ?? []).join(", "),
      ]),
    ));
    return content;
  }),

  patterns: (patterns) => section("patterns", "Patterns", () => {
    const content = fragment();
    content.append(table(
      ["Selected", "Reason", "Evidence"],
      (patterns.selected ?? []).map((entry) => [
        entry.name,
        entry.reason,
        (entry.evidenceIds ?? []).join(", "),
      ]),
    ));
    content.append(table(
      ["Rejected", "Missing evidence"],
      (patterns.rejected ?? []).map((entry) => [entry.name, entry.missingEvidence]),
    ));
    return content;
  }),

  risks: (rows) => section("risks", "Risks", () =>
    table(["Risk", "Mitigation", "Sev."], rows.map((row) => [
      row.risk,
      row.mitigation ?? "",
      badge(row.severity),
    ]))),

  openQuestions: (rows) => section("openQuestions", "Open questions", () => {
    const content = fragment();
    for (const question of rows) {
      const wrapper = document.createElement("div");
      wrapper.style.margin = ".5rem 0";
      const label = document.createElement("label");
      label.textContent = (question.blocking ? "🔴 " : "") + question.q;
      const answer = document.createElement("textarea");
      answer.rows = 2;
      answer.addEventListener("input", () => decide(question.id, { answer: answer.value }));
      wrapper.append(label, answer);
      content.append(wrapper);
    }
    return content;
  }),

  scope: (scope) => section("scope", "Scope preview", () =>
    table(
      ["#", "Title", "Domain"],
      (scope.nodesPreview ?? []).map((node) => [node.id, node.title, node.domain]),
    )),
};

const fragment = () => document.createDocumentFragment();

function section(key, title, body) {
  const sectionElement = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  heading.append(approvalToggle(key));
  sectionElement.append(heading, body());
  return sectionElement;
}

function approvalToggle(key) {
  const wrapper = document.createElement("span");
  wrapper.className = "approve-toggle";
  wrapper.style.marginLeft = "auto";
  for (const value of ["approve", "change"]) {
    const button = document.createElement("button");
    button.textContent = value;
    button.setAttribute("aria-pressed", String(state.approvals[key] === value));
    button.onclick = () => {
      state.approvals[key] = value;
      wrapper.querySelectorAll("button").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", "false");
      });
      button.setAttribute("aria-pressed", "true");
    };
    wrapper.append(button);
  }
  return wrapper;
}

function field(ref, labelText, value) {
  const wrapper = document.createElement("div");
  wrapper.style.margin = ".4rem 0";
  const label = document.createElement("label");
  label.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.value = value ?? "";
  textarea.addEventListener("input", () => decide(ref, { edit: textarea.value }));
  wrapper.append(label, textarea);
  return wrapper;
}

function editable(ref, value) {
  const textarea = document.createElement("textarea");
  textarea.rows = 1;
  textarea.value = value ?? "";
  textarea.addEventListener("input", () => decide(ref, { edit: textarea.value }));
  return textarea;
}

function list(title, items) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const listElement = document.createElement("ul");
  for (const item of items ?? []) {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    listElement.append(listItem);
  }
  wrapper.append(heading, listElement);
  return wrapper;
}

function table(headers, rows) {
  const tableElement = document.createElement("table");
  const headingRow = tableElement.createTHead().insertRow();
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    headingRow.append(cell);
  }
  const body = tableElement.createTBody();
  for (const row of rows) {
    const tableRow = body.insertRow();
    for (const value of row) {
      const cell = tableRow.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value ?? "";
    }
  }
  return tableElement;
}

function badge(severity) {
  const element = document.createElement("span");
  element.className = "badge " + severity;
  element.textContent = severity;
  return element;
}

function decide(ref, patch) {
  const previous = state.decisions.get(ref) ?? { ref };
  state.decisions.set(ref, { ...previous, ...patch });
}

function renderPlan(plan) {
  state.plan = plan;
  intentElement.textContent = plan?.meta?.intent ?? "";
  rootElement.replaceChildren();
  for (const key of Object.keys(plan)) {
    if (key === "meta") continue;
    const render = renderers[key];
    if (render) {
      rootElement.append(render(plan[key]));
      continue;
    }
    const fallback = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = key;
    const raw = document.createElement("pre");
    raw.textContent = JSON.stringify(plan[key], null, 2);
    fallback.append(heading, raw);
    rootElement.append(fallback);
  }
  statusElement.textContent = state.embedded ? "ready · offline" : "ready";
}

function showError(error) {
  rootElement.replaceChildren();
  const panel = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Horizon could not load the plan";
  const message = document.createElement("p");
  message.textContent = error.message +
    ". Open an exported Horizon file or start the Horizon server and reload.";
  panel.append(heading, message);
  rootElement.append(panel);
  statusElement.textContent = "error";
}

async function loadPlan() {
  if (state.embedded) return structuredClone(globalThis.__HORIZON_PLAN__);
  const response = await fetch("/api/plan");
  if (!response.ok) throw new Error("server returned " + response.status + " for /api/plan");
  return response.json();
}

function feedbackFor(verdict) {
  return {
    slug: state.plan?.meta?.slug ?? "",
    verdict,
    decisions: [...state.decisions.values()].filter((decision) =>
      Boolean(decision.answer || decision.edit)),
    approvals: { ...state.approvals },
    notes: "",
  };
}

function downloadFeedback(feedback) {
  const blob = new Blob([JSON.stringify(feedback, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = (feedback.slug || "horizon") + "-feedback.json";
  link.click();
  URL.revokeObjectURL(url);
}

function feedbackProblem(feedback) {
  const changed = Object.values(feedback.approvals).some((value) => value === "change");
  if (feedback.verdict === "changes-requested" && !changed) {
    return "mark at least one section for change";
  }
  if (feedback.verdict !== "approved") return null;
  if (changed) return "all sections must be approved";

  const blocking = (state.plan?.openQuestions ?? [])
    .filter((question) => question.blocking)
    .map((question) => question.id);
  const answered = new Set(feedback.decisions
    .filter((decision) => typeof decision.answer === "string" && decision.answer.trim())
    .map((decision) => decision.ref));
  const missing = blocking.filter((id) => !answered.has(id));
  return missing.length > 0 ? "answer every blocking question" : null;
}

async function submit(verdict) {
  const feedback = feedbackFor(verdict);
  const problem = feedbackProblem(feedback);
  if (problem) {
    statusElement.textContent = "not submitted: " + problem;
    return;
  }
  if (state.embedded) {
    downloadFeedback(feedback);
    statusElement.textContent = "downloaded: " + verdict;
    return;
  }

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(feedback),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    statusElement.textContent = detail?.error?.message ?? "feedback rejected";
    return;
  }
  statusElement.textContent = "sent: " + verdict;
  document.getElementById("approve").disabled = true;
  document.getElementById("requestChanges").disabled = true;
}

document.getElementById("approve").onclick = () => submit("approved");
document.getElementById("requestChanges").onclick = () => submit("changes-requested");

addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("drop");
});
addEventListener("dragleave", () => document.body.classList.remove("drop"));
addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("drop");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const plan = JSON.parse(await file.text());
  if (!state.embedded) {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan),
    });
    if (!response.ok) {
      statusElement.textContent = "plan rejected";
      return;
    }
  }
  renderPlan(plan);
});

loadPlan().then(renderPlan).catch(showError);
