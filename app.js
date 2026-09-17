const BADGE = {
  PASS: "bp",
  PASS_CHANGED: "bc",
  "PASS(변경 감지)": "bc",
  FAIL: "bf",
  ERROR: "be",
};

let CATALOG = null;
let FILTER = "all";
let SCREEN_FILTER = "all";
let SEARCH = "";
const PAGE_SIZE = 10;
const CASE_PAGES = { home: 1, cases: 1 };
let CASE_HIST_RUN = null;

function badge(v) {
  if (!v) return `<span class="badge bn">미실행</span>`;
  const cls = BADGE[v] || "bn";
  const label = v === "PASS_CHANGED" || v === "PASS(변경 감지)" ? "PASS (변경 감지)" : v;
  return `<span class="badge ${cls}">${label}</span>`;
}

function when(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { hour12: false });
  } catch {
    return iso;
  }
}

function countsOf(obj) {
  const c = obj || {};
  return {
    PASS: c.PASS || 0,
    CHANGE: c.PASS_CHANGED || c["PASS(변경 감지)"] || 0,
    FAIL: c.FAIL || 0,
    ERROR: c.ERROR || 0,
  };
}

function verdictKey(v) {
  if (!v) return "NONE";
  if (v === "PASS_CHANGED" || v === "PASS(변경 감지)") return "CHANGE";
  return v;
}

