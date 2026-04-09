from pathlib import Path
import os
from flask import Flask, render_template, send_from_directory, jsonify, request

app = Flask(__name__)

AUDIO_FILENAME = "I Want To Hold Your Hand.mp3"
PLAY_DURATION_SECONDS = 40

# Backend timing configuration.
CLAP_KEY_BINDINGS = {
    "k": "low",
    "l": "high",
}
CLAP_KEY_BINDINGS = {str(k).lower(): v for k, v in CLAP_KEY_BINDINGS.items()}


def clap_type_from_key(key: str | None) -> str | None:
    if not key:
        return None
    normalized = str(key).strip().lower()
    if normalized.startswith("key") and len(normalized) == 4:
        normalized = normalized[-1]
    return CLAP_KEY_BINDINGS.get(normalized)


BPM = 131.0
BEAT_OFFSET_SECONDS = 0.0
MATCH_TOLERANCE_BEATS = 0.75
CONSISTENT_BIAS_MS = 55.0

# Ignore clap scoring during the song pause around 20 seconds.
IGNORE_WINDOWS_SECONDS = [
    (19.50, 29.90),
]

# Reference timing targets from your example. These are quantized for scoring.
REFERENCE_CLAPS = [

{"type": "low",  "time": 8.590},
{"type": "low",  "time": 8.770},
{"type": "high", "time": 9.460},
{"type": "low",  "time": 10.390},
{"type": "low",  "time": 10.600},
{"type": "high", "time": 11.290},
{"type": "low",  "time": 12.180},
{"type": "low",  "time": 12.370},
{"type": "high", "time": 13.040},
{"type": "low",  "time": 13.920},
{"type": "low",  "time": 14.120},
{"type": "high", "time": 14.800},
{"type": "low",  "time": 15.720},
{"type": "low",  "time": 15.910},
{"type": "high", "time": 16.590},
{"type": "low",  "time": 17.480},
{"type": "low",  "time": 17.680},
{"type": "high", "time": 18.370},
{"type": "low",  "time": 19.260},
{"type": "low",  "time": 19.490},
{"type": "high", "time": 20.140},
{"type": "low",  "time": 21.060},
{"type": "low",  "time": 21.260},
{"type": "high", "time": 21.900},
{"type": "low",  "time": 30.100},
{"type": "low",  "time": 30.280},
{"type": "high", "time": 30.940},
{"type": "low",  "time": 31.870},
{"type": "low",  "time": 32.080},
{"type": "high", "time": 32.760},
{"type": "low",  "time": 33.650},
{"type": "low",  "time": 33.870},
{"type": "high", "time": 34.570},
{"type": "low",  "time": 35.480},
{"type": "low",  "time": 35.690},
{"type": "high", "time": 36.380},
{"type": "low",  "time": 37.300},
{"type": "low",  "time": 37.520},
{"type": "high", "time": 38.180},
{"type": "low",  "time": 39.080},
{"type": "low",  "time": 39.290},
{"type": "high", "time": 39.860}

]


def beat_duration() -> float:
    return 60.0 / BPM


def quantize_time(seconds: float) -> float:
    beat = beat_duration()
    beat_index = round((seconds - BEAT_OFFSET_SECONDS) / beat)
    return BEAT_OFFSET_SECONDS + beat_index * beat


def in_ignored_window(seconds: float) -> bool:
    return any(start <= seconds <= end for start, end in IGNORE_WINDOWS_SECONDS)


def clap_position_label(position: int) -> str:
    labels = {1: "1.", 2: "2.", 3: "3."}
    return labels.get(position, f"{position}.")


def rank_from_accuracy(accuracy: float) -> str:
    if accuracy < 65:
        return "Dræn"
    if accuracy < 80:
        return "sidstegangs"
    if accuracy < 97:
        return "medarbejder"
    if accuracy <= 98:
        return "god nok til bandet"
    return "Niels (Guden)"


@app.get("/")
def index():
    audio_exists = (Path(app.root_path) / AUDIO_FILENAME).exists()
    active_expected_count = sum(1 for c in REFERENCE_CLAPS if not in_ignored_window(c["time"]))
    return render_template(
        "index.html",
        audio_filename=AUDIO_FILENAME,
        audio_exists=audio_exists,
        play_duration=PLAY_DURATION_SECONDS,
        bpm=BPM,
        expected_count=active_expected_count,
        key_bindings=CLAP_KEY_BINDINGS,
    )


@app.get("/audio")
def audio():
    return send_from_directory(app.root_path, AUDIO_FILENAME)


@app.get("/config")
def config():
    active_expected_count = sum(1 for c in REFERENCE_CLAPS if not in_ignored_window(c["time"]))
    return jsonify(
        {
            "audioFilename": AUDIO_FILENAME,
            "audioExists": (Path(app.root_path) / AUDIO_FILENAME).exists(),
            "playDuration": PLAY_DURATION_SECONDS,
            "bpm": BPM,
            "beatOffsetSeconds": BEAT_OFFSET_SECONDS,
            "matchToleranceBeats": MATCH_TOLERANCE_BEATS,
            "expectedCount": active_expected_count,
            "keyBindings": CLAP_KEY_BINDINGS,
            "ignoreWindowsSeconds": IGNORE_WINDOWS_SECONDS,
        }
    )


