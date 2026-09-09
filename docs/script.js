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
  "hold the hotkey and just talk",
  "your words, typed at your cursor",
  "dictate the whole email hands free",
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
const iconDebian = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M13.88 12.685c-.4 0 .08.2.601.28.14-.1.27-.22.39-.33a3.001 3.001 0 01-.99.05m2.14-.53c.23-.33.4-.69.47-1.06-.06.27-.2.5-.33.73-.75.47-.07-.27 0-.56-.8 1.01-.11.6-.14.89m.781-2.05c.05-.721-.14-.501-.2-.221.07.04.13.5.2.22M12.38.31c.2.04.45.07.42.12.23-.05.28-.1-.43-.12m.43.12l-.15.03.14-.01V.43m6.633 9.944c.02.64-.2.95-.38 1.5l-.35.181c-.28.54.03.35-.17.78-.44.39-1.34 1.22-1.62 1.301-.201 0 .14-.25.19-.34-.591.4-.481.6-1.371.85l-.03-.06c-2.221 1.04-5.303-1.02-5.253-3.842-.03.17-.07.13-.12.2a3.551 3.552 0 012.001-3.501 3.361 3.362 0 013.732.48 3.341 3.342 0 00-2.721-1.3c-1.18.01-2.281.76-2.651 1.57-.6.38-.67 1.47-.93 1.661-.361 2.601.66 3.722 2.38 5.042.27.19.08.21.12.35a4.702 4.702 0 01-1.53-1.16c.23.33.47.66.8.91-.55-.18-1.27-1.3-1.48-1.35.93 1.66 3.78 2.921 5.261 2.3a6.203 6.203 0 01-2.33-.28c-.33-.16-.77-.51-.7-.57a5.802 5.803 0 005.902-.84c.44-.35.93-.94 1.07-.95-.2.32.04.16-.12.44.44-.72-.2-.3.46-1.24l.24.33c-.09-.6.74-1.321.66-2.262.19-.3.2.3 0 .97.29-.74.08-.85.15-1.46.08.2.18.42.23.63-.18-.7.2-1.2.28-1.6-.09-.05-.28.3-.32-.53 0-.37.1-.2.14-.28-.08-.05-.26-.32-.38-.861.08-.13.22.33.34.34-.08-.42-.2-.75-.2-1.08-.34-.68-.12.1-.4-.3-.34-1.091.3-.25.34-.74.54.77.84 1.96.981 2.46-.1-.6-.28-1.2-.49-1.76.16.07-.26-1.241.21-.37A7.823 7.824 0 0017.702 1.6c.18.17.42.39.33.42-.75-.45-.62-.48-.73-.67-.61-.25-.65.02-1.06 0C15.082.73 14.862.8 13.8.4l.05.23c-.77-.25-.9.1-1.73 0-.05-.04.27-.14.53-.18-.741.1-.701-.14-1.431.03.17-.13.36-.21.55-.32-.6.04-1.44.35-1.18.07C9.6.68 7.847 1.3 6.867 2.22L6.838 2c-.45.54-1.96 1.611-2.08 2.311l-.131.03c-.23.4-.38.85-.57 1.261-.3.52-.45.2-.4.28-.6 1.22-.9 2.251-1.16 3.102.18.27 0 1.65.07 2.76-.3 5.463 3.84 10.776 8.363 12.006.67.23 1.65.23 2.49.25-.99-.28-1.12-.15-2.08-.49-.7-.32-.85-.7-1.34-1.13l.2.35c-.971-.34-.57-.42-1.361-.67l.21-.27c-.31-.03-.83-.53-.97-.81l-.34.01c-.41-.501-.63-.871-.61-1.161l-.111.2c-.13-.21-1.52-1.901-.8-1.511-.13-.12-.31-.2-.5-.55l.14-.17c-.35-.44-.64-1.02-.62-1.2.2.24.32.3.45.33-.88-2.172-.93-.12-1.601-2.202l.15-.02c-.1-.16-.18-.34-.26-.51l.06-.6c-.63-.74-.18-3.102-.09-4.402.07-.54.53-1.1.88-1.981l-.21-.04c.4-.71 2.341-2.872 3.241-2.761.43-.55-.09 0-.18-.14.96-.991 1.26-.7 1.901-.88.7-.401-.6.16-.27-.151 1.2-.3.85-.7 2.421-.85.16.1-.39.14-.52.26 1-.49 3.151-.37 4.562.27 1.63.77 3.461 3.011 3.531 5.132l.08.02c-.04.85.13 1.821-.17 2.711l.2-.42M9.54 13.236l-.05.28c.26.35.47.73.8 1.01-.24-.47-.42-.66-.75-1.3m.62-.02c-.14-.15-.22-.34-.31-.52.08.32.26.6.43.88l-.12-.36m10.945-2.382l-.07.15c-.1.76-.34 1.511-.69 2.212.4-.73.65-1.541.75-2.362M12.45.12c.27-.1.66-.05.95-.12-.37.03-.74.05-1.1.1l.15.02M3.006 5.142c.07.57-.43.8.11.42.3-.66-.11-.18-.1-.42m-.64 2.661c.12-.39.15-.62.2-.84-.35.44-.17.53-.2.83"/></svg>`;
const iconRpm = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12.001 0C5.376 0 .008 5.369.004 11.992H.002v9.287h.002A2.726 2.726 0 0 0 2.73 24h9.275c6.626-.004 11.993-5.372 11.993-11.997C23.998 5.375 18.628 0 12 0zm2.431 4.94c2.015 0 3.917 1.543 3.917 3.671 0 .197.001.395-.03.619a1.002 1.002 0 0 1-1.137.893 1.002 1.002 0 0 1-.842-1.175 2.61 2.61 0 0 0 .013-.337c0-1.207-.987-1.672-1.92-1.672-.934 0-1.775.784-1.777 1.672.016 1.027 0 2.046 0 3.07l1.732-.012c1.352-.028 1.368 2.009.016 1.998l-1.748.013c-.004.826.006.677.002 1.093 0 0 .015 1.01-.016 1.776-.209 2.25-2.124 4.046-4.424 4.046-2.438 0-4.448-1.993-4.448-4.437.073-2.515 2.078-4.492 4.603-4.469l1.409-.01v1.996l-1.409.013h-.007c-1.388.04-2.577.984-2.6 2.47a2.438 2.438 0 0 0 2.452 2.439c1.356 0 2.441-.987 2.441-2.437l-.001-7.557c0-.14.005-.252.02-.407.23-1.848 1.883-3.256 3.754-3.256z"/></svg>`;
const iconWindows = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M4 4h7.2v7.2H4zM12.8 4H20v7.2h-7.2zM4 12.8h7.2V20H4zM12.8 12.8H20V20h-7.2z"/></svg>`;

