/* Support Inbox Triage — Tech Stack: shared rendering, nav, search, illustrations, Ask panel.
   Classic script, no ES module, no CDN. Reads the bare `STACK` identifier (not
   window.STACK). Declares the bare `Site` identifier for page scripts to call. */

const Site = {
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

const FIT_ICON = { green: "🟢", amber: "🟡", red: "🔴" };
const FIT_BADGE = { green: "good", amber: "warn", red: "risk" };
const FIT_LABEL = { green: "great fit", amber: "good fit", red: "consider carefully" };

function fitBadge(fit) {
  return `<span class="badge ${FIT_BADGE[fit]}">${FIT_ICON[fit]} ${escapeHtml(FIT_LABEL[fit])}</span>`;
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
};

/* ============================== nav / chrome ============================== */

Site.renderNav = function (pageId) {
  const nav = el("div", { class: "nav-inner" });

  const brand = el("a", { href: "index.html", class: "nav-brand" }, escapeHtml(STACK.meta.projectName));
  nav.appendChild(brand);

  const links = el("div", { class: "nav-links" });
  STACK.pages.filter(p => p.id !== "index").forEach(p => {
    const a = el("a", { href: p.file }, escapeHtml(p.nav));
    if (p.id === pageId) a.classList.add("active");
    links.appendChild(a);
  });
  nav.appendChild(links);

  const tools = el("div", { class: "nav-tools" });

  const searchWrap = el("div", { class: "search-wrap" });
  const searchInput = el("input", { id: "nav-search", type: "search", placeholder: "Search stack…", "aria-label": "Search tech stack" });
  const dropdown = el("div", { id: "search-dropdown", class: "hidden" });
  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(dropdown);
  tools.appendChild(searchWrap);

  const archLink = el("a", { class: "icon-btn", href: STACK.meta.architectureRef, title: "Open the architecture blueprint", "aria-label": "Open the architecture blueprint" }, "&#8617;");
  tools.appendChild(archLink);

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
  const page = STACK.pages.find(p => p.id === pageId);
  if (pageId === "index") { container.innerHTML = ""; return; }
  container.innerHTML = `<a href="index.html">Command Center</a> &rsaquo; <span>${escapeHtml(page.nav)}</span>`;
};

Site.renderPrevNext = function (pageId) {
  const container = qs("#section-footer");
  if (!container) return;
  const order = STACK.pages.filter(p => p.id !== "index");
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
  if (f) f.innerHTML = `${escapeHtml(STACK.meta.projectName)} &middot; generated ${escapeHtml(STACK.meta.generatedDate)} &middot; built with the tech-stack-recommender skill &middot; <a href="${STACK.meta.architectureRef}">${escapeHtml(STACK.meta.architectureLabel)} &rarr;</a>`;
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

/* ============================== copy buttons ============================== */

Site.copyText = function (text, btn) {
  const done = () => {
    const original = btn.getAttribute("data-label") || "Copy";
    btn.textContent = "Copied ✓";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = original; btn.classList.remove("copied"); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => Site.copyFallback(text, done));
  } else {
    Site.copyFallback(text, done);
  }
};

Site.copyFallback = function (text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { /* clipboard unavailable */ }
  document.body.removeChild(ta);
};

Site.initCopyButtons = function (root) {
  qsa(".copy-btn", root).forEach(btn => {
    btn.setAttribute("data-label", btn.textContent);
    btn.addEventListener("click", () => Site.copyText(btn.getAttribute("data-copy"), btn));
  });
};

Site.promptBox = function (promptText) {
  return `<div class="prompt-box"><div class="prompt-text">${escapeHtml(promptText)}</div><button class="copy-btn" data-copy="${escapeHtml(promptText)}">Copy</button></div>`;
};

/* ============================== search index ============================== */

const STOPWORDS = new Set(["the","a","an","and","or","of","to","in","on","for","with","is","are","it","this","that","by","as","be","was","were","so","if","its","at","from","into","your","you"]);

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

  entries.push({ pageId: "summary", file: "01-summary.html", title: "Headline", text: STACK.headline });
  STACK.leastConfident.forEach(l => {
    entries.push({ pageId: "summary", file: "01-summary.html", title: "Least confident: " + l.title, text: l.reason });
  });

  STACK.recommendations.forEach(r => {
    entries.push({ pageId: "recommendations", file: "02-recommendations.html", title: r.component + " — " + r.technology, text: r.why + " " + (r.caveat || "") });
  });

  entries.push({ pageId: "topology", file: "03-topology.html", title: "Topology", text: "what runs on your machine your code your data render vendors postmark anthropic claude" });

  STACK.learningPath.forEach(l => {
    entries.push({ pageId: "learning-path", file: "04-learning-path.html", title: "Step " + l.order + ": " + l.technology, text: l.reason });
  });

  STACK.alternatives.forEach(a => {
    entries.push({ pageId: "alternatives", file: "05-alternatives.html", title: "Instead of " + a.insteadOf + ": " + a.considered, text: a.whyNot });
  });

  STACK.reversibility.forEach(r => {
    entries.push({ pageId: "reversibility", file: "06-reversibility.html", title: r.label, text: r.items.join(", ") });
  });

  STACK.notCovered.forEach(n => {
    entries.push({ pageId: "not-covered", file: "07-not-covered.html", title: "Not covered", text: n });
  });

  STACK.recommendations.forEach(r => {
    entries.push({ pageId: "appendix", file: "08-appendix.html", title: "Prompt: " + r.technology, text: r.prompt });
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
    dropdown.innerHTML = `<div class="search-empty">No matches. Try Alternatives or Not Covered — a miss can itself be the answer.</div>`;
  } else {
    dropdown.innerHTML = results.map(r => `
      <a class="search-result" href="${r.file}">
        <div class="sr-section">${escapeHtml(STACK.pages.find(p => p.id === r.pageId).nav)}</div>
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

/* ============================== SVG illustrations (no CDN, inline only) ============================== */

Site.svg = {};

Site.svg.fitBands = function (variant) {
  const tile = variant === "tile";
  const recs = STACK.recommendations;
  const w = tile ? 300 : 860;
  const rowH = tile ? 8 : 34;
  const gap = tile ? 2 : 6;
  const h = recs.length * (rowH + gap);
  const fill = { green: "var(--good-bg)", amber: "var(--warn-bg)", red: "var(--risk-bg)" };
  const stroke = { green: "var(--good)", amber: "var(--warn)", red: "var(--risk)" };
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Every recommendation, colored by fit rating">`;
  recs.forEach((r, i) => {
    const y = i * (rowH + gap);
    svg += `<rect x="0" y="${y}" width="${w}" height="${rowH}" rx="5" style="fill:${fill[r.fit]};stroke:${stroke[r.fit]};stroke-width:1.5" />`;
    if (!tile) {
      svg += `<foreignObject x="10" y="${y}" width="${w - 20}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:12px;color:var(--text);"><strong style="margin-right:8px;">${FIT_ICON[r.fit]}</strong>${escapeHtml(r.component)} &nbsp;→&nbsp; ${escapeHtml(r.technology)}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.fitBar = function (variant) {
  const tile = variant === "tile";
  const c = STACK.meta.fitCounts;
  const total = c.green + c.amber + c.red;
  const w = tile ? 300 : 760, h = tile ? 50 : 90;
  const barY = tile ? 10 : 24, barH = tile ? 22 : 40;
  let x = 0;
  const segs = [
    { n: c.green, color: "var(--good)", label: "great fit" },
    { n: c.amber, color: "var(--warn)", label: "good fit" },
    { n: c.red, color: "var(--risk)", label: "consider carefully" }
  ];
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Proportion of recommendations by fit rating">`;
  svg += `<rect x="0" y="${barY}" width="${w}" height="${barH}" rx="8" style="fill:var(--bg);stroke:var(--border)" />`;
  segs.forEach(s => {
    if (s.n === 0) return;
    const segW = (s.n / total) * w;
    svg += `<rect x="${x}" y="${barY}" width="${segW}" height="${barH}" style="fill:${s.color}" />`;
    if (!tile) {
      svg += `<text x="${x + segW / 2}" y="${barY + barH / 2 + 5}" text-anchor="middle" style="font-size:13px;font-weight:700;fill:#fff;font-family:inherit;">${s.n}</text>`;
      svg += `<text x="${x + segW / 2}" y="${barY + barH + 18}" text-anchor="middle" style="font-size:10px;fill:var(--muted);font-family:inherit;">${escapeHtml(s.label)}</text>`;
    }
    x += segW;
  });
  svg += `<rect x="0" y="${barY}" width="${w}" height="${barH}" rx="8" style="fill:none;stroke:var(--border);stroke-width:1.5" />`;
  svg += `</svg>`;
  return svg;
};

Site.svg.topology = function (variant) {
  const tile = variant === "tile";
  const buckets = [
    { key: "yours", ...STACK.topology.yours, color: "var(--good)", bg: "var(--good-bg)" },
    { key: "managed", ...STACK.topology.managed, color: "var(--info)", bg: "var(--info-bg)" },
    { key: "vendor", ...STACK.topology.vendor, color: "var(--warn)", bg: "var(--warn-bg)" }
  ];
  const w = tile ? 300 : 860;
  const colW = w / buckets.length;
  const rowH = tile ? 14 : 32;
  const maxNodes = Math.max(...buckets.map(b => b.nodes.length));
  const h = tile ? 90 : (60 + maxNodes * (rowH + 6));
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What runs as your code, what is your data on managed infrastructure, and what is a vendor's server">`;
  buckets.forEach((b, bi) => {
    const x = bi * colW + 6;
    const boxW = colW - 12;
    svg += `<rect x="${x}" y="4" width="${boxW}" height="${h - 8}" rx="10" style="fill:${b.bg};stroke:${b.color};stroke-width:1.5;stroke-dasharray:${b.key === "vendor" ? "4,3" : "0"}" />`;
    if (!tile) {
      svg += `<foreignObject x="${x + 6}" y="10" width="${boxW - 12}" height="34"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px;font-weight:700;color:${b.color};line-height:1.3;">${escapeHtml(b.label)}</div></foreignObject>`;
      b.nodes.forEach((node, ni) => {
        const y = 48 + ni * (rowH + 6);
        svg += `<rect x="${x + 6}" y="${y}" width="${boxW - 12}" height="${rowH}" rx="6" style="fill:var(--card);stroke:var(--border)" />`;
        svg += `<foreignObject x="${x + 10}" y="${y}" width="${boxW - 20}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:10px;color:var(--text);line-height:1.2;">${escapeHtml(node)}</div></foreignObject>`;
      });
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.ladder = function (variant) {
  const tile = variant === "tile";
  const steps = STACK.learningPath;
  const w = tile ? 300 : 700;
  const rowH = tile ? (90 / steps.length) : 42;
  const gap = tile ? 0 : 6;
  const h = steps.length * (rowH + gap);
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What to learn first, in order">`;
  steps.forEach((s, i) => {
    const y = i * (rowH + gap);
    const indent = tile ? i * 4 : i * 14;
    const rw = w - indent - (tile ? 4 : 16);
    svg += `<rect x="${indent}" y="${y}" width="${rw}" height="${rowH}" rx="6" style="fill:var(--card);stroke:var(--accent);stroke-width:1.5" />`;
    if (!tile) {
      svg += `<foreignObject x="${indent + 10}" y="${y}" width="${rw - 20}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:12px;color:var(--text);"><strong style="color:var(--accent);margin-right:8px;">${s.order}.</strong>${escapeHtml(s.technology)}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.lockinScale = function (variant) {
  const tile = variant === "tile";
  const levels = STACK.reversibility;
  const w = tile ? 300 : 800;
  const colorMap = { easy: ["var(--good-bg)", "var(--good)"], medium: ["var(--warn-bg)", "var(--warn)"], hard: ["var(--risk-bg)", "var(--risk)"] };
  const colW = w / levels.length;
  const maxItems = Math.max(...levels.map(l => l.items.length));
  const itemH = tile ? 10 : 26;
  const h = tile ? 90 : (46 + maxItems * (itemH + 4));
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="How hard each decision is to undo, easy to hard">`;
  levels.forEach((lvl, li) => {
    const [bg, stroke] = colorMap[lvl.level];
    const x = li * colW + 5;
    const boxW = colW - 10;
    svg += `<rect x="${x}" y="2" width="${boxW}" height="${h - 4}" rx="10" style="fill:${bg};stroke:${stroke};stroke-width:1.5" />`;
    if (!tile) {
      svg += `<foreignObject x="${x + 6}" y="8" width="${boxW - 12}" height="34"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px;font-weight:700;color:${stroke};line-height:1.3;text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(lvl.level)}</div></foreignObject>`;
      lvl.items.forEach((item, ii) => {
        const y = 44 + ii * (itemH + 4);
        svg += `<foreignObject x="${x + 6}" y="${y}" width="${boxW - 12}" height="${itemH}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:9.5px;color:var(--text);line-height:1.2;">• ${escapeHtml(item)}</div></foreignObject>`;
      });
    }
  });
  svg += `</svg>`;
  return svg;
};

Site.svg.gapList = function (variant, items, label) {
  const tile = variant === "tile";
  items = items || STACK.notCovered;
  label = label || "What this document does not tell you";
  const w = tile ? 300 : 760;
  const rowH = tile ? (90 / items.length) : 44;
  const h = items.length * rowH;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(label)}">`;
  items.forEach((item, i) => {
    const y = i * rowH;
    svg += `<circle cx="${tile ? 8 : 12}" cy="${y + rowH / 2}" r="${tile ? 3 : 5}" style="fill:var(--neutral)" />`;
    if (!tile) {
      svg += `<foreignObject x="24" y="${y}" width="${w - 30}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;align-items:center;font-size:11px;color:var(--text);line-height:1.3;">${escapeHtml(item)}</div></foreignObject>`;
    }
  });
  svg += `</svg>`;
  return svg;
};

/* ============================== Ask panel ============================== */

Site.initAskPanel = function (pageId) {
  const root = qs("#ask-panel");
  root.innerHTML = `
    <button class="ask-fab" id="ask-fab" aria-label="Ask the stack">?</button>
    <div class="ask-window hidden" id="ask-window">
      <div class="ask-head"><strong>Ask the stack</strong><button class="icon-btn" id="ask-close">×</button></div>
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
          <option value="whole">Whole stack</option>
        </select>
      </div>
      <div class="ask-body" id="ask-body">
        <div class="ask-answer-card"><div class="aq-section">Ready</div>Ask anything about this tech stack. Search mode works offline, no key needed.</div>
      </div>
      <div class="ask-input-row">
        <input type="text" id="ask-input" placeholder="e.g. why not Redis for the queue?" />
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
        body.innerHTML = `<div class="ask-answer-card">No matches in the stack for "${escapeHtml(query)}". Check Alternatives or Not Covered — a miss can itself be the answer.</div>` + body.innerHTML;
      } else {
        const cards = results.map(r => `<div class="ask-answer-card"><div class="aq-section">${escapeHtml(STACK.pages.find(p => p.id === r.pageId).nav)}</div><strong>${escapeHtml(r.title)}</strong><div>${highlightSnippet(r.text, query)}</div><a href="${r.file}">Open section →</a></div>`).join("");
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
  const scopedData = scope === "whole" ? STACK : Site.sectionSlice(pageId);
  const system = "You are answering questions about a tech-stack recommendation called \"" + STACK.meta.projectName +
    "\". Answer ONLY using the JSON data below. If the answer is not in the data, say so plainly and point the user at the Alternatives or Not Covered section. Never talk the user out of a 🔴 (consider-carefully) rating — if asked, explain the risk more clearly instead. Data:\n" +
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
    case "summary": return { headline: STACK.headline, leastConfident: STACK.leastConfident, ratingKey: STACK.ratingKey };
    case "recommendations": return { recommendations: STACK.recommendations, groups: STACK.groups };
    case "topology": return { topology: STACK.topology };
    case "learning-path": return { learningPath: STACK.learningPath };
    case "alternatives": return { alternatives: STACK.alternatives };
    case "reversibility": return { reversibility: STACK.reversibility };
    case "not-covered": return { notCovered: STACK.notCovered };
    case "appendix": return { recommendations: STACK.recommendations.map(r => ({ technology: r.technology, prompt: r.prompt })), fitCounts: STACK.meta.fitCounts };
    default: return STACK;
  }
};

/* ============================== page renderers ============================== */

Site.renderCommandCenter = function () {
  const main = qs("#page-content");
  const m = STACK.meta;
  main.innerHTML = `
    <div class="hero">
      <h1>${escapeHtml(m.projectName)}</h1>
      <p class="muted">${escapeHtml(m.tagline)}</p>
      <div class="callout critical"><strong>Where this stack is most likely to break:</strong> ${escapeHtml(STACK.headline)}</div>
    </div>
    <div class="tile-grid" id="tile-grid"></div>`;

  const grid = qs("#tile-grid");
  const c = m.fitCounts;
  const tileMap = {
    summary: { svg: Site.svg.fitBar("tile"), count: (c.green + c.amber + c.red) + " recommendations, " + c.red + " to watch" },
    recommendations: { svg: Site.svg.fitBands("tile"), count: STACK.recommendations.length + " components" },
    topology: { svg: Site.svg.topology("tile"), count: "3 trust boundaries" },
    "learning-path": { svg: Site.svg.ladder("tile"), count: STACK.learningPath.length + " steps, in order" },
    alternatives: { svg: Site.svg.gapList("tile", STACK.alternatives.map(a => a.insteadOf + " vs. " + a.considered), "Alternatives considered"), count: STACK.alternatives.length + " alternatives considered" },
    reversibility: { svg: Site.svg.lockinScale("tile"), count: STACK.reversibility.reduce((s, l) => s + l.items.length, 0) + " decisions rated" },
    "not-covered": { svg: Site.svg.gapList("tile"), count: STACK.notCovered.length + " gaps stated" },
    appendix: { svg: Site.svg.fitBar("tile"), count: STACK.recommendations.length + " copy-ready prompts" }
  };

  STACK.pages.filter(p => p.id !== "index").forEach(p => {
    const t = tileMap[p.id];
    const tile = el("a", { class: "tile", href: p.file });
    tile.innerHTML = `<div class="tile-svg">${t.svg}</div><h3>${escapeHtml(p.nav)}</h3><p>${escapeHtml(p.desc)}</p><div class="tile-count">${escapeHtml(t.count)}</div>`;
    grid.appendChild(tile);
  });
};

Site.renderSummary = function () {
  const rows = STACK.ratingKey.map(r => `<tr><td>${r.icon}</td><td><strong>${escapeHtml(r.label)}</strong></td><td class="muted">${escapeHtml(r.desc)}</td></tr>`).join("");
  const confCards = STACK.leastConfident.map(l => `<div class="card" data-search-text="${escapeHtml(l.title + " " + l.reason)}"><strong>${escapeHtml(l.title)}</strong><p class="muted" style="margin:6px 0 0">${escapeHtml(l.reason)}</p></div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>${escapeHtml(STACK.meta.projectName)}</h1>
    <p class="muted">${escapeHtml(STACK.meta.tagline)}</p>
    <h2>Fit-rating key</h2>
    <div class="card" style="overflow-x:auto"><table><tbody>${rows}</tbody></table></div>
    <h2>Where this stack is most likely to break</h2>
    <div class="callout critical" data-search-text="${escapeHtml(STACK.headline)}">${escapeHtml(STACK.headline)}</div>
    <div id="fig-fitbar"></div>
    <h2>Calls this document is least confident about</h2>
    ${confCards}`;
  Site.figure("fig-fitbar", "Fit ratings, proportionally", "Most of this stack is a confident 🟢. The 🔴 is called out on purpose, not hedging.", (target) => { target.innerHTML = Site.svg.fitBar("full"); });
};

Site.renderRecommendations = function () {
  const groupsHtml = STACK.groups.map(g => {
    const items = STACK.recommendations.filter(r => r.group === g.id);
    const cards = items.map(r => `
      <div class="rec-card fit-${r.fit}" data-search-text="${escapeHtml(r.component + " " + r.technology + " " + r.why + " " + (r.caveat || ""))}">
        <div class="rec-top">
          <div><div class="rec-component">${escapeHtml(r.component)}${r.fromDataFlow ? ' <span class="badge info">from data flow</span>' : ""}</div><div class="rec-tech">${escapeHtml(r.technology)}</div></div>
          ${fitBadge(r.fit)}
        </div>
        <p class="rec-why">${escapeHtml(r.why)}</p>
        ${r.caveat ? `<div class="rec-caveat"><strong>Caveat:</strong> ${escapeHtml(r.caveat)}</div>` : ""}
        ${Site.promptBox(r.prompt)}
      </div>`).join("");
    return `<h2>${escapeHtml(g.label)}</h2><p class="muted" style="margin-top:-4px">${escapeHtml(g.desc)}</p>${cards}`;
  }).join("");

  qs("#page-content").innerHTML = `
    <h1>Recommendations</h1>
    <p class="muted">One real, current technology per component from <a href="${STACK.meta.architectureRef}">the architecture</a>, plus what the data flow needs that the component list never named.</p>
    <div id="fig-bands"></div>
    ${groupsHtml}`;
  Site.figure("fig-bands", "The whole stack, colored by fit", "Green dominates; the one red band is exactly the component the project's day-one promise rests on.", (target) => { target.innerHTML = Site.svg.fitBands("full"); });
  Site.initCopyButtons(qs("#page-content"));
};

Site.renderTopology = function () {
  const buckets = [
    { key: "yours", ...STACK.topology.yours, badge: "good" },
    { key: "managed", ...STACK.topology.managed, badge: "info" },
    { key: "vendor", ...STACK.topology.vendor, badge: "warn" }
  ];
  const cards = buckets.map(b => `
    <div class="card">
      <span class="badge ${b.badge}">${escapeHtml(b.label)}</span>
      <ul style="margin:10px 0 0;padding-left:18px">${b.nodes.map(n => `<li style="margin-bottom:4px">${escapeHtml(n)}</li>`).join("")}</ul>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Topology</h1>
    <p class="muted">What runs as code you wrote, what's your data sitting on infrastructure a vendor manages, and what's a server you'll never touch.</p>
    <div id="fig-topology"></div>
    <div class="tile-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${cards}</div>`;
  Site.figure("fig-topology", "What runs on your machine versus somebody else's", "Everything in the left two boxes is Render's Web Service and managed Postgres, in your account. The dashed box on the right is out of your hands entirely — plan for it to fail sometimes.", (target) => { target.innerHTML = Site.svg.topology("full"); });
};

Site.renderLearningPath = function () {
  const cards = STACK.learningPath.map(l => `
    <div class="card" data-search-text="${escapeHtml(l.technology + " " + l.reason)}" style="margin-bottom:10px;">
      <strong>${l.order}. ${escapeHtml(l.technology)}</strong>
      <p style="margin:6px 0 0">${escapeHtml(l.reason)}</p>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Learning Path</h1>
    <p class="muted">Eight technologies, in the order they'll actually make sense to learn.</p>
    <div id="fig-ladder"></div>
    ${cards}`;
  Site.figure("fig-ladder", "Learning ladder", "Each rung assumes the one below it. Skipping straight to the AI classifier without knowing Postgres and Express first will make the fallback logic hard to reason about.", (target) => { target.innerHTML = Site.svg.ladder("full"); });
};

Site.renderAlternatives = function () {
  const rows = STACK.alternatives.map(a => `
    <tr data-search-text="${escapeHtml(a.insteadOf + " " + a.considered + " " + a.whyNot)}">
      <td><strong>${escapeHtml(a.insteadOf)}</strong></td>
      <td>${escapeHtml(a.considered)}</td>
      <td>${escapeHtml(a.whyNot)}</td>
    </tr>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Alternatives Considered</h1>
    <p class="muted">Nothing here was the only option. This is what lost, and why.</p>
    <div id="fig-alternatives"></div>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr><th>Instead of</th><th>Considered</th><th>Why not</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  Site.figure("fig-alternatives", "What was considered instead", "Every runner-up here lost for a stated reason tied to this project's actual scale, not a general opinion about the technology.", (target) => { target.innerHTML = Site.svg.gapList("full", STACK.alternatives.map(a => a.insteadOf + " → considered " + a.considered), "Alternatives considered"); });
};

Site.renderReversibility = function () {
  const cards = STACK.reversibility.map(l => `
    <div class="card" data-search-text="${escapeHtml(l.label + " " + l.items.join(" "))}">
      <strong>${escapeHtml(l.label)}</strong>
      <ul style="margin:10px 0 0;padding-left:18px">${l.items.map(i => `<li style="margin-bottom:4px">${escapeHtml(i)}</li>`).join("")}</ul>
    </div>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Reversibility</h1>
    <p class="muted">How hard each decision above is to undo, from a one-file swap to a full rebuild.</p>
    <div id="fig-lockin"></div>
    ${cards}`;
  Site.figure("fig-lockin", "Lock-in scale", "The two “hard” rows — the backend runtime and the database — are exactly the two things to be most sure about before writing much code.", (target) => { target.innerHTML = Site.svg.lockinScale("full"); });
};

Site.renderNotCovered = function () {
  const items = STACK.notCovered.map(n => `<li data-search-text="${escapeHtml(n)}" style="margin-bottom:8px;"><span class="badge neutral">not covered</span> ${escapeHtml(n)}</li>`).join("");
  qs("#page-content").innerHTML = `
    <h1>What This Document Does Not Tell Me</h1>
    <p class="muted">Said honestly, up front, instead of discovered the hard way after the first Anthropic invoice.</p>
    <div class="card"><ul style="list-style:none;margin:0;padding:0">${items}</ul></div>
    <div id="fig-gap"></div>`;
  Site.figure("fig-gap", "Stated gaps", "Six things a technology recommendation cannot answer on its own.", (target) => { target.innerHTML = Site.svg.gapList("full"); });
};

Site.renderAppendix = function () {
  const rows = STACK.recommendations.map((r, i) => `
    <tr data-search-text="${escapeHtml(r.technology + " " + r.prompt)}">
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.technology)}</strong></td>
      <td>${Site.promptBox(r.prompt)}</td>
    </tr>`).join("");

  qs("#page-content").innerHTML = `
    <h1>Appendix — Every Prompt, One Table</h1>
    <p class="muted">Every copy-ready prompt from the Recommendations page, collected in one place.</p>
    <div id="fig-fitbar-appendix"></div>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Technology</th><th>Prompt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  Site.figure("fig-fitbar-appendix", "Fit-rating breakdown", `${STACK.meta.fitCounts.green} great fit · ${STACK.meta.fitCounts.amber} good fit · ${STACK.meta.fitCounts.red} consider carefully.`, (target) => { target.innerHTML = Site.svg.fitBar("full"); });
  Site.initCopyButtons(qs("#page-content"));
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
    case "recommendations": Site.renderRecommendations(); break;
    case "topology": Site.renderTopology(); break;
    case "learning-path": Site.renderLearningPath(); break;
    case "alternatives": Site.renderAlternatives(); break;
    case "reversibility": Site.renderReversibility(); break;
    case "not-covered": Site.renderNotCovered(); break;
    case "appendix": Site.renderAppendix(); break;
  }

  Site.renderPrevNext(pageId);
};
