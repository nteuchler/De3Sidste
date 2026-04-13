const refreshStatusBtn = document.getElementById("refreshStatusBtn");
const refreshJsonBtn = document.getElementById("refreshJsonBtn");
const saveJsonBtn = document.getElementById("saveJsonBtn");
const uploadForm = document.getElementById("uploadForm");
const uploadBtn = document.getElementById("uploadBtn");
const uploadFileInput = document.getElementById("uploadFileInput");
const storageStatus = document.getElementById("storageStatus");
const jsonEditor = document.getElementById("jsonEditor");
const adminMessage = document.getElementById("adminMessage");

function setMessage(text, isError = false) {
  adminMessage.textContent = text;
  adminMessage.style.color = isError ? "#ff9b9b" : "#b9ffbf";
}

async function loadStorageStatus() {
  try {
    const response = await fetch("/leaderboard/storage-status");
    if (!response.ok) {
      throw new Error(`Status fetch failed (${response.status})`);
    }
    const data = await response.json();
    storageStatus.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    storageStatus.textContent = `Could not load storage status: ${String(error)}`;
  }
}

async function loadLeaderboardJson() {
  try {
    const response = await fetch("/admin/leaderboard/raw");
    if (!response.ok) {
      throw new Error(`JSON load failed (${response.status})`);
    }
    const data = await response.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    jsonEditor.value = JSON.stringify(entries, null, 2);
    setMessage(`Loaded ${entries.length} entries.`);
  } catch (error) {
    setMessage(`Could not load leaderboard JSON: ${String(error)}`, true);
  }
}

async function saveLeaderboardJson() {
  const raw = jsonEditor.value.trim();
  let parsed;

  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch (error) {
    setMessage(`JSON parse error: ${String(error)}`, true);
    return;
  }

  if (!Array.isArray(parsed)) {
    setMessage("Top-level JSON must be an array.", true);
    return;
  }

  saveJsonBtn.disabled = true;
  setMessage("Saving leaderboard JSON...");

  try {
    const response = await fetch("/admin/leaderboard/raw", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.error || `Save failed (${response.status})`));
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    jsonEditor.value = JSON.stringify(entries, null, 2);
    setMessage(`Saved ${entries.length} entries.`);
    await loadStorageStatus();
  } catch (error) {
    setMessage(`Could not save JSON: ${String(error)}`, true);
  } finally {
    saveJsonBtn.disabled = false;
  }
}

async function uploadLeaderboardJson(event) {
  event.preventDefault();

  const file = uploadFileInput.files && uploadFileInput.files[0];
  if (!file) {
    setMessage("Choose a JSON file before uploading.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  uploadBtn.disabled = true;
  setMessage("Uploading leaderboard file...");

  try {
    const response = await fetch("/admin/leaderboard/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.error || `Upload failed (${response.status})`));
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    jsonEditor.value = JSON.stringify(entries, null, 2);
    setMessage(`Upload complete. ${entries.length} entries saved.`);
    await loadStorageStatus();
  } catch (error) {
    setMessage(`Could not upload file: ${String(error)}`, true);
  } finally {
    uploadBtn.disabled = false;
    uploadFileInput.value = "";
  }
}

refreshStatusBtn.addEventListener("click", loadStorageStatus);
refreshJsonBtn.addEventListener("click", loadLeaderboardJson);
saveJsonBtn.addEventListener("click", saveLeaderboardJson);
uploadForm.addEventListener("submit", uploadLeaderboardJson);

loadStorageStatus();
loadLeaderboardJson();
