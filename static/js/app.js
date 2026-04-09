const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const lowBtn = document.getElementById("lowBtn");
const highBtn = document.getElementById("highBtn");
const timeDisplay = document.getElementById("timeDisplay");
const scoreSummary = document.getElementById("scoreSummary");
const scoreDetails = document.getElementById("scoreDetails");
const liveFeedback = document.getElementById("liveFeedback");
const leaderboardEntry = document.getElementById("leaderboardEntry");
const playerNameInput = document.getElementById("playerNameInput");
const saveScoreBtn = document.getElementById("saveScoreBtn");
const leaderboardMessage = document.getElementById("leaderboardMessage");
const leaderboardList = document.getElementById("leaderboardList");

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
  const headline = displayScore >= 90 ? "SEJR!" : "RUN FÆRDIG";

  scoreSummary.className = `score-summary-card is-win ${tierClass}`;
  scoreSummary.innerHTML = `
    <div class="win-tag">${headline}</div>
    <div class="win-score">${displayScore.toFixed(1)}<span>/100</span></div>
    <div class="win-rank">${result.rank}</div>
    <div class="win-stats">Ramt ${result.matchedCount}/${result.expectedCount} | Ekstra ${result.extraCount}</div>
  `;
}

const config = window.APP_CONFIG;
const audio = new Audio("/audio");
audio.preload = "auto";

const LAST_PLAYER_NAME_KEY = "draenLastPlayerName";

let runStartPerf = null;
let uiTimer = null;
let fadeTimer = null;
let clapEvents = [];
let isRunning = false;
let feedbackTimer = null;
let lastScoreResult = null;
let leaderboardEntries = [];
let hasSavedCurrentRun = false;

function formatPlayedAt(playedAt) {
  const timestamp = Number(playedAt || 0);
  if (!timestamp) return "Ukendt tidspunkt";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Ukendt tidspunkt";
  return date.toLocaleString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function renderLeaderboard(entries = leaderboardEntries) {
  leaderboardList.innerHTML = "";

  if (entries.length === 0) {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">Ingen scores endnu. Spil en runde og gem den!</li>';
    return;
  }

  entries.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "leaderboard-item";
    li.innerHTML = `
      <div class="leaderboard-main">
        <span>#${index + 1} ${entry.name}</span>
        <span>${entry.finalScore} pts</span>
      </div>
      <div class="leaderboard-meta">
        ${entry.rank} | Accuracy ${Number(entry.accuracyScore || 0).toFixed(1)}% | Timing ${Number(entry.timingScore || 0).toFixed(1)}% | Mistakes ${Number(entry.totalMistakes || 0)} (missed ${Number(entry.missedCount || 0)}, extra ${Number(entry.extraCount || 0)}) | Beat error ${Number(entry.averageBeatError || 0).toFixed(3)} | ${formatPlayedAt(entry.playedAt)}
      </div>
    `;
    leaderboardList.appendChild(li);
  });
}

async function refreshLeaderboard() {
  try {
    const response = await fetch("/leaderboard");
    if (!response.ok) {
      throw new Error(`Leaderboard fejlede med status ${response.status}`);
    }
    const data = await response.json();
    leaderboardEntries = Array.isArray(data.entries) ? data.entries : [];
    renderLeaderboard(leaderboardEntries);
  } catch {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">Kunne ikke hente leaderboard.</li>';
  }
}

function showLeaderboardEntry(show) {
  leaderboardEntry.hidden = !show;
  if (!show) {
    leaderboardMessage.textContent = "";
  }
}

