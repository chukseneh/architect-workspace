/* Support Inbox Triage — shared rendering, nav, search, illustrations, Ask panel.
   Classic script, no ES module. Reads the bare `BLUEPRINT` identifier (not
   window.BLUEPRINT). Declares the bare `Site` identifier for page scripts to call. */

const Site = {
  _mermaidReady: false,
  _mermaidInstances: [],
  _mermaidCounter: 0,
  _searchIndex: null
};

/* ============================== utilities ============================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function el(tag, attrs, html) {
  const node = document.createElement(tag);
  if (attrs) { Object.keys(attrs).forEach(k => node.setAttribute(k, attrs[k])); }
  if (html !== undefined) { node.innerHTML = html; }
  return node;
}

/* ============================== theme ============================== */

Site.initTheme = function () {
  const stored = localStorage.getItem("kb-theme");
  if (stored === "dark" || stored === "light") {
    document.documentElement.setAttribute("data-theme", stored);
  }
};

Site.toggleTheme = function () {
  const current = document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("kb-theme", next);
  Site.reRenderMermaidForTheme();
};

Site.currentThemeIsDark = function () {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
};

/* ============================== nav / chrome ============================== */

Site.renderNav = function (pageId) {
  const nav = el("div", { class: "nav-inner" });

  const brand = el("a", { href: "index.html", class: "nav-brand" }, escapeHtml(BLUEPRINT.meta.projectName));
  nav.appendChild(brand);

  const links = el("div", { class: "nav-links" });
  BLUEPRINT.pages.filter(p => p.id !== "index").forEach(p => {
    const a = el("a", { href: p.file }, escapeHtml(p.nav));
    if (p.id === pageId) a.classList.add("active");
    links.appendChild(a);
  });
  nav.appendChild(links);

  const tools = el("div", { class: "nav-tools" });

  const searchWrap = el("div", { class: "search-wrap" });
  const searchInput = el("input", { id: "nav-search", type: "search", placeholder: "Search blueprint…", "aria-label": "Search blueprint" });
  const dropdown = el("div", { id: "search-dropdown", class: "hidden" });
  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(dropdown);
  tools.appendChild(searchWrap);

  const themeBtn = el("button", { class: "icon-btn", id: "theme-toggle", "aria-label": "Toggle dark mode", title: "Toggle theme" }, "◑");
  const printBtn = el("button", { class: "icon-btn", id: "print-btn", "aria-label": "Print this page", title: "Print" }, "⎘");
  tools.appendChild(themeBtn);
  tools.appendChild(printBtn);

  nav.appendChild(tools);

  const header = qs("#top-nav");
  header.innerHTML = "";
  header.appendChild(nav);

  themeBtn.addEventListener("click", Site.toggleTheme);
  printBtn.addEventListener("click", () => window.print());

  searchInput.addEventListener("input", () => Site.onSearchInput(pageId, searchInput.value));
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { dropdown.classList.add("hidden"); searchInput.blur(); } });
  document.addEventListener("click", (e) => {
    if (!searchWrap.contains(e.target)) dropdown.classList.add("hidden");
  });
};

Site.renderBreadcrumbs = function (pageId) {
  const container = qs("#breadcrumbs");
  if (!container) return;
  const page = BLUEPRINT.pages.find(p => p.id === pageId);
  if (pageId === "index") { container.innerHTML = ""; return; }
  container.innerHTML = `<a href="index.html">Command Center</a> &rsaquo; <span>${escapeHtml(page.nav)}</span>`;
};

Site.renderPrevNext = function (pageId) {
  const container = qs("#section-footer");
  if (!container) return;
  const order = BLUEPRINT.pages.filter(p => p.id !== "index");
  const idx = order.findIndex(p => p.id === pageId);
  if (idx === -1) { container.innerHTML = ""; return; }
  const prev = idx > 0 ? order[idx - 1] : { file: "index.html", nav: "Command Center" };
  const next = idx < order.length - 1 ? order[idx + 1] : null;

  let html = `<a class="pn-link prev" href="${prev.file}"><div class="pn-label">&larr; Previous</div><div class="pn-title">${escapeHtml(prev.nav)}</div></a>`;
  if (next) {
    html += `<a class="pn-link next" href="${next.file}"><div class="pn-label">Next &rarr;</div><div class="pn-title">${escapeHtml(next.nav)}</div></a>`;
  }
  container.innerHTML = html;
};

Site.renderFooter = function () {
  const f = qs("#page-footer");
  if (f) f.innerHTML = `${escapeHtml(BLUEPRINT.meta.projectName)} &middot; generated ${escapeHtml(BLUEPRINT.meta.generatedDate)} &middot; built with the system-architect skill`;
};

Site.initScrollChrome = function () {
  const bar = qs("#progress-bar");
  const backToTop = qs("#back-to-top");
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    const scrolled = h.scrollTop;
    const height = h.scrollHeight - h.clientHeight;
    const pct = height > 0 ? (scrolled / height) * 100 : 0;
    if (bar) bar.style.width = pct + "%";
    if (backToTop) backToTop.classList.toggle("hidden", scrolled < 400);
  });
  if (backToTop) backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
};

