// Wisper showcase: hero dictation stage + page utilities.
// Everything visual degrades gracefully: no-JS gets static content,
// reduced-motion gets static bars, no beam spin, no reveals.
document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Hero dictation: a Wisper session, typed in real time ----------
// The hero IS the product demo. Each command types forward with a faint key
// click, holds, then true-backspaces one character at a time before typing
// the next one. Web Audio click is only created on first user gesture.
const DICTATIONS = [
  'git commit -m "3.1.0: pill inside, beam on"',
  'git tag v3.1.0 && git push --tags',
  'gh release create v3.1.0 --generate-notes',
];
const textEl = document.getElementById("t-text");
let audioCtx = null;

function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  } catch (e) { audioCtx = null; }
  return audioCtx;
}
function click(pitchHz) {
  const ctx = audioCtx;
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  // Mechanical key: short noise burst high-passed to feel like a key, with a
  // pitched body so different keys sound subtly different.
  const dur = 0.018;
  const burst = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const ch = burst.getChannelData(0);
  for (let i = 0; i < ch.length; i++) {
    ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.4) * 0.32;
  }
  const src = ctx.createBufferSource();
  src.buffer = burst;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 1800;
  const out = ctx.createGain(); out.gain.value = 0.18;
  src.connect(hp).connect(out).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.03);
}
function backspace() {
  // Quieter, lower, no key click. Sounds like a release, not a press.
  const ctx = audioCtx;
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  const burst = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.012), ctx.sampleRate);
  const ch = burst.getChannelData(0);
  for (let i = 0; i < ch.length; i++) {
    ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.2) * 0.18;
  }
  const src = ctx.createBufferSource();
  src.buffer = burst;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 900;
  const out = ctx.createGain(); out.gain.value = 0.10;
  src.connect(lp).connect(out).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.02);
}

let dictIdx = 0, dictCi = 0;
let dictPhase = "type"; // "type" | "hold" | "backspace" | "gap"

function dictTick() {
  if (!textEl) return;
  const line = DICTATIONS[dictIdx];
  if (dictPhase === "type") {
    dictCi++;
    textEl.textContent = line.slice(0, dictCi);
    click(2400 + Math.random() * 1200);
    const ch = line[dictCi - 1];
    const pause = ch === " " ? 70 : ch === "." || ch === "," ? 130 : 28 + Math.random() * 22;
    if (dictCi >= line.length) { dictPhase = "hold"; setTimeout(dictTick, 2600); return; }
    setTimeout(dictTick, pause);
  } else if (dictPhase === "hold") {
    dictPhase = "backspace";
    setTimeout(dictTick, 220);
  } else if (dictPhase === "backspace") {
    if (dictCi <= 0) {
      dictIdx = (dictIdx + 1) % DICTATIONS.length;
      dictPhase = "gap";
      setTimeout(dictTick, 360);
      return;
    }
    dictCi--;
    textEl.textContent = line.slice(0, dictCi);
    backspace();
    setTimeout(dictTick, 22);
  } else if (dictPhase === "gap") {
    dictPhase = "type"; dictCi = 0;
    setTimeout(dictTick, 240);
  }
}
if (!reduceMotion) {
  if (textEl) textEl.textContent = DICTATIONS[0].slice(0, 1);
  const unlock = () => { ensureAudio(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  setTimeout(dictTick, 700);
}

// ---------- Waveforms: every .js-bars group gets the app's bar motion ----------
// Organic speech-like envelope, fast-attack/slow-decay, same as the real overlay.
(function () {
  const groups = document.querySelectorAll(".js-bars");
  if (!groups.length) return;
  const N = 7, CY = 80, MAXH = 120, FLOOR = 18, W = 14, GAP = 20;
  const X0 = (312 - (N * W + (N - 1) * GAP)) / 2;
  const all = [];

  groups.forEach((g) => {
    const state = { bars: [], phase: [], speed: [], cur: [] };
    for (let i = 0; i < N; i++) {
      state.phase.push(Math.random() * Math.PI * 2);
      state.speed.push(0.004 + Math.random() * 0.006);
      state.cur.push(FLOOR);
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", X0 + i * (W + GAP));
      r.setAttribute("width", W);
      r.setAttribute("rx", W / 2);
      g.appendChild(r);
      state.bars.push(r);
    }
    all.push(state);
  });

  // Reduced motion: static rest-height bars, no loop.
  if (reduceMotion) {
    all.forEach((s) => s.bars.forEach((b) => {
      b.setAttribute("height", FLOOR);
      b.setAttribute("y", CY - FLOOR / 2);
    }));
    return;
  }

  function render(state, level, t) {
    const energy = Math.min(1, level / 0.22);
    for (let i = 0; i < N; i++) {
      let w = 0.5 + 0.5 * Math.sin(t * state.speed[i] + state.phase[i]);
      w = w * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * state.speed[i] * 0.5 + state.phase[i] * 1.7));
      const target = FLOOR + (MAXH - FLOOR) * energy * (0.35 + 0.65 * w);
      const k = target > state.cur[i] ? 0.6 : 0.16;
      state.cur[i] += (target - state.cur[i]) * k;
      const h = state.cur[i];
      state.bars[i].setAttribute("height", h);
      state.bars[i].setAttribute("y", CY - h / 2);
    }
  }

  const start = performance.now();
  setInterval(() => {
    const t = performance.now() - start;
    const level = 0.11 + 0.11 * (0.5 + 0.5 * Math.sin(t * 0.0016)) * (0.6 + 0.4 * Math.sin(t * 0.011));
    all.forEach((s) => render(s, level, t));
  }, 45);
})();

