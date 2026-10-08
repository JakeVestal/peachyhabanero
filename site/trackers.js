/* Treasury daily par curve. A missing tenor is a missing point.
   Nothing is filled in. */
(function () {
  const AXIS = {
    titlefont: { color: "#c4a35a", size: 12 },
    tickfont: { color: "#d5e4f0", size: 11 },
    gridcolor: "rgba(196,163,90,0.28)",
    zerolinecolor: "rgba(196,163,90,0.45)",
    linecolor: "rgba(196,163,90,0.7)",
  };
  const COLORS = [[0, "#1c3a5a"], [0.55, "#7f93a6"], [1, "#c4a35a"]];
  const PLOT = {
    responsive: true,
    scrollZoom: false,
    displayModeBar: true,
    displaylogo: false,
  };

  let PACK = null;

  function utcMs(iso) {
    const p = iso.split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function isoDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function stamp(text) {
    const el = document.getElementById("stamp");
    if (el) el.textContent = text;
  }

  function note(el, text) {
    Plotly.purge(el);
    el.textContent = text;
  }

  function paint(el, data, layout) {
    if (el.classList.contains("js-plotly-plot")) {
      Plotly.react(el, data, layout, PLOT);
      return;
    }
    el.replaceChildren();
    Plotly.newPlot(el, data, layout, PLOT);
  }

  function rangeIdx() {
    const dates = PACK.dates;
    const from = document.getElementById("curve-from").value;
    const to = document.getElementById("curve-to").value;
    if (from && to && from > to) return null;
    let i0 = 0;
    let i1 = dates.length - 1;
    if (from) while (i0 < dates.length && dates[i0] < from) i0 += 1;
    if (to) while (i1 >= 0 && dates[i1] > to) i1 -= 1;
    return [i0, i1];
  }

  function yearTicks(ms0, ms1) {
    const y0 = new Date(ms0).getUTCFullYear();
    const y1 = new Date(ms1).getUTCFullYear();
    const step = (y1 - y0) > 12 ? 2 : 1;
    const vals = [];
    const text = [];
    for (let y = y0; y <= y1; y += step) {
      vals.push(Date.UTC(y, 0, 1));
      text.push(String(y));
    }
    return { vals: vals, text: text };
  }

  function drawLatest() {
    const el = document.getElementById("curve-latest");
    const iso = document.getElementById("curve-day").value;
    const i = PACK.dates.indexOf(iso);
    if (i < 0) {
      note(el, "No Treasury curve published on " + iso + ".");
      return;
    }
    const date = PACK.dates[i];
    const x = [];
    const y = [];
    const text = [];
    PACK.tenors.forEach(function (tenor) {
      const v = PACK.columns[tenor.key][i];
      x.push(tenor.years);
      y.push(v === undefined ? null : v);
      text.push(date + " · " + tenor.label + (v == null ? " · not published" : ""));
    });
    paint(el, [{
      type: "scatter",
      mode: "lines+markers",
      x: x,
      y: y,
      text: text,
      connectgaps: false,
      line: { color: "#c4a35a", width: 2 },
      marker: { color: "#00f0ff", size: 7, line: { color: "#07080c", width: 1 } },
      hovertemplate: "%{text}<br>%{y:.2f}%<extra></extra>",
    }], {
      margin: { l: 52, r: 16, t: 28, b: 44 },
      paper_bgcolor: "#0d1117",
      plot_bgcolor: "#0d1117",
      font: { color: "#d5e4f0", family: "IBM Plex Sans, Segoe UI, sans-serif" },
      title: { text: date, font: { size: 13, color: "#c4a35a" } },
      xaxis: Object.assign({ title: "maturity (years)" }, AXIS),
      yaxis: Object.assign({ title: "yield %", ticksuffix: "%" }, AXIS),
      hoverlabel: { bgcolor: "#0d1117", bordercolor: "#c4a35a", font: { color: "#d5e4f0" } },
    });
  }

  function drawSurface(i0, i1) {
    const el = document.getElementById("curve-surface");
    const from = document.getElementById("curve-from").value;
    const to = document.getElementById("curve-to").value;
    if (i0 === null || i0 > i1) {
      note(el, "No Treasury curve between " + from + " and " + to + ".");
      return;
    }
    const x = [];
    const y = [];
    const z = [];
    const custom = [];
    let zmin = Infinity;
    let zmax = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const date = PACK.dates[i];
      const ms = utcMs(date);
      PACK.tenors.forEach(function (tenor) {
        const v = PACK.columns[tenor.key][i];
        if (v === null || v === undefined) return;
        x.push(ms);
        y.push(tenor.years);
        z.push(v);
        custom.push([date, tenor.label]);
        if (v < zmin) zmin = v;
        if (v > zmax) zmax = v;
      });
    }
    if (!z.length) {
      note(el, "No published yields between " + from + " and " + to + ".");
      return;
    }
    const ticks = yearTicks(utcMs(PACK.dates[i0]), utcMs(PACK.dates[i1]));
    const sceneAxis = function (title, extra) {
      return Object.assign({
        title: { text: title, font: { color: "#c4a35a", size: 12 } },
        tickfont: { color: "#d5e4f0", size: 11 },
        gridcolor: "rgba(196,163,90,0.28)",
        zerolinecolor: "rgba(196,163,90,0.4)",
        backgroundcolor: "#0d1117",
        showbackground: true,
      }, extra || {});
    };
    paint(el, [{
      type: "scatter3d",
      mode: "markers",
      x: x,
      y: y,
      z: z,
      customdata: custom,
      hovertemplate: "date %{customdata[0]}<br>maturity %{customdata[1]}<br>rate %{z:.2f}%<extra></extra>",
      marker: {
        size: 3,
        color: z,
        colorscale: COLORS,
        cmin: zmin,
        cmax: zmax,
        opacity: 0.9,
        line: { width: 0 },
        colorbar: {
          title: { text: "yield %", font: { color: "#c4a35a" } },
          tickfont: { color: "#d5e4f0" },
          thickness: 14,
        },
      },
    }], {
      margin: { l: 0, r: 0, t: 8, b: 0 },
      paper_bgcolor: "#07080c",
      font: { color: "#d5e4f0" },
      showlegend: false,
      hoverlabel: { bgcolor: "#0d1117", bordercolor: "#c4a35a", font: { color: "#d5e4f0" } },
      scene: {
        bgcolor: "#07080c",
        aspectmode: "manual",
        aspectratio: { x: 2.4, y: 1.15, z: 0.55 },
        camera: { eye: { x: 1.55, y: -1.65, z: 0.72 } },
        xaxis: sceneAxis("date", { tickvals: ticks.vals, ticktext: ticks.text }),
        yaxis: sceneAxis("maturity (years)"),
        zaxis: sceneAxis("yield %"),
      },
    });
  }

  function draw() {
    if (!PACK || !PACK.dates || !PACK.dates.length) return;
    drawLatest();
    const span = rangeIdx();
    if (!span) {
      note(document.getElementById("curve-surface"), "The start date is after the end date.");
      return;
    }
    drawSurface(span[0], span[1]);
  }

  function bindPickers() {
    const first = PACK.dates[0];
    const last = PACK.dates[PACK.dates.length - 1];
    const today = isoDate(new Date());
    const ago = new Date();
    ago.setFullYear(ago.getFullYear() - 5);
    const fromDefault = isoDate(ago);
    ["curve-day", "curve-from", "curve-to"].forEach(function (id) {
      const el = document.getElementById(id);
      el.min = first;
      el.max = today;
    });
    document.getElementById("curve-day").value = last;
    document.getElementById("curve-from").value = fromDefault < first ? first : fromDefault;
    document.getElementById("curve-to").value = today;
    document.getElementById("curve-day").addEventListener("change", drawLatest);
    document.getElementById("curve-from").addEventListener("change", draw);
    document.getElementById("curve-to").addEventListener("change", draw);
  }

  fetch("data/published/yield_curve.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("yield_curve.json " + r.status);
      return r.json();
    })
    .then(function (pack) {
      PACK = pack;
      if (pack.error && (!pack.dates || !pack.dates.length)) {
        stamp("yield curve failed: " + pack.error);
        return;
      }
      const bits = [
        "last print " + pack.end,
        "published " + (pack.generated_at || "").replace("T", " ").replace("+00:00", " UTC"),
      ];
      if (pack.stale) bits.push("STALE — last good curve kept");
      if (pack.error) bits.push(pack.error);
      stamp(bits.join(" · "));
      bindPickers();
      draw();
    })
    .catch(function (err) {
      stamp(String(err && err.message ? err.message : err));
    });
})();