/* ============================== search index ============================== */

const STOPWORDS = new Set(["the","a","an","and","or","of","to","in","on","for","with","is","are","it","this","that","by","as","be","was","were","so","if","its","at","from","into"]);

function stem(word) {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t));
}

Site.buildSearchIndex = function () {
  if (Site._searchIndex) return Site._searchIndex;
  const entries = [];

  entries.push({ pageId: "summary", file: "01-summary.html", title: "The Idea", text: BLUEPRINT.meta.ideaParagraph + " " + BLUEPRINT.meta.mustDoWell });

  BLUEPRINT.components.forEach(c => {
    entries.push({ pageId: "components", file: "02-components.html", title: c.name, text: c.sentence + " " + c.words });
  });

  entries.push({ pageId: "architecture", file: "03-architecture.html", title: "How It Fits Together", text: "system architecture flowchart components connections data flow entry points" });

  BLUEPRINT.dataFlowSteps.forEach(s => {
    entries.push({ pageId: "data-flow", file: "04-data-flow.html", title: "Step " + s.step + ": " + s.actor, text: s.action });
  });

  BLUEPRINT.phases.forEach(p => {
    entries.push({ pageId: "build-order", file: "05-build-order.html", title: p.name, text: p.proves + (p.makeOrBreak ? " make or break critical phase" : "") });
  });

  BLUEPRINT.requirements.forEach(r => {
    entries.push({ pageId: "build-order", file: "05-build-order.html", title: "Coverage: " + r.label, text: r.label + " coverage across build phases" });
  });

  BLUEPRINT.assumptions.forEach(a => {
    entries.push({ pageId: "assumptions", file: "06-assumptions.html", title: "Assumption", text: a.text + " " + a.impact });
  });
  entries.push({ pageId: "assumptions", file: "06-assumptions.html", title: "Open question", text: BLUEPRINT.openQuestion.question + " " + BLUEPRINT.openQuestion.branchA.impact + " " + BLUEPRINT.openQuestion.branchB.impact });

  BLUEPRINT.notCovered.forEach(n => {
    entries.push({ pageId: "not-covered", file: "07-not-covered.html", title: "Not covered", text: n });
  });

  entries.forEach((entry, i) => {
    entry.id = i;
    entry.titleTokens = tokenize(entry.title).map(stem);
    entry.bodyTokens = tokenize(entry.text).map(stem);
    entry.raw = entry.title + " — " + entry.text;
  });

  Site._searchIndex = entries;
  return entries;
};

Site.search = function (query, limit) {
  const q = tokenize(query).map(stem);
  if (q.length === 0) return [];
  const index = Site.buildSearchIndex();
  const phrase = query.trim().toLowerCase();

  const scored = index.map(entry => {
    let score = 0;
    q.forEach(term => {
      const titleHits = entry.titleTokens.filter(t => t === term || t.startsWith(term)).length;
      const bodyHits = entry.bodyTokens.filter(t => t === term || t.startsWith(term)).length;
      score += titleHits * 4 + bodyHits * 1;
    });
    if (phrase.length > 2 && entry.raw.toLowerCase().includes(phrase)) score += 6;
    return { entry, score };
  }).filter(r => r.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 8).map(r => r.entry);
};

function highlightSnippet(text, query) {
  const terms = tokenize(query);
  if (terms.length === 0) return escapeHtml(text.slice(0, 140));
  let snippetStart = 0;
  const lower = text.toLowerCase();
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx > -1) { snippetStart = Math.max(0, idx - 40); break; }
  }
  let snippet = text.slice(snippetStart, snippetStart + 160);
  let safe = escapeHtml(snippet);
  terms.forEach(t => {
    if (t.length < 2) return;
    const re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    safe = safe.replace(re, "<mark>$1</mark>");
  });
  return (snippetStart > 0 ? "…" : "") + safe + "…";
}

Site.onSearchInput = function (pageId, query) {
  const dropdown = qs("#search-dropdown");
  if (!dropdown) return;
  if (!query || query.trim().length < 2) { dropdown.classList.add("hidden"); dropdown.innerHTML = ""; return; }

  const results = Site.search(query, 8);
  if (results.length === 0) {
    dropdown.innerHTML = `<div class="search-empty">No matches. Try Coverage or Assumptions — a miss can itself be the answer.</div>`;
  } else {
    dropdown.innerHTML = results.map(r => `
      <a class="search-result" href="${r.file}">
        <div class="sr-section">${escapeHtml(BLUEPRINT.pages.find(p => p.id === r.pageId).nav)}</div>
        <div class="sr-snippet"><strong>${escapeHtml(r.title)}</strong> — ${highlightSnippet(r.text, query)}</div>
      </a>`).join("");
  }
  dropdown.classList.remove("hidden");

  qsa("[data-search-text]").forEach(node => {
    const hay = node.getAttribute("data-search-text").toLowerCase();
    const visible = tokenize(query).every(t => hay.includes(t));
    node.style.display = visible ? "" : "none";
  });
};

