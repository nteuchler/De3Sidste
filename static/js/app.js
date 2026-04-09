const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const lowBtn = document.getElementById("lowBtn");
const highBtn = document.getElementById("highBtn");
const timeDisplay = document.getElementById("timeDisplay");
const scoreSummary = document.getElementById("scoreSummary");
const scoreDetails = document.getElementById("scoreDetails");
const liveFeedback = document.getElementById("liveFeedback");

const rankClassByName = {
  "Dræn": "tier-draen",
  sidstegangs: "tier-sidstegangs",
  medarbejder: "tier-medarbejder",
  "god nok til bandet": "tier-bandet",
  "Niels (Guden)": "tier-niels",
};

function renderScoreCard(result) {
  const tierClass = rankClassByName[result.rank] || "tier-medarbejder";
  const displayScore = Number(result.accuracyScore || 0);
  const headline = displayScore >= 90 ? "SEJR!" : "RUN COMPLETE";

  scoreSummary.className = `score-summary-card is-win ${tierClass}`;
  scoreSummary.innerHTML = `
    <div class="win-tag">${headline}</div>
    <div class="win-score">${displayScore.toFixed(1)}<span>/100</span></div>
    <div class="win-rank">${result.rank}</div>
    <div class="win-stats">Matched ${result.matchedCount}/${result.expectedCount} | Extra ${result.extraCount}</div>
  `;
}

const config = window.APP_CONFIG;
const audio = new Audio("/audio");
audio.preload = "auto";

let runStartPerf = null;
let uiTimer = null;
let fadeTimer = null;
let clapEvents = [];
let isRunning = false;
let feedbackTimer = null;

function currentRunTime() {
  if (!runStartPerf) return 0;
  return (performance.now() - runStartPerf) / 1000;
}

function setRunningState(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  lowBtn.disabled = !running;
  highBtn.disabled = !running;
}

function pulseButton(button) {
  button.classList.remove("pulse");
  void button.offsetWidth;
  button.classList.add("pulse");

  clearTimeout(button._pulseResetTimer);
  button._pulseResetTimer = setTimeout(() => {
    button.classList.remove("pulse");
  }, 120);
}

function flashFeedback(type, time) {
  liveFeedback.classList.remove("low", "high");
  liveFeedback.classList.add(type);
  liveFeedback.textContent = `${type.toUpperCase()} clap registered at ${time.toFixed(2)}s`;

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    liveFeedback.classList.remove("low", "high");
    liveFeedback.textContent = "Listening...";
  }, 250);
}

function renderTime() {
  const now = currentRunTime();
  timeDisplay.textContent = `${now.toFixed(2)}s / ${config.playDuration.toFixed(2)}s`;
}

function stopPlaybackAndScore() {
  if (!isRunning) return;

  setRunningState(false);
  clearInterval(uiTimer);
  uiTimer = null;
  clearInterval(fadeTimer);
  fadeTimer = null;

  audio.pause();
  audio.currentTime = 0;
  audio.volume = 1;

  scoreRun();
}

function scheduleFadeOut() {
  const fadeDuration = 2.0;
  const fadeStart = Math.max(0, config.playDuration - fadeDuration);

  fadeTimer = setInterval(() => {
    const now = currentRunTime();

    if (now >= fadeStart && now <= config.playDuration) {
      const progress = (now - fadeStart) / fadeDuration;
      audio.volume = Math.max(0, 1 - progress);
    }

    if (now >= config.playDuration) {
      stopPlaybackAndScore();
    }
  }, 30);
}

function startRun() {
  clapEvents = [];
  scoreSummary.className = "score-summary-card";
  scoreSummary.textContent = "Running... Clap with the buttons!";
  scoreDetails.textContent = "";
  liveFeedback.classList.remove("low", "high");
  liveFeedback.textContent = "Listening...";

  runStartPerf = performance.now();
  audio.currentTime = 0;
  audio.volume = 1;

  audio
    .play()
    .then(() => {
      setRunningState(true);
      renderTime();
      uiTimer = setInterval(renderTime, 50);
      scheduleFadeOut();
    })
    .catch((error) => {
      scoreSummary.textContent = "Could not start audio playback. Click Start again.";
      scoreDetails.textContent = String(error);
      liveFeedback.classList.remove("low", "high");
      liveFeedback.textContent = "Playback failed.";
    });
}

function registerClap(type) {
  if (!isRunning) return;
  const time = currentRunTime();
  clapEvents.push({ type, time });
  pulseButton(type === "low" ? lowBtn : highBtn);
  flashFeedback(type, time);
}

async function scoreRun() {
  liveFeedback.classList.remove("low", "high");
  liveFeedback.textContent = "Scoring...";
  try {
    const response = await fetch("/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claps: clapEvents }),
    });

    if (!response.ok) {
      throw new Error(`Scoring failed with status ${response.status}`);
    }

    const result = await response.json();
    renderScoreCard(result);

    const perPositionLines = (result.perPosition || []).map((p) => {
      const avgAbs = p.averageAbsErrorMs == null ? "-" : `${p.averageAbsErrorMs}ms`;
      const avgSigned = p.averageSignedErrorMs == null ? "-" : `${p.averageSignedErrorMs}ms`;
      return `${p.positionLabel} clap: ${p.hitCount}/${p.expectedCount} (${p.hitRate}%) | avg err ${avgAbs} | bias ${avgSigned} | ${p.trend}`;
    });

    const lines = [
      `BPM: ${result.bpm}`,
      `Rank: ${result.rank}`,
      `Accuracy: ${result.accuracyScore}%`,
      `Timing: ${result.timingScore}%`,
      `Ignored window: ${(result.ignoredWindowSeconds || []).map((w) => `${w[0]}s-${w[1]}s`).join(", ") || "none"}`,
      "",
      "Feedback per clap in each 3-clap phrase:",
      ...perPositionLines,
      "",
      "Sample of expected vs matched:",
      ...result.matches.slice(0, 18).map((m, idx) => {
        const expected = `${idx + 1}. [${m.expected.positionLabel}] ${m.expected.type.toUpperCase()} @ ${m.expected.time.toFixed(2)}s`;
        if (!m.matched) return `${expected} -> MISS`;
        const signedMs = m.signed_error_seconds * 1000;
        const trend = signedMs < -20 ? "EARLY" : signedMs > 20 ? "LATE" : "ON";
        return `${expected} -> HIT @ ${m.actual.time.toFixed(2)}s (${trend}, ${signedMs.toFixed(1)}ms, beat err ${m.beat_error.toFixed(3)})`;
      }),
      "",
      "All claps:",
      ...clapEvents.map((e, idx) => `${idx + 1}. ${e.type.toUpperCase()} @ ${e.time.toFixed(2)}s`),
    ];

    scoreDetails.textContent = lines.join("\n");
    liveFeedback.textContent = "Run complete.";
  } catch (error) {
    scoreSummary.className = "score-summary-card";
    scoreSummary.textContent = "Could not score this run.";
    scoreDetails.textContent = String(error);
    liveFeedback.textContent = "Scoring failed.";
  }
}

startBtn.addEventListener("click", startRun);
stopBtn.addEventListener("click", stopPlaybackAndScore);
lowBtn.addEventListener("click", () => registerClap("low"));
highBtn.addEventListener("click", () => registerClap("high"));

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (key === "k") {
    event.preventDefault();
    registerClap("low");
  } else if (key === "l") {
    event.preventDefault();
    registerClap("high");
  }
});

renderTime();