@app.post("/score")
def score():
    payload = request.get_json(silent=True) or {}
    input_claps = payload.get("claps", [])

    user_claps = []
    for clap in input_claps:
        clap_type = clap.get("type")
        if clap_type not in {"low", "high"}:
            clap_type = clap_type_from_key(clap.get("key")) or clap_type_from_key(clap.get("code"))

        clap_time = clap.get("time")
        if clap_type not in {"low", "high"}:
            continue
        try:
            clap_time = float(clap_time)
        except (TypeError, ValueError):
            continue
        if clap_time < 0:
            continue
        if in_ignored_window(clap_time):
            continue
        user_claps.append(
            {
                "type": clap_type,
                "time": clap_time,
                "q_time": quantize_time(clap_time),
            }
        )

    expected = [
        {
            "type": c["type"],
            "time": c["time"],
            "q_time": quantize_time(c["time"]),
            "position": (idx % 3) + 1,
            "positionLabel": clap_position_label((idx % 3) + 1),
        }
        for idx, c in enumerate(REFERENCE_CLAPS)
        if not in_ignored_window(c["time"])
    ]

    beat = beat_duration()
    max_distance_seconds = MATCH_TOLERANCE_BEATS * beat
    used = set()
    matches = []

    for exp in expected:
        best_idx = -1
        best_dist = float("inf")

        for idx, usr in enumerate(user_claps):
            if idx in used:
                continue
            if usr["type"] != exp["type"]:
                continue
            dist = abs(usr["time"] - exp["time"])
            if dist < best_dist:
                best_dist = dist
                best_idx = idx

        if best_idx >= 0 and best_dist <= max_distance_seconds:
            used.add(best_idx)
            usr = user_claps[best_idx]
            signed_error_seconds = usr["time"] - exp["time"]
            matches.append(
                {
                    "expected": exp,
                    "actual": usr,
                    "timing_error_seconds": abs(signed_error_seconds),
                    "signed_error_seconds": signed_error_seconds,
                    "beat_error": abs(signed_error_seconds) / beat,
                    "matched": True,
                }
            )
        else:
            matches.append(
                {
                    "expected": exp,
                    "actual": None,
                    "timing_error_seconds": None,
                    "signed_error_seconds": None,
                    "beat_error": None,
                    "matched": False,
                }
            )

    matched = [m for m in matches if m["matched"]]
    matched_count = len(matched)
    expected_count = len(expected)
    extra_count = max(0, len(user_claps) - matched_count)

    avg_beat_error = (
        sum(m["beat_error"] for m in matched) / matched_count if matched_count > 0 else MATCH_TOLERANCE_BEATS
    )
    timing_score = max(0.0, 100.0 * (1.0 - (avg_beat_error / MATCH_TOLERANCE_BEATS)))
    accuracy_score = 100.0 * (matched_count / expected_count) if expected_count > 0 else 0.0
    penalty = extra_count * 1.5
    final_score = max(0, round(0.65 * accuracy_score + 0.35 * timing_score - penalty))
    rank = rank_from_accuracy(accuracy_score)

    # Per clap-position feedback within each 3-clap phrase.
    per_position = {}
    for pos in (1, 2, 3):
        pos_matches = [m for m in matches if m["expected"]["position"] == pos]
        pos_hits = [m for m in pos_matches if m["matched"]]
        pos_expected = len(pos_matches)
        pos_hit_count = len(pos_hits)
        pos_avg_abs_ms = (
            (sum(m["timing_error_seconds"] for m in pos_hits) / pos_hit_count) * 1000.0
            if pos_hit_count > 0
            else None
        )
        pos_avg_signed_ms = (
            (sum(m["signed_error_seconds"] for m in pos_hits) / pos_hit_count) * 1000.0
            if pos_hit_count > 0
            else 0.0
        )
        hit_rate = (pos_hit_count / pos_expected) if pos_expected > 0 else 0.0

        if pos_hit_count == 0:
            trend = "ingen data"
        elif pos_avg_signed_ms <= -CONSISTENT_BIAS_MS:
            trend = "konsekvent tidlig"
        elif pos_avg_signed_ms >= CONSISTENT_BIAS_MS:
            trend = "konsekvent sen"
        else:
            trend = "i takt"

        per_position[pos] = {
            "position": pos,
            "positionLabel": clap_position_label(pos),
            "expectedCount": pos_expected,
            "hitCount": pos_hit_count,
            "hitRate": round(hit_rate * 100.0, 1),
            "averageAbsErrorMs": round(pos_avg_abs_ms, 1) if pos_avg_abs_ms is not None else None,
            "averageSignedErrorMs": round(pos_avg_signed_ms, 1) if pos_hit_count > 0 else None,
            "trend": trend,
        }

    return jsonify(
        {
            "finalScore": final_score,
            "rank": rank,
            "accuracyScore": round(accuracy_score, 1),
            "timingScore": round(timing_score, 1),
            "averageBeatError": round(avg_beat_error, 3),
            "matchedCount": matched_count,
            "expectedCount": expected_count,
            "extraCount": extra_count,
            "ignoredWindowSeconds": IGNORE_WINDOWS_SECONDS,
            "bpm": BPM,
            "matches": matches,
            "perPosition": [per_position[1], per_position[2], per_position[3]],
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