/* ============================== mermaid ============================== */

Site.ensureMermaidInit = function () {
  if (typeof mermaid === "undefined") return false;
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: Site.currentThemeIsDark() ? "dark" : "default" });
  Site._mermaidReady = true;
  return true;
};

Site.renderMermaidInto = function (containerEl, source) {
  if (!Site.ensureMermaidInit()) {
    containerEl.innerHTML = `<div class="ask-error">Mermaid did not load (no internet on first visit?). The raw diagram source is still below.</div><pre>${escapeHtml(source)}</pre>`;
    return;
  }
  const id = "mmd-" + (Site._mermaidCounter++);
  mermaid.render(id, source).then(({ svg }) => {
    containerEl.innerHTML = svg;
    Site._mermaidInstances = Site._mermaidInstances.filter(i => i.container !== containerEl);
    Site._mermaidInstances.push({ container: containerEl, source });
  }).catch(err => {
    containerEl.innerHTML = `<div class="ask-error">Diagram failed to parse: ${escapeHtml(err.message || String(err))}</div>`;
  });
};

Site.reRenderMermaidForTheme = function () {
  if (!Site._mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: Site.currentThemeIsDark() ? "dark" : "default" });
  Site._mermaidInstances.forEach(inst => {
    const id = "mmd-" + (Site._mermaidCounter++);
    mermaid.render(id, inst.source).then(({ svg }) => { inst.container.innerHTML = svg; }).catch(() => {});
  });
};

/* ============================== expand / zoom modal ============================== */

Site.attachExpand = function (figureEl, title, buildFn) {
  const btn = figureEl.querySelector(".expand-btn");
  if (!btn) return;
  btn.addEventListener("click", () => Site.openModal(title, buildFn));
};