const iconMac = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`;

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
      { test: (n) => n.endsWith(".AppImage"), label: "AppImage", ext: ".AppImage", icon: iconAppImage, os: "linux", pkg: "appimage", universal: true },
      { test: (n) => n.endsWith(".deb"), label: "Debian / Ubuntu", ext: ".deb", icon: iconDebian, os: "linux", pkg: "deb" },
      { test: (n) => n.endsWith(".rpm"), label: "Fedora / RPM", ext: ".rpm", icon: iconRpm, os: "linux", pkg: "rpm" },
      { test: (n) => n.endsWith("-setup.exe"), label: "Windows", ext: ".exe", icon: iconWindows, os: "windows" },
    ];

    const cards = [];
    for (const kind of kinds) {
      const asset = assets.find((a) => kind.test(a.name));
      if (!asset) continue;
      const a = document.createElement("a");
      a.className = "pkg";
      a.href = asset.browser_download_url;
      a.dataset.os = kind.os || "linux";
      if (kind.pkg) a.dataset.pkg = kind.pkg;
      if (kind.universal) a.dataset.universal = "true";
      a.setAttribute("aria-label", `Download Wisper for ${kind.label}`);
      a.innerHTML =
        `<span class="pkg-ico">${kind.icon}</span>` +
        `<span class="pkg-meta"><h3>${kind.label}</h3>` +
        `<span class="pkg-file mono">${asset.name}</span></span>` +
        `<span class="pkg-side"><span class="ext">${kind.ext} · ${fmtSize(asset.size)}</span>` +
        `<span class="pkg-go" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M5 20h14"/></svg><span class="pkg-go-t">Download</span></span></span>`;
      cards.push(a);
    }

    if (!cards.length) throw new Error("no matching assets");
    grid.innerHTML = "";
    cards.forEach((c) => grid.appendChild(c));

    try {
      const bres = await fetch(`https://api.github.com/repos/${repo}/releases/tags/beta`);
      if (!bres.ok) throw new Error(`beta status ${bres.status}`);
      const brel = await bres.json();
      const win = (brel.assets || []).find((a) => a.name.endsWith("-setup.exe"));
      if (win) {
        const w = document.createElement("a");
        w.className = "pkg pkg-beta";
        w.href = win.browser_download_url;
        w.dataset.os = "windows";
        w.setAttribute("aria-label", "Download Wisper beta for Windows");
        w.innerHTML =
          `<span class="pkg-ico">${iconWindows}</span>` +
          `<span class="pkg-meta"><h3>Windows <span class="pkg-chip">beta</span></h3>` +
          `<span class="pkg-file mono">${win.name}</span></span>` +
          `<span class="pkg-side"><span class="ext">.exe · ${fmtSize(win.size)}</span>` +
          `<span class="pkg-go" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M5 20h14"/></svg><span class="pkg-go-t">Download</span></span></span>`;
        grid.appendChild(w);
      }
    } catch (betaErr) {
      console.warn("No Windows beta asset:", betaErr);
    }

    grid.appendChild(macSoonRow());

    recommendForThisOS(grid);
  } catch (err) {
    console.warn("Could not load latest release:", err);
    if (grid) {
      grid.innerHTML =
        `<a class="pkg" href="https://github.com/${repo}/releases/latest">` +
        `<span class="pkg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M5 20h14"/></svg></span>` +
        `<span class="pkg-meta"><h3>All releases</h3>` +
        `<span class="pkg-file mono">GitHub</span></span>` +
        `<span class="pkg-side"><span class="pkg-go" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M5 20h14"/></svg><span class="pkg-go-t">Open</span></span></span></a>`;
      grid.appendChild(macSoonRow());

    recommendForThisOS(grid);
    }
  }
})();

