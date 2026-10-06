const API_URL = "https://mental-health-score-1-ey1r.onrender.com";

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const states = {
  idle: document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  done: document.getElementById("state-done"),
};
const CIRCUMFERENCE = 326.7;
const MAX_SCORE = 10; // assumed scale of the model's output

// Field rules mirror the Pydantic StudentData model.
const rules = {
  age:                     { type: "int",   gt: 10, lt: 100, label: "Age" },
  gender:                  { type: "select", label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "select", label: "Academic level" },
  most_used_platform:      { type: "select", label: "Most used platform" },
  purpose_of_use:          { type: "select", label: "Main purpose" },
  avg_daily_usage_hours:   { type: "float", gt: 0, lt: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   gt: 0, label: "Daily unlocks" },
  study_hours:             { type: "float", gt: 0, lt: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", gt: 0, lt: 2,  label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", gt: 0, lt: 24, label: "Sleep hours" },
  stress_level:            { type: "select", label: "Stress level" },
};

function showState(name) {
  Object.entries(states).forEach(([key, el]) => (el.hidden = key !== name));
}

function setFieldError(name, message) {
  const field = form.elements[name].closest(".field");
  field.classList.toggle("invalid", Boolean(message));
  field.querySelector(".error").textContent = message || "";
}

function clearErrors() {
  Object.keys(rules).forEach((name) => setFieldError(name, ""));
}

function validate() {
  const data = {};
  let valid = true;
  for (const [name, rule] of Object.entries(rules)) {
    const raw = form.elements[name].value.trim();
    if (raw === "") {
      setFieldError(name, `${rule.label} is required.`);
      valid = false;
      continue;
    }
    if (rule.type === "select" || rule.type === "text") {
      data[name] = raw;
      setFieldError(name, "");
      continue;
    }
    const num = Number(raw);
    let message = "";
    if (Number.isNaN(num)) message = "Enter a valid number.";
    else if (rule.type === "int" && !Number.isInteger(num)) message = "Enter a whole number.";
    else if (rule.gt !== undefined && num <= rule.gt) message = `Must be greater than ${rule.gt}.`;
    else if (rule.lt !== undefined && num >= rule.lt) message = `Must be less than ${rule.lt}.`;
    setFieldError(name, message);
    if (message) valid = false;
    else data[name] = num;
  }
  return valid ? data : null;
}

function describeScore(score) {
  if (score >= 8) return ["Strong well-being", "Your habits point to a healthy balance."];
  if (score >= 6) return ["Moderate well-being", "There is room to improve sleep, activity or screen time."];
  return ["Needs attention", "Consider cutting screen time and talking to someone you trust."];
}

function showScore(score) {
  const [verdict, note] = describeScore(score);
  document.getElementById("verdict").textContent = verdict;
  document.getElementById("verdict-note").textContent = note;
  showState("done");

  const bar = document.getElementById("bar");
  const value = document.getElementById("score-value");
  const ratio = Math.min(Math.max(score / MAX_SCORE, 0), 1);
  bar.style.strokeDashoffset = CIRCUMFERENCE;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => (bar.style.strokeDashoffset = CIRCUMFERENCE * (1 - ratio)))
  );

  // count-up animation
  const start = performance.now();
  const duration = 1000;
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    value.textContent = (score * (1 - Math.pow(1 - t, 3))).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
    else value.textContent = score.toFixed(2);
  })(start);
}

function showError(title, text) {
  document.getElementById("error-title").textContent = title;
  document.getElementById("error-text").textContent = text;
  showState("error");
}

// Map FastAPI 422 responses back onto the form fields.
function handleValidationErrors(detail) {
  const lines = [];
  detail.forEach((item) => {
    const field = item.loc?.[item.loc.length - 1];
    if (field in rules) setFieldError(field, item.msg);
    lines.push(`${rules[field]?.label || field}: ${item.msg}`);
  });
  showError("The server rejected some values", lines.join("\n"));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  const payload = validate();
  if (!payload) {
    showError("Check your inputs", "Some fields are missing or out of range. Fix the highlighted fields and try again.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Predicting…";
  showState("loading");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);

    if (response.ok) {
      showScore(body.predicted_mental_health_score);
    } else if (response.status === 422 && Array.isArray(body?.detail)) {
      handleValidationErrors(body.detail);
    } else {
      const detail = typeof body?.detail === "string" ? body.detail : "The prediction service had a problem.";
      showError(`Server error (${response.status})`, detail);
    }
  } catch (err) {
    showError("Can't reach the server", `Make sure the backend is running at ${API_URL.replace("/predict", "")} (uvicorn main:app --reload) and try again.`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Predict my score";
  }
});

form.addEventListener("reset", () => {
  clearErrors();
  showState("idle");
});