Site.openModal = function (title, buildFn) {
  const modal = qs("#diagram-modal");
  let scale = 1;
  modal.innerHTML = `
    <div class="modal-inner">
      <div class="modal-head">
        <strong>${escapeHtml(title)}</strong>
        <div class="modal-controls">
          <button class="icon-btn" id="zoom-out" aria-label="Zoom out">−</button>
          <button class="icon-btn" id="zoom-reset" aria-label="Reset zoom">⟳</button>
          <button class="icon-btn" id="zoom-in" aria-label="Zoom in">+</button>
          <button class="icon-btn" id="modal-close" aria-label="Close">×</button>
        </div>
      </div>
      <div class="modal-body"><div class="zoom-surface"></div></div>
    </div>`;
  modal.classList.remove("hidden");
  const surface = qs(".zoom-surface", modal);
  buildFn(surface);

  const applyScale = () => { surface.style.transform = "scale(" + scale + ")"; };
  qs("#zoom-in", modal).addEventListener("click", () => { scale = Math.min(3, scale + 0.2); applyScale(); });
  qs("#zoom-out", modal).addEventListener("click", () => { scale = Math.max(0.4, scale - 0.2); applyScale(); });
  qs("#zoom-reset", modal).addEventListener("click", () => { scale = 1; applyScale(); });

  const close = () => { modal.classList.add("hidden"); modal.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  qs("#modal-close", modal).addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
};

/* ============================== figure helper ============================== */

Site.figure = function (containerId, title, interpretation, renderFn) {
  const container = qs("#" + containerId);
  if (!container) return;
  container.classList.add("figure");
  container.innerHTML = `
    <div class="figure-head"><h3>${escapeHtml(title)}</h3><button class="expand-btn">⤢ Expand</button></div>
    <div class="figure-body"></div>
    <div class="figure-interpretation">${interpretation}</div>`;
  const body = qs(".figure-body", container);
  renderFn(body);
  Site.attachExpand(container, title, (surface) => renderFn(surface));
};

/* ============================== SVG illustrations ============================== */

Site.svg = {};

Site.svg.pipeline = function (variant) {
  const tile = variant === "tile";
  const w = tile ? 300 : 860, h = tile ? 90 : 200;
  const stages = ["Customer email", "Ingest → Queue → Classify → Route", "Sorted agent dashboard"];
  const boxW = w / 3 - 20, boxH = tile ? 40 : 70, y = h / 2 - boxH / 2;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Inputs, pipeline, output">`;
  stages.forEach((label, i) => {
    const x = i * (w / 3) + 10;
    svg += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" style="fill:var(--card);stroke:var(--accent);stroke-width:1.5" />`;
    svg += `<foreignObject x="${x + 4}" y="${y}" width="${boxW - 8}" height="${boxH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:${tile ? 8 : 12}px;font-family:inherit;color:var(--text);line-height:1.25;">${escapeHtml(label)}</div></foreignObject>`;
    if (i < stages.length - 1) {
      const ax = x + boxW + 2;
      svg += `<line x1="${ax}" y1="${h / 2}" x2="${ax + 14}" y2="${h / 2}" style="stroke:var(--muted);stroke-width:2" marker-end="url(#arrow)" />`;
    }
  });
  svg += `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" style="fill:var(--muted)" /></marker></defs>`;
  svg += `</svg>`;
  return svg;
};

Site.svg.layers = function (variant) {
  const tile = variant === "tile";
  const w = tile ? 300 : 860;
  const rowH = tile ? 16 : 46;
  const gap = tile ? 3 : 8;
  const h = BLUEPRINT.layers.length * (rowH + gap);
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Components grouped into layers">`;
  BLUEPRINT.layers.forEach((layer, i) => {
    const y = i * (rowH + gap);
    const comps = BLUEPRINT.components.filter(c => c.layer === layer.id);
    svg += `<rect x="0" y="${y}" width="${w}" height="${rowH}" rx="6" style="fill:var(--bg);stroke:var(--border)" />`;
    const labelText = tile ? layer.label : `${layer.label}  —  ${comps.map(c => c.name).join(", ")}`;
    svg += `<foreignObject x="8" y="${y}" width="${w - 16}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:${tile ? 7 : 12}px;color:var(--text);"><strong style="color:var(--accent);margin-right:6px;">${escapeHtml(layer.label)}</strong>${tile ? "" : escapeHtml(comps.map(c => c.name).join(" · "))}</div></foreignObject>`;
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.ribbon = function (variant) {
  const tile = variant === "tile";
  const steps = BLUEPRINT.dataFlowSteps;
  const w = tile ? 300 : 900;
  const n = steps.length;
  const cw = w / n;
  const h = tile ? 90 : 170;
  const r = tile ? 8 : 16;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Data flow steps, AI step highlighted">`;
  steps.forEach((s, i) => {
    const cx = cw * i + cw / 2;
    const cy = h / 2 - (tile ? 10 : 20);
    const color = s.touchesModel ? "var(--info)" : "var(--accent)";
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${s.touchesModel ? "var(--info-bg)" : "var(--card)"};stroke:${color};stroke-width:2" />`;
    svg += `<text x="${cx}" y="${cy + (tile ? 3 : 5)}" text-anchor="middle" style="font-size:${tile ? 8 : 13}px;fill:${color};font-weight:700;font-family:inherit;">${s.step}</text>`;
    if (!tile) {
      svg += `<foreignObject x="${cx - cw / 2 + 4}" y="${cy + r + 6}" width="${cw - 8}" height="${h - (cy + r + 6)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:10px;color:var(--muted);text-align:center;line-height:1.3;">${escapeHtml(s.actor)}</div></foreignObject>`;
    }
    if (i < n - 1) {
      svg += `<line x1="${cx + r}" y1="${cy}" x2="${cx + cw - r}" y2="${cy}" style="stroke:var(--border);stroke-width:2" />`;
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.timeline = function (variant) {
  const tile = variant === "tile";
  const phases = BLUEPRINT.phases;
  const w = tile ? 300 : 860;
  const totalWeight = phases.reduce((s, p) => s + p.weight, 0);
  const barH = tile ? 12 : 34;
  const gap = tile ? 2 : 6;
  const h = phases.length * (barH + gap);
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Build phases, proportional, make-or-break highlighted">`;
  let x = 0;
  phases.forEach((p, i) => {
    const bw = Math.max(6, (p.weight / totalWeight) * w);
    const y = i * (barH + gap);
    const barW = tile ? bw : w;
    const fill = p.makeOrBreak ? "var(--risk-bg)" : "var(--card)";
    const stroke = p.makeOrBreak ? "var(--risk)" : "var(--border)";
    if (tile) {
      svg += `<rect x="${x}" y="0" width="${bw}" height="${h}" style="fill:${fill};stroke:${stroke}" />`;
      x += bw;
    } else {
      svg += `<rect x="0" y="${y}" width="${w}" height="${barH}" rx="6" style="fill:${fill};stroke:${stroke};stroke-width:1.5" />`;
      svg += `<rect x="0" y="${y}" width="${bw}" height="${barH}" rx="6" style="fill:${p.makeOrBreak ? "var(--risk)" : "var(--accent)"};opacity:0.18" />`;
      svg += `<foreignObject x="10" y="${y}" width="${w - 20}" height="${barH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:12px;color:var(--text);"><strong style="margin-right:8px;">P${p.order}</strong>${escapeHtml(p.name)}${p.makeOrBreak ? " — make or break" : ""}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.coverageGrid = function (variant) {
  const tile = variant === "tile";
  const reqs = BLUEPRINT.requirements;
  const phases = BLUEPRINT.phases;
  const w = tile ? 300 : 760;
  const labelW = tile ? 0 : 220;
  const cellW = (w - labelW) / phases.length;
  const cellH = tile ? (90 / reqs.length) : 40;
  const h = reqs.length * cellH;
  const statusClass = { covered: "coverage-cell-covered", partial: "coverage-cell-partial", none: "coverage-cell-none" };
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Requirement coverage by build phase">`;
  reqs.forEach((r, ri) => {
    const cov = BLUEPRINT.coverage.find(c => c.requirementId === r.id);
    if (!tile) {
      svg += `<foreignObject x="0" y="${ri * cellH}" width="${labelW - 8}" height="${cellH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:11px;color:var(--text);">${escapeHtml(r.label)}</div></foreignObject>`;
    }
    phases.forEach((p, pi) => {
      const status = cov.byPhase[p.id];
      const x = labelW + pi * cellW;
      const y = ri * cellH;
      svg += `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" class="${statusClass[status]}" stroke-width="1.5" />`;
      if (!tile) {
        svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" style="font-size:9px;fill:var(--text);font-family:inherit;">${status === "covered" ? "✓" : status === "partial" ? "½" : "—"}</text>`;
      }
    });
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.fork = function (variant) {
  const tile = variant === "tile";
  const w = tile ? 300 : 800, h = tile ? 90 : 220;
  const oq = BLUEPRINT.openQuestion;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Open question, two branches">`;
  const startX = w * 0.12, startY = h / 2;
  const midX = w * 0.4;
  const boxW = w * 0.42, boxH = tile ? 30 : 64;
  const topY = h * 0.18, botY = h * 0.62;
  svg += `<circle cx="${startX}" cy="${startY}" r="${tile ? 5 : 9}" style="fill:var(--accent)" />`;
  svg += `<line x1="${startX}" y1="${startY}" x2="${midX}" y2="${topY + boxH / 2}" style="stroke:var(--border);stroke-width:2" />`;
  svg += `<line x1="${startX}" y1="${startY}" x2="${midX}" y2="${botY + boxH / 2}" style="stroke:var(--border);stroke-width:2" />`;
  [{ y: topY, label: oq.branchA.label, on: true }, { y: botY, label: oq.branchB.label, on: false }].forEach(branch => {
    svg += `<rect x="${midX}" y="${branch.y}" width="${boxW}" height="${boxH}" rx="8" style="fill:${branch.on ? "var(--good-bg)" : "var(--card)"};stroke:${branch.on ? "var(--good)" : "var(--border)"};stroke-width:1.5" />`;
    if (!tile) {
      svg += `<foreignObject x="${midX + 8}" y="${branch.y}" width="${boxW - 16}" height="${boxH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:11px;color:var(--text);line-height:1.3;">${escapeHtml(branch.label)}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.gapList = function (variant) {
  const tile = variant === "tile";
  const items = BLUEPRINT.notCovered;
  const w = tile ? 300 : 760;
  const rowH = tile ? (90 / items.length) : 36;
  const h = items.length * rowH;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What this design does not cover">`;
  items.forEach((item, i) => {
    const y = i * rowH;
    svg += `<circle cx="${tile ? 8 : 12}" cy="${y + rowH / 2}" r="${tile ? 3 : 5}" style="fill:var(--neutral)" />`;
    if (!tile) {
      svg += `<foreignObject x="24" y="${y}" width="${w - 30}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:11px;color:var(--text);">${escapeHtml(item)}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

/* ============================== Ask panel ============================== */

Site.initAskPanel = function (pageId) {
  const root = qs("#ask-panel");
  root.innerHTML = `
    <button class="ask-fab" id="ask-fab" aria-label="Ask the blueprint">?</button>
    <div class="ask-window hidden" id="ask-window">
      <div class="ask-head"><strong>Ask the blueprint</strong><button class="icon-btn" id="ask-close">×</button></div>
      <div class="ask-mode-switch">
        <button class="active" data-mode="search">Search — no key</button>
        <button data-mode="claude">Claude — needs key</button>
      </div>
      <div class="ask-config hidden" id="ask-config">
        <input type="password" id="ask-api-key" placeholder="Anthropic API key (stored locally only)" />
        <select id="ask-model">
          <option value="claude-opus-5">claude-opus-5</option>
          <option value="claude-sonnet-5">claude-sonnet-5</option>
          <option value="claude-haiku-4-5">claude-haiku-4-5</option>
        </select>
        <select id="ask-scope">
          <option value="section">This section</option>
          <option value="whole">Whole blueprint</option>
        </select>
      </div>
      <div class="ask-body" id="ask-body">
        <div class="ask-answer-card"><div class="aq-section">Ready</div>Ask anything about this blueprint. Search mode works offline, no key needed.</div>
      </div>
      <div class="ask-input-row">
        <input type="text" id="ask-input" placeholder="e.g. what happens if the classifier goes down?" />
        <button id="ask-send">Ask</button>
      </div>
      <div class="offline-note">Search mode never leaves this browser. Claude mode calls api.anthropic.com directly with the key you paste — it is stored in localStorage on this machine only, never sent anywhere else.</div>
    </div>`;

  let mode = "search";
  const win = qs("#ask-window", root);
  qs("#ask-fab", root).addEventListener("click", () => win.classList.toggle("hidden"));
  qs("#ask-close", root).addEventListener("click", () => win.classList.add("hidden"));

  qsa(".ask-mode-switch button", root).forEach(btn => {
    btn.addEventListener("click", () => {
      mode = btn.getAttribute("data-mode");
      qsa(".ask-mode-switch button", root).forEach(b => b.classList.toggle("active", b === btn));
      qs("#ask-config", root).classList.toggle("hidden", mode !== "claude");
    });
  });

  const savedKey = localStorage.getItem("kb-anthropic-key");
  if (savedKey) qs("#ask-api-key", root).value = savedKey;
  qs("#ask-api-key", root).addEventListener("change", (e) => localStorage.setItem("kb-anthropic-key", e.target.value));

  const send = async () => {
    const input = qs("#ask-input", root);
    const query = input.value.trim();
    if (!query) return;
    input.value = "";
    const body = qs("#ask-body", root);

    if (mode === "search") {
      const results = Site.search(query, 6);
      if (results.length === 0) {
        body.innerHTML = `<div class="ask-answer-card">No matches in the blueprint for "${escapeHtml(query)}". Check the Coverage grid or Assumptions — a miss can itself be the answer.</div>` + body.innerHTML;
      } else {
        const cards = results.map(r => `<div class="ask-answer-card"><div class="aq-section">${escapeHtml(BLUEPRINT.pages.find(p => p.id === r.pageId).nav)}</div><strong>${escapeHtml(r.title)}</strong><div>${highlightSnippet(r.text, query)}</div><a href="${r.file}">Open section →</a></div>`).join("");
        body.innerHTML = cards + body.innerHTML;
      }
      return;
    }

    const key = qs("#ask-api-key", root).value.trim();
    const model = qs("#ask-model", root).value;
    const scope = qs("#ask-scope", root).value;
    if (!key) {
      body.innerHTML = `<div class="ask-error">No API key pasted. Switch to Search mode, or paste a key above.</div>` + body.innerHTML;
      return;
    }
    body.innerHTML = `<div class="ask-answer-card"><div class="aq-section">Working</div>Asking Claude…</div>` + body.innerHTML;
    try {
      const answer = await Site.askClaude(key, model, scope, pageId, query);
      body.innerHTML = `<div class="ask-answer-card"><div class="aq-section">Claude · ${escapeHtml(model)}</div>${escapeHtml(answer)}</div>` + body.innerHTML;
    } catch (err) {
      body.innerHTML = `<div class="ask-error">${escapeHtml(err.message)} — you can switch to Search mode, which needs no key and works offline.</div>` + body.innerHTML;
    }
  };

  qs("#ask-send", root).addEventListener("click", send);
  qs("#ask-input", root).addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
};

Site.askClaude = async function (apiKey, model, scope, pageId, question) {
  const scopedData = scope === "whole" ? BLUEPRINT : Site.sectionSlice(pageId);
  const system = "You are answering questions about a system-architecture blueprint called \"" + BLUEPRINT.meta.projectName +
    "\". Answer ONLY using the JSON data below. If the answer is not in the data, say so plainly and point the user at the Coverage or Assumptions section. Data:\n" +
    JSON.stringify(scopedData);

  const requestBody = { model: model, max_tokens: 16000, system: system, messages: [{ role: "user", content: question }] };
  if (model === "claude-opus-5" || model === "claude-sonnet-5") {
    requestBody.output_config = { effort: "low" };
  }

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (networkErr) {
    throw new Error("Lost connection to api.anthropic.com.");
  }

  if (res.status === 401) throw new Error("That API key was rejected (401).");
  if (res.status === 429) throw new Error("Rate limited by Anthropic (429). Try again shortly.");
  if (!res.ok) throw new Error("Anthropic API returned HTTP " + res.status + ".");

  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("Claude declined to answer that.");
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return text || "(empty response)";
};

Site.sectionSlice = function (pageId) {
  switch (pageId) {
    case "summary": return { meta: BLUEPRINT.meta };
    case "components": return { components: BLUEPRINT.components, layers: BLUEPRINT.layers };
    case "architecture": return { mermaidArchitecture: BLUEPRINT.mermaid.architecture, components: BLUEPRINT.components.map(c => c.name) };
    case "data-flow": return { dataFlowSteps: BLUEPRINT.dataFlowSteps, mermaidSequence: BLUEPRINT.mermaid.sequence };
    case "build-order": return { phases: BLUEPRINT.phases, requirements: BLUEPRINT.requirements, coverage: BLUEPRINT.coverage };
    case "assumptions": return { assumptions: BLUEPRINT.assumptions, openQuestion: BLUEPRINT.openQuestion };
    case "not-covered": return { notCovered: BLUEPRINT.notCovered };
    default: return BLUEPRINT;
  }
};

/* ============================== page renderers ============================== */

Site.renderCommandCenter = function () {
  const main = qs("#page-content");
  const m = BLUEPRINT.meta;
  main.innerHTML = `
    <div class="hero">
      <h1>${escapeHtml(m.projectName)}</h1>
      <p class="muted">${escapeHtml(m.tagline)}</p>
      <div class="callout critical"><strong>Must work well on day one:</strong> ${escapeHtml(m.mustDoWell)}</div>
    </div>
    <div class="tile-grid" id="tile-grid"></div>`;

  const grid = qs("#tile-grid");
  const tileMap = {
    summary: { svg: Site.svg.pipeline("tile"), count: "1 must-win requirement" },
    components: { svg: Site.svg.layers("tile"), count: BLUEPRINT.components.length + " components" },
    architecture: { svg: Site.svg.layers("tile"), count: BLUEPRINT.components.length + " nodes" },
    "data-flow": { svg: Site.svg.ribbon("tile"), count: BLUEPRINT.dataFlowSteps.length + " steps, 1 touches the model" },
    "build-order": { svg: Site.svg.timeline("tile"), count: BLUEPRINT.phases.length + " phases, 1 make-or-break" },
    assumptions: { svg: Site.svg.fork("tile"), count: BLUEPRINT.assumptions.length + " assumptions, 1 open question" },
    "not-covered": { svg: Site.svg.gapList("tile"), count: BLUEPRINT.notCovered.length + " deferred" }
  };

  BLUEPRINT.pages.filter(p => p.id !== "index").forEach(p => {
    const t = tileMap[p.id];
    const tile = el("a", { class: "tile", href: p.file });
    tile.innerHTML = `<div class="tile-svg">${t.svg}</div><h3>${escapeHtml(p.nav)}</h3><p>${escapeHtml(p.desc)}</p><div class="tile-count">${escapeHtml(t.count)}</div>`;
    grid.appendChild(tile);
  });
};

Site.renderSummary = function () {
  const m = BLUEPRINT.meta;
  qs("#page-content").innerHTML = `
    <h1>${escapeHtml(m.projectName)}</h1>
    <p class="muted">${escapeHtml(m.tagline)}</p>
    <div class="card">
      <h2 style="margin-top:0">The idea, as given</h2>
      <blockquote style="margin:0;padding-left:14px;border-left:3px solid var(--border);color:var(--text)">${escapeHtml(m.ideaParagraph)}</blockquote>
    </div>
    <div class="callout critical" data-search-text="${escapeHtml(m.mustDoWell)}">
      <strong>The sentence that outranks everything else:</strong><br />${escapeHtml(m.mustDoWell)}
      <br /><span class="muted">The component this depends on: <a href="02-components.html">AI Classification &amp; Urgency Service</a>.</span>
    </div>
    <div id="fig-pipeline"></div>`;
  Site.figure("fig-pipeline", "The idea as inputs → pipeline → output", "One customer email goes in; a correctly-prioritized ticket, sitting in front of the right agent, comes out.", (target) => { target.innerHTML = Site.svg.pipeline("full"); });
};

Site.renderComponents = function () {
  const rows = BLUEPRINT.components.map(c => `
    <tr data-search-text="${escapeHtml(c.name + " " + c.sentence)}">
      <td><strong>${escapeHtml(c.name)}</strong>${c.critical ? ' <span class="badge risk">critical</span>' : ""}</td>
      <td><span class="badge neutral">${escapeHtml(BLUEPRINT.layers.find(l => l.id === c.layer).label)}</span></td>
      <td>${c.builtByUs ? '<span class="badge good">we build it</span>' : '<span class="badge info">third party</span>'}</td>
      <td>${escapeHtml(c.sentence)}</td>
      <td class="muted">${escapeHtml(c.words)}</td>
    </tr>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Components</h1>
    <p class="muted">Every box here traces back to a specific clause in the idea paragraph. Nothing is here "just in case."</p>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr><th>Component</th><th>Layer</th><th>Ownership</th><th>What it does</th><th>Words that required it</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div id="fig-layers"></div>`;
  Site.figure("fig-layers", "Components grouped into layers", "Five layers, one external dependency, and a single AI layer doing exactly one job: scoring urgency.", (target) => { target.innerHTML = Site.svg.layers("full"); });
};

Site.renderArchitecture = function () {
  qs("#page-content").innerHTML = `
    <h1>How It Fits Together</h1>
    <p class="muted">The real request path: from a customer's inbox to an agent's screen.</p>
    <div id="fig-architecture"></div>`;
  Site.figure("fig-architecture", "System architecture", "An email becomes a queued ticket, gets scored for urgency, gets routed, and lands — sorted — in front of an agent; updates flow back the same way.", (target) => { Site.renderMermaidInto(target, BLUEPRINT.mermaid.architecture); });
};

Site.renderDataFlow = function () {
  const steps = BLUEPRINT.dataFlowSteps.map(s => `
    <div class="card" data-search-text="${escapeHtml(s.actor + " " + s.action)}" style="margin-bottom:10px;">
      <strong>${s.step}. ${escapeHtml(s.actor)}</strong> ${s.touchesModel ? '<span class="badge info">AI step</span>' : ""}
      <p style="margin:6px 0 0">${escapeHtml(s.action)}</p>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Data Flow</h1>
    <p class="muted">One real customer email, traced step by step.</p>
    <div id="fig-sequence"></div>
    <h2>Step by step</h2>
    ${steps}
    <div id="fig-ribbon"></div>`;

  Site.figure("fig-sequence", "Sequence diagram", "Every arrow is a real message crossing a real boundary — there is exactly one step where a model makes a judgment call.", (target) => { Site.renderMermaidInto(target, BLUEPRINT.mermaid.sequence); });
  Site.figure("fig-ribbon", "Steps colored by AI involvement", "Only step 4 touches the model; every other step is deterministic plumbing.", (target) => { target.innerHTML = Site.svg.ribbon("full"); });
};

Site.renderBuildOrder = function () {
  const phaseCards = BLUEPRINT.phases.map(p => `
    <div class="card" data-search-text="${escapeHtml(p.name + " " + p.proves)}" style="margin-bottom:10px;">
      <strong>Phase ${p.order}: ${escapeHtml(p.name)}</strong> ${p.makeOrBreak ? '<span class="badge risk">make or break</span>' : ""}
      <p style="margin:6px 0 0">${escapeHtml(p.proves)}</p>
      <p class="muted" style="margin:4px 0 0;font-size:0.8rem">Components: ${escapeHtml(p.componentIds.map(id => BLUEPRINT.components.find(c => c.id === id).name).join(", "))}</p>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Build Order</h1>
    <p class="muted">Five phases. Phase 2 is the one the day-one requirement lives or dies on.</p>
    <div id="fig-gantt"></div>
    <h2>Phases</h2>
    ${phaseCards}
    <div id="fig-timeline"></div>
    <h2>Coverage</h2>
    <p class="muted">Which requirement is actually satisfied after each phase ships.</p>
    <div id="fig-coverage"></div>`;

  Site.figure("fig-gantt", "Build order (gantt)", "Ingestion first so nothing is lost, classification second because that's the day-one bar, routing and the dashboard after.", (target) => { Site.renderMermaidInto(target, BLUEPRINT.mermaid.gantt); });
  Site.figure("fig-timeline", "Phases, proportional, make-or-break highlighted", "Phase 2 is drawn in the risk color deliberately — it's small, but everything else is worthless if it's wrong.", (target) => { target.innerHTML = Site.svg.timeline("full"); });
  Site.figure("fig-coverage", "Requirement coverage by phase", "Emergency-detection isn't real until Phase 2; full shift-history coverage isn't real until Phase 4.", (target) => { target.innerHTML = Site.svg.coverageGrid("full"); });
};

Site.renderAssumptions = function () {
  const cards = BLUEPRINT.assumptions.map(a => `
    <div class="card" data-search-text="${escapeHtml(a.text + " " + a.impact)}">
      <strong>${escapeHtml(a.text)}</strong>
      <p class="muted" style="margin:6px 0 0"><strong>Impact:</strong> ${escapeHtml(a.impact)}</p>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Assumptions</h1>
    <p class="muted">Where the idea left something genuinely ambiguous, here is the call made and why.</p>
    ${cards}
    <h2>The one question that would most change this design</h2>
    <div class="callout critical" data-search-text="${escapeHtml(BLUEPRINT.openQuestion.question)}">
      <strong>${escapeHtml(BLUEPRINT.openQuestion.question)}</strong>
      <p style="margin:8px 0 0"><span class="badge good">Assumed</span> ${escapeHtml(BLUEPRINT.openQuestion.branchA.label)} — ${escapeHtml(BLUEPRINT.openQuestion.branchA.impact)}</p>
      <p style="margin:8px 0 0"><span class="badge neutral">Alternative</span> ${escapeHtml(BLUEPRINT.openQuestion.branchB.label)} — ${escapeHtml(BLUEPRINT.openQuestion.branchB.impact)}</p>
    </div>
    <div id="fig-fork"></div>`;
  Site.figure("fig-fork", "Open question, two branches", "The top branch is what this design assumes; the bottom branch is what ships instead if that assumption is wrong.", (target) => { target.innerHTML = Site.svg.fork("full"); });
};

Site.renderNotCovered = function () {
  const items = BLUEPRINT.notCovered.map(n => `<li data-search-text="${escapeHtml(n)}" style="margin-bottom:8px;"><span class="badge neutral">out of scope</span> ${escapeHtml(n)}</li>`).join("");
  qs("#page-content").innerHTML = `
    <h1>What This Design Does Not Cover</h1>
    <p class="muted">Said honestly, up front, instead of discovered the hard way in week three.</p>
    <div class="card"><ul style="list-style:none;margin:0;padding:0">${items}</ul></div>
    <div id="fig-gap"></div>`;
  Site.figure("fig-gap", "Deferred scope", "Five things this design deliberately does not solve on day one.", (target) => { target.innerHTML = Site.svg.gapList("full"); });
};

/* ============================== page bootstrap ============================== */

Site.renderPage = function (pageId) {
  Site.initTheme();
  Site.renderNav(pageId);
  Site.renderBreadcrumbs(pageId);
  Site.renderFooter();
  Site.initScrollChrome();
  Site.initAskPanel(pageId);

  switch (pageId) {
    case "index": Site.renderCommandCenter(); break;
    case "summary": Site.renderSummary(); break;
    case "components": Site.renderComponents(); break;
    case "architecture": Site.renderArchitecture(); break;
    case "data-flow": Site.renderDataFlow(); break;
    case "build-order": Site.renderBuildOrder(); break;
    case "assumptions": Site.renderAssumptions(); break;
    case "not-covered": Site.renderNotCovered(); break;
  }

  Site.renderPrevNext(pageId);
};