async function submitScoreToLeaderboard() {
  if (!lastScoreResult) {
    leaderboardMessage.textContent = "Spil en runde foerst.";
    return;
  }

  if (hasSavedCurrentRun) {
    leaderboardMessage.textContent = "Du har allerede gemt dit navn for denne runde.";
    return;
  }

  const rawName = playerNameInput.value.trim();
  if (!rawName) {
    leaderboardMessage.textContent = "Skriv dit navn foer du gemmer.";
    playerNameInput.focus();
    return;
  }

  const safeName = rawName.slice(0, 24);
  localStorage.setItem(LAST_PLAYER_NAME_KEY, safeName);

  saveScoreBtn.disabled = true;
  leaderboardMessage.textContent = "Gemmer score...";

  try {
    const response = await fetch("/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: safeName,
        finalScore: Number(lastScoreResult.finalScore || 0),
        accuracyScore: Number(lastScoreResult.accuracyScore || 0),
        timingScore: Number(lastScoreResult.timingScore || 0),
        averageBeatError: Number(lastScoreResult.averageBeatError || 0),
        rank: String(lastScoreResult.rank || "Ukendt"),
        matchedCount: Number(lastScoreResult.matchedCount || 0),
        expectedCount: Number(lastScoreResult.expectedCount || 0),
        extraCount: Number(lastScoreResult.extraCount || 0),
      }),
    });

    if (!response.ok) {
      throw new Error(`Leaderboard gem fejlede med status ${response.status}`);
    }

    const data = await response.json();
    leaderboardEntries = Array.isArray(data.entries) ? data.entries : [];
    renderLeaderboard(leaderboardEntries);
    hasSavedCurrentRun = true;
    saveScoreBtn.disabled = true;
    leaderboardMessage.textContent = `${safeName}, din score er gemt paa leaderboardet.`;
  } catch {
    leaderboardMessage.textContent = "Kunne ikke gemme score til serveren.";
  } finally {
    if (!hasSavedCurrentRun) {
      saveScoreBtn.disabled = false;
    }
  }
}

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
  liveFeedback.textContent = `${type.toUpperCase()} klap registreret ved ${time.toFixed(2)}s`;

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    liveFeedback.classList.remove("low", "high");
    liveFeedback.textContent = "Lytter...";
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
  lastScoreResult = null;
  hasSavedCurrentRun = false;
  saveScoreBtn.disabled = false;
  scoreSummary.className = "score-summary-card";
  scoreSummary.textContent = "Spiller... Klap med knapperne!";
  scoreDetails.textContent = "";
  liveFeedback.classList.remove("low", "high");
  liveFeedback.textContent = "Lytter...";
  showLeaderboardEntry(false);

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
      scoreSummary.textContent = "Kunne ikke starte afspilning. Tryk Start igen.";
      scoreDetails.textContent = String(error);
      liveFeedback.classList.remove("low", "high");
      liveFeedback.textContent = "Afspilning fejlede.";
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
  liveFeedback.textContent = "Beregner score...";
  try {
    const response = await fetch("/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claps: clapEvents }),
    });

    if (!response.ok) {
      throw new Error(`Score fejlede med status ${response.status}`);
    }

    const result = await response.json();
    lastScoreResult = result;
    hasSavedCurrentRun = false;
    saveScoreBtn.disabled = false;
    renderScoreCard(result);
    showLeaderboardEntry(true);

    if (!playerNameInput.value.trim()) {
      const lastName = localStorage.getItem(LAST_PLAYER_NAME_KEY) || "";
      playerNameInput.value = lastName;
    }
    playerNameInput.focus();

    const perPositionLines = (result.perPosition || []).map((p) => {
      const avgAbs = p.averageAbsErrorMs == null ? "-" : `${p.averageAbsErrorMs}ms`;
      const avgSigned = p.averageSignedErrorMs == null ? "-" : `${p.averageSignedErrorMs}ms`;
      return `${p.positionLabel} klap: ${p.hitCount}/${p.expectedCount} (${p.hitRate}%) | gennemsnitlig fejl ${avgAbs} | bias ${avgSigned} | ${p.trend}`;
    });

    const lines = [
      `BPM: ${result.bpm}`,
      `Rang: ${result.rank}`,
      `Nøjagtighed: ${result.accuracyScore}%`,
      `Timing: ${result.timingScore}%`,
      `Ignoreret vindue: ${(result.ignoredWindowSeconds || []).map((w) => `${w[0]}s-${w[1]}s`).join(", ") || "ingen"}`,
      "",
      "Feedback pr. klap i hver 3-klaps frase:",
      ...perPositionLines,
      "",
      "Eksempel på forventede vs. ramte:",
      ...result.matches.slice(0, 18).map((m, idx) => {
        const expected = `${idx + 1}. [${m.expected.positionLabel}] ${m.expected.type.toUpperCase()} @ ${m.expected.time.toFixed(2)}s`;
        if (!m.matched) return `${expected} -> FORBI`;
        const signedMs = m.signed_error_seconds * 1000;
        const trend = signedMs < -20 ? "TIDLIG" : signedMs > 20 ? "SEN" : "I TAKT";
        return `${expected} -> RAMT @ ${m.actual.time.toFixed(2)}s (${trend}, ${signedMs.toFixed(1)}ms, beat-fejl ${m.beat_error.toFixed(3)})`;
      }),
      "",
      "Alle klap:",
      ...clapEvents.map((e, idx) => `${idx + 1}. ${e.type.toUpperCase()} @ ${e.time.toFixed(2)}s`),
    ];

    scoreDetails.textContent = lines.join("\n");
    liveFeedback.textContent = "Runde afsluttet.";
  } catch (error) {
    scoreSummary.className = "score-summary-card";
    scoreSummary.textContent = "Kunne ikke beregne denne runde.";
    scoreDetails.textContent = String(error);
    liveFeedback.textContent = "Score fejlede.";
    showLeaderboardEntry(false);
  }
}

startBtn.addEventListener("click", startRun);
stopBtn.addEventListener("click", stopPlaybackAndScore);
lowBtn.addEventListener("click", () => registerClap("low"));
highBtn.addEventListener("click", () => registerClap("high"));
saveScoreBtn.addEventListener("click", submitScoreToLeaderboard);
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitScoreToLeaderboard();
  }
});

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) {
    return;
  }

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
refreshLeaderboard();
