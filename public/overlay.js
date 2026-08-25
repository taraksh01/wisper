(function () {
  var N = 7;
  var CY = 80;
  var MAXH = 120;
  var FLOOR = 18;
  var W = 14, GAP = 20, X0 = 22;

  var contentW = N * W + (N - 1) * GAP;
  X0 = (312 - contentW) / 2;

  var phase = [], speed = [], cur = [];
  for (var i = 0; i < N; i++) {
    phase.push(Math.random() * Math.PI * 2);
    speed.push(0.004 + Math.random() * 0.006);
    cur.push(FLOOR);
  }

  var g = document.getElementById("bars");
  var bars = [];
  for (var i = 0; i < N; i++) {
    var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", X0 + i * (W + GAP));
    r.setAttribute("width", W);
    r.setAttribute("rx", W / 2);
    g.appendChild(r);
    bars.push(r);
  }

  function render(level, t) {
    var energy = Math.min(1, level / 0.22);
    for (var i = 0; i < N; i++) {
      var w = 0.5 + 0.5 * Math.sin(t * speed[i] + phase[i]);
      w = w * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * speed[i] * 0.5 + phase[i] * 1.7));
      var target = FLOOR + (MAXH - FLOOR) * energy * (0.35 + 0.65 * w);
      var k = target > cur[i] ? 0.6 : 0.16;
      cur[i] += (target - cur[i]) * k;
      var h = cur[i];
      bars[i].setAttribute("height", h);
      bars[i].setAttribute("y", CY - h / 2);
    }
  }

  var tauri = window.__TAURI__;
  var start = performance.now();
  var cardEl = document.getElementById("card");
  var waveEl = document.getElementById("wave");
  var procEl = document.getElementById("proc");
  var beamRaf = 0;
  function startBeam() {
    if (beamRaf) return;
    function tick(now) {
      var angle = (now / 5) % 360;
      cardEl.style.setProperty("--beam-angle", angle + "deg");
      beamRaf = requestAnimationFrame(tick);
    }
    beamRaf = requestAnimationFrame(tick);
  }
  function stopBeam() {
    if (beamRaf) {
      cancelAnimationFrame(beamRaf);
      beamRaf = 0;
    }
    cardEl.style.removeProperty("--beam-angle");
  }

  window.__mode = function (m) {
    var processing = m === "processing";
    waveEl.style.display = processing ? "none" : "";
    procEl.style.display = processing ? "flex" : "none";
    cardEl.classList.toggle("processing", processing);
    cardEl.classList.toggle("err", m === "error");
    if (processing) startBeam();
    else stopBeam();
  };

  function cancel() {
    if (tauri && tauri.core) {
      tauri.core.invoke("cancel_recording").catch(function () {});
    }
  }
  var cancelBtn = document.getElementById("cancel");
  cancelBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    cancel();
  });

  if (tauri && tauri.core) {
    setInterval(function () {
      var t = performance.now() - start;
      tauri.core.invoke("get_input_level")
        .then(function (l) { render(l, t); })
        .catch(function () { render(0, t); });
    }, 45);
  } else {
    setInterval(function () { render(0, performance.now() - start); }, 60);
  }
})();
