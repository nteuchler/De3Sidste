from pathlib import Path
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

# Reference timing targets from your example. These are quantized for scoring.
REFERENCE_CLAPS = [

  {"type": "low",  "time": 8.920},
  {"type": "low",  "time": 9.149},
  {"type": "high", "time": 9.836},

  {"type": "low",  "time": 10.752},
  {"type": "low",  "time": 10.981},
  {"type": "high", "time": 11.668},

  {"type": "low",  "time": 12.584},
  {"type": "low",  "time": 12.813},
  {"type": "high", "time": 13.500},

  {"type": "low",  "time": 14.416},
  {"type": "low",  "time": 14.645},
  {"type": "high", "time": 15.332},

  {"type": "low",  "time": 16.248},
  {"type": "low",  "time": 16.477},
  {"type": "high", "time": 17.164},

  {"type": "low",  "time": 18.080},
  {"type": "low",  "time": 18.309},
  {"type": "high", "time": 18.996},

  {"type": "low",  "time": 19.912},
  {"type": "low",  "time": 20.141},
  {"type": "high", "time": 20.828},


  {"type": "low",  "time": 30.410},
  {"type": "low",  "time": 30.639},
  {"type": "high", "time": 31.326},

  {"type": "low",  "time": 32.242},
  {"type": "low",  "time": 32.471},
  {"type": "high", "time": 33.158},

  {"type": "low",  "time": 34.074},
  {"type": "low",  "time": 34.303},
  {"type": "high", "time": 34.990},

  {"type": "low",  "time": 35.906},
  {"type": "low",  "time": 36.135},
  {"type": "high", "time": 36.822},

  {"type": "low",  "time": 37.738},
  {"type": "low",  "time": 37.967},
  {"type": "high", "time": 38.654}


]


def beat_duration() -> float:
    return 60.0 / BPM


def quantize_time(seconds: float) -> float:
    beat = beat_duration()
    beat_index = round((seconds - BEAT_OFFSET_SECONDS) / beat)
    return BEAT_OFFSET_SECONDS + beat_index * beat


@app.get("/")
def index():
    audio_exists = (Path(app.root_path) / AUDIO_FILENAME).exists()
    return render_template(
        "index.html",
        audio_filename=AUDIO_FILENAME,
        audio_exists=audio_exists,
        play_duration=PLAY_DURATION_SECONDS,
        bpm=BPM,
        expected_count=len(REFERENCE_CLAPS),
        key_bindings=CLAP_KEY_BINDINGS,
    )


@app.get("/audio")
def audio():
    return send_from_directory(app.root_path, AUDIO_FILENAME)


@app.get("/config")
def config():
    return jsonify(
        {
            "audioFilename": AUDIO_FILENAME,
            "audioExists": (Path(app.root_path) / AUDIO_FILENAME).exists(),
            "playDuration": PLAY_DURATION_SECONDS,
            "bpm": BPM,
            "beatOffsetSeconds": BEAT_OFFSET_SECONDS,
            "matchToleranceBeats": MATCH_TOLERANCE_BEATS,
            "expectedCount": len(REFERENCE_CLAPS),
            "keyBindings": CLAP_KEY_BINDINGS,
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
        }
        for c in REFERENCE_CLAPS
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
            dist = abs(usr["q_time"] - exp["q_time"])
            if dist < best_dist:
                best_dist = dist
                best_idx = idx

        if best_idx >= 0 and best_dist <= max_distance_seconds:
            used.add(best_idx)
            usr = user_claps[best_idx]
            matches.append(
                {
                    "expected": exp,
                    "actual": usr,
                    "beat_error": abs(usr["q_time"] - exp["q_time"]) / beat,
                    "matched": True,
                }
            )
        else:
            matches.append({"expected": exp, "actual": None, "beat_error": None, "matched": False})

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

    return jsonify(
        {
            "finalScore": final_score,
            "accuracyScore": round(accuracy_score, 1),
            "timingScore": round(timing_score, 1),
            "averageBeatError": round(avg_beat_error, 3),
            "matchedCount": matched_count,
            "expectedCount": expected_count,
            "extraCount": extra_count,
            "bpm": BPM,
            "matches": matches,
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