// Best-effort distro sniff from the UA string. Chrome omits the distro
// (Firefox reports it, e.g. "X11; Ubuntu; Linux x86_64"), so unknown
// distros fall back to the universal AppImage. Testable via distroPkg(ua).
function distroPkg(ua = navigator.userAgent || "") {
  if (/ubuntu|debian|mint|pop|elementary|zorin|kali|raspbian/i.test(ua)) return "deb";
  if (/fedora|red ?hat|rhel|centos|opensuse|suse|rocky|alma/i.test(ua)) return "rpm";
  return "appimage";
}

// OS-aware downloads: recommend the row matching this machine, hide the
// rest behind a toggle. Uncertain OS or no match shows everything.
function detectOS(
  ua = navigator.userAgent || "",
  hint = navigator.userAgentData?.platform || navigator.platform || ""
) {
  // Client hint wins when exact (survives UA reduction; MDN/web.dev guidance).
  const h = hint.trim().toLowerCase();
  if (h === "windows") return "windows";
  if (h === "macos") return "macos";
  if (h === "linux") return "linux";
  // UA fallback in strict order: mobile first (Android UAs contain Linux).
  if (/iphone|ipad|ipod/i.test(ua)) return "unknown";
  if (/cros/i.test(ua)) return "unknown";
  if (/android/i.test(ua)) return "unknown";
  if (/windows nt|win64|win32|windows phone/i.test(ua)) return "windows";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "unknown";
}

function recommendForThisOS(grid) {
  const os = detectOS();
  const rows = [...grid.querySelectorAll(".pkg[data-os]")];
  if (!rows.length) return;
  let recs;
  if (os === "linux") {
    // An explicit past pick beats sniffing: Chrome hides the distro,
    // so a user who once chose .deb keeps getting .deb recommended.
    let pick = null;
    try { pick = localStorage.getItem("wisper-dl-pick"); } catch {}
    if (pick) recs = rows.filter((r) => r.dataset.pkg === pick);
    if (!recs || !recs.length) {
      const pkg = distroPkg();
      recs = rows.filter((r) => r.dataset.pkg === pkg);
    }
    if (!recs.length) recs = rows.filter((r) => r.dataset.universal === "true");
    if (!recs.length) recs = rows.filter((r) => r.dataset.os === "linux");
  } else if (os === "unknown") {
    recs = rows;
  } else {
    recs = rows.filter((r) => r.dataset.os === os);
  }
  if (!recs.length || recs.length === rows.length) return;
  const recSet = new Set(recs);
  recs.forEach((r) => {
    const h3 = r.querySelector("h3");
    if (h3 && !h3.querySelector(".pkg-chip-rec")) {
      const chip = document.createElement("span");
      chip.className = "pkg-chip pkg-chip-rec";
      chip.textContent = "for your system";
      h3.appendChild(chip);
    }
  });
  rows.forEach((r) => { if (!recSet.has(r)) r.hidden = true; });
  const hidden = rows.length - recs.length;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dl-toggle mono";
  btn.setAttribute("aria-expanded", "false");
  const showAll = `Show all ${rows.length} downloads`;
  btn.textContent = showAll;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") === "true";
    rows.forEach((r) => { r.hidden = open && !recSet.has(r); });
    btn.setAttribute("aria-expanded", String(!open));
    btn.textContent = open ? showAll : "Show less";
  });
  grid.after(btn);
}

// macOS is not built yet: a disabled row, never a link.
function macSoonRow() {
  const m = document.createElement("div");
  m.className = "pkg pkg-soon";
  m.dataset.os = "macos";
  m.setAttribute("aria-disabled", "true");
  m.innerHTML =
    `<span class="pkg-ico">${iconMac}</span>` +
    `<span class="pkg-meta"><h3>macOS <span class="pkg-chip">coming soon</span></h3>` +
    `<span class="pkg-file mono">Signed build still in the works</span></span>`;
  return m;
}

// ---------- Download click feedback: sweep + spinner, then follow the link ----------
document.getElementById("download-grid")?.addEventListener("click", (e) => {
  const a = e.target.closest("a.pkg");
  if (!a || a.classList.contains("pkg-busy")) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (reduceMotion) return;
  e.preventDefault();
  a.classList.add("pkg-busy");
  try {
    const pkg = a.dataset.pkg || a.dataset.os;
    if (pkg) localStorage.setItem("wisper-dl-pick", pkg);
  } catch {}
  const label = a.querySelector(".pkg-go-t");
  const prev = label ? label.textContent : null;
  if (label) label.textContent = "Starting…";
  setTimeout(() => { window.location.href = a.href; }, 450);
  // Downloads and cancelled save dialogs leave the page in place,
  // so always reset: the row never sticks and stays clickable.
  setTimeout(() => {
    a.classList.remove("pkg-busy");
    if (label && prev !== null) label.textContent = prev;
  }, 3000);
});

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
