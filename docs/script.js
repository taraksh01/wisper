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
      { test: (n) => n.endsWith(".AppImage"), label: "AppImage", ext: ".AppImage" },
      { test: (n) => n.endsWith(".deb"), label: "Debian / Ubuntu", ext: ".deb" },
      { test: (n) => n.endsWith(".rpm"), label: "Fedora / RPM", ext: ".rpm" },
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
        `<span class="ext">${kind.ext}</span>` +
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