// ---------- Radiant beam: rotate --beam-angle on every [data-beam] pill ----------
// Same JS-driven approach as the app (WebKit-safe), rAF at the app's speed.
(function () {
  const beams = document.querySelectorAll("[data-beam]");
  if (!beams.length || reduceMotion) return;
  const t0 = performance.now();
  (function spin(now) {
    const angle = ((now - t0) / 5) % 360;
    beams.forEach((b) => b.style.setProperty("--beam-angle", angle + "deg"));
    requestAnimationFrame(spin);
  })(t0);
})();

// ---------- Scroll reveals ----------
// Auto-tag the major blocks; no reveal classes needed in the HTML.
(function () {
  const items = document.querySelectorAll(
    ".section-head, .pipeline, .bento, .engines-inner, .download-grid, .setup-grid, .faq, .cta"
  );
  if (!items.length) return;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach((n) => n.classList.add("in"));
    return;
  }
  items.forEach((n) => n.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  items.forEach((n) => io.observe(n));
})();

// ---------- Copy-to-clipboard for setup commands ----------
document.querySelectorAll(".cmd-copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.dataset.copy || "";
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1600);
    } catch (err) {
      console.warn("Copy failed:", err);
    }
  });
});

// ---------- Live GitHub star count ----------
(async () => {
  const repo = "taraksh01/wisper";
  const ids = ["nav-stars", "cta-stars"];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const n = data.stargazers_count;
    if (typeof n === "number") {
      const txt = n.toLocaleString();
      ids.forEach((id) => {
        const elx = document.getElementById(id);
        if (elx) elx.textContent = txt;
      });
    }
  } catch (err) {
    console.warn("Could not load star count:", err);
  }
})();

// ---------- Package-type icons (inline SVG, inherit currentColor) ----------
const iconAppImage = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M9 6l3 3 3-3"/><path d="M4 11l8-4 8 4v8l-8 4-8-4z"/><path d="M4 11l8 4 8-4M12 15v8"/></svg>`;
const iconDebian = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c0-3.5 2.5-5.5 5.5-5 2.2.4 3.5 2.3 3 4.3-.6 2.3-3.6 2.8-4.8.8-.9-1.5.2-3.4 2-3.4"/><path d="M12 12c0 3.5-2.5 5.5-5.5 5-2.2-.4-3.5-2.3-3-4.3.6-2.3 3.6-2.8 4.8-.8.9 1.5-.2 3.4-2 3.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`;
const iconRpm = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V7.5C9 6 10 5 11.5 5H17"/><path d="M13 9l3.5 1.2c1.6.5 2.5 1.8 2.5 3.4 0 1.7-1.1 3-2.8 3.3"/><path d="M9 12.5h5"/></svg>`;

function fmtSize(b) {
  if (!b) return "";
  const gb = b / 1e9, mb = b / 1e6;
  if (gb >= 1) return gb.toFixed(1) + " GB";
  if (mb >= 1) return Math.round(mb) + " MB";
  return Math.round(b / 1e3) + " KB";
}

// ---------- Build download cards from the latest GitHub release ----------
(async () => {
  const grid = document.getElementById("download-grid");
  const ver = document.getElementById("version");
  const repo = grid?.dataset.repo || "taraksh01/wisper";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const rel = await res.json();

    if (ver && rel.tag_name) ver.textContent = rel.tag_name;

    const assets = rel.assets || [];
    if (!assets.length) throw new Error("no assets");

    const kinds = [
      { test: (n) => n.endsWith(".AppImage"), label: "AppImage", ext: ".AppImage", icon: iconAppImage },
      { test: (n) => n.endsWith(".deb"), label: "Debian / Ubuntu", ext: ".deb", icon: iconDebian },
      { test: (n) => n.endsWith(".rpm"), label: "Fedora / RPM", ext: ".rpm", icon: iconRpm },
    ];

    const cards = [];
    for (const kind of kinds) {
      const asset = assets.find((a) => kind.test(a.name));
      if (!asset) continue;
      const a = document.createElement("a");
      a.className = "pkg";
      a.href = asset.browser_download_url;
      a.setAttribute("aria-label", `Download Wisper for ${kind.label}`);
      a.innerHTML =
        `<span class="pkg-ico">${kind.icon}</span>` +
        `<h3>${kind.label}</h3>` +
        `<span class="ext">${kind.ext} · ${fmtSize(asset.size)}</span>` +
        `<span class="pkg-cta">Download</span>`;
      cards.push(a);
    }

    if (!cards.length) throw new Error("no matching assets");
    grid.innerHTML = "";
    cards.forEach((c) => grid.appendChild(c));
  } catch (err) {
    console.warn("Could not load latest release:", err);
    if (grid) {
      grid.innerHTML =
        `<a class="pkg" href="https://github.com/${repo}/releases/latest">` +
        `<span class="pkg-ico">📦</span><h3>All releases</h3>` +
        `<span class="ext">GitHub</span><span class="pkg-cta">Go to downloads</span></a>`;
    }
  }
})();

// ---------- Theme toggle: explicit choice overrides system pref ----------
(function () {
  const KEY = "wisper-theme";
  const root = document.documentElement;
  const saved = localStorage.getItem(KEY);
  const initial =
    saved === "light" || saved === "dark"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  root.setAttribute("data-theme", initial);
  root.style.colorScheme = initial;

  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    root.style.colorScheme = next;
    localStorage.setItem(KEY, next);
  });
})();
