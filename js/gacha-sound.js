
"use strict";

// RASH MASTERS - ORIGINAL GACHA SOUND
// Web Audio API / No external audio files

let context = null;
let master = null;
let musicTimer = null;
let musicStep = 0;

const STORAGE_KEY = "rashMastersGachaSoundV1";

let settings = {
  enabled: true,
  volume: 0.45,
  bgm: false
};

try {
  const saved = JSON.parse(
    localStorage.getItem(STORAGE_KEY) || "{}"
  );

  if (typeof saved.enabled === "boolean") {
    settings.enabled = saved.enabled;
  }

  if (
    Number.isFinite(saved.volume) &&
    saved.volume >= 0 &&
    saved.volume <= 1
  ) {
    settings.volume = saved.volume;
  }
} catch {
  // ストレージが利用できない場合も動作する
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: settings.enabled,
        volume: settings.volume
      })
    );
  } catch {
    // 保存できなくても音声機能は利用可能
  }
}

function audio() {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!context) {
    context = new AudioContextClass();
    master = context.createGain();
    master.connect(context.destination);
  }

  master.gain.setTargetAtTime(
    settings.enabled ? settings.volume : 0,
    context.currentTime,
    0.02
  );

  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  return context;
}

function tone(
  frequency,
  duration = 0.4,
  type = "sine",
  gain = 0.1,
  delay = 0,
  destination = null
) {
  const ctx = audio();

  if (!ctx || !settings.enabled) return;

  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(
    frequency,
    start
  );

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, gain),
    start + 0.025
  );

  envelope.gain.exponentialRampToValueAtTime(
    0.0001,
    start + duration
  );

  oscillator.connect(envelope);
  envelope.connect(destination || master);

  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

export function playSummonStart() {
  if (!settings.enabled) return;

  [220, 293.66, 440, 587.33, 880].forEach(
    (note, index) => {
      tone(
        note,
        1.0,
        "sine",
        0.075,
        index * 0.17
      );
    }
  );

  tone(110, 1.7, "triangle", 0.055);
}

export function playCardReveal(rarity) {
  if (!settings.enabled) return;

  const patterns = {
    N: [392, 523.25],
    R: [440, 587.33, 783.99],
    SR: [523.25, 659.25, 1046.5],
    SSR: [523.25, 659.25, 783.99, 1046.5],
    UR: [
      523.25, 659.25, 783.99,
      1046.5, 1318.5, 1567.98
    ]
  };

  const notes = patterns[rarity] || patterns.N;

  notes.forEach((note, index) => {
    tone(
      note,
      rarity === "UR" ? 1.6 : 0.8,
      "sine",
      rarity === "UR" ? 0.13 : 0.09,
      index * 0.12
    );
  });

  if (rarity === "SSR" || rarity === "UR") {
    tone(
      rarity === "UR" ? 261.63 : 196,
      1.8,
      "triangle",
      0.07
    );
  }
}

export function playSummarySound() {
  if (!settings.enabled) return;

  [523.25, 659.25, 783.99, 1046.5].forEach(
    (note, index) => {
      tone(note, 1.1, "sine", 0.065, index * 0.11);
    }
  );
}

const ambientNotes = [
  130.81, 196, 261.63, 392,
  146.83, 220, 293.66, 440,
  174.61, 261.63, 349.23, 523.25,
  130.81, 196, 329.63, 392
];

function ambientTick() {
  if (!settings.bgm || !settings.enabled) return;

  const note = ambientNotes[
    musicStep % ambientNotes.length
  ];

  tone(note, 2.8, "sine", 0.025);
  tone(note * 2, 1.8, "sine", 0.009, 0.25);

  musicStep++;
}

function stopTimer() {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

function syncBgm() {
  stopTimer();

  if (settings.bgm && settings.enabled) {
    audio();
    ambientTick();
    musicTimer = setInterval(ambientTick, 1700);
  }
}

export function stopGachaBgm() {
  settings.bgm = false;
  stopTimer();
}

export function setupGachaSound() {
  const panel = document.getElementById(
    "effectPreviewArea"
  );

  if (!panel || document.getElementById("gachaSoundControls")) {
    return;
  }

  const controls = document.createElement("div");
  controls.id = "gachaSoundControls";
  controls.className = "gacha-sound-controls";

  const title = document.createElement("strong");
  title.textContent = "♫ SOUND SETTINGS";

  const toggle = document.createElement("button");
  toggle.type = "button";

  const bgmButton = document.createElement("button");
  bgmButton.type = "button";

  const volumeLabel = document.createElement("label");
  volumeLabel.textContent = "音量";

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.step = "1";
  volume.value = String(
    Math.round(settings.volume * 100)
  );

  volume.setAttribute("aria-label", "ガチャ音量");

  function updateControls() {
    toggle.textContent = settings.enabled
      ? "🔊 サウンド ON"
      : "🔇 サウンド OFF";

    bgmButton.textContent = settings.bgm
      ? "♫ BGM停止"
      : "♫ BGM再生";

    bgmButton.disabled = !settings.enabled;
  }

  toggle.addEventListener("click", () => {
    settings.enabled = !settings.enabled;

    if (!settings.enabled) {
      settings.bgm = false;
    }

    if (context && master) {
      master.gain.setTargetAtTime(
        settings.enabled ? settings.volume : 0,
        context.currentTime,
        0.02
      );
    }

    save();
    syncBgm();
    updateControls();
  });

  bgmButton.addEventListener("click", () => {
    settings.bgm = !settings.bgm;
    syncBgm();
    updateControls();
  });

  volume.addEventListener("input", () => {
    settings.volume = Number(volume.value) / 100;

    if (context && master) {
      master.gain.setTargetAtTime(
        settings.enabled ? settings.volume : 0,
        context.currentTime,
        0.02
      );
    }

    save();
  });

  volumeLabel.append(volume);

  controls.append(
    title,
    toggle,
    bgmButton,
    volumeLabel
  );

  panel.append(controls);

  updateControls();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && settings.bgm) {
      settings.bgm = false;
      syncBgm();
      updateControls();
    }
  });
}
