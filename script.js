"use strict";

const API_URL = "https://mental-health-score-1-yfk8.onrender.com";
const REQUEST_TIMEOUT_MS = 15000;

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const resetBtn = document.getElementById("reset-btn");
const retryBtn = document.getElementById("retry-btn");
const panel = document.querySelector(".result-panel");

const states = {
  idle: document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  result: document.getElementById("state-result"),
  error: document.getElementById("state-error"),
};

/* Validation rules mirror the StudentData Pydantic model (gt/lt are exclusive). */
const rules = {
  age:                     { type: "int",   gt: 10, lt: 100, label: "Age" },
  gender:                  { type: "choice", label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "choice", label: "Academic level" },
  most_used_platform:      { type: "choice", label: "Most used platform" },
  purpose_of_use:          { type: "choice", label: "Purpose of use" },
  avg_daily_usage_hours:   { type: "float", gt: 0, lt: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   gt: 0, label: "Phone unlocks" },
  study_hours:             { type: "float", gt: 0, lt: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", lt: 2, label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", gt: 0, lt: 24, label: "Sleep hours" },
  stress_level:            { type: "choice", label: "Stress level" },
};

/* ---------- UI helpers ---------- */

function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
}

function setFieldError(name, message) {
  const wrapper = form.querySelector(`[data-field="${name}"]`);
  if (!wrapper) return false;
  wrapper.classList.toggle("invalid", Boolean(message));
  wrapper.querySelector(".error").textContent = message || "";
  return true;
}

function clearErrors() {
  Object.keys(rules).forEach((name) => setFieldError(name, ""));
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Predicting…" : "Predict my score";
}

function showError(title, message) {
  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;
  showState("error");
}

function revealPanelOnSmallScreens() {
  if (window.matchMedia("(max-width: 860px)").matches) {
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* ---------- Validation ---------- */

function readValues() {
  const data = new FormData(form);
  const values = {};
  for (const [name, rule] of Object.entries(rules)) {
    const raw = (data.get(name) ?? "").toString().trim();
    values[name] = raw;
  }
  return values;
}

function validate(values) {
  const payload = {};
  const errors = {};

  for (const [name, rule] of Object.entries(rules)) {
    const raw = values[name];

    if (raw === "") {
      errors[name] = rule.type === "choice" ? `Select a ${rule.label.toLowerCase()}.` : `${rule.label} is required.`;
      continue;
    }
    if (rule.type === "choice" || rule.type === "text") {
      payload[name] = raw;
      continue;
    }

    const num = Number(raw);
    if (!Number.isFinite(num)) { errors[name] = "Enter a valid number."; continue; }
    if (rule.type === "int" && !Number.isInteger(num)) { errors[name] = "Enter a whole number."; continue; }
    if (rule.gt !== undefined && !(num > rule.gt)) { errors[name] = `Must be greater than ${rule.gt}.`; continue; }
    if (rule.lt !== undefined && !(num < rule.lt)) { errors[name] = `Must be less than ${rule.lt}.`; continue; }
    if (name === "physical_activity_hours" && num < 0) { errors[name] = "Cannot be negative."; continue; }

    payload[name] = num;
  }
  return { payload, errors };
}

/* ---------- Result display ---------- */

function describeScore(score) {
  // Assumes a 1-10 scale where a higher score means better mental health.
  if (score >= 7) return { label: "Good wellbeing", note: "Your habits point to a healthy balance.", color: "var(--good)" };
  if (score >= 5) return { label: "Moderate wellbeing", note: "There is room to improve. Sleep, activity and screen time are good places to start.", color: "var(--mid)" };
  return { label: "Needs attention", note: "Your habits suggest elevated risk. Cutting screen time and getting more sleep may help.", color: "var(--low)" };
}

function animateNumber(el, target, duration = 1100) {
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showResult(score) {
  const info = describeScore(score);
  const fill = document.getElementById("gauge-fill");
  const pct = Math.max(0, Math.min(score / 10, 1)) * 100;

  document.getElementById("score-label").textContent = info.label;
  document.getElementById("score-note").textContent = info.note;
  fill.style.stroke = info.color;
  fill.style.strokeDashoffset = 100;

  showState("result");
  // Two frames so the transition runs from the empty state.
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.strokeDashoffset = 100 - pct; }));
  animateNumber(document.getElementById("score-value"), score);
}

/* ---------- API ---------- */

function parseValidationDetail(detail) {
  // FastAPI 422: detail is [{ loc: ["body", "age"], msg: "..." }, ...]
  const unmatched = [];
  detail.forEach((item) => {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    const message = item.msg || "Invalid value.";
    if (!(field in rules && setFieldError(field, message))) unmatched.push(message);
  });
  return unmatched;
}

async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearErrors();

  const { payload, errors } = validate(readValues());
  const failed = Object.keys(errors);
  if (failed.length) {
    failed.forEach((name) => setFieldError(name, errors[name]));
    form.querySelector(`[data-field="${failed[0]}"] input, [data-field="${failed[0]}"] select`)?.focus();
    return;
  }

  setLoading(true);
  showState("loading");
  revealPanelOnSmallScreens();

  try {
    const response = await requestPrediction(payload);

    if (response.status === 422) {
      const body = await response.json().catch(() => ({}));
      const unmatched = Array.isArray(body.detail) ? parseValidationDetail(body.detail) : [];
      showError("Some inputs were rejected", unmatched.length ? unmatched.join("\n") : "Please correct the highlighted fields and try again.");
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = typeof body.detail === "string" ? body.detail : "";
      showError(`Server error (${response.status})`, detail || "The model could not process this request. Check the backend terminal for details.");
      return;
    }

    const data = await response.json();
    const score = Number(data.predicted_mental_health_score);
    if (!Number.isFinite(score)) {
      showError("Unexpected response", "The server did not return a valid score.");
      return;
    }
    showResult(score);
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out", "The server took too long to respond. Please try again.");
    } else {
      showError("Cannot reach the server", `Make sure the backend is running:\nuvicorn main:app --reload\n(expected at ${API_URL})`);
    }
  } finally {
    setLoading(false);
  }
}

/* ---------- Events ---------- */

form.addEventListener("submit", handleSubmit);

form.addEventListener("reset", () => {
  clearErrors();
  showState("idle");
});

retryBtn.addEventListener("click", () => {
  showState("idle");
  form.requestSubmit();
});

// Clear a field's error as soon as the user edits it.
form.addEventListener("input", (e) => {
  const wrapper = e.target.closest("[data-field]");
  if (wrapper) setFieldError(wrapper.dataset.field, "");
});
