// Hero transcript typing loop (subtle, on-brand).
// Guarded so it stops mutating the DOM under reduced-motion.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lines = [
  "press the hotkey and start talking…",
  "wisper types it wherever the cursor sits",
  "privacy-first, everything on your device",
  "deb and AppImage, ready when you are",
];
const el = document.getElementById("transcript");
let li = 0, ci = 0, deleting = false;

function tick() {
  if (!el) return;
  const full = lines[li];
  if (!deleting) {
    el.textContent = full.slice(0, ci + 1);
    ci++;
    if (ci === full.length) { deleting = true; return setTimeout(tick, 1700); }
  } else {
    el.textContent = full.slice(0, ci - 1);
    ci--;
    if (ci === 0) { deleting = false; li = (li + 1) % lines.length; }
  }
  setTimeout(tick, deleting ? 26 : 52);
}
if (!reduceMotion) tick();

// Hero waveform: JS-driven bars mirroring the real app overlay (organic motion,
// fast-attack/slow-decay). No mic in the browser, so a soft speech-like envelope
// keeps it lively. Under reduced-motion it renders a static bar set (no loop).
(function () {
  const g = document.getElementById("ov-bars");
  if (!g) return;
  const N = 7, CY = 80, MAXH = 120, FLOOR = 18, W = 14, GAP = 20;
  const X0 = (312 - (N * W + (N - 1) * GAP)) / 2;
  const phase = [], speed = [], cur = [];
  const bars = [];
  for (let i = 0; i < N; i++) {
    phase.push(Math.random() * Math.PI * 2);
    speed.push(0.004 + Math.random() * 0.006);
    cur.push(FLOOR);
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", X0 + i * (W + GAP));
    r.setAttribute("width", W);
    r.setAttribute("rx", W / 2);
    g.appendChild(r);
    bars.push(r);
  }
  // Reduced-motion: render a static rest-height bar set, no animation loop.
  if (reduceMotion) {
    bars.forEach((b) => { b.setAttribute("height", FLOOR); b.setAttribute("y", CY - FLOOR / 2); });
    return;
  }
  function render(level, t) {
    const energy = Math.min(1, level / 0.22);
    for (let i = 0; i < N; i++) {
      let w = 0.5 + 0.5 * Math.sin(t * speed[i] + phase[i]);
      w = w * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * speed[i] * 0.5 + phase[i] * 1.7));
      const target = FLOOR + (MAXH - FLOOR) * energy * (0.35 + 0.65 * w);
      const k = target > cur[i] ? 0.6 : 0.16;
      cur[i] += (target - cur[i]) * k;
      const h = cur[i];
      bars[i].setAttribute("height", h);
      bars[i].setAttribute("y", CY - h / 2);
    }
  }
  const start = performance.now();
  setInterval(() => {
    const t = performance.now() - start;
    const level = 0.11 + 0.11 * (0.5 + 0.5 * Math.sin(t * 0.0016)) * (0.6 + 0.4 * Math.sin(t * 0.011));
    render(level, t);
  }, 45);
})();

// Copy-to-clipboard for setup commands.
// Only toggles a class; the icon swap + animation live in CSS so we never
// wipe the inline SVGs (which would break the button).
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

// Live GitHub star count (option B: always show, even when small).
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

// Package-type icons (inline SVG, inherit currentColor).
// AppImage: a package box with a download arrow dropping in.
const iconAppImage = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M9 6l3 3 3-3"/><path d="M4 11l8-4 8 4v8l-8 4-8-4z"/><path d="M4 11l8 4 8-4M12 15v8"/></svg>`;
// Debian: the Debian swirl (the project's recognizable mark).
const iconDebian = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c0-3.5 2.5-5.5 5.5-5 2.2.4 3.5 2.3 3 4.3-.6 2.3-3.6 2.8-4.8.8-.9-1.5.2-3.4 2-3.4"/><path d="M12 12c0 3.5-2.5 5.5-5.5 5-2.2-.4-3.5-2.3-3-4.3.6-2.3 3.6-2.8 4.8-.8.9 1.5-.2 3.4-2 3.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`;
// Fedora/RPM: the Fedora "f" with its trailing ribbon.
const iconRpm = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V7.5C9 6 10 5 11.5 5H17"/><path d="M13 9l3.5 1.2c1.6.5 2.5 1.8 2.5 3.4 0 1.7-1.1 3-2.8 3.3"/><path d="M9 12.5h5"/></svg>`;

// Format a byte count as a short human string (e.g. 18 MB, 1.4 GB).
function fmtSize(b) {
  if (!b) return "";
  const gb = b / 1e9, mb = b / 1e6;
  if (gb >= 1) return gb.toFixed(1) + " GB";
  if (mb >= 1) return Math.round(mb) + " MB";
  return Math.round(b / 1e3) + " KB";
}

// Build download cards from the latest GitHub release.
// Any asset format present in the release shows up automatically, so adding
// a new package (rpm, flatpak, ...) needs no HTML change.
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

    // Map a file suffix to a human label + file extension.
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
        `<h3>${kind.label}</h3>` +
        `<span class="ext">${kind.ext} · ${fmtSize(asset.size)}</span>` +
        `<span class="pkg-cta">Download</span>`;
      cards.push(a);
    }

    if (!cards.length) throw new Error("no matching assets");
    grid.innerHTML = "";
    cards.forEach((c) => grid.appendChild(c));
  } catch (err) {
    // API unreachable or no assets: offer the releases page as a safe fallback.
    console.warn("Could not load latest release:", err);
    if (grid) {
      grid.innerHTML =
        `<a class="pkg" href="https://github.com/${repo}/releases/latest">` +
        `<div class="pkg-ico">📦</div><h3>All releases</h3>` +
        `<span class="ext">GitHub</span><span class="pkg-cta">Go to downloads</span></a>`;
    }
  }
})();

// Theme toggle: explicit user choice (localStorage) overrides system pref.
// data-theme is set on <html> so CSS keys on the attribute, not the OS setting.
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
