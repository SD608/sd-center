"use strict";

const SOUND_MARK = "ACHIEVEMENT_CHIME_DATA_URL";
const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 0.78;

function synthesizeAchievementChimeWav() {
  const sampleCount = Math.floor(SAMPLE_RATE * DURATION_SECONDS);
  const samples = new Float64Array(sampleCount);
  const partials = [
    [1.0, 1.0, 0.46],
    [2.01, 0.24, 0.21],
    [2.97, 0.10, 0.15],
  ];

  function addBell(startSeconds, frequency, amplitude, decay) {
    const start = Math.floor(startSeconds * SAMPLE_RATE);
    for (let i = start; i < sampleCount; i += 1) {
      const t = (i - start) / SAMPLE_RATE;
      const envelope = (1 - Math.exp(-t / 0.005)) * Math.exp(-t / decay);
      let value = 0;
      for (const [ratio, partialAmplitude, partialDecay] of partials) {
        value += partialAmplitude
          * Math.sin(2 * Math.PI * frequency * ratio * t)
          * Math.exp(-t / partialDecay);
      }
      samples[i] += amplitude * envelope * value;
    }
  }

  // Soft body + delayed perfect-fifth/octave shimmer. Short enough not to annoy on repeated unlocks.
  addBell(0.000, 392.00, 0.36, 0.42); // G4
  addBell(0.000, 587.33, 0.22, 0.36); // D5
  addBell(0.130, 783.99, 0.30, 0.44); // G5
  addBell(0.130, 1174.66, 0.10, 0.30); // D6

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / SAMPLE_RATE;
    if (t < 0.10) {
      samples[i] += 0.045
        * Math.sin(2 * Math.PI * 196 * t)
        * (1 - Math.exp(-t / 0.004))
        * Math.exp(-t / 0.05);
    }
    if (t > 0.68) {
      samples[i] *= Math.max(0, (DURATION_SECONDS - t) / (DURATION_SECONDS - 0.68));
    }
  }

  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const normalize = peak > 0 ? 0.72 / peak : 1;
  const pcmBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcmBytes, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] * normalize));
    wav.writeInt16LE(Math.trunc(clamped * 32767), 44 + (i * 2));
  }
  return wav;
}

function patchOverlaySoundSource(sourceInput) {
  const source = String(sourceInput || "");
  if (source.includes(SOUND_MARK)) return source;
  if (!source.includes("try { shell.beep(); } catch {}")) {
    throw new Error("achievement overlay system beep marker missing");
  }
  if (!source.includes("const ACHIEVEMENTS_URL =")) {
    throw new Error("achievement overlay URL marker missing");
  }

  const wavBase64 = synthesizeAchievementChimeWav().toString("base64");
  let output = source.replace(
    /const ACHIEVEMENTS_URL = ([^;]+);/,
    (match) => `${match}\nconst ACHIEVEMENT_CHIME_DATA_URL = "data:audio/wav;base64,${wavBase64}";`,
  );
  output = output.replace(
    "default-src 'none'; style-src 'unsafe-inline'",
    "default-src 'none'; style-src 'unsafe-inline'; media-src data:",
  );
  output = output.replace(
    '<div class="arrow">›</div></a></body></html>',
    '<div class="arrow">›</div></a><audio aria-hidden="true" autoplay preload="auto" src="${ACHIEVEMENT_CHIME_DATA_URL}"></audio></body></html>',
  );
  output = output.replace("      try { shell.beep(); } catch {}\n", "");

  for (const marker of [SOUND_MARK, "media-src data:", "autoplay preload=\"auto\""]) {
    if (!output.includes(marker)) throw new Error(`achievement chime marker missing after patch: ${marker}`);
  }
  if (output.includes("shell.beep()")) throw new Error("system beep remained after achievement chime patch");
  return output;
}

module.exports = {
  DURATION_SECONDS,
  SAMPLE_RATE,
  patchOverlaySoundSource,
  synthesizeAchievementChimeWav,
};