function tcTally() {
  const all = caseList();
  const out = { PASS: 0, CHANGE: 0, FAIL: 0, ERROR: 0, NONE: 0, total: all.length };
  for (const tc of all) {
    const k = verdictKey(tc.latest && tc.latest.verdict);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function page() {
  const h = location.hash.replace(/^#/, "") || "/home";
  const parts = h.split("/").filter(Boolean);
  return { name: parts[0] || "home", id: decodeURIComponent(parts.slice(1).join("/") || "") };
}

function go(path) {
  location.hash = path.startsWith("/") ? path : "/" + path;
}

function apiBase() {
  const configured = String(window.STE_BTV_API || "").replace(/\/$/, "");
  if (configured) return configured;
  if (/github\.io$/i.test(location.hostname)) return "";
  if (location.protocol === "http:" || location.protocol === "https:") {
    if (location.port === "8080" || location.port === "") return location.origin;
  }
  return "";
}

function mediaSrc(src) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  let path = String(src).replace(/^\//, "");
  if (path.startsWith("api/shots/")) {
    path = "data/shots/" + path.slice("api/shots/".length);
  }
  // ref-shots 는 항상 view 정적 파일 — API/index/shots 누락과 무관하게 표시
  if (path.startsWith("data/ref-shots/")) {
    return path;
  }
  const base = apiBase();
  if (CATALOG && CATALOG.source === "sqlite" && base) {
    if (path.startsWith("data/shots/")) {
      const rest = path.slice("data/shots/".length);
      return base + "/api/shots/" + rest;
    }
    return base + "/" + path;
  }
  return path;
}

function shotSrc(name) {
  const file = String(name || "")
    .split(/[/\\]/)
    .pop()
    .trim();
  if (!file) return "";
  return "data/ref-shots/" + file;
}

async function load() {
  const tries = [];
  const base = apiBase();
  if (base) tries.push(base + "/api/catalog");
  tries.push("data/catalog.json");
  let last = new Error("catalog.json 없음");
  for (const url of tries) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(url + " " + res.status);
      CATALOG = await res.json();
      if (!CATALOG.source) CATALOG.source = url.includes("/api/catalog") ? "sqlite" : "snapshot";
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function render() {
  const { name, id } = page();
  document.querySelectorAll(".nav button").forEach((b) => {
    b.classList.toggle("on", b.dataset.page === name);
  });
  const srcLabel = CATALOG.source === "sqlite" ? "랩 SQLite" : "스냅샷";
  document.getElementById("generated").textContent = CATALOG
    ? `${srcLabel} · ${when(CATALOG.generated_at)}`
    : "";
  const app = document.getElementById("app");
  if (!CATALOG) {
    app.innerHTML = `<p class="muted">랩에서 publish_view 후 data/catalog.json 이 생깁니다.</p>`;
    return;
  }
  if (name === "chat") {
    openChat();
    go("/home");
    return;
  }
  if (name === "docs") app.innerHTML = id ? renderDoc(id) : renderDocs();
  else if (name === "cases") {
    if (!id) CASE_HIST_RUN = null;
    app.innerHTML = id ? renderCase(id) : renderCases();
  }   else if (name === "process") {
    app.innerHTML = renderProcess(id);
    bind();
    fillProcessShots();
    return;
  } else if (name === "runs") app.innerHTML = id ? renderRun(id) : renderHome();
  else app.innerHTML = renderHome();
  bind();
}

function runSeries(timeline) {
  const runs = [...(timeline || [])].reverse();
  return runs.map((x) => {
    const c = countsOf(x.counts);
    const pass = c.PASS + c.CHANGE;
    const total = pass + c.FAIL + c.ERROR;
    return {
      run: x.run || {},
      pass,
      change: c.CHANGE,
      fail: c.FAIL,
      error: c.ERROR,
      total,
      results: x.results || [],
    };
  });
}

function trendChart(timeline) {
  const series = runSeries(timeline);
  if (!series.length) return `<div class="chart empty muted">실행 회차가 없습니다.</div>`;
  const w = 720;
  const h = 330;
  const l = 40;
  const r = 16;
  const t = 18;
  const b = 32;
  const iw = w - l - r;
  const ih = h - t - b;
  const ymax = Math.max(1, ...series.map((s) => Math.max(s.pass, s.fail, s.error, s.total)));
  const step = Math.max(1, Math.ceil(ymax / 5));
  const yMaxNice = step * Math.ceil(ymax / step);
  const n = series.length;
  const maxGap = 72;
  const span = n <= 1 ? 0 : Math.min(iw, (n - 1) * maxGap);
  const x0 = l + (iw - span) / 2;
  const xAt = (i) => (n === 1 ? l + iw / 2 : x0 + (i / (n - 1)) * span);
  const yAt = (v) => t + ih - (v / yMaxNice) * ih;
  const pathFor = (key, color) => {
    const d = series.map((s, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(s[key]).toFixed(1)}`).join(" ");
    const dots = series
      .map(
        (s, i) =>
          `<circle class="chart-dot" data-run="${s.run.id}" data-i="${i}" cx="${xAt(i)}" cy="${yAt(s[key])}" r="4.5" fill="${color}"></circle>`
      )
      .join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2"></path>${dots}`;
  };
  const yTicks = [];
  for (let v = 0; v <= yMaxNice; v += step) {
    yTicks.push(
      `<line x1="${l}" y1="${yAt(v)}" x2="${l + iw}" y2="${yAt(v)}" stroke="var(--hairline)" stroke-dasharray="3 4"></line>
       <text class="chart-y" x="${l - 8}" y="${yAt(v) + 4}" text-anchor="end">${v}</text>`
    );
  }
  const xLabels = series
    .map((s, i) => `<text class="chart-x" x="${xAt(i)}" y="${h - 10}" text-anchor="middle">#${s.run.id}</text>`)
    .join("");
  const tipRows = series
    .map((s, i) => {
      const whenRun = when(s.run.started_at);
      return `<div class="chart-tip" data-tip="${i}" hidden>
        <b>#${s.run.id} · ${whenRun}</b>
        <div>PASS ${s.pass - s.change}</div>
        <div>변경 감지 ${s.change}</div>
        <div>FAIL ${s.fail}</div>
        <div>ERROR ${s.error}</div>
        <div>총 ${s.total}건</div>
      </div>`;
    })
    .join("");
  return `<div class="chart trend-chart">
      <div class="chart-head"><b>회차별 테스트 결과 추이</b>
        <span class="chart-legend"><i class="lg pass"></i>PASS <i class="lg fail"></i>FAIL <i class="lg error"></i>ERROR</span>
      </div>
      <div class="chart-svg-wrap">
        <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="회차별 PASS FAIL ERROR 추이">
          ${yTicks.join("")}
          <line x1="${l}" y1="${t}" x2="${l}" y2="${t + ih}" stroke="var(--hairline)"></line>
          <line x1="${l}" y1="${t + ih}" x2="${l + iw}" y2="${t + ih}" stroke="var(--hairline)"></line>
          ${pathFor("pass", "var(--brand)")}
          ${pathFor("fail", "#c0392b")}
          ${pathFor("error", "#8a8d96")}
          ${xLabels}
        </svg>
        ${tipRows}
      </div>
    </div>`;
}

function donutPanel(c) {
  const pass = c.PASS || 0;
  const change = c.CHANGE || 0;
  const fail = c.FAIL || 0;
  const error = c.ERROR || 0;
  const total = Math.max(1, pass + change + fail + error);
  const parts = [
    { key: "PASS", n: pass, color: "var(--brand)" },
    { key: "CHANGE", n: change, color: "var(--public-blue)" },
    { key: "FAIL", n: fail, color: "#c0392b" },
    { key: "ERROR", n: error, color: "#8a8d96" },
  ];
  let acc = 0;
  const segs = parts
    .filter((p) => p.n > 0)
    .map((p) => {
      const start = (acc / total) * 360;
      acc += p.n;
      const end = (acc / total) * 360;
      return `${p.color} ${start}deg ${end}deg`;
    })
    .join(", ");
  const rate = Math.round(((pass + change) / total) * 100);
  return `<div class="donut-card">
      <div class="chart-head"><b>최신 테스트 결과</b><span class="muted">통과율 ${rate}%</span></div>
      <div class="donut-body">
        <div class="donut" style="background:conic-gradient(${segs || "var(--hairline) 0deg 360deg"})">
          <div class="donut-hole"><strong>${pass + change + fail + error}</strong><span>전체 TC</span></div>
        </div>
        <div class="donut-legend">
          <button type="button" class="leg-row" data-filter="PASS"><span class="sw pass"></span><span>PASS</span><b>${pass}</b><em>기준 일치</em></button>
          <button type="button" class="leg-row" data-filter="CHANGE"><span class="sw change"></span><span>변경 감지</span><b>${change}</b><em>PASS 특수 · UI 다름</em></button>
          <button type="button" class="leg-row" data-filter="FAIL"><span class="sw fail"></span><span>FAIL</span><b>${fail}</b><em>기능 결함</em></button>
          <button type="button" class="leg-row" data-filter="ERROR"><span class="sw error"></span><span>ERROR</span><b>${error}</b><em>전제·판독 불가</em></button>
        </div>
      </div>
    </div>`;
}

function coverageTable() {
  const cov = CATALOG.coverage || {};
  const rows = cov.rows || [];
  if (!rows.length) return "";
  return `<section class="section">
    <div class="sectionhead"><h2>구현·실기 현황</h2><div class="desc muted">${escHtml(cov.note || "mock PASS ≠ 실기 검증")}</div></div>
    <div class="card tablewrap"><table>
      <thead><tr><th>TC</th><th>BDD</th><th>Step</th><th>Page</th><th>Mock</th><th>실기 조작</th><th>실기 판정</th><th>10회</th><th>판정 근거</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr data-go="/cases/${encodeURIComponent(r.tc_id)}">
              <td class="tcid">${escHtml(r.tc_id)}</td>
              <td>${escHtml(r.bdd)}</td>
              <td>${escHtml(r.step)}</td>
              <td>${escHtml(r.page)}</td>
              <td>${badge(r.mock === "미실행" ? "" : r.mock)}</td>
              <td>${escHtml(r.real_nav)}</td>
              <td>${badge(r.real_judge === "미검증" ? "" : r.real_judge)}</td>
              <td>${escHtml(r.repeat10)}</td>
              <td class="muted">${escHtml(r.evidence || "")}${r.deferred && r.deferred.length ? " · 보류 " + escHtml(r.deferred.join(", ")) : ""}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table></div>
  </section>`;
}

function renderHome() {
  const run = CATALOG.latest_run || {};
  const c = tcTally();
  const device = CATALOG.device || {};
  const timeline = CATALOG.timeline || [];
  const whenRun = when(run.started_at || CATALOG.generated_at);
  const latestCounts = countsOf(CATALOG.counts || {});
  const latestTotal = latestCounts.PASS + latestCounts.CHANGE + latestCounts.FAIL + latestCounts.ERROR;
  const passShow = latestCounts.PASS + latestCounts.CHANGE;
  return `
    <header>
      <div class="eyebrow">테스트케이스 ${c.total}건</div>
      <h1>최신 판정</h1>
      <p class="dash-summary">최근 실행 <b>#${run.id || "—"}</b> · 총 <b>${latestTotal || c.total}</b>건 · PASS <b>${passShow || c.PASS + c.CHANGE}</b>(변경 ${latestCounts.CHANGE || c.CHANGE}) · FAIL <b>${latestCounts.FAIL || c.FAIL}</b> · ERROR <b>${latestCounts.ERROR || c.ERROR}</b> · ${CATALOG.mode === "mock" ? "mock 실행" : CATALOG.mode === "real" ? "실기 실행" : "모드 미기록"}</p>
    </header>
    <section class="dash-grid">
      ${donutPanel(c)}
      ${trendChart(timeline)}
    </section>
    <div class="card runinfo">
      <div class="kv"><span>최근 회차</span><b>#${run.id || "—"} · ${whenRun}${run.trigger ? " · " + run.trigger : ""}</b></div>
      <div class="kv"><span>대상 단말</span><b>${device.model || "—"} · ${device.serial || ""}</b></div>
      <div class="kv"><span>연결 / 실기검증</span><b>${device.connected ? "연결됨" : "미확인"} / ${device.verified ? "실기 검증 완료" : "실기 미검증"}</b></div>
    </div>
    ${coverageTable()}
    <section class="section">
      <div class="sectionhead"><h2>테스트케이스</h2><div class="desc muted">${c.total}건 · 각 TC의 최신 판정</div></div>
      ${caseTable(caseList(), { scope: "home" })}
    </section>
  `;
}

function renderRun(id) {
  const runId = String(id || "");
  const item = (CATALOG.timeline || []).find((x) => String((x.run || {}).id) === runId);
  if (!item) {
    return `<button class="btn" type="button" data-go="/home">← 홈</button><p class="muted">회차 #${escHtml(runId)} 없음</p>`;
  }
  const c = countsOf(item.counts);
  const run = item.run || {};
  return `
    <button class="btn" type="button" data-go="/home">← 홈</button>
    <header>
      <div class="eyebrow">회차</div>
      <h1>#${escHtml(String(run.id))} · ${when(run.started_at)}</h1>
      <p class="muted">${escHtml(run.trigger || "")} · PASS ${c.PASS + c.CHANGE} · FAIL ${c.FAIL} · ERROR ${c.ERROR}</p>
    </header>
    <div class="card tablewrap"><table>
      <thead><tr><th>결과</th><th>TC</th><th>메시지</th></tr></thead>
      <tbody>
        ${(item.results || [])
          .map(
            (r) => `<tr data-go="/cases/${encodeURIComponent(r.tc_id)}">
              <td>${badge(r.verdict)}</td>
              <td class="tcid">${escHtml(r.tc_id)}</td>
              <td>${escHtml(r.message || r.title || "")}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table></div>`;
}

function screenOf(tc) {
  const specs = (CATALOG.docs || []).filter((d) => d.kind === "spec");
  const byRelated = specs.find((d) => (d.related_tcs || []).includes(tc.id));
  const byScreen = specs.find((d) => d.screen_id === tc.screen_id);
  const spec = byRelated || byScreen;
  const major = (spec && spec.major) || tc.major || "";
  const minor = (spec && spec.minor) || "";
  const title = minor && major ? `${major} · ${minor}` : (spec && spec.title) || tc.screen_id || "기타";
  return {
    id: (spec && spec.id) || tc.screen_id || "",
    screen_id: tc.screen_id || (spec && spec.screen_id) || "",
    major,
    minor,
    title,
  };
}

function screenOptions() {
  const seen = new Map();
  for (const d of (CATALOG.docs || []).filter((x) => x.kind === "spec")) {
    const title = d.minor && d.major ? `${d.major} · ${d.minor}` : d.title;
    seen.set(d.id || d.screen_id, title);
  }
  return [...seen.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

function caseTable(rows, opts = {}) {
  const scope = opts.scope || "cases";
  const pageSize = opts.pageSize || PAGE_SIZE;
  if (!rows.length) {
    CASE_PAGES[scope] = 1;
    return `<p class="muted">테스트케이스가 없습니다.</p>`;
  }
  const sorted = [...rows].sort((a, b) => {
    const sa = screenOf(a).title;
    const sb = screenOf(b).title;
    const byScreen = sa.localeCompare(sb, "ko");
    if (byScreen) return byScreen;
    return String(a.id).localeCompare(String(b.id), "ko");
  });
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let page = Math.min(Math.max(1, Number(CASE_PAGES[scope]) || 1), pages);
  CASE_PAGES[scope] = page;
  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);
  const from = start + 1;
  const to = start + slice.length;
  return `<div class="card tablewrap"><table>
    <thead><tr><th>결과</th><th>TC ID</th><th>분류</th><th>테스트 항목</th><th></th></tr></thead>
    <tbody>
      ${slice
        .map((tc) => {
          const L = tc.latest;
          const sites = Array.isArray(tc.start_ids) ? tc.start_ids.length : 0;
          const extra = tc.run_each_start && sites > 1 ? ` · ${sites}곳` : "";
          const cls = screenOf(tc);
          return `<tr data-go="/cases/${encodeURIComponent(tc.id)}">
            <td>${badge(L && L.verdict)}</td>
            <td class="tcid">${tc.id}</td>
            <td class="cls">${escHtml(cls.title)}</td>
            <td class="name"><b>${tc.title}</b><span>${escHtml(((tc.expect || "").split("\n")[0] || (L && L.message) || "") + extra)}</span></td>
            <td class="muted">›</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>
  <div class="pager" data-pager="${escHtml(scope)}">
    <span class="pager-meta">${from}–${to} / ${total}건</span>
    <div class="pager-btns">
      <button type="button" class="pager-btn" data-page-to="1" ${page <= 1 ? "disabled" : ""} aria-label="첫 페이지">«</button>
      <button type="button" class="pager-btn" data-page-to="${page - 1}" ${page <= 1 ? "disabled" : ""}>이전</button>
      <span class="pager-num">${page} / ${pages}</span>
      <button type="button" class="pager-btn" data-page-to="${page + 1}" ${page >= pages ? "disabled" : ""}>다음</button>
      <button type="button" class="pager-btn" data-page-to="${pages}" ${page >= pages ? "disabled" : ""} aria-label="마지막 페이지">»</button>
    </div>
  </div>`;
}

function styleGuideDoc() {
  const docs = CATALOG.docs || [];
  return (
    docs.find((d) => d.kind === "styleguide") ||
    docs.find((d) => d.id === "design/style-guide.md") ||
    docs.find((d) => String(d.title || "").includes("스타일 가이드")) || {
      id: "design/style-guide.md",
      title: "스타일 가이드",
      kind: "styleguide",
    }
  );
}

function pinNotice() {
  const bins = CATALOG.binaries || [];
  const ids = [
    "셋톱박스 테스트 자동화 기획서-V2.html",
    "셋톱박스 테스트 자동화 用 테스트케이스 예시-V1.html",
    "셋톱박스 테스트 자동화 기획서-V1.html",
  ];
  const pinned = ids.map((id) => bins.find((b) => b.id === id)).filter(Boolean);
  const rest = bins.filter((b) => !ids.includes(b.id));
  return [...pinned, ...rest];
}

/** 공지 고정 순서: 기획서 V2 → TC 예시 → 기획서 V1 → 스타일 가이드 → 그 외 */
function docsNotices() {
  const bins = pinNotice();
  const guide = styleGuideDoc();
  const guideNotice = {
    id: guide.id,
    title: guide.title || "스타일 가이드",
    kind: "styleguide",
    badge: "공통 기획 · 색·리모컨·컴포넌트",
    href: `/docs/${encodeURIComponent(guide.id)}`,
  };
  const asNotice = (b) => ({
    id: b.id,
    title: b.title,
    kind: b.kind,
    preview: b.preview,
    badge: "참고",
    href: b.preview ? `/docs/${encodeURIComponent("file:" + b.id)}` : "",
    fileHref: b.preview ? "" : b.href || "",
  });
  const head = bins.slice(0, 2).map(asNotice);
  const tail = bins.slice(2).map(asNotice);
  return [...head, guideNotice, ...tail];
}

function renderDocs() {
  const specs = (CATALOG.docs || []).filter((d) => d.kind === "spec");
  const notices = docsNotices();
  const byMajor = new Map();
  for (const d of specs) {
    const maj = d.major || "기획서";
    if (!byMajor.has(maj)) byMajor.set(maj, []);
    byMajor.get(maj).push(d);
  }
  const majorOrder = ["LiveTV", "VOD", "기획서"];
  const majors = [...byMajor.keys()].sort((a, b) => {
    const ia = majorOrder.indexOf(a);
    const ib = majorOrder.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  const noticeBtn = (n) => {
    const go = n.href || "";
    const dl =
      !go && n.preview === false && n.fileHref
        ? `<a class="muted" href="${mediaSrc(n.fileHref)}">다운로드</a>`
        : "";
    return `<button class="doc-item" type="button" ${go ? `data-go="${go}"` : ""}><span><b>${escHtml(n.title)}</b><span class="muted">${escHtml(n.badge || "참고")}</span></span><span class="muted">${dl || "열기"}</span></button>`;
  };
  return `
    <div class="docs-home">
    <header>
      <div class="eyebrow">기획</div>
      <h1>화면 명세</h1>
    </header>
    <section class="section docs-notice">
      <div class="sectionhead"><h2>공지</h2></div>
      <div class="doc-list">
        ${notices.map((n) => noticeBtn(n)).join("")}
      </div>
    </section>
    ${majors
      .map((maj) => {
        const rows = byMajor.get(maj) || [];
        rows.sort((a, b) => String(a.minor || a.title).localeCompare(String(b.minor || b.title), "ko"));
        const label = maj === "기타" ? "기획서" : maj;
        return `<section class="section docs-major">
      <div class="sectionhead"><h2>${escHtml(label)}</h2><div class="desc muted">${maj === "기타" ? "화면 명세" : "중분류"} ${rows.length}건</div></div>
      <div class="card tablewrap"><table>
        <thead><tr><th>중분류</th><th>승인</th><th>관련 TC</th><th>버전</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((d) => {
              const n = (d.related_tcs || []).length || tcsForScreen(d.screen_id).length;
              const approved = String(d.status || "") === "approved";
              return `<tr data-go="/docs/${encodeURIComponent(d.id)}">
                <td class="name"><b>${escHtml(d.minor || d.title)}</b><span>${escHtml(d.screen_id || d.id)}</span></td>
                <td>${approved ? `<span class="badge bp">승인</span>` : `<span class="badge bn">대기</span>`}</td>
                <td class="tcid">${n}건</td>
                <td class="muted">${d.version || "—"}</td>
                <td class="muted">›</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table></div>
    </section>`;
      })
      .join("")}
    </div>
  `;
}

function escHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return null;
  return {
    hex: h.toUpperCase(),
    css: `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`,
  };
}

function swatchHtml(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return escHtml("#" + String(hex || "").replace(/^#/, ""));
  return `<span class="swatch-wrap"><i class="swatch" style="background-color:${rgb.css}"></i><code class="hex">&#35;${rgb.hex}</code></span>`;
}

function parseCompAttrs(raw) {
  const out = {};
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq > 0) out[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1);
    else out[t.toLowerCase()] = true;
  }
  return out;
}

function renderComp(name, rawAttrs) {
  const a = parseCompAttrs(rawAttrs);
  const n = String(name || "").toLowerCase();
  const bg = (v, fallback) => {
    const rgb = hexToRgb(v || fallback);
    return rgb ? rgb.css : "rgb(100,100,100)";
  };
  if (n === "toggle") {
    const on = (!!a.on || a.state === "on" || a.state === "켜짐") && !a.off && a.state !== "off" && a.state !== "꺼짐";
    const label = on ? "켜짐" : "꺼짐";
    return `<span class="ui-comp ui-btv-toggle ${on ? "on" : "off"}" title="토글 ${label}"><span class="ui-btv-toggle-knob"></span><span class="ui-btv-toggle-txt">${label}</span></span>`;
  }
  if (n === "stepper") {
    return `<span class="ui-comp ui-stepper" title="스텝 ±"><button type="button" tabindex="-1" disabled>−</button><button type="button" tabindex="-1" disabled>+</button></span>`;
  }
  if (n === "progress") {
    const fill = Math.max(0, Math.min(1, parseFloat(a.fill || "0.35") || 0.35));
    return `<span class="ui-comp ui-progress" title="채움 ${Math.round(fill * 100)}%"><span class="ui-progress-track"><span class="ui-progress-fill" style="width:${fill * 100}%;background-color:${bg(a.color, "6B7CFF")}"></span></span></span>`;
  }
  if (n === "knob") {
    return `<span class="ui-comp ui-knob" style="background-color:${bg(a.color, "FFFFFF")}" title="노브"></span>`;
  }
  if (n === "pill") {
    const label = (a.label || a.text || "pill").replace(/_/g, " ");
    return `<span class="ui-comp ui-pill" style="background-color:${bg(a.color, "221A56")}" title="필 버튼">${escHtml(label)}</span>`;
  }
  if (n === "badge") {
    const label = a.label || a.text || "15";
    return `<span class="ui-comp ui-badge" style="background-color:${bg(a.color, "DD7430")}" title="뱃지">${escHtml(label)}</span>`;
  }
  if (n === "icon-btn") {
    const kind = String(a.kind || "ok").toLowerCase();
    const label = (a.label || "").replace(/_/g, " ");
    if (kind === "play" || kind === "pause") {
      const glyph = kind === "play" ? "▶" : "❚❚";
      const lab = label || (kind === "play" ? "재생" : "일시정지");
      return `<span class="ui-comp ui-playpause" title="${escHtml(lab)}"><span class="ui-playpause-btn">${glyph}</span><span class="ui-playpause-lab">${escHtml(lab)}</span></span>`;
    }
    const icons = { plus: "+", minus: "−", ok: "OK", search: "⌕", settings: "⚙", back: "←", exit: "✕" };
    return `<span class="ui-comp ui-icon-btn" title="아이콘 ${kind}">${icons[kind] || kind}</span>`;
  }
  if (n === "key") {
    const label = (a.label || a.text || "OK").replace(/_/g, " ");
    const role = { OK: "확인", 확인: "확인", 나가기: "EXIT", 이전: "BACK", 좌: "←", 우: "→", 상: "↑", 하: "↓" }[label] || "RCU";
    return `<span class="ui-comp ui-rcu-key" title="리모컨 ${escHtml(label)} (${role})"><span class="ui-rcu-cap">${escHtml(label)}</span></span>`;
  }
  if (n === "state") {
    const before = (a.before || "재생").replace(/_/g, " ");
    const after = (a.after || "일시정지").replace(/_/g, " ");
    const bGlyph = before.includes("일시") ? "❚❚" : before === "▶" || before === "재생" ? "▶" : before;
    const aGlyph = after.includes("일시") ? "❚❚" : after === "▶" || after === "재생" ? "▶" : after;
    const bLab = before === "▶" ? "재생" : before === "❚❚" ? "일시정지" : before;
    const aLab = after === "▶" ? "재생" : after === "❚❚" ? "일시정지" : after;
    return `<span class="ui-comp ui-state" title="상태 변화"><span class="ui-playpause"><span class="ui-playpause-btn">${escHtml(bGlyph)}</span><span class="ui-playpause-lab">${escHtml(bLab)}</span></span><span class="ui-state-arrow">→</span><span class="ui-playpause"><span class="ui-playpause-btn">${escHtml(aGlyph)}</span><span class="ui-playpause-lab">${escHtml(aLab)}</span></span></span>`;
  }
  if (n === "radio") {
    const on = !!a.on || !!a.selected;
    return `<span class="ui-comp ui-radio ${on ? "on" : ""}" title="라디오 ${on ? "선택" : "미선택"}"></span>`;
  }
  if (n === "check") {
    const on = !!a.on || !!a.selected;
    return `<span class="ui-comp ui-check ${on ? "on" : ""}" title="체크 ${on ? "켜짐" : "꺼짐"}">${on ? "✓" : ""}</span>`;
  }
  if (n === "focus") {
    const label = (a.label || a.text || "포커스").replace(/_/g, " ");
    return `<span class="ui-comp ui-focus" title="포커스 하이라이트">${escHtml(label)}</span>`;
  }
  if (n === "option-list" || n === "options") {
    const title = (a.title || "설정").replace(/_/g, " ");
    const desc = (a.desc || "").replace(/_/g, " ");
    const selected = (a.selected || "").replace(/_/g, " ");
    const focused = (a.focus || a.focused || "").replace(/_/g, " ");
    const rawOpts = a.options || a.items || "";
    const opts = String(rawOpts)
      .split(/[|,]/)
      .map((s) => s.trim().replace(/_/g, " "))
      .filter(Boolean);
    const rows = opts
      .map((opt) => {
        const on = selected ? opt === selected : false;
        const foc = focused ? opt === focused : false;
        return `<div class="ui-opt-row ${on ? "on" : ""} ${foc ? "focus" : ""}"><span>${escHtml(opt)}</span>${on ? '<span class="ui-opt-check">✓</span>' : ""}</div>`;
      })
      .join("");
    return `<div class="ui-comp ui-opt-panel" title="${escHtml(title)}"><div class="ui-opt-title">${escHtml(title)}</div>${
      desc ? `<div class="ui-opt-desc">${escHtml(desc)}</div>` : ""
    }<div class="ui-opt-list">${rows || '<div class="ui-opt-row muted">옵션 없음</div>'}</div></div>`;
  }
  if (n === "menu-rail") {
    const selected = (a.selected || "").replace(/_/g, " ");
    const mode = String(a.mode || a.state || "focus").toLowerCase(); // focus | selected
    const items = String(a.items || "AI_화질_설정|AI_사운드_설정|자막/해설/수어|시청_환경_설정")
      .split(/[|,]/)
      .map((s) => s.trim().replace(/_/g, " "))
      .filter(Boolean);
    const cls = mode === "selected" || mode === "drill" ? "selected" : "on";
    return `<div class="ui-comp ui-menu-rail">${items
      .map((it) => `<div class="ui-menu-item ${it === selected ? cls : ""}">${escHtml(it)}</div>`)
      .join("")}</div>`;
  }
  if (n === "poster" || n === "thumb" || n === "vod-card") {
    const label = (a.label || a.title || "회차").replace(/_/g, " ");
    const focused = !!(a.focus || a.on || a.selected);
    const ep = (a.ep || a.episode || "").replace(/_/g, " ");
    return `<div class="ui-comp ui-poster ${focused ? "focus" : ""}"><div class="ui-poster-img" style="${
      a.color ? `background:${escHtml(a.color)}` : ""
    }"></div><div class="ui-poster-meta"><b>${escHtml(label)}</b>${
      ep ? `<span>${escHtml(ep)}</span>` : ""
    }</div></div>`;
  }
  if (n === "detail-row") {
    const label = (a.label || a.text || "항목").replace(/_/g, " ");
    const focused = !!(a.focus || a.on);
    const trailing = a.toggle
      ? renderComp("toggle", a.toggle === "on" || a.toggle === "켜짐" ? "on" : "off")
      : a.arrow
        ? `<span class="ui-row-arrow">›</span>`
        : a.check
          ? `<span class="ui-opt-check">✓</span>`
          : "";
    return `<div class="ui-comp ui-detail-row ${focused ? "focus" : ""}"><span>${escHtml(label)}</span>${trailing}</div>`;
  }
  if (n === "shot") {
    const file = a.file || a.name || a.src || "";
    const caption = (a.caption || a.label || file).replace(/_/g, " ");
    const src = shotSrc(file.endsWith(".png") || file.endsWith(".jpg") ? file : `${file}.png`);
    if (!src) return `<span class="muted">샷 없음</span>`;
    return `<figure class="ui-shot"><img src="${src}" alt="${escHtml(caption)}"><figcaption>${escHtml(caption)}</figcaption></figure>`;
  }
  return `<code>{{comp:${escHtml(name)}}}</code>`;
}

function inlineFormat(text) {
  let s = String(text || "");
  const slots = [];
  const park = (html) => {
    const i = slots.length;
    slots.push(html);
    return `\uE000${i}\uE001`;
  };
  s = s.replace(/`#([0-9A-Fa-f]{6})`/g, (_, h) => park(swatchHtml(h)));
  s = s.replace(/#([0-9A-Fa-f]{6})\b/g, (_, h) => park(swatchHtml(h)));
  s = escHtml(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label) => label);
  s = s.replace(/\uE000(\d+)\uE001/g, (_, i) => slots[Number(i)] || "");
  return s;
}

function richText(text) {
  const src = String(text || "");
  const re = /\{\{comp:([a-z0-9-]+)([^}]*)\}\}|\{\{shot:([^\s}]+)([^}]*)\}\}/gi;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += inlineFormat(src.slice(last, m.index));
    if (m[1]) out += renderComp(m[1], m[2]);
    else out += renderComp("shot", `file=${m[3]}${m[4] || ""}`);
    last = m.index + m[0].length;
  }
  out += inlineFormat(src.slice(last));
  return out;
}

function enhanceHtml(html) {
  let s = String(html || "");
  s = s.replace(/\{\{comp:([a-z0-9-]+)([^}]*)\}\}/gi, (_, name, attrs) => renderComp(name, attrs));
  s = s.replace(/\{\{shot:([^\s}]+)([^}]*)\}\}/gi, (_, file, attrs) => renderComp("shot", `file=${file}${attrs || ""}`));
  s = s.replace(/<code>#([0-9A-Fa-f]{6})<\/code>/g, (_, h) => swatchHtml(h));
  return s;
}

function tcsForScreen(sid) {
  if (!sid) return [];
  const related = new Set();
  const spec = (CATALOG.docs || []).find((d) => d.kind === "spec" && d.screen_id === sid);
  (spec && spec.related_tcs ? spec.related_tcs : []).forEach((id) => related.add(id));
  return caseList().filter((tc) => tc.screen_id === sid || related.has(tc.id));
}

function parseNamedBlocks(text) {
  const out = [];
  let cur = null;
  let buf = [];
  const lead = [];
  for (const line of String(text || "").split(/\n/)) {
    const heading = line.match(/^###\s+(.+)/);
    if (heading) {
      if (cur) {
        cur.body = buf.join("\n").trim();
        out.push(cur);
      } else if (buf.length) {
        lead.push(buf.join("\n").trim());
      }
      cur = { title: heading[1].trim(), body: "" };
      buf = [];
      continue;
    }
    buf.push(line);
  }
  if (cur) {
    cur.body = buf.join("\n").trim();
    out.push(cur);
  } else if (buf.length) {
    lead.push(buf.join("\n").trim());
  }
  return { lead: lead.filter(Boolean).join("\n\n"), blocks: out };
}

function parseFeatures(text) {
  return parseNamedBlocks(text).blocks.map((b) => ({
    title: b.title,
    rules: b.body
      .split(/\n/)
      .map((l) => l.match(/^\s*[-*]\s+(.+)/))
      .filter(Boolean)
      .map((m) => m[1].trim()),
  }));
}

function featuresHtml(text, emptyLabel) {
  const { blocks } = parseNamedBlocks(text);
  if (!blocks.length) return sectionHtml(text);
  return `<div class="feat-list">${blocks
    .map((b) => {
      const body = String(b.body || "").trim();
      const inner = body
        ? `<div class="feat-body">${sectionHtml(body)}</div>`
        : `<p class="muted">${escHtml(emptyLabel || "내용 없음")}</p>`;
      return `<details class="feat">
        <summary>
          <span class="feat-chev" aria-hidden="true"></span>
          <span class="feat-name">${richText(b.title)}</span>
        </summary>
        ${inner}
      </details>`;
    })
    .join("")}</div>`;
}

function designHtml(text) {
  const raw = String(text || "").trim();
  if (!raw) return `<p class="muted">없음</p>`;
  const { lead, blocks } = parseNamedBlocks(raw);
  if (!blocks.length) return sectionHtml(raw);
  const leadHtml = lead ? `<div class="design-lead">${sectionHtml(lead)}</div>` : "";
  return `${leadHtml}<div class="feat-list">${blocks
    .map(
      (b) => `<details class="feat">
        <summary>
          <span class="feat-chev" aria-hidden="true"></span>
          <span class="feat-name">${richText(b.title)}</span>
        </summary>
        <div class="feat-body">${sectionHtml(b.body)}</div>
      </details>`
    )
    .join("")}</div>`;
}

function relatedTestsHtml(text, tcs) {
  const byId = new Map((tcs || []).map((tc) => [tc.id, tc]));
  const lines = String(text || "")
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => /^[-*]\s+/.test(s));
  if (lines.length) {
    return `<ul class="related-list">${lines
      .map((line) => {
        const body = line.replace(/^[-*]\s+/, "");
        const ids = body.match(/BTVTC-\d+/g) || [];
        let html = richText(body);
        for (const id of ids) {
          html = html.replace(
            new RegExp(id, "g"),
            `<button type="button" class="tc-link" data-go="/cases/${encodeURIComponent(id)}">${id}</button>`
          );
        }
        return `<li>${html}</li>`;
      })
      .join("")}</ul>`;
  }
  if (tcs && tcs.length) {
    return `<div class="hist">${tcs
      .map(
        (tc) =>
          `<button type="button" data-go="/cases/${encodeURIComponent(tc.id)}"><span>${badge(tc.latest && tc.latest.verdict)} <b>${tc.id}</b> ${escHtml(tc.title)}</span><span class="muted">›</span></button>`
      )
      .join("")}</div>`;
  }
  return `<p class="muted">연결된 테스트 없음</p>`;
}

function sectionHtml(text, asSteps) {
  const raw = String(text || "").trim();
  if (!raw) return `<p class="muted">없음</p>`;
  if (asSteps) return stepsHtml(raw);
  const lines = raw.split(/\n/);
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /---/.test(lines[i + 1] || "")) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i].trim());
        i += 1;
      }
      const cells = (row) => row.split("|").slice(1, -1).map((c) => c.trim());
      const headers = cells(block[0]);
      const rows = block.slice(2).map(cells);
      chunks.push(
        `<div class="tablewrap"><table><thead><tr>${headers.map((h) => `<th>${richText(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${richText(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }
    if (/^[-*]\s/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test((lines[i] || "").trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      chunks.push(`<ul class="spec-list">${items.map((l) => `<li>${richText(l)}</li>`).join("")}</ul>`);
      continue;
    }
    const prose = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*]\s/.test(lines[i].trim())
    ) {
      prose.push(lines[i].trim());
      i += 1;
    }
    chunks.push(`<div class="spec-prose">${prose.map(richText).join("<br>")}</div>`);
  }
  return chunks.join("") || `<p class="muted">없음</p>`;
}

function renderDoc(id) {
  if (id.startsWith("file:")) {
    const name = id.slice(5);
    const bin = (CATALOG.binaries || []).find((b) => b.id === name);
    if (!bin) return `<p>파일을 찾지 못했습니다.</p>`;
    if (!bin.preview) {
      return `<p>${bin.note || "미리보기 불가"}</p><p><a href="${mediaSrc(bin.href)}">${bin.title} 다운로드</a></p>`;
    }
    const isPdf = (bin.kind || "").includes("pdf");
    const href = mediaSrc(bin.href);
    return `
      <button class="btn" type="button" data-go="/docs">← 기획</button>
      <header style="margin-top:12px"><div class="eyebrow">참고 자료</div><h1>${bin.title}</h1></header>
      ${isPdf ? `<embed class="frame" src="${href}" type="application/pdf">` : `<iframe class="frame" src="${href}" title="${bin.title}"></iframe>`}
    `;
  }
  const doc =
    (CATALOG.docs || []).find((d) => d.id === id) ||
    (id === "design/style-guide.md" || String(id).includes("style-guide")
      ? styleGuideDoc()
      : null);
  if (!doc) return `<p>문서를 찾지 못했습니다.</p>`;
  if (doc.kind === "styleguide" || doc.id === "design/style-guide.md") return renderStyleGuide(doc);
  if (doc.kind === "spec") return renderSpec(doc);
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="doc-body">
      <div class="eyebrow">${doc.kind}</div>
      <h1>${doc.title}</h1>
      ${enhanceHtml(doc.html || "")}
    </article>
  `;
}

function renderStyleGuide(doc) {
  const colors = [
    ["#4A46FF", "레일 포커스(시작)"],
    ["#7A5CFF", "레일 포커스(끝)"],
    ["#4A90E2", "카드 포커스"],
    ["#7EB6FF", "재생바"],
    ["#DD7430", "연령 뱃지"],
    ["#221A56", "mobile Btv"],
    ["#FFFFFF", "본문/원"],
    ["#111111", "글리프"],
    ["#B0B0B0", "보조 글자"],
    ["#0C0D14", "패널 글래스"],
  ];
  const keys = [
    ["OK", "선택 · 재생/일시정지 · 오버레이·Wing 확정"],
    ["상", "포커스 위"],
    ["하", "포커스 아래 · 메뉴 칸 수"],
    ["좌", "좌측 Wing · 홈 메뉴 · 장면 탐색"],
    ["우", "우측 Wing · 장면 탐색 (미니 EPG면 Ai 시청 설정→OK)"],
    ["이전", "한 단계 뒤로 (BACK)"],
    ["나가기", "메뉴/오버레이 닫기 (EXIT)"],
  ];
  const comps = [
    {
      id: "play-pause",
      name: "재생 / 일시정지",
      preview: `${renderComp("icon-btn", "kind=play label=재생")} ${renderComp("icon-btn", "kind=pause label=일시정지")} ${renderComp("state", "before=▶ after=❚❚")}`,
      where: "VOD 오버레이 좌측 하단. 흰 원 + 검정 ▶/❚❚ + 라벨. 실측 샷과 동일.",
    },
    {
      id: "progress",
      name: "재생바",
      preview: `${renderComp("progress", "fill=0.35 color=#7EB6FF")} ${renderComp("knob", "color=#7EB6FF")}`,
      where: "VOD 하단. 채움·노브는 밝은 블루 #7EB6FF.",
    },
    {
      id: "toggle",
      name: "토글 (켜짐/꺼짐 문구)",
      preview: `${renderComp("toggle", "off")} ${renderComp("toggle", "on")}`,
      where: "자막·마케팅 배너·음성 다중 등. 트랙 안에 꺼짐/켜짐 문구. 문구 없는 iOS형 스위치로 그리면 틀림.",
    },
    {
      id: "option-list",
      name: "옵션 리스트",
      preview: renderComp(
        "option-list",
        "title=AI_클리어_보이스 selected=기본 focus=기본 options=사용_안_함|기본|크게|아주_크게"
      ),
      where: "우측 Wing 상세 패널. 라디오+✓. AI 사운드·음성 다중(한국어/영어) 등.",
    },
    {
      id: "menu-rail",
      name: "Wing 메뉴 레일",
      preview: `${renderComp(
        "menu-rail",
        "mode=focus selected=AI_사운드_설정 items=볼만한_콘텐츠|AI_사운드_설정|자막/해설/수어|시청_환경_설정|블루투스_연결"
      )} ${renderComp(
        "menu-rail",
        "mode=selected selected=AI_사운드_설정 items=볼만한_콘텐츠|AI_사운드_설정|자막/해설/수어|시청_환경_설정|블루투스_연결"
      )}`,
      where: "포커스=그라데이션. 상세 진입 후 부모=회색 하이라이트. 무료·AI 화질은 레일에 없음.",
    },
    {
      id: "detail-row",
      name: "상세 행",
      preview: `${renderComp("detail-row", "label=자막_보기 focus toggle=off")} ${renderComp("detail-row", "label=자막_스타일 arrow")}`,
      where: "우측 Wing 2depth. 포커스=밝은 테두리. 토글·›·✓ 는 행 끝.",
    },
    {
      id: "poster",
      name: "VOD · 회차 썸네일",
      preview: `${renderComp("poster", "label=1화 focus ep=무료")} ${renderComp("poster", "label=2화 ep=무료")} ${renderComp("poster", "label=3화")}`,
      where: "회차 목록·볼만한 콘텐츠 카드. 포커스=파란 링.",
    },
    {
      id: "home-rail",
      name: "홈 좌측 메뉴",
      preview: renderComp(
        "menu-rail",
        "selected=홈 items=무료|홈|Btv+|영화/시리즈|TV방송"
      ),
      where: "메인 홈 [좌]×2. 기본 포커스 홈. [하]×3 → TV방송.",
    },
    {
      id: "stepper",
      name: "± 스텝",
      preview: renderComp("stepper", ""),
      where: "배속 등 단계 조절.",
    },
    {
      id: "badge",
      name: "연령 뱃지",
      preview: renderComp("badge", "label=15 color=#DD7430"),
      where: "Clean A/V 좌상단.",
    },
    {
      id: "pill",
      name: "필 버튼",
      preview: `${renderComp("pill", "label=회차_목록 color=#333333")} ${renderComp("pill", "label=mobile_Btv color=#221A56")}`,
      where: "회차 목록·mobile Btv·메뉴 칩.",
    },
    {
      id: "focus",
      name: "포커스 링",
      preview: renderComp("focus", "label=카드"),
      where: "좌측 Wing 채널 카드 등.",
    },
    {
      id: "radio-check",
      name: "라디오 / 체크",
      preview: `${renderComp("radio", "on")} ${renderComp("radio", "")} ${renderComp("check", "on")} ${renderComp("check", "")}`,
      where: "선택·체크 상태 표시.",
    },
    {
      id: "key",
      name: "리모컨 키",
      preview: `${renderComp("key", "label=OK")} ${renderComp("key", "label=우")} ${renderComp("key", "label=나가기")}`,
      where: "기획 문서에서 조작을 설명할 때 사용.",
    },
  ];
  const typoRows = [
    ["Wing/홈 메뉴 라벨", "26–32px", "얇은 → 액티브 볼드"],
    ["2depth 제목", "28–34px", "볼드"],
    ["설명 문구", "20–24px", "보통 · #B0B0B0"],
    ["토글 문구", "11–14px", "볼드"],
  ];
  const railShot = shotSrc("wing-right-menu-171.png");
  const sec = doc.sections || {};
  const introRaw = String(sec["본문"] || "").replace(/^#\s*.+\n+/, "").trim();
  const intro =
    introRaw ||
    "셋톱 공용 색·타이포·리모컨·UI 부품. 화면 고유 치수만 각 spec에 적습니다.";
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="card case-sheet sg-page">
      <div class="case-head">
        <div>
          <div class="eyebrow">스타일 가이드 · 공용</div>
          <h1>${escHtml(doc.title || "스타일 가이드")}</h1>
          <div class="tcid">색 · 타이포 · 리모컨 · 컴포넌트 · 메뉴 레일</div>
        </div>
        <div class="muted">${escHtml(doc.version || "")}</div>
      </div>
      <div class="case-body">
        <section class="section">
          <p class="howto-p">${richText(intro)}</p>
          <p class="muted tip">관련: tokens · components · home-menu-rail · wing-right-banner</p>
        </section>
        <section class="section">
          <h2>판정</h2>
          <div class="tablewrap"><table class="sg-table">
            <thead><tr><th>어긋남</th><th>판정</th></tr></thead>
            <tbody>
              <tr><td>메뉴 존재·순서·라벨, 토글 on/off, 키 동작</td><td><span class="badge bf">FAIL</span> 기능</td></tr>
              <tr><td>색·폰트·여백·스킨·포커스 글로우</td><td><span class="badge bc">PASS(변경 감지)</span> 디자인</td></tr>
              <tr><td>신호 불량·전제 미충족</td><td><span class="badge be">ERROR</span></td></tr>
            </tbody>
          </table></div>
          <p class="muted tip">기준 캡처 1920×1080</p>
        </section>
        <section class="section">
          <h2>색</h2>
          <div class="sg-colors">
            ${colors
              .map(
                ([hex, name]) =>
                  `<div class="sg-color">${swatchHtml(hex)}<span>${escHtml(name)}<code class="hex">${escHtml(hex)}</code></span></div>`
              )
              .join("")}
          </div>
        </section>
        <section class="section">
          <h2>타이포</h2>
          <div class="tablewrap"><table class="sg-table">
            <thead><tr><th>용도</th><th>크기</th><th>두께</th></tr></thead>
            <tbody>
              ${typoRows
                .map(
                  ([a, b, c]) =>
                    `<tr><td>${escHtml(a)}</td><td>${escHtml(b)}</td><td>${escHtml(c)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table></div>
        </section>
        <section class="section">
          <h2>상태 · 액티브 / 논액티브</h2>
          <div class="sg-state-grid sg-state-grid-3">
            <div class="sg-state-card">
              <p class="howto-label">메뉴 레일 · 포커스</p>
              ${renderComp(
                "menu-rail",
                "mode=focus selected=자막/해설/수어 items=볼만한_콘텐츠|AI_사운드_설정|자막/해설/수어|시청_환경_설정|블루투스_연결"
              )}
              <p class="muted tip">포커스가 레일에 있을 때 · 그라데이션+볼드</p>
            </div>
            <div class="sg-state-card">
              <p class="howto-label">메뉴 레일 · 상세 진입</p>
              ${renderComp(
                "menu-rail",
                "mode=selected selected=자막/해설/수어 items=볼만한_콘텐츠|AI_사운드_설정|자막/해설/수어|시청_환경_설정|블루투스_연결"
              )}
              <p class="muted tip">상세로 들어간 뒤 부모 항목 · 회색 하이라이트+볼드</p>
            </div>
            <div class="sg-state-card">
              <p class="howto-label">상세 행 · 포커스</p>
              <div class="ui-comp ui-opt-panel">
                <div class="ui-opt-title">자막/해설/수어 설정</div>
                ${renderComp("detail-row", "label=자막_보기 focus toggle=off")}
                ${renderComp("detail-row", "label=음소거_시_자막_보기 toggle=off")}
                ${renderComp("detail-row", "label=자막_스타일 arrow")}
              </div>
              <p class="muted tip">행 포커스 = 밝은 테두리+옅은 채움+볼드 · 선택값은 ✓/토글</p>
            </div>
          </div>
        </section>
        <section class="section">
          <h2>리모컨</h2>
          <p class="muted tip">물리 리모컨 느낌의 키. 셋톱 논리 키와 1:1.</p>
          <div class="sg-remote-wrap">
            <div class="sg-remote" aria-hidden="true">
              <div class="sg-remote-power"></div>
              <div class="sg-dpad">
                <span class="sg-d up">▲</span>
                <span class="sg-d left">◀</span>
                <span class="sg-d ok">OK</span>
                <span class="sg-d right">▶</span>
                <span class="sg-d down">▼</span>
              </div>
              <div class="sg-remote-row">
                <span class="sg-rb">이전</span>
                <span class="sg-rb">나가기</span>
              </div>
              <div class="sg-remote-row">
                <span class="sg-rb dim">홈</span>
                <span class="sg-rb dim">메뉴</span>
              </div>
            </div>
            <ul class="sg-keylist">
              ${keys
                .map(
                  ([k, role]) =>
                    `<li><span class="ui-comp ui-rcu-key"><span class="ui-rcu-cap">${escHtml(k)}</span></span><span>${escHtml(role)}</span></li>`
                )
                .join("")}
            </ul>
          </div>
        </section>
        <section class="section">
          <h2>우측 Wing 메뉴 레일 (ADB 실측)</h2>
          <ol class="howto-list">
            <li>볼만한 콘텐츠 (기본 포커스)</li>
            <li>AI 사운드 설정</li>
            <li>자막/해설/수어</li>
            <li>시청 환경 설정</li>
            <li>(조건부) 음성 다중 설정 — 171 등</li>
            <li>블루투스 연결</li>
          </ol>
          <p class="muted tip">상단 아이콘 멀티뷰·zem 키즈홈은 [하] 카운트에 넣지 않음. 레일에 무료 콘텐츠·AI 화질 없음.</p>
          <figure class="spec-hero">
            <img src="${railShot}" alt="우측 Wing 메뉴 레일 실측">
            <figcaption>171 채널 · 음성 다중 포함 · 2026-09-16 ADB</figcaption>
          </figure>
        </section>
        <section class="section">
          <h2>UI 컴포넌트</h2>
          <p class="muted tip">? 를 누르면 사용처가 나옵니다.</p>
          <div class="sg-comps">
            ${comps
              .map(
                (c) => `<div class="sg-comp">
                  <div class="sg-comp-main">
                    <b>${escHtml(c.name)}</b>
                    <div class="sg-comp-prev">${c.preview}</div>
                  </div>
                  <button type="button" class="sg-help" data-help="${escHtml(c.where)}" aria-label="설명">?</button>
                </div>`
              )
              .join("")}
          </div>
          <div class="sg-ref-shots">
            <p class="howto-label">실측 참고</p>
            <div class="shots">
              <figure class="shot"><img src="${shotSrc("wing-right-panel-caption.png")}" alt="자막 상세"><figcaption>상세 행 포커스</figcaption></figure>
              <figure class="shot"><img src="${shotSrc("wing-right-settings-enter-4.png")}" alt="상세 진입 레일"><figcaption>레일 · 상세 진입(회색)</figcaption></figure>
              <figure class="shot"><img src="${shotSrc("shots-129-player-nav3-s3-02.jpg")}" alt="회차 목록"><figcaption>회차 목록 필</figcaption></figure>
              <figure class="shot"><img src="${shotSrc("wing-right-menu-171.png")}" alt="볼만한"><figcaption>볼만한 콘텐츠 썸네일</figcaption></figure>
            </div>
          </div>
        </section>
      </div>
    </article>
    <div id="sg-pop" class="sg-pop" hidden></div>
  `;
}

function heroHtml(doc) {
  const shot = doc.hero_shot || "";
  if (!shot) return "";
  const file = shot.endsWith(".png") || shot.endsWith(".jpg") || shot.endsWith(".jpeg") ? shot : `${shot}.png`;
  const src = shotSrc(file);
  const cap = doc.hero_caption || "대표 화면";
  return `<section class="section spec-hero-sec">
      <h2>대표 화면</h2>
      <figure class="spec-hero">
        <img src="${src}" alt="${escHtml(cap)}">
        <figcaption>${escHtml(cap)}</figcaption>
      </figure>
    </section>`;
}

function renderSpec(doc) {
  const sec = doc.sections || {};
  const relatedIds = new Set(doc.related_tcs || []);
  const tcs = relatedIds.size
    ? caseList().filter((tc) => relatedIds.has(tc.id))
    : tcsForScreen(doc.screen_id);
  const notices = pinNotice().filter((b) => b.preview);
  const related = sec["관련 테스트"] || sec["케이스"] || "";
  const cls = [doc.major, doc.minor].filter(Boolean).join(" · ");
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="card case-sheet">
      <div class="case-head">
        <div>
          <div class="eyebrow">화면 명세${cls ? " · " + escHtml(cls) : ""}</div>
          <h1>${doc.title}</h1>
          <div class="tcid">${doc.screen_id || doc.id} · ${String(doc.status || "") === "approved" ? `<span class="badge bp">승인</span>` : `<span class="badge bn">${escHtml(doc.status || "대기")}</span>`}</div>
        </div>
        <div class="muted">${doc.version || ""}</div>
      </div>
      <div class="case-body">
        <div class="card runinfo spec-meta">
          <div class="kv"><span>화면 ID</span><b>${doc.screen_id || "—"}</b></div>
          <div class="kv"><span>승인 상태</span><b>${String(doc.status || "") === "approved" ? "approved (기준 반영)" : "대기 · baseline 미반영"}</b></div>
          <div class="kv"><span>관련 TC</span><b>${tcs.length}건</b></div>
        </div>
        ${(doc.sources || []).length
          ? `<section class="section"><h2>원본 문서</h2>
              <p class="muted tip">spec.md는 여러 형식 입력을 정규화한 최종 기준입니다. 아래가 등록된 원본입니다.</p>
              <ul class="howto-list">${(doc.sources || []).map((s) => `<li><code>${escHtml(s)}</code></li>`).join("")}</ul>
            </section>`
          : ""}
        ${heroHtml(doc)}
        <section class="section">
          <h2>기능</h2>
          ${featuresHtml(sec["기능"], "규칙 없음")}
        </section>
        <section class="section">
          <h2>디자인</h2>
          <p class="muted tip">불일치 → PASS(변경 감지). 폭·폰트·색을 기준으로 본다.</p>
          ${designHtml(sec["디자인"])}
        </section>
        <section class="section">
          <h2>시작</h2>
          ${sectionHtml(sec["시작"])}
        </section>
        <section class="section">
          <h2>조작</h2>
          ${sectionHtml(sec["조작"], true)}
        </section>
        <section class="section">
          <h2>전제</h2>
          ${sectionHtml(sec["전제"])}
        </section>
        <section class="section">
          <h2>관련 테스트</h2>
          <p class="muted tip">시작 경로·위치 반복은 각 TC와 starts.md에 있습니다.</p>
          ${relatedTestsHtml(related, tcs)}
        </section>
        <section class="section">
          <h2>참고</h2>
          ${sectionHtml(sec["참고"])}
          ${
            notices.length
              ? `<div class="hist">${notices
                  .map(
                    (b) =>
                      `<button type="button" data-go="/docs/${encodeURIComponent("file:" + b.id)}"><span><b>${escHtml(b.title)}</b></span><span class="muted">열기</span></button>`
                  )
                  .join("")}</div>`
              : ""
          }
        </section>
        <section class="section">
          <h2>변경이력</h2>
          ${sectionHtml(sec["변경이력"])}
        </section>
      </div>
    </article>
  `;
}

function caseList() {
  return CATALOG.cases || [];
}

function renderCases() {
  const rows = caseList().filter((tc) => {
    const v = (tc.latest && tc.latest.verdict) || "NONE";
    if (FILTER === "all") return true;
    if (FILTER === "NONE") return !tc.latest;
    if (FILTER === "CHANGE") return v === "PASS_CHANGED" || v === "PASS(변경 감지)";
    return v === FILTER;
  }).filter((tc) => {
    if (SCREEN_FILTER === "all") return true;
    const s = screenOf(tc);
    return s.id === SCREEN_FILTER || s.screen_id === SCREEN_FILTER;
  }).filter((tc) => {
    const q = SEARCH.trim().toLowerCase();
    if (!q) return true;
    const cls = screenOf(tc);
    return `${tc.id} ${tc.title} ${tc.steps || ""} ${cls.title} ${cls.id} ${tc.start || ""}`.toLowerCase().includes(q);
  });
  const t = tcTally();
  const screens = screenOptions();
  const verdictOpts = [
    ["all", `전체 (${t.total})`],
    ["PASS", `PASS (${t.PASS})`],
    ["CHANGE", `변경 감지 (${t.CHANGE})`],
    ["FAIL", `FAIL (${t.FAIL})`],
    ["ERROR", `ERROR (${t.ERROR})`],
    ["NONE", `미실행 (${t.NONE})`],
  ];
  return `
    <div class="page-compact">
    <header>
      <div class="eyebrow">테스트케이스 ${t.total}건</div>
      <h1>항목과 최신 판정</h1>
    </header>
    <div class="tools compact-tools">
      <label class="tool">판정
        <select id="filter-verdict">
          ${verdictOpts
            .map(([v, label]) => `<option value="${v}" ${FILTER === v ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
      <label class="tool">화면
        <select id="filter-screen">
          <option value="all" ${SCREEN_FILTER === "all" ? "selected" : ""}>전체</option>
          ${screens
            .map(
              (s) =>
                `<option value="${escHtml(s.id)}" ${SCREEN_FILTER === s.id ? "selected" : ""}>${escHtml(s.title)}</option>`
            )
            .join("")}
        </select>
      </label>
      <input class="search" id="q" placeholder="TC ID, 분류, 항목 검색" value="${SEARCH.replace(/"/g, "&quot;")}">
    </div>
    ${caseTable(rows, { scope: "cases" })}
    </div>
  `;
}

function parseSteps(text) {
  const groups = [];
  let cur = { title: "", steps: [] };
  let pending = null;
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const h = line.match(/^###\s+(.+)/);
    if (h) {
      if (pending) {
        cur.steps.push(pending);
        pending = null;
      }
      if (cur.steps.length || cur.title) groups.push(cur);
      cur = { title: h[1].trim(), steps: [] };
      continue;
    }
    const num = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (num) {
      if (pending) cur.steps.push(pending);
      pending = { title: num[2].trim(), detail: "" };
      continue;
    }
    if (pending && /^\s{2,}/.test(line)) {
      const bit = line.trim().replace(/^[-*]\s*/, "");
      pending.detail = pending.detail ? `${pending.detail} · ${bit}` : bit;
      continue;
    }
    if (pending) {
      cur.steps.push(pending);
      pending = null;
    }
    const loose = line.trim().replace(/^[-*]\s*/, "");
    if (loose) cur.steps.push({ title: loose, detail: "" });
  }
  if (pending) cur.steps.push(pending);
  if (cur.steps.length || cur.title) groups.push(cur);
  return groups.filter((g) => g.steps.length);
}

function stepStatusHtml(verdict) {
  if (!verdict) return "";
  const v = String(verdict);
  if (v === "PASS" || v === "PASS_CHANGED" || v === "PASS(변경 감지)") {
    return `<span class="step-status ok">정상</span>`;
  }
  if (v === "FAIL") return `<span class="step-status bad">실패</span>`;
  if (v === "ERROR") return `<span class="step-status err">ERROR</span>`;
  return `<span class="step-status">${escHtml(v)}</span>`;
}

function stepsHtml(text, verdict) {
  const groups = parseSteps(text);
  if (!groups.length) return `<p class="muted">단계 없음</p>`;
  let n = 0;
  const status = stepStatusHtml(verdict);
  return `<div class="steplist">${groups
    .map((g) => {
      const head = g.title ? `<div class="step-group">${escHtml(g.title)}</div>` : "";
      const rows = g.steps
        .map((s) => {
          n += 1;
          const detail = s.detail
            ? `<div class="step-detail">${richText(s.detail)}</div>`
            : "";
          return `<div class="step"><div class="num">${n}</div><div class="step-body"><div class="step-title">${richText(s.title)}</div>${detail}</div>${status}</div>`;
        })
        .join("");
      return head + rows;
    })
    .join("")}</div>`;
}

function proseHtml(text) {
  const raw = String(text || "").trim();
  if (!raw) return `<p class="muted">없음</p>`;
  return raw
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split(/\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
      if (!lines.length) return "";
      const allBullet = lines.every((l) => /^\s*[-*]\s+/.test(l));
      const allNum = lines.every((l) => /^\s*\d+\.\s+/.test(l));
      if (allBullet || allNum) {
        const tag = allNum ? "ol" : "ul";
        const items = lines
          .map((l) => `<li>${richText(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`)
          .join("");
        return `<${tag} class="howto-list">${items}</${tag}>`;
      }
      return `<p class="howto-p">${lines.map((l) => richText(l)).join("<br>")}</p>`;
    })
    .join("");
}

function shotsHtml(paths, highlightLast) {
  if (!paths || !paths.length) return `<p class="muted">첨부 화면 없음</p>`;
  return `<div class="shots">${paths
    .map((src, i) => {
      const name = src.split("/").pop();
      const mark = highlightLast && i === paths.length - 1 ? " · 실패 시점 후보" : "";
      const primary = mediaSrc(src);
      const refGuess = shotSrc(name);
      const onerr =
        refGuess && refGuess !== primary
          ? ` onerror="this.onerror=null;this.src='${refGuess.replace(/'/g, "%27")}';"`
          : "";
      return `<figure class="shot"><img src="${primary}" alt="${escHtml(name)}"${onerr}><figcaption>${escHtml(name)}${mark}</figcaption></figure>`;
    })
    .join("")}</div>`;
}

function beforeAfter(paths) {
  if (!paths || paths.length < 2) return "";
  const a = paths[0];
  const b = paths[paths.length - 1];
  return `<div class="compare">
    <figure class="shot"><img src="${mediaSrc(a)}" alt="before"><figcaption>이전 / 기준</figcaption></figure>
    <div class="arrow">→</div>
    <figure class="shot"><img src="${mediaSrc(b)}" alt="after"><figcaption>현재</figcaption></figure>
  </div>`;
}

function failPointOf(verdict, message) {
  if (verdict === "FAIL") return { kind: "function", detail: message || "" };
  if (verdict === "ERROR") return { kind: "error", detail: message || "" };
  if (verdict === "PASS_CHANGED" || verdict === "PASS(변경 감지)") return { kind: "ui", detail: message || "" };
  return null;
}

function shotUrlFor(name, shots) {
  if (!name) return "";
  const hit = (shots || []).find((s) => String(s).endsWith(name) || String(s).split("/").pop() === name);
  return hit ? mediaSrc(hit) : "";
}

function anchorsHtml(anchors) {
  const entries = Object.entries(anchors || {});
  if (!entries.length) return "";
  return `<ul class="anchor-list">${entries
    .map(([k, v]) => `<li class="${v ? "hit" : "miss"}">${v ? "확인" : "없음"} · ${escHtml(k)}</li>`)
    .join("")}</ul>`;
}

function readCard(rd, shots) {
  let url = rd.shot_url ? mediaSrc(rd.shot_url) : shotUrlFor(rd.shot, shots);
  if (rd.shot_preview === "mock-stub") url = "";
  const mockBadge =
    rd.shot_preview === "mock-stub" || (rd.metrics && rd.metrics.mock)
      ? `<p class="muted mock-badge">mock 실행 · 슬롯/OCR 기준 (stub PNG는 표시하지 않음)</p>`
      : "";
  const img = url
    ? `<figure class="shot read-shot"><img src="${url}" alt="${escHtml(rd.shot || "")}"><figcaption>${escHtml(rd.shot || rd.note || "샷")}</figcaption></figure>`
    : rd.shot
      ? `<p class="muted read-shot-name">${escHtml(rd.shot)}</p>${mockBadge}`
      : mockBadge;
  const boxes = (rd.boxes || [])
    .slice(0, 12)
    .map((b) => `${b.text || ""} (${b.confidence != null ? Number(b.confidence).toFixed(2) : "—"})`)
    .join(" · ");
  const metrics =
    rd.metrics && Object.keys(rd.metrics).length ? `<p class="ocr-metrics">${escHtml(JSON.stringify(rd.metrics))}</p>` : "";
  return `<div class="read-card">
    ${img}
    <div class="read-body">
      <p class="howto-label">${escHtml(rd.note || "화면 판독")}</p>
      ${anchorsHtml(rd.anchors)}
      <pre class="ocr-text">${escHtml(rd.ocr_text || "(텍스트 없음)")}</pre>
      ${boxes ? `<p class="muted">박스 ${escHtml(boxes)}</p>` : ""}
      ${metrics}
    </div>
  </div>`;
}

function bddFlowHtml(L, tc) {
  const shots = (L && L.shots) || [];
  const t = (L && L.trace) || (L && L.artifacts && L.artifacts.trace) || {};
  const stored = (tc && tc.bdd) || (L && L.artifacts && L.artifacts.bdd) || {};
  if (!t.steps || !t.steps.length) {
    const gherkin = stored.gherkin || "";
    const dbNote = gherkin
      ? `<pre class="gherkin-block">${escHtml(gherkin)}</pre>
         <p class="muted">이 시나리오는 랩 DB <code>bdd_scenarios</code>에 있습니다. 다음 실기 회차에 Step · Page · 샷 · OCR이 붙습니다.</p>`
      : `<p class="muted">이 회차에는 BDD 실행 기록이 없습니다. LIVE/VOD를 다시 실행하면 Gherkin 문장마다 Step · Page · 샷 · OCR이 붙습니다.</p>`;
    return `<section class="section bdd-section">
      <h2>실행 경로 · Gherkin → Page → 판독</h2>
      ${dbNote}
    </section>`;
  }
  const layers = (t.flow || ["Gherkin", "Step Definition", "Page 메서드", "ADB·OCR", "판정"])
    .map((x) => `<span class="flow-node">${escHtml(x)}</span>`)
    .join('<span class="flow-arrow">→</span>');
  const steps = t.steps
    .map((st) => {
      const keys = (st.keys || []).filter((k) => String(k).startsWith("press")).slice(-10);
      const reads = (st.reads || []).map((rd) => readCard(rd, shots)).join("");
      const devices = (st.devices || []).map((d) => `${d.action || ""} ${d.detail || ""}`.trim()).join(" · ");
      const stBadge =
        st.status === "FAIL" ? badge("FAIL") : st.status === "ERROR" ? badge("ERROR") : st.status === "PASS" ? badge("PASS") : "";
      return `<article class="bdd-step">
      <header>
        <span class="bdd-kw">${escHtml(st.kw || "")}</span>
        <b>${escHtml(st.text || "")}</b>
        ${stBadge}
      </header>
      <dl class="bdd-meta">
        <div><dt>Step Definition</dt><dd><code>${escHtml(st.step_def || "")}</code></dd></div>
        <div><dt>Page 메서드</dt><dd><code>${escHtml(st.page || "")}</code></dd></div>
        ${keys.length ? `<div><dt>ADB 키</dt><dd>${escHtml(keys.join(" → "))}</dd></div>` : ""}
        ${devices ? `<div><dt>기기</dt><dd>${escHtml(devices)}</dd></div>` : ""}
      </dl>
      ${st.detail ? `<p class="muted">${escHtml(st.detail)}</p>` : ""}
      ${reads}
    </article>`;
    })
    .join("");
  const gherkin = `기능: ${t.feature || ""}
  시나리오: ${t.scenario || ""}
${(t.steps || []).map((s) => `    ${s.kw}   ${s.text}`).join("\n")}`;
  return `<section class="section bdd-section">
    <h2>실행 경로 · Gherkin → Page → 판독</h2>
    <p class="muted tip">스위트가 아래 Gherkin을 위에서 아래로 실행합니다. 각 문장은 Step Definition → Page 메서드 → ADB/OCR 순입니다. 이미지와 OCR 텍스트가 그 순간의 화면 판독입니다.</p>
    <div class="bdd-head">
      <p><b>기능</b> ${escHtml(t.feature || "")} · <b>시나리오</b> ${escHtml(t.scenario || "")} · <b>Page</b> <code>${escHtml(t.page || "")}</code></p>
      <div class="bdd-layers">${layers}</div>
    </div>
    <pre class="gherkin-block">${escHtml(gherkin)}</pre>
    <div class="bdd-steps">${steps}</div>
  </section>`;
}

function fillShotBox(boxId, jsonUrl, dir, labels) {
  const box = document.getElementById(boxId);
  if (!box) return;
  fetch(jsonUrl, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { shots: [] }))
    .then((data) => {
      const shots = data.shots || [];
      if (!shots.length) {
        box.innerHTML = `<p class="muted">이 단계 실기 샷이 아직 없습니다.</p>`;
        return;
      }
      const ch = data.channel ? ` · 채널 ${escHtml(data.channel)}` : "";
      const result = data.result
        ? `<p class="muted">결과 scene=<b>${escHtml(data.result)}</b>${ch}</p>`
        : "";
      const figs = shots
        .map((s) => {
          const src = dir + s.file;
          const cap = `${labels[s.tag] || s.tag} · ${s.scene || ""}`;
          return `<figure class="shot"><img src="${src}" alt="${escHtml(cap)}"><figcaption>${escHtml(cap)} · ${escHtml(s.file)}</figcaption></figure>`;
        })
        .join("");
      box.innerHTML = result + `<div class="shots">${figs}</div>`;
    })
    .catch(() => {
      box.innerHTML = `<p class="muted">샷 목록을 읽지 못했습니다.</p>`;
    });
}

function fillProcessShots() {
  fillShotBox("proc-step-1-shot-list", "data/process/goto-live/shots.json", "data/process/goto-live/", {
    digit: "171 채널 입력",
    "digit-0": "171 채널 입력",
    ok: "[확인] 후 미니 EPG",
    "mini-epg": "[확인] 후 미니 EPG",
    ready: "시작 조건 완료",
  });
  fillShotBox("proc-step-2-shot-list", "data/process/open-right/shots.json", "data/process/open-right/", {
    right: "[우] 후 우측 Wing",
    epg: "미니 EPG",
    "epg-right": "[우] 미니 EPG",
    "ai-ok": "Ai 시청 설정 → 확인",
    "epg-close": "미니 EPG 닫음",
    retry: "[우] 재시도",
    wing: "우측 Wing",
    wake: "미니 EPG",
    target: "[하]×4 음성 다중 설정",
    "down-1": "[하] ×1",
    "down-2": "[하] ×2",
    "down-3": "[하] ×3",
    "down-4": "[하] ×4 음성 다중 설정",
  });
  fillShotBox("proc-step-4-shot-list", "data/process/assert-layout/shots.json", "data/process/assert-layout/", {
    ko: "한국어 기본 상세",
  });
  fillShotBox("proc-step-5-shot-list", "data/process/audio-multi/shots.json", "data/process/audio-multi/", {
    body: "본문 슬롯 열림",
    focus: "[확인] 후 한국어 하늘색 아웃라인",
    down: "[하] 후 영어 아웃라인",
    ko: "audio_multi(\"ko\") 한국어 설정",
    en: "audio_multi(\"en\") 영어 설정",
  });
}

function histRow(h, selected) {
  const on = selected ? " on" : "";
  return `<button type="button" class="hist-row${on}" data-hist-run="${escHtml(String(h.run_id))}"><span>${badge(h.verdict)} <b>회차 ${h.run_id}</b> ${when(h.started_at)}</span><span class="muted">${escHtml((h.message || "").slice(0, 80))}</span></button>`;
}

function renderProcess(id) {
  const tcId = id || "BTVTC-157249";
  const gherkin = `# language: ko
기능: 우측 Wing UI
  원 TC: BTVTC-157249
  Page: LiveWingPage

  시나리오: 음성 다중 설정을 확인한다
    조건   음성 다중 채널(171) 실시간 라이브 화면에 진입한다
    만일   우측 Wing을 열고 음성 다중 설정까지 이동한다
    그러면 타이틀·본문 슬롯에서 음성 다중 또는 한국어 옵션이 확인된다
    그리고 영어로 설정한다`;
  const note =
    tcId !== "BTVTC-157249"
      ? `<p class="muted">지금은 <b>BTVTC-157249</b>만 풀어 둡니다. 요청하신 TC는 ${escHtml(tcId)}입니다.</p>`
      : "";
  return `
    <article class="card case-sheet proc-sheet">
      <p class="eyebrow">프로세스 · BTVTC-157249</p>
      <h1>[LiveTV] 우측 Wing UI &gt; 음성 다중 설정</h1>
      <div class="tcid">BTVTC-157249 · LiveWingPage · 신호 복구 팝업 샷은 판정에서 제외</div>
      ${note}
      <p class="muted tip">1단계는 <code>goto_live("audio_multi")</code>로 171까지 갑니다. 2단계는 <code>open_right("audio_multi")</code>가 우측 Wing을 열고 메뉴 기준 <code>[하]</code> 횟수만큼 내립니다. 5번이 <code>audio_multi("ko"|"en")</code>입니다. 3번은 이번 회차에서 실행하지 않습니다.</p>
      <p><button class="btn" type="button" data-go="/cases/BTVTC-157249">테스트케이스 보기</button></p>

      <nav class="proc-toc" aria-label="순서 목차">
        <p class="howto-label">순서 목차</p>
        <ol>
          <li><button type="button" data-jump="proc-bdd">BDD — Gherkin이 러너에 들어오는 경로</button></li>
          <li><button type="button" data-jump="proc-page">Page — LiveWingPage가 하는 일</button></li>
        </ol>
      </nav>

      <section class="section proc-section" id="proc-bdd">
        <h2>1. BDD</h2>
        <p>BDD는 Markdown TC가 아니라 <code>bdd_map.py</code>의 시나리오 표입니다. 랩이 켜지면 SQLite <code>bdd_scenarios</code>에 심고, <code>bdd_features/BTVTC-157249.feature</code>로 내보냅니다. LIVE 스위트는 그 표를 읽어 <code>run_live_mapped</code>가 문장 순서대로 Page를 부릅니다.</p>
        <div class="bdd-layers">
          <span class="flow-node">bdd_map</span><span class="flow-arrow">→</span>
          <span class="flow-node">SQLite / .feature</span><span class="flow-arrow">→</span>
          <span class="flow-node">run_live_mapped</span><span class="flow-arrow">→</span>
          <span class="flow-node">LiveWingPage</span>
        </div>
        <p class="howto-label">이 TC의 Gherkin</p>
        <pre class="gherkin-block">${escHtml(gherkin)}</pre>
        <table class="proc-table">
          <thead><tr><th>문장</th><th>Step Definition</th><th>Page</th></tr></thead>
          <tbody>
            <tr>
              <td><b>조건</b> 음성 다중 채널(171) 실시간 라이브 화면에 진입한다</td>
              <td><code>goto_live("audio_multi")</code></td>
              <td><code>LiveWingPage.goto_live</code></td>
            </tr>
            <tr>
              <td><b>만일</b> 우측 Wing을 열고 음성 다중 설정까지 이동한다</td>
              <td><code>open_right("audio_multi")</code></td>
              <td><code>LiveWingPage.open_right</code></td>
            </tr>
            <tr>
              <td><b>그러면</b> 타이틀·본문 슬롯에서 음성 다중 또는 한국어 옵션이 확인된다</td>
              <td><code>assert_layout()</code></td>
              <td><code>LiveWingPage.assert_layout</code></td>
            </tr>
            <tr>
              <td><b>그리고</b> 영어로 설정한다</td>
              <td><code>audio_multi("en")</code></td>
              <td><code>LiveWingPage.audio_multi</code></td>
            </tr>
          </tbody>
        </table>
        <p class="muted">매핑 파일: <code>dev/src/ste_btv/runner/bdd_map.py</code> · 실행 함수: <code>runner/bdd_run.py</code> <code>run_live_mapped</code>. 스위트가 <code>LIVE</code> 또는 <code>BTVTC-157249</code>일 때만 이 경로가 탑니다.</p>
      </section>

      <section class="section proc-section" id="proc-page">
        <h2>2. Page</h2>
        <p>페이지 객체는 <code>LiveWingPage</code> 하나입니다. <code>tc_157249</code>가 메뉴를 찾고, 이어서 <code>assert_layout</code>이 <code>live-249.png</code>를 슬롯 OCR로 대조합니다. 골든샷 전체 비교는 하지 않습니다.</p>
        <table class="proc-table">
          <thead><tr><th>순서</th><th>메서드</th><th>동작</th></tr></thead>
          <tbody>
            <tr>
              <td>
                <div class="proc-num">
                  <button type="button" class="proc-toggle" data-toggle="proc-step-1-shots" aria-expanded="false" aria-label="goto_live 샷 펼치기">›</button>
                  1
                </div>
              </td>
              <td><code>goto_live("audio_multi")</code></td>
              <td class="proc-desc">음성 다중 채널 171로 실시간 진입. 신호 팝업이 꺼진 뒤에만 샷. 채널 목록<br>→ <code>[확인]</code> 후 미니 EPG(편성표·미니뷰·채널명)가 이동 확인<br>→ 하단 좌측 편성표·우측 맞춤 서비스면 시작 조건 완료. 이 화면에서 <code>[우]</code>가 우측 Wing을 연다.</td>
            </tr>
            <tr id="proc-step-1-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">goto_live · UI 변경 샷</p>
                <div id="proc-step-1-shot-list" class="shots"><p class="muted">샷 목록을 불러오는 중…</p></div>
              </td>
            </tr>
            <tr>
              <td>
                <div class="proc-num">
                  <button type="button" class="proc-toggle" data-toggle="proc-step-2-shots" aria-expanded="false" aria-label="open_right 샷 펼치기">›</button>
                  2
                </div>
              </td>
              <td><code>open_right("audio_multi")</code></td>
              <td class="proc-desc"><code>[우]</code>로 우측 Wing을 연다. 기본 포커스는 볼만한 콘텐츠.<br>→ DB <code>menu_rails</code>의 <code>audio_multi</code> <code>[하]</code> 횟수(4)만큼 내린다.<br>→ 미니 EPG만 뜨면 Ai 시청 설정까지 이동 후 <code>[확인]</code>.</td>
            </tr>
            <tr id="proc-step-2-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">open_right("audio_multi") · UI 변경 샷</p>
                <div id="proc-step-2-shot-list" class="shots"><p class="muted">샷 목록을 불러오는 중…</p></div>
              </td>
            </tr>
            <tr>
              <td>3</td>
              <td><code>tc_157249()</code></td>
              <td class="proc-desc">이번 회차에서는 실행하지 않음. 171에서 메뉴가 없으면 후보 188·987. 그래도 없으면 <b>ERROR</b>(전제 미충족).</td>
            </tr>
            <tr>
              <td>
                <div class="proc-num">
                  <button type="button" class="proc-toggle" data-toggle="proc-step-4-shots" aria-expanded="false" aria-label="assert_layout 샷 펼치기">›</button>
                  4
                </div>
              </td>
              <td><code>assert_layout("live-249.png")</code></td>
              <td class="proc-desc">화면 종류 <code>right_wing</code>. 신호 팝업이면 ERROR.<br>→ 타이틀 슬롯 <code>음성</code>, 본문 슬롯 <code>한국어</code>. 상세가 걸리고 기본이 한국어인 샷 1장.</td>
            </tr>
            <tr id="proc-step-4-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">assert_layout · 한국어 기본 상세</p>
                <div id="proc-step-4-shot-list" class="shots"><p class="muted">샷 목록을 불러오는 중…</p></div>
              </td>
            </tr>
            <tr>
              <td>
                <div class="proc-num">
                  <button type="button" class="proc-toggle" data-toggle="proc-step-5-shots" aria-expanded="false" aria-label="audio_multi 샷 펼치기">›</button>
                  5
                </div>
              </td>
              <td><code>audio_multi("ko")</code><br><code>audio_multi("en")</code></td>
              <td class="proc-desc">본문 슬롯이 열린 상태에서 <code>[확인]</code>으로 옵션에 들어간다. 한국어에 하늘색 아웃라인이 생긴다.<br>→ <code>ko</code>: <code>[확인]</code>으로 한국어를 설정한다.<br>→ <code>en</code>: <code>[하]</code> 후 <code>[확인]</code>으로 영어를 설정한다.<br>→ 본문 열린 샷 · 아웃라인 샷 · 설정 후 샷.</td>
            </tr>
            <tr id="proc-step-5-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">audio_multi("ko"|"en") · 설정 샷</p>
                <div id="proc-step-5-shot-list" class="shots"><p class="muted">샷 목록을 불러오는 중…</p></div>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="howto-label">채택하는 판정 기준 (expects)</p>
        <pre class="gherkin-block">layout: right_wing
shot: live-249.png
title: ["음성"]
body: ["한국어"]
제외: 채널명 · 프로그램명 · 시계 · 방송 본편 픽셀 · 신호 복구 팝업 프레임</pre>
        <p class="muted">파일: <code>dev/src/ste_btv/pages/wing_live.py</code>. 슬롯 정의는 <code>vision/layout.py</code>의 <code>TEMPLATES["right_wing"]</code>입니다. 방송 영역 <code>live</code>는 화면 종류 확인만 하고 문구 비교에 넣지 않습니다.</p>
      </section>
    </article>
  `;
}

function renderCase(id) {
  const tc = caseList().find((x) => x.id === id);
  if (!tc) return `<p>TC를 찾지 못했습니다.</p>`;
  const hist = tc.history || [];
  const selected =
    (CASE_HIST_RUN != null && hist.find((h) => String(h.run_id) === String(CASE_HIST_RUN))) ||
    hist[0] ||
    tc.latest ||
    null;
  const L = selected || tc.latest;
  const fp = failPointOf(L && L.verdict, L && L.message) || (selected === tc.latest || !selected ? tc.fail_point : null);
  let callout = `<div class="callout">아직 실기 결과가 없습니다.</div>`;
  if (L && fp && fp.kind === "function") {
    callout = `<div class="callout bad"><b>기능 실패</b><br>${escHtml(fp.detail || "")}</div>`;
  } else if (L && fp && fp.kind === "error") {
    callout = `<div class="callout err"><b>ERROR · 제품 결함 아님</b><br>${escHtml(fp.detail || "")}</div>`;
  } else if (L && fp && fp.kind === "ui") {
    callout = `<div class="callout ui"><b>기능은 성공 · UI가 기준과 다름</b><br>${escHtml(fp.detail || "")}</div>`;
  } else if (L && L.verdict === "PASS") {
    callout = `<div class="callout good"><b>기능 정상 · UI 기준 일치</b><br>${escHtml(L.message || "")}</div>`;
  }
  const shots = (L && L.shots) || [];
  const stepCount = parseSteps(tc.steps).reduce((n, g) => n + g.steps.length, 0);
  const judgeCap = stepCount ? `판정 화면 · step ${stepCount}` : "판정 화면";
  const uiBlock =
    L && (L.verdict === "PASS_CHANGED" || L.verdict === "PASS(변경 감지)" || L.verdict === "FAIL")
      ? `<section class="section"><h2>${L.verdict === "FAIL" ? "실패 화면" : "UI 이전 / 현재"}</h2>${beforeAfter(shots)}</section>`
      : "";
  const latestH = hist[0];
  const older = hist.slice(1);
  const cls = [tc.major, tc.minor].filter(Boolean).join(" · ");
  const selLabel = L ? `회차 ${L.run_id} · ${when(L.started_at)}` : "미실행";
  const arts = (L && L.artifacts) || {};
  const runMeta =
    arts.duration_s || (arts.deferred && arts.deferred.length) || arts.mode
      ? `<p class="muted">시간 ${arts.duration_s ?? "—"}s · 모드 ${escHtml(arts.mode || "미기록")} · 보류 ${escHtml((arts.deferred || []).join(", ") || "없음")}</p>`
      : "";
  const procLink =
    tc.id === "BTVTC-157249"
      ? `<button class="btn" type="button" data-go="/process/BTVTC-157249">프로세스</button>`
      : "";
  return `
    <div class="tools">
      <button class="btn" type="button" data-go="/cases">← 테스트케이스</button>
      ${procLink}
    </div>
    <article class="card case-sheet">
      <div class="case-head">
        <div>
          ${badge(L && L.verdict)}
          <h1>${escHtml(tc.title)}</h1>
          <div class="tcid">${escHtml(tc.id)} · ${escHtml(screenOf(tc).title)}${cls ? " · " + escHtml(cls) : ""}</div>
        </div>
        <div class="muted">${selLabel}</div>
      </div>
      <div class="case-body">
        ${callout}
        ${runMeta}
        ${bddFlowHtml(L, tc)}
        <section class="section">
          <h2>작동 설명</h2>
          <div class="howto-grid">
            <div class="howto-block">
              <p class="howto-label">시작 조건</p>
              ${proseHtml(tc.start)}
            </div>
            <div class="howto-block">
              <p class="howto-label">전제</p>
              ${proseHtml(tc.precondition)}
            </div>
            <div class="howto-block howto-expect">
              <p class="howto-label">기대 결과</p>
              ${proseHtml(tc.expect)}
            </div>
          </div>
        </section>
        <section class="section exec-section">
          <div class="exec-split">
            <div class="exec-steps">
              <h2>수행 절차</h2>
              ${stepsHtml(tc.steps, L && L.verdict)}
            </div>
            <div class="exec-result">
              <h2>선택 회차 결과</h2>
              <p class="exec-msg">${L ? escHtml(L.message || "—") : "아직 실기 결과가 없습니다."}</p>
              <p class="howto-label">${escHtml(judgeCap)}${L && L.verdict === "FAIL" ? " · 실패 지점" : ""}</p>
              ${shotsHtml(shots, L && L.verdict === "FAIL")}
            </div>
          </div>
        </section>
        ${uiBlock}
        <section class="section">
          <h2>실행 이력</h2>
          <p class="muted tip">회차를 누르면 위 결과·샷이 그 실행 기준으로 바뀝니다.</p>
          <div class="hist">
            ${latestH ? histRow(latestH, L && String(L.run_id) === String(latestH.run_id)) : `<p class="muted">이력 없음</p>`}
          </div>
          ${
            older.length
              ? `<details class="hist-more" open><summary>이전 회차 ${older.length}건</summary><div class="hist">${older
                  .map((h) => histRow(h, L && String(L.run_id) === String(h.run_id)))
                  .join("")}</div></details>`
              : ""
          }
        </section>
      </div>
    </article>
  `;
}

let CHAT_MODE = null;
let CHAT_READY = false;

function chatWelcome() {
  return [
    {
      role: "bot",
      text:
        "이 창은 랩 결과·기획·BDD 시나리오를 찾거나, 시나리오를 추가하거나, 명세를 고칠 때 씁니다.\n\n" +
        "탐색: 테스트 결과, BDD, 화면 명세를 찾아 봅니다.\n" +
        "시나리오 추가: 기존 BDD와 Page를 참고해 초안을 DB에 넣습니다.\n" +
        "정보 수정·기입: 기획 문구를 고치거나 보탭니다.\n\n" +
        "지금은 무엇을 하시겠어요?",
      choices: true,
    },
  ];
}

let CHAT_LOG = chatWelcome();

function wrapChatText(text) {
  const t = text.trim();
  if (/^(문의|실행|변경|추가)\s*[:：]/.test(t) || /테스트\s*진행/.test(t)) return t;
  if (CHAT_MODE === "edit") return "변경: " + t;
  if (CHAT_MODE === "bdd") return "추가: " + t;
  return "문의: " + t;
}

function syncChatChrome() {
  const pop = document.getElementById("chat-pop");
  const fab = document.getElementById("chat-fab");
  const modeLabel = document.getElementById("chat-mode-label");
  const input = document.getElementById("chat-q");
  const open = pop && !pop.hidden;
  document.body.classList.toggle("chat-open", !!open);
  if (fab) fab.hidden = !!open;
  if (modeLabel) {
    modeLabel.textContent =
      CHAT_MODE === "edit"
        ? "정보 수정·기입"
        : CHAT_MODE === "bdd"
          ? "시나리오 추가"
          : CHAT_MODE === "explore"
            ? "탐색"
            : "모드를 골라 주세요";
  }
  if (input) {
    input.placeholder =
      CHAT_MODE === "edit"
        ? "예: vod-player 배속 설명을 바꿔 주세요"
        : CHAT_MODE === "bdd"
          ? "예: 볼만한 콘텐츠처럼 우측 Wing에서 ○○ 확인"
          : CHAT_MODE === "explore"
            ? "예: 어제 FAIL, 좌측 Wing, BTVTC-134784"
            : "먼저 모드를 고른 뒤 입력하세요";
  }
}

function paintChat() {
  const log = document.getElementById("chat-log");
  if (!log) return;
  log.innerHTML = CHAT_LOG.map((m) => {
    const isUser = m.role === "user";
    const who = isUser ? "나" : "랩";
    const choices =
      m.choices && !CHAT_MODE
        ? `<div class="chat-choices">
            <button type="button" data-chat-mode="explore">탐색</button>
            <button type="button" data-chat-mode="bdd">시나리오 추가</button>
            <button type="button" data-chat-mode="edit">정보 수정·기입</button>
          </div>`
        : "";
    const pending = m.text === "실행 중…" ? " chat-pending" : "";
    return `<div class="chat-msg chat-${isUser ? "user" : "bot"}${pending}">
      <div class="chat-meta">${who}</div>
      <div class="chat-bubble"><p>${escHtml(m.text).replace(/\n/g, "<br>")}</p>${choices}</div>
    </div>`;
  }).join("");
  log.scrollTop = log.scrollHeight;
  syncChatChrome();
}

function openChat() {
  const pop = document.getElementById("chat-pop");
  if (!pop) return;
  pop.hidden = false;
  paintChat();
  const q = document.getElementById("chat-q");
  if (q) q.focus();
  syncChatChrome();
}

function closeChat() {
  const pop = document.getElementById("chat-pop");
  if (pop) pop.hidden = true;
  syncChatChrome();
}

function pickChatMode(mode) {
  CHAT_MODE = mode;
  const label = mode === "edit" ? "정보 수정·기입" : mode === "bdd" ? "시나리오 추가" : "탐색";
  CHAT_LOG.push({ role: "user", text: label });
  CHAT_LOG.push({
    role: "bot",
    text:
      mode === "edit"
        ? "수정할 화면이나 내용을 적어 주세요. 예: vod-player 배속 설명을 바꿔 주세요."
        : mode === "bdd"
          ? "추가할 시나리오를 적어 주세요. 기존 BDD와 Page를 참고해 랩 DB에 초안을 넣습니다. 예: 볼만한 콘텐츠처럼 우측 Wing에서 ○○을 확인"
          : "찾고 싶은 결과나 BDD, 문서를 적어 주세요. 예: 어제 FAIL, 좌측 Wing, BTVTC-134784",
  });
  paintChat();
}

async function sendChat(text) {
  const raw = (text || "").trim();
  if (!raw) return;
  const base = apiBase();
  CHAT_LOG.push({ role: "user", text: raw });
  if (!CHAT_MODE) {
    CHAT_LOG.push({ role: "bot", text: "먼저 탐색 / 시나리오 추가 / 정보 수정 중 하나를 골라 주세요.", choices: true });
    paintChat();
    return;
  }
  if (!base) {
    CHAT_LOG.push({ role: "bot", text: "랩 API가 없습니다. 이 PC에서 서버를 켠 뒤 http://127.0.0.1:8080/ 으로 여세요." });
    paintChat();
    return;
  }
  CHAT_LOG.push({ role: "bot", text: "실행 중…" });
  paintChat();
  try {
    const res = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: wrapChatText(raw) }),
    });
    const body = await res.json().catch(() => ({}));
    CHAT_LOG = CHAT_LOG.filter((m) => m.text !== "실행 중…");
    CHAT_LOG.push({ role: "bot", text: res.ok ? body.answer || JSON.stringify(body) : `오류 ${res.status}` });
  } catch (err) {
    CHAT_LOG = CHAT_LOG.filter((m) => m.text !== "실행 중…");
    CHAT_LOG.push({ role: "bot", text: "연결 실패. 랩 서버가 켜져 있는지 보세요." });
  }
  paintChat();
}

function mountChat() {
  if (CHAT_READY) return;
  const fab = document.getElementById("chat-fab");
  const pop = document.getElementById("chat-pop");
  const form = document.getElementById("chat-form");
  const closeBtn = document.getElementById("chat-x");
  if (!fab || !pop || !form || !closeBtn) return;
  CHAT_READY = true;
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    openChat();
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeChat();
  });
  pop.addEventListener("click", (e) => e.stopPropagation());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-q");
    const text = input.value;
    input.value = "";
    sendChat(text);
  });
  pop.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-chat-mode]");
    if (!btn) return;
    pickChatMode(btn.getAttribute("data-chat-mode"));
  });
  syncChatChrome();
}

function bootChat() {
  location.replace("index.html#/chat");
}

function bind() {
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => go(el.getAttribute("data-go")));
  });
  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = document.getElementById(el.getAttribute("data-toggle") || "");
      if (!panel) return;
      const open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      el.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  document.querySelectorAll("[data-jump]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(el.getAttribute("data-jump") || "");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      FILTER = el.getAttribute("data-filter") || "all";
      CASE_PAGES.cases = 1;
      if (page().name === "cases") render();
      else go("/cases");
    });
  });
  const wrap = document.querySelector(".trend-chart .chart-svg-wrap");
  if (wrap) {
    const hideTips = () => {
      wrap.querySelectorAll(".chart-tip").forEach((t) => {
        t.hidden = true;
      });
    };
    wrap.querySelectorAll(".chart-dot").forEach((dot) => {
      const showTip = () => {
        const i = dot.getAttribute("data-i");
        hideTips();
        const tip = wrap.querySelector(`.chart-tip[data-tip="${i}"]`);
        if (!tip) return;
        tip.hidden = false;
        const wrapRect = wrap.getBoundingClientRect();
        const dotRect = dot.getBoundingClientRect();
        const x = dotRect.left + dotRect.width / 2 - wrapRect.left;
        const y = dotRect.top - wrapRect.top;
        tip.style.left = `${Math.max(74, Math.min(wrapRect.width - 74, x))}px`;
        tip.style.top = `${Math.max(8, y)}px`;
      };
      dot.addEventListener("mouseenter", showTip);
      dot.addEventListener("mousemove", showTip);
      dot.addEventListener("focus", showTip);
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const rid = dot.getAttribute("data-run");
        if (rid) go(`/runs/${rid}`);
      });
    });
    wrap.addEventListener("mouseleave", hideTips);
  }
  const verdict = document.getElementById("filter-verdict");
  if (verdict) {
    verdict.addEventListener("change", () => {
      FILTER = verdict.value || "all";
      CASE_PAGES.cases = 1;
      render();
    });
  }
  const screen = document.getElementById("filter-screen");
  if (screen) {
    screen.addEventListener("change", () => {
      SCREEN_FILTER = screen.value || "all";
      CASE_PAGES.cases = 1;
      render();
    });
  }
  const q = document.getElementById("q");
  if (q) {
    q.addEventListener("input", () => {
      SEARCH = q.value;
      CASE_PAGES.cases = 1;
      render();
      const again = document.getElementById("q");
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
  }
  document.querySelectorAll("[data-pager] .pager-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const wrap = btn.closest("[data-pager]");
      const scope = (wrap && wrap.getAttribute("data-pager")) || "cases";
      const to = Number(btn.getAttribute("data-page-to"));
      if (!Number.isFinite(to) || to < 1) return;
      CASE_PAGES[scope] = to;
      render();
    });
  });
  document.querySelectorAll("[data-hist-run]").forEach((el) => {
    el.addEventListener("click", () => {
      CASE_HIST_RUN = el.getAttribute("data-hist-run");
      render();
      const anchor = document.querySelector(".exec-result");
      if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll(".sg-help").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = document.getElementById("sg-pop");
      if (!pop) return;
      const text = btn.getAttribute("data-help") || "";
      if (!pop.hidden && pop.textContent === text) {
        pop.hidden = true;
        return;
      }
      pop.hidden = false;
      pop.textContent = text;
      const rect = btn.getBoundingClientRect();
      const pad = 12;
      const left = Math.min(window.innerWidth - 280, Math.max(pad, rect.right - 240));
      const top = rect.bottom + 8 + window.scrollY;
      pop.style.position = "absolute";
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    });
  });
}

function lightbox() {
  return document.getElementById("lightbox");
}

function openLightbox(src, cap) {
  const box = lightbox();
  if (!box || !src) return;
  const img = box.querySelector("img");
  img.src = src;
  img.alt = cap || "";
  box.querySelector(".lightbox-cap").textContent = cap || "";
  box.classList.add("on");
  box.removeAttribute("hidden");
  document.body.classList.add("lb-open");
}

function closeLightbox() {
  const box = lightbox();
  if (!box || !box.classList.contains("on")) return;
  box.classList.remove("on");
  box.setAttribute("hidden", "");
  box.querySelector("img").removeAttribute("src");
  document.body.classList.remove("lb-open");
}

document.querySelectorAll(".nav button").forEach((b) => {
  b.addEventListener("click", () => go("/" + b.dataset.page));
});
window.addEventListener("hashchange", () => {
  closeLightbox();
  render();
});
document.addEventListener("click", (e) => {
  const box = lightbox();
  if (box && box.classList.contains("on")) {
    if (e.target === box) closeLightbox();
    return;
  }
  const pop = document.getElementById("sg-pop");
  if (pop && !pop.hidden && !e.target.closest(".sg-help") && !e.target.closest("#sg-pop")) {
    pop.hidden = true;
  }
  const img = e.target.closest(".shot img, .ui-shot img");
  if (!img) return;
  e.preventDefault();
  openLightbox(img.currentSrc || img.src, img.alt || "");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const lb = document.getElementById("lightbox");
  if (lb && !lb.hidden) {
    closeLightbox();
    return;
  }
  const pop = document.getElementById("chat-pop");
  if (pop && !pop.hidden) closeChat();
});

if (document.getElementById("app")) {
  mountChat();
  load()
    .then(render)
    .catch((err) => {
      document.getElementById("app").innerHTML = `<p class="muted">${err.message}</p>`;
    });
}
