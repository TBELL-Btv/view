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
/** 홈 대시보드에 표시할 회차. null이면 최신 회차. */
let HOME_RUN_ID = null;
/** 테스트케이스 목록 회차 필터. null이면 최신 회차. */
let CASES_RUN_ID = null;

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

function latestRunId() {
  const lr = (CATALOG && CATALOG.latest_run) || {};
  if (lr.id != null) return String(lr.id);
  const tl = (CATALOG && CATALOG.timeline) || [];
  if (tl.length && tl[0].run && tl[0].run.id != null) return String(tl[0].run.id);
  return "";
}

function timelineItem(runId) {
  const want = String(runId || "");
  return ((CATALOG && CATALOG.timeline) || []).find((x) => String((x.run || {}).id) === want) || null;
}

function selectedHomeItem() {
  const want = HOME_RUN_ID != null ? String(HOME_RUN_ID) : latestRunId();
  return timelineItem(want) || ((CATALOG && CATALOG.timeline) || [])[0] || null;
}

function selectedCasesItem() {
  const want = CASES_RUN_ID != null ? String(CASES_RUN_ID) : latestRunId();
  return timelineItem(want) || ((CATALOG && CATALOG.timeline) || [])[0] || null;
}

function countsFromResults(results) {
  const out = { PASS: 0, CHANGE: 0, FAIL: 0, ERROR: 0 };
  for (const r of results || []) {
    const v = r.verdict || "";
    if (v === "PASS_CHANGED" || v === "PASS(변경 감지)") out.CHANGE += 1;
    else if (v === "PASS") out.PASS += 1;
    else if (v === "FAIL") out.FAIL += 1;
    else if (v === "ERROR") out.ERROR += 1;
  }
  return out;
}

function rowsFromRunResults(results) {
  const byId = Object.fromEntries((caseList() || []).map((tc) => [tc.id, tc]));
  return (results || []).map((r) => {
    const base = byId[r.tc_id] || { id: r.tc_id, title: r.title || r.tc_id };
    return {
      ...base,
      latest: {
        verdict: r.verdict,
        message: r.message,
        run_id: r.run_id,
        started_at: r.started_at,
        finished_at: r.finished_at,
      },
    };
  });
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
  const next = path.startsWith("/") ? path : "/" + path;
  const cur = location.hash.replace(/^#/, "") || "/home";
  if (cur === next) {
    render();
    return;
  }
  location.hash = next;
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

function fetchJson(url, timeoutMs) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  return fetch(url, {
    cache: "no-store",
    credentials: "include",
    signal: ctrl ? ctrl.signal : undefined,
  })
    .then((res) => {
      if (!res.ok) throw new Error(url + " " + res.status);
      return res.json();
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

async function loadSnapshot() {
  const data = await fetchJson("data/catalog.json");
  CATALOG = data;
  if (!CATALOG.source) CATALOG.source = "snapshot";
}

async function loadLive() {
  const base = apiBase();
  if (!base) return false;
  try {
    const data = await fetchJson(base + "/api/catalog", 8000);
    CATALOG = data;
    if (!CATALOG.source) CATALOG.source = "sqlite";
    return true;
  } catch {
    return false;
  }
}

async function boot() {
  let snapOk = false;
  try {
    await loadSnapshot();
    snapOk = true;
    render();
  } catch {
    /* snapshot optional when the lab API is available */
  }
  const upgraded = await loadLive();
  if (upgraded) render();
  else if (!snapOk) throw new Error("catalog.json 없음");
}

function render() {
  const app = document.getElementById("app");
  try {
    const { name, id } = page();
    if (name !== "run" && LAB_RUN_POLL) {
      clearInterval(LAB_RUN_POLL);
      LAB_RUN_POLL = null;
    }
    document.querySelectorAll(".nav button").forEach((b) => {
      b.classList.toggle("on", b.dataset.page === name);
    });
    const gen = document.getElementById("generated");
    if (gen && !gen.querySelector(".sidefoot-copy")) {
      gen.innerHTML = `<img class="sidefoot-img" src="side-footer.webp" width="64" alt="">
        <div class="sidefoot-copy">Copyright 2015-2026. TBELL Corp. All Rights Reserved.</div>`;
    }
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
    } else if (name === "process") {
      app.innerHTML = renderProcess(id);
      bind();
      fillProcessShots();
      window.scrollTo(0, 0);
      return;
    } else if (name === "stack") app.innerHTML = renderStack();
    else if (name === "run") {
      app.innerHTML = renderLabRun();
      bind();
      bindLabRun();
      window.scrollTo(0, 0);
      return;
    } else if (name === "runs") app.innerHTML = id ? renderRun(id) : renderHome();
    else app.innerHTML = renderHome();
    bind();
    window.scrollTo(0, 0);
  } catch (err) {
    if (app) {
      app.innerHTML = `<p class="muted">화면을 그리지 못했습니다. ${escHtml(err && err.message)}</p>`;
    }
    console.error(err);
  }
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

function donutPanel(c, title) {
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
      <div class="chart-head"><b>${escHtml(title || "최신 테스트 결과")}</b><span class="muted">통과율 ${rate}%</span></div>
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

function covIcon(ok, labelOk, labelNo) {
  if (ok) {
    return `<span class="cov-ico on" title="${escHtml(labelOk || "완료")}" aria-label="${escHtml(labelOk || "완료")}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
    </span>`;
  }
  return `<span class="cov-ico off" title="${escHtml(labelNo || "없음")}" aria-label="${escHtml(labelNo || "없음")}">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>
  </span>`;
}

function covDone(v) {
  const s = String(v || "").trim();
  return s === "완료" || s === "Y" || s === "yes" || s === "true" || s === "1";
}

/** CHANGED/DEFAULT/CLEAR/VOLUME 변형을 패밀리 TC로 묶는다. */
function familyIdOf(tcId) {
  const id = String(tcId || "");
  const m = id.match(/^(BTVTC-\d+)-(CHANGED|DEFAULT|CLEAR|VOLUME)$/i);
  return m ? m[1] : id;
}

const VARIANT_SUFFIX_LABEL = {
  CHANGED: "변경",
  DEFAULT: "기본",
  CLEAR: "클리어 보이스",
  VOLUME: "자동 볼륨",
};

/** publish 전 스냅샷에도 Wing이 갈리도록 패밀리 기본 feature. */
const FEATURE_BY_FAMILY = {
  "BTVTC-157215": "좌측 Wing UI",
  "BTVTC-157217": "좌측 Wing UI",
  "BTVTC-157214": "좌측 Wing UI",
  "BTVTC-157233": "우측 Wing UI",
  "BTVTC-157255": "우측 Wing UI",
  "BTVTC-157249": "우측 Wing UI",
  "BTVTC-157242": "우측 Wing UI",
  "BTVTC-157261": "우측 Wing UI",
  "BTVTC-157265": "우측 Wing UI",
};

const TITLE_BY_FAMILY = {
  "BTVTC-157215": "좌측 Wing 메뉴",
  "BTVTC-157217": "인기채널 / AI 추천",
  "BTVTC-157214": "선호 채널",
  "BTVTC-157233": "볼만한 콘텐츠",
  "BTVTC-157255": "AI 사운드 설정",
  "BTVTC-157249": "음성 다중 설정",
  "BTVTC-157242": "자막/해설/수어 설정",
  "BTVTC-157261": "시청 환경 설정",
  "BTVTC-157265": "마케팅 배너 제어",
};

function suiteLabelOf(suite) {
  const s = String(suite || "").toUpperCase();
  if (s === "LIVE") return "Live TV";
  if (s === "VOD") return "VOD";
  return suite || "기타";
}

function featureOfRow(r, familyId) {
  const raw = String(r.feature || "").trim();
  if (raw && raw !== "LIVE" && raw !== "VOD" && raw !== suiteLabelOf(r.suite)) return raw;
  if (FEATURE_BY_FAMILY[familyId]) return FEATURE_BY_FAMILY[familyId];
  const suite = String(r.suite || "").toUpperCase();
  if (suite === "VOD") return "VOD Player";
  return suiteLabelOf(suite);
}

function featureOrderKey(name) {
  const n = String(name || "");
  if (n.includes("좌측")) return "0";
  if (n.includes("우측")) return "1";
  return "9" + n;
}

function variantLabelOf(tcId, scenario) {
  const sc = String(scenario || "");
  let m = sc.match(/을\s+(.+?)(?:로|으로)\s*확인/);
  if (m) return m[1].trim();
  m = sc.match(/을\s+(.+?)한다$/);
  if (m && m[1].length < 40) return m[1].trim();
  const up = String(tcId || "").split("-").pop().toUpperCase();
  if (VARIANT_SUFFIX_LABEL[up]) return VARIANT_SUFFIX_LABEL[up];
  return sc || tcId;
}

function familyTitleOf(scenario, feature, familyId) {
  const sc = String(scenario || "");
  let m = sc.match(/^(.+?)을\s+/);
  if (m) return m[1].trim();
  m = sc.match(/^(.+?)를\s+/);
  if (m) return m[1].trim();
  if (TITLE_BY_FAMILY[familyId]) return TITLE_BY_FAMILY[familyId];
  if (sc) return sc;
  return feature || familyId;
}

function verdictRank(v) {
  const s = String(v || "");
  if (s === "FAIL") return 4;
  if (s === "ERROR") return 3;
  if (s === "PASS_CHANGED" || s === "PASS(변경 감지)") return 2;
  if (s === "PASS") return 1;
  return 0;
}

function pickWorseVerdict(a, b) {
  return verdictRank(a) >= verdictRank(b) ? a : b;
}

/** 회차 결과 + coverage 메타로 트리용 행을 만든다(실행분만). */
function coverageRowsForRun(runResults) {
  const covById = Object.fromEntries(((CATALOG.coverage && CATALOG.coverage.rows) || []).map((r) => [r.tc_id, r]));
  const caseById = Object.fromEntries((caseList() || []).map((tc) => [tc.id, tc]));
  return (runResults || []).map((r) => {
    const cov = covById[r.tc_id] || {};
    const tc = caseById[r.tc_id] || {};
    const fid = familyIdOf(r.tc_id);
    let suite = String(cov.suite || "").toUpperCase();
    if (!suite) {
      suite = FEATURE_BY_FAMILY[fid] ? "LIVE" : /^BTVTC-(134|145)/.test(r.tc_id) ? "VOD" : "LIVE";
    }
    return {
      tc_id: r.tc_id,
      suite,
      feature: cov.feature || "",
      scenario: cov.scenario || tc.title || r.title || "",
      bdd: cov.bdd || (tc.given ? "완료" : "없음"),
      step: cov.step || (tc.method || tc.page ? "완료" : "없음"),
      page: cov.page || tc.page || "",
      real_judge: r.verdict || "",
      evidence: r.message || cov.evidence || "",
      deferred: Array.isArray(cov.deferred) ? cov.deferred : [],
    };
  });
}

/** suite → feature(Wing) → family → variants (입력 행만 포함). */
function coverageTreeFromRows(rawRows) {
  const asList = (v) => (Array.isArray(v) ? v : []);
  const byFamily = new Map();
  for (const r of rawRows || []) {
    const fid = familyIdOf(r.tc_id);
    const suite = String(r.suite || "").toUpperCase() || "LIVE";
    const feature = featureOfRow(r, fid);
    let fam = byFamily.get(fid);
    if (!fam) {
      fam = {
        family_id: fid,
        title: TITLE_BY_FAMILY[fid] || familyTitleOf(r.scenario, feature, fid),
        suite,
        feature,
        bdd: r.bdd,
        step: r.step,
        page: r.page,
        real_judge: "",
        evidence: "",
        deferred: asList(r.deferred),
        variants: [],
      };
      byFamily.set(fid, fam);
    }
    if (covDone(r.bdd)) fam.bdd = "완료";
    if (covDone(r.step)) fam.step = "완료";
    if (!fam.page && r.page) fam.page = r.page;
    if (TITLE_BY_FAMILY[fid]) fam.title = TITLE_BY_FAMILY[fid];
    else if (r.tc_id === fid) fam.title = familyTitleOf(r.scenario, feature, fid);
    fam.deferred = [...new Set([...(fam.deferred || []), ...asList(r.deferred)])];
    const verdict = r.real_judge === "미검증" ? "" : r.real_judge || "";
    const evidence = r.evidence || "";
    fam.real_judge = pickWorseVerdict(fam.real_judge, verdict);
    if (evidence) fam.evidence = evidence;
    fam.variants.push({
      tc_id: r.tc_id,
      label: variantLabelOf(r.tc_id, r.scenario),
      scenario: r.scenario || "",
      bdd: r.bdd,
      step: r.step,
      page: r.page,
      real_judge: verdict || "미검증",
      evidence,
      deferred: asList(r.deferred),
    });
  }
  const suites = new Map();
  for (const fam of byFamily.values()) {
    if (!suites.has(fam.suite)) {
      suites.set(fam.suite, { suite: fam.suite, label: suiteLabelOf(fam.suite), features: new Map() });
    }
    const su = suites.get(fam.suite);
    if (!su.features.has(fam.feature)) {
      su.features.set(fam.feature, { name: fam.feature, families: [] });
    }
    su.features.get(fam.feature).families.push(fam);
  }
  const suiteOrder = ["LIVE", "VOD"];
  return suiteOrder
    .filter((k) => suites.has(k))
    .concat([...suites.keys()].filter((k) => !suiteOrder.includes(k)))
    .map((k) => {
      const su = suites.get(k);
      const features = [...su.features.values()].sort((a, b) =>
        featureOrderKey(a.name).localeCompare(featureOrderKey(b.name), "ko")
      );
      return { suite: su.suite, label: su.label, features };
    });
}

function isPassVerdict(v) {
  const s = String(v || "");
  return s === "PASS" || s === "PASS_CHANGED" || s === "PASS(변경 감지)";
}

function variantPassTotal(variants) {
  const list = variants || [];
  let pass = 0;
  for (const v of list) {
    if (isPassVerdict(v.real_judge)) pass += 1;
  }
  return { pass, total: list.length };
}

function familyPassTotal(fam) {
  return variantPassTotal(fam.variants);
}

function featurePassTotal(feat) {
  let pass = 0;
  let total = 0;
  for (const fam of feat.families || []) {
    const s = familyPassTotal(fam);
    pass += s.pass;
    total += s.total;
  }
  return { pass, total };
}

function suitePassTotal(su) {
  let pass = 0;
  let total = 0;
  for (const f of su.features || []) {
    const s = featurePassTotal(f);
    pass += s.pass;
    total += s.total;
  }
  return { pass, total };
}

function treePassCountHtml(pass, total) {
  return `<span class="tc-tree-count" title="PASS / 전체">${pass}/${total}</span>`;
}

function treeVariantCount(tree) {
  return (tree || []).reduce((a, su) => a + suitePassTotal(su).total, 0);
}

function covVariantRowHtml(v) {
  const vrd = v.real_judge === "미검증" ? "" : v.real_judge;
  return `<div class="tc-tree-var" data-go="/cases/${encodeURIComponent(v.tc_id)}" role="link" tabindex="0">
    <div class="tc-tree-var-top">
      ${badge(vrd)}
      <span class="tc-tree-var-label">${escHtml(v.label)}</span>
      <code class="tcid">${escHtml(v.tc_id)}</code>
    </div>
    ${v.evidence ? `<div class="tc-tree-var-msg muted">${escHtml(v.evidence)}</div>` : ""}
  </div>`;
}

function covFamilyBlockHtml(fam) {
  const { pass, total } = familyPassTotal(fam);
  const body = (fam.variants || []).map(covVariantRowHtml).join("");
  return `<details class="tc-tree-family">
    <summary class="tc-tree-family-head">
      <code class="tcid">${escHtml(fam.family_id)}</code>
      <span class="tc-tree-family-title">${escHtml(fam.title)}</span>
      ${treePassCountHtml(pass, total)}
      ${badge(fam.real_judge || "")}
    </summary>
    <div class="tc-tree-family-body">${body}</div>
  </details>`;
}

function covFeatureBlockHtml(feat, { open = false } = {}) {
  const { pass, total } = featurePassTotal(feat);
  const body = (feat.families || []).map(covFamilyBlockHtml).join("");
  return `<details class="tc-tree-feature"${open ? " open" : ""}>
    <summary class="tc-tree-feature-head">
      <span class="tc-tree-feature-title">${escHtml(feat.name)}</span>
      ${treePassCountHtml(pass, total)}
    </summary>
    <div class="tc-tree-feature-body">${body}</div>
  </details>`;
}

function covSuiteBlockHtml(su, { open = true } = {}) {
  const { pass, total } = suitePassTotal(su);
  const body = (su.features || []).map((f) => covFeatureBlockHtml(f, { open: false })).join("");
  return `<details class="tc-tree-suite"${open ? " open" : ""}>
    <summary class="tc-tree-suite-head">
      <span class="tc-tree-suite-title">${escHtml(su.label)}</span>
      ${treePassCountHtml(pass, total)}
    </summary>
    <div class="tc-tree-suite-body">${body}</div>
  </details>`;
}

function tcTreeHtml(runResults, opts = {}) {
  let rows = coverageRowsForRun(runResults);
  if (opts.filterRow) rows = rows.filter(opts.filterRow);
  const tree = coverageTreeFromRows(rows);
  if (!tree.length) {
    return `<p class="muted">${escHtml(opts.empty || "이 회차에서 실행한 테스트케이스가 없습니다.")}</p>`;
  }
  const total = treeVariantCount(tree);
  const head = opts.hideHead
    ? ""
    : `<div class="sectionhead">
        <h2>${escHtml(opts.title || "테스트케이스")}</h2>
        <div class="desc muted">${escHtml(opts.desc || `${total}건 · Live TV → Wing → TC`)}</div>
      </div>`;
  return `${head}
    <div class="tc-tree card">${tree
      .map((su) => covSuiteBlockHtml(su, { open: su.suite === "LIVE" || tree.length === 1 }))
      .join("")}</div>`;
}

let LAB_RUN_CATALOG = null;
let LAB_RUN_POLL = null;
let LAB_RUN_CHECKED = new Set();
let LAB_RUN_ENTRY = {};

function renderLabRun() {
  return `<header>
      <div class="eyebrow">실기 실행</div>
      <h1>테스트 실행</h1>
      <p class="dash-summary">셋톱 1대 · 변형을 골라 이 PC에서 실행합니다. 이미 실행 중이면 선택이 잠깁니다.</p>
    </header>
    <section class="lab-run" id="lab-run">
      <aside class="lab-run-list">
        <div class="lab-run-busy" id="lab-run-busy" hidden>
          <b>실행 중</b>
          <span id="lab-run-busy-detail">셋톱을 사용 중입니다. 끝날 때까지 다른 TC를 선택할 수 없습니다.</span>
        </div>
        <div class="lab-run-toolbar">
          <button type="button" class="btn" id="lab-run-all">전체 선택</button>
          <button type="button" class="btn ghost" id="lab-run-none">선택 해제</button>
          <button type="button" class="btn primary" id="lab-run-start">실행</button>
        </div>
        <div class="lab-run-status muted" id="lab-run-status">목록 불러오는 중…</div>
        <div class="lab-run-families" id="lab-run-families"></div>
      </aside>
      <div class="lab-run-stage">
        <div class="lab-run-preview">
          <img id="lab-run-mjpeg" alt="ADB 미리보기" />
        </div>
        <div class="lab-run-meta">
          <div><span class="muted">TC</span> <b id="lab-run-tc">—</b></div>
          <div><span class="muted">BDD</span> <span id="lab-run-bdd">—</span></div>
        </div>
        <pre class="lab-run-log" id="lab-run-log"></pre>
      </div>
    </section>`;
}

function labRunSuites(families) {
  const suiteOrder = [];
  const suites = new Map();
  for (const f of families || []) {
    const suite = String(f.suite || "LIVE").toUpperCase() || "LIVE";
    const feature = String(f.feature || suiteLabelOf(suite)).trim() || suiteLabelOf(suite);
    if (!suites.has(suite)) {
      suites.set(suite, { suite, label: suiteLabelOf(suite), features: new Map() });
      suiteOrder.push(suite);
    }
    const su = suites.get(suite);
    if (!su.features.has(feature)) su.features.set(feature, []);
    su.features.get(feature).push(f);
  }
  const prefer = ["LIVE", "VOD"];
  const ordered = prefer.filter((k) => suites.has(k)).concat(suiteOrder.filter((k) => !prefer.includes(k)));
  return ordered.map((k) => {
    const su = suites.get(k);
    const feats = [...su.features.entries()]
      .sort((a, b) => featureOrderKey(a[0]).localeCompare(featureOrderKey(b[0]), "ko"))
      .map(([name, fams]) => ({ name, families: fams }));
    return { suite: su.suite, label: su.label, features: feats };
  });
}

function labRunFamilyBlockHtml(f) {
  const variants = f.variants || [];
  const ids = variants.map((v) => v.id);
  const allOn = ids.length > 0 && ids.every((id) => LAB_RUN_CHECKED.has(id));
  const someOn = ids.some((id) => LAB_RUN_CHECKED.has(id));
  const entry =
    f.entry_options && f.entry_options.length
      ? `<select class="lab-run-entry-sel" data-family-entry="${escHtml(f.family_id)}" title="진입경로">
            ${f.entry_options
              .map(
                (o) =>
                  `<option value="${escHtml(o.id)}" ${
                    LAB_RUN_ENTRY[f.family_id] === o.id ? "selected" : ""
                  }>${escHtml(o.label)}</option>`
              )
              .join("")}
          </select>`
      : "";
  /* 단일 변형: 패밀리 헤더·하위행 중복 없이 한 줄 */
  if (variants.length <= 1) {
    const v = variants[0] || { id: f.family_id, label: f.title };
    const on = LAB_RUN_CHECKED.has(v.id) ? "checked" : "";
    const short = String(v.id || "").replace(/^BTVTC-/, "");
    return `<div class="lab-run-family lab-run-family--solo" data-family="${escHtml(f.family_id)}">
      <label class="lab-run-item lab-run-item--solo">
        <input type="checkbox" data-tc="${escHtml(v.id)}" ${on} />
        <span class="lab-run-item-label">${escHtml(f.title || v.label)}</span>
        <code class="tcid" title="${escHtml(v.id)}">${escHtml(short)}</code>
        ${entry}
      </label>
    </div>`;
  }
  const rows = variants
    .map((v) => {
      const on = LAB_RUN_CHECKED.has(v.id) ? "checked" : "";
      const short = String(v.id || "").replace(/^BTVTC-/, "");
      return `<label class="lab-run-item">
        <input type="checkbox" data-tc="${escHtml(v.id)}" ${on} />
        <span class="lab-run-item-label">${escHtml(v.label)}</span>
        <code class="tcid" title="${escHtml(v.id)}">${escHtml(short)}</code>
      </label>`;
    })
    .join("");
  return `<div class="lab-run-family" data-family="${escHtml(f.family_id)}">
    <div class="lab-run-family-head">
      <label class="lab-run-family-check" title="이 TC 변형 전체">
        <input type="checkbox" data-family-all="${escHtml(f.family_id)}" ${allOn ? "checked" : ""} ${
          someOn && !allOn ? 'data-indeterminate="1"' : ""
        } />
      </label>
      <span class="lab-run-family-title">${escHtml(f.title)}</span>
      <code class="tcid">${escHtml(String(f.family_id || "").replace(/^BTVTC-/, ""))}</code>
      ${entry}
      <span class="lab-run-count">${variants.length}</span>
    </div>
    <div class="lab-run-variants">${rows}</div>
  </div>`;
}

function labRunFamiliesHtml(families) {
  if (!families || !families.length) {
    return `<p class="muted">실행 가능한 TC가 없습니다.</p>`;
  }
  const suites = labRunSuites(families);
  return suites
    .map((su) => {
      const n = su.features.reduce((a, f) => a + f.families.reduce((b, fam) => b + (fam.variants || []).length, 0), 0);
      const featBody = su.features
        .map((g) => {
          const gn = g.families.reduce((a, f) => a + (f.variants || []).length, 0);
          const body = g.families.map(labRunFamilyBlockHtml).join("");
          return `<details class="lab-run-group" open>
            <summary class="lab-run-group-head">
              <span class="lab-run-group-title">${escHtml(g.name)}</span>
              <span class="lab-run-count">${gn}</span>
            </summary>
            <div class="lab-run-group-body">${body}</div>
          </details>`;
        })
        .join("");
      return `<details class="lab-run-suite"${su.suite === "LIVE" || suites.length === 1 ? " open" : ""}>
        <summary class="lab-run-suite-head">
          <span class="lab-run-suite-title">${escHtml(su.label)}</span>
          <span class="lab-run-count">${n}</span>
        </summary>
        <div class="lab-run-suite-body">${featBody}</div>
      </details>`;
    })
    .join("");
}

function syncLabRunFamilyMasters() {
  document.querySelectorAll("#lab-run-families [data-family-all]").forEach((el) => {
    const fid = el.getAttribute("data-family-all");
    const box = el.closest(".lab-run-family");
    if (!box) return;
    const tcs = [...box.querySelectorAll("input[data-tc]")];
    const n = tcs.length;
    const on = tcs.filter((c) => c.checked).length;
    el.checked = n > 0 && on === n;
    el.indeterminate = on > 0 && on < n;
  });
}

function syncLabRunCheckedFromDom() {
  LAB_RUN_CHECKED = new Set();
  document.querySelectorAll("#lab-run-families input[data-tc]").forEach((el) => {
    if (el.checked) LAB_RUN_CHECKED.add(el.getAttribute("data-tc"));
  });
  document.querySelectorAll("#lab-run-families select[data-family-entry]").forEach((el) => {
    LAB_RUN_ENTRY[el.getAttribute("data-family-entry")] = el.value;
  });
}

function setLabRunControlsLocked(locked) {
  const root = document.getElementById("lab-run");
  if (root) root.classList.toggle("is-busy", !!locked);
  ["lab-run-all", "lab-run-none", "lab-run-start"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!locked;
  });
  document.querySelectorAll("#lab-run-families input[data-tc], #lab-run-families select[data-family-entry], #lab-run-families input[data-family-all]").forEach((el) => {
    el.disabled = !!locked;
  });
  const busy = document.getElementById("lab-run-busy");
  if (busy) busy.hidden = !locked;
}

function applyLabRunActive(st) {
  const tc = document.getElementById("lab-run-tc");
  const bdd = document.getElementById("lab-run-bdd");
  const log = document.getElementById("lab-run-log");
  const status = document.getElementById("lab-run-status");
  const busyDetail = document.getElementById("lab-run-busy-detail");
  const running = !!(st && st.running);
  if (tc) tc.textContent = (st && st.tc_id) || "—";
  if (bdd) bdd.textContent = (st && st.bdd) || "—";
  if (log) {
    const lines = (st && st.lines) || [];
    log.textContent = lines.slice(-40).join("\n");
    log.scrollTop = log.scrollHeight;
  }
  setLabRunControlsLocked(running);
  if (busyDetail && running) {
    const bits = [
      st.run_id != null ? `run-${st.run_id}` : "",
      st.tc_id || "",
      st.bdd ? String(st.bdd).slice(0, 80) : "",
    ].filter(Boolean);
    busyDetail.textContent = bits.length
      ? `셋톱 사용 중 · ${bits.join(" · ")}`
      : "셋톱을 사용 중입니다. 끝날 때까지 다른 TC를 선택할 수 없습니다.";
  }
  if (status) {
    if (running) {
      status.textContent = `실행 중${st.run_id != null ? ` · run-${st.run_id}` : ""} · ${st.tc_id || ""} · 선택 잠금`;
    } else if (st && st.finished) {
      status.textContent = st.error
        ? `종료(오류) · ${st.error}`
        : `대기 · 마지막 run-${st.run_id != null ? st.run_id : "—"} · ${LAB_RUN_CHECKED.size}건 선택`;
    } else {
      status.textContent = `${LAB_RUN_CHECKED.size}건 선택`;
    }
  }
}

async function refreshLabRunActive() {
  const base = apiBase();
  if (!base) return;
  try {
    const st = await fetchJson(base + "/api/runs/active", 5000);
    applyLabRunActive(st || {});
    if (st && st.running) {
      startLabRunPoll();
    } else if (LAB_RUN_POLL) {
      clearInterval(LAB_RUN_POLL);
      LAB_RUN_POLL = null;
    }
  } catch {
    /* ignore poll errors */
  }
}

function startLabRunPoll() {
  if (LAB_RUN_POLL) return;
  LAB_RUN_POLL = setInterval(refreshLabRunActive, 1200);
}

async function loadLabRunCatalog() {
  const box = document.getElementById("lab-run-families");
  const status = document.getElementById("lab-run-status");
  const base = apiBase();
  if (!base) {
    if (status) status.textContent = "랩 API(:8080)에 연결되지 않았습니다.";
    return;
  }
  try {
    LAB_RUN_CATALOG = await fetchJson(base + "/api/run-catalog", 12000);
    if (box) {
      box.innerHTML = labRunFamiliesHtml((LAB_RUN_CATALOG && LAB_RUN_CATALOG.families) || []);
      syncLabRunFamilyMasters();
    }
    if (status) {
      const n = ((LAB_RUN_CATALOG && LAB_RUN_CATALOG.families) || []).reduce(
        (a, f) => a + (f.variants || []).length,
        0
      );
      status.textContent = `변형 ${n}건 · ${LAB_RUN_CHECKED.size}건 선택`;
    }
    const img = document.getElementById("lab-run-mjpeg");
    if (img && !img.dataset.live) {
      img.dataset.live = "1";
      img.src = base + "/api/preview/mjpeg?t=" + Date.now();
    }
    await refreshLabRunActive();
  } catch (err) {
    if (status) status.textContent = "목록 실패: " + ((err && err.message) || "auth/API");
  }
}

async function startLabRun() {
  const busy = document.getElementById("lab-run");
  if (busy && busy.classList.contains("is-busy")) {
    const status = document.getElementById("lab-run-status");
    if (status) status.textContent = "이미 실행 중 · 셋톱 1대라 대기하세요.";
    return;
  }
  syncLabRunCheckedFromDom();
  const ids = [...LAB_RUN_CHECKED];
  const status = document.getElementById("lab-run-status");
  if (!ids.length) {
    if (status) status.textContent = "하나 이상 선택하세요.";
    return;
  }
  const base = apiBase();
  if (!base) return;
  // 서버 상태 재확인
  try {
    const st = await fetchJson(base + "/api/runs/active", 4000);
    if (st && st.running) {
      applyLabRunActive(st);
      startLabRunPoll();
      if (status) status.textContent = "이미 실행 중 · 셋톱 1대라 대기하세요.";
      return;
    }
  } catch {
    /* continue */
  }
  const entries = Object.values(LAB_RUN_ENTRY).filter(Boolean);
  const entry = entries[0] || "";
  try {
    if (status) status.textContent = "실행 요청 중…";
    setLabRunControlsLocked(true);
    const res = await fetch(base + "/api/runs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tc_ids: ids, entry, real: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLabRunControlsLocked(false);
      if (status) status.textContent = data.detail || data.error || "실행 실패";
      return;
    }
    applyLabRunActive(data);
    startLabRunPoll();
    refreshLabRunActive();
  } catch (err) {
    setLabRunControlsLocked(false);
    if (status) status.textContent = "실행 실패: " + ((err && err.message) || "");
  }
}

function bindLabRun() {
  const root = document.getElementById("lab-run");
  if (!root || root.dataset.bound === "1") {
    loadLabRunCatalog();
    return;
  }
  root.dataset.bound = "1";
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches("input[data-family-all]")) {
      const box = t.closest(".lab-run-family");
      if (box) {
        box.querySelectorAll("input[data-tc]").forEach((el) => {
          el.checked = t.checked;
        });
      }
      syncLabRunCheckedFromDom();
      syncLabRunFamilyMasters();
      const status = document.getElementById("lab-run-status");
      if (status && !status.textContent.includes("실행 중")) {
        status.textContent = `${LAB_RUN_CHECKED.size}건 선택`;
      }
      return;
    }
    if (t.matches("input[data-tc]") || t.matches("select[data-family-entry]")) {
      syncLabRunCheckedFromDom();
      syncLabRunFamilyMasters();
      const status = document.getElementById("lab-run-status");
      if (status && !status.textContent.includes("실행 중")) {
        status.textContent = `${LAB_RUN_CHECKED.size}건 선택`;
      }
    }
  });
  const all = document.getElementById("lab-run-all");
  const none = document.getElementById("lab-run-none");
  const start = document.getElementById("lab-run-start");
  if (all) {
    all.addEventListener("click", () => {
      document.querySelectorAll("#lab-run-families input[data-tc]").forEach((el) => {
        el.checked = true;
      });
      syncLabRunCheckedFromDom();
      syncLabRunFamilyMasters();
      const status = document.getElementById("lab-run-status");
      if (status) status.textContent = `${LAB_RUN_CHECKED.size}건 선택`;
    });
  }
  if (none) {
    none.addEventListener("click", () => {
      document.querySelectorAll("#lab-run-families input[data-tc]").forEach((el) => {
        el.checked = false;
      });
      syncLabRunCheckedFromDom();
      syncLabRunFamilyMasters();
      const status = document.getElementById("lab-run-status");
      if (status) status.textContent = "0건 선택";
    });
  }
  if (start) start.addEventListener("click", () => startLabRun());
  loadLabRunCatalog();
}

function renderHome() {
  const item = selectedHomeItem();
  const run = (item && item.run) || CATALOG.latest_run || {};
  const results = (item && item.results) || [];
  const c = results.length ? countsFromResults(results) : countsOf(CATALOG.counts || {});
  const device = CATALOG.device || {};
  const timeline = CATALOG.timeline || [];
  const whenRun = when(run.started_at || CATALOG.generated_at);
  const latestTotal = c.PASS + c.CHANGE + c.FAIL + c.ERROR;
  const passShow = c.PASS + c.CHANGE;
  const runLabel = run.id != null ? `#${run.id}회차` : "최신";
  return `
    <header>
      <div class="eyebrow">테스트케이스 ${results.length}건</div>
      <h1>${escHtml(runLabel)} 테스트 결과</h1>
      <p class="dash-summary">실행 <b>#${run.id || "—"}</b> · 총 <b>${latestTotal || results.length}</b>건 · PASS <b>${passShow}</b>(변경 ${c.CHANGE}) · FAIL <b>${c.FAIL}</b> · ERROR <b>${c.ERROR}</b> · ${CATALOG.mode === "mock" ? "mock 실행" : CATALOG.mode === "real" ? "실기 실행" : "모드 미기록"}</p>
    </header>
    <section class="dash-grid">
      ${donutPanel(c, `${runLabel} 테스트 결과`)}
      ${trendChart(timeline)}
    </section>
    <div class="card runinfo">
      <div class="kv kv-run"><span>선택 회차</span>${runPickHtml(run, whenRun)}</div>
      <div class="kv"><span>대상 단말</span><b>${device.model || "—"} · ${device.serial || ""}</b></div>
      <div class="kv"><span>연결 / 실기검증</span><b>${device.connected ? "연결됨" : "미확인"} / ${device.verified ? "실기 검증 완료" : "실기 미검증"}</b></div>
    </div>
    <section class="section">
      ${tcTreeHtml(results, {
        title: "테스트케이스",
        desc: `${results.length}건 · ${runLabel} 실행분 · Live TV → Wing → TC`,
      })}
    </section>
  `;
}

function triggerTcList(trigger) {
  const raw = String(trigger || "");
  const m = raw.match(/cycle:([^:]+)/i);
  const blob = m ? m[1] : raw;
  return blob
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter((s) => /^BTVTC-/i.test(s) || /^[A-Z0-9_-]+-\d+/i.test(s));
}

function runPickHtml(run, whenRun) {
  const id = run && run.id != null ? `#${run.id}` : "#—";
  const short = `<b class="run-short" tabindex="0">${escHtml(id)} · ${escHtml(whenRun || "—")}</b>`;
  const names = triggerTcList(run && run.trigger);
  if (!names.length) return short;
  const tip = `<div class="run-tip" role="tooltip"><b>이 회차 테스트</b><ol>${names
    .map((n) => `<li>${escHtml(n)}</li>`)
    .join("")}</ol></div>`;
  return `${short}${tip}`;
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
  const item = selectedCasesItem();
  const run = (item && item.run) || CATALOG.latest_run || {};
  const runResults = (item && item.results) || [];
  const caseById = Object.fromEntries((caseList() || []).map((tc) => [tc.id, tc]));
  const filtered = runResults.filter((r) => {
    const v = r.verdict || "NONE";
    if (FILTER === "PASS") {
      if (v !== "PASS") return false;
    } else if (FILTER === "CHANGE") {
      if (v !== "PASS_CHANGED" && v !== "PASS(변경 감지)") return false;
    } else if (FILTER === "FAIL" || FILTER === "ERROR") {
      if (v !== FILTER) return false;
    } else if (FILTER === "NONE") {
      if (v) return false;
    }
    const tc = caseById[r.tc_id] || { id: r.tc_id, title: r.title || r.tc_id };
    if (SCREEN_FILTER !== "all") {
      const s = screenOf(tc);
      if (s.id !== SCREEN_FILTER && s.screen_id !== SCREEN_FILTER) return false;
    }
    const q = SEARCH.trim().toLowerCase();
    if (q) {
      const cls = screenOf(tc);
      const blob = `${r.tc_id} ${tc.title || ""} ${r.title || ""} ${r.message || ""} ${cls.title} ${cls.id}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  const tally = countsFromResults(runResults);
  const t = {
    total: runResults.length,
    PASS: tally.PASS,
    CHANGE: tally.CHANGE,
    FAIL: tally.FAIL,
    ERROR: tally.ERROR,
    NONE: Math.max(0, runResults.length - (tally.PASS + tally.CHANGE + tally.FAIL + tally.ERROR)),
  };
  const screens = screenOptions();
  const timeline = CATALOG.timeline || [];
  const activeRun = CASES_RUN_ID != null ? String(CASES_RUN_ID) : latestRunId();
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
      <div class="eyebrow">테스트케이스 ${filtered.length}건</div>
      <h1>#${escHtml(String(run.id || "—"))}회차 판정</h1>
    </header>
    <div class="tools compact-tools">
      <label class="tool">회차
        <select id="filter-run">
          ${timeline
            .map((x) => {
              const rid = String((x.run || {}).id || "");
              const c = countsOf(x.counts);
              const n = c.PASS + c.CHANGE + c.FAIL + c.ERROR;
              return `<option value="${escHtml(rid)}" ${activeRun === rid ? "selected" : ""}>#${escHtml(rid)} · ${when((x.run || {}).started_at)} · ${n}건</option>`;
            })
            .join("")}
        </select>
      </label>
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
    <section class="section">
      ${tcTreeHtml(filtered, {
        title: "테스트케이스",
        desc: `${filtered.length}건 · #${run.id || "—"}회차 · Live TV → Wing → TC`,
        hideHead: true,
      })}
    </section>
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

function stepsHtml(text, verdict, message, traceSteps) {
  const timeout = /타임아웃/.test(String(message || ""));
  // BDD trace가 있으면 수행 절차를 시나리오 문장+단계별 상태로 표시
  if (Array.isArray(traceSteps) && traceSteps.length) {
    let n = 0;
    const rows = traceSteps
      .map((st) => {
        n += 1;
        const stStatus = timeout ? "" : stepStatusHtml(st.status || verdict);
        const detail = [st.step_def, st.detail].filter(Boolean).join(" · ");
        return `<div class="step"><div class="num">${n}</div><div class="step-body"><div class="step-title">${richText(
          `${st.kw || ""} ${st.text || ""}`.trim()
        )}</div>${
          detail ? `<div class="step-detail">${richText(detail)}</div>` : ""
        }</div>${stStatus}</div>`;
      })
      .join("");
    return `<div class="steplist">${rows}</div>`;
  }
  const groups = parseSteps(text);
  if (!groups.length) return `<p class="muted">단계 없음</p>`;
  let n = 0;
  const status = timeout ? "" : stepStatusHtml(verdict);
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

function isOcrWorkShot(name) {
  const n = String(name || "")
    .split(/[/\\]/)
    .pop();
  if (!n || n.startsWith("_")) return true;
  const stem = n.replace(/\.png$/i, "");
  if (/-(rail|title|lrail|ch)$/i.test(stem)) return true;
  if (/-body$/i.test(stem) && !/-\d{2}-body$/i.test(stem)) return true;
  return false;
}

function shotBaseName(src) {
  return String(src || "")
    .split(/[/\\]/)
    .pop() || "";
}

function readShotUrl(rd, shots) {
  if (rd.shot_preview === "mock-stub") return "";
  if (rd.shot_url) return mediaSrc(rd.shot_url);
  return shotUrlFor(rd.shot, shots);
}

function pickGalleryShot(st, shots) {
  const list = (shots || []).filter((s) => !isOcrWorkShot(s));
  if (!list.length) return "";
  const blob = `${st.kw || ""} ${st.step_def || ""} ${st.page || ""} ${st.text || ""}`;
  const pats = [];
  if (/조건|goto_live/i.test(blob)) {
    pats.push(/live-enter-digit(?!-ch)/i, /live-enter-ready/i, /live-enter/i);
  } else if (/만일|open_right|open_ai|tc_157249|tc_157242|tc_157255|find_voice|find_caption/i.test(blob)) {
    pats.push(/open-right-menu/i, /menu-hit|voice-menu-hit|caption-menu-hit|ai-sound/i, /open-right-nav-\d+/i, /open-right-right/i);
  } else if (/그러면|assert_layout|타이틀 슬롯/i.test(blob)) {
    pats.push(/assert-layout|menu-hit|open-right-menu|focus/i);
  } else if (/그리고/i.test(blob) && /audio_multi|음성다중|영어|한국어/i.test(blob) && !/caption|자막/i.test(blob)) {
    pats.push(/audio-multi-(ko|en)\.png/i, /audio-multi/i);
  } else if (/그리고/i.test(blob) && /ai_clear|클리어|ai_auto|자동 볼륨|ai-sound/i.test(blob)) {
    pats.push(/ai-clear|ai-volume|ai-sound|live-255/i);
  } else if (/그리고|caption_toggles|자막|해설|수어/i.test(blob)) {
    pats.push(/caption-(changed|default)-(sign|desc|subtitle)/i, /caption-(changed|default)/i);
  }
  for (const re of pats) {
    const hits = list.filter((s) => re.test(shotBaseName(s)));
    if (hits.length) return hits[hits.length - 1];
  }
  // 다른 BDD 단계 샷으로 때우지 않는다
  return "";
}

function stepReadsHtml(st, shots) {
  const reads = st.reads || [];
  if (!reads.length) {
    const alt = pickGalleryShot(st, shots);
    if (!alt) return "";
    return readCard(
      {
        shot: shotBaseName(alt),
        shot_url: alt,
        note: `${st.kw || "단계"} · ${st.text || "대표 샷"}`.slice(0, 80),
      },
      shots,
      { compact: true }
    );
  }
  const usable = [];
  const seen = new Set();
  for (const rd of reads) {
    const name = shotBaseName(rd.shot || rd.shot_url || "");
    if (name && isOcrWorkShot(name)) continue;
    const url = readShotUrl(rd, shots);
    const key = name || url || String(rd.note || "");
    if (!key) continue;
    if (seen.has(key)) {
      const i = usable.findIndex((x) => (shotBaseName(x.shot || x.shot_url || "") || readShotUrl(x, shots)) === key);
      if (i >= 0) usable[i] = rd;
      continue;
    }
    seen.add(key);
    usable.push(rd);
  }
  const prefer =
    /채널 OCR|메뉴 도달|메뉴 포커스|슬롯 앵커|음성다중|자막토글|설정 확인|대조|focus|hit|판정/i;
  let pick = null;
  if (usable.length) {
    pick = [...usable].reverse().find((r) => prefer.test(String(r.note || ""))) || usable[usable.length - 1];
  } else {
    pick = reads[reads.length - 1];
  }
  const last = reads[reads.length - 1] || pick;
  let url = pick ? readShotUrl(pick, shots) : "";
  if (!url || isOcrWorkShot(shotBaseName(pick && (pick.shot || pick.shot_url)))) {
    const alt = pickGalleryShot(st, shots);
    if (alt) {
      pick = {
        ...(pick || last || {}),
        shot: shotBaseName(alt),
        shot_url: alt,
        shot_preview: undefined,
      };
      url = mediaSrc(alt);
    }
  }
  if (!pick) return "";
  const merged = {
    ...pick,
    note: pick.note || last.note,
    ocr_text: last.ocr_text || pick.ocr_text,
    anchors: last.anchors || pick.anchors,
    boxes: last.boxes && last.boxes.length ? last.boxes : pick.boxes,
    metrics: last.metrics || pick.metrics,
  };
  return readCard(merged, shots, { compact: true });
}

function shotsHtml(paths, highlightLast) {
  const visible = (paths || []).filter((src) => {
    const n = String(src || "")
      .split(/[/\\]/)
      .pop();
    if (!n || isOcrWorkShot(n)) return false;
    if (/^live-\d{3}\.png$/i.test(n)) return false;
    if (n === "open-right.png" || n === "open-left.png") return false;
    return true;
  });
  // 동일 파일명만 1회
  const seen = new Set();
  const uniq = [];
  for (const src of visible) {
    const n = src.split(/[/\\]/).pop();
    if (seen.has(n)) continue;
    seen.add(n);
    uniq.push(src);
  }
  if (!uniq.length) return `<p class="muted">첨부 화면 없음</p>`;
  return `<div class="shots" data-gallery="1">${uniq
    .map((src, i) => {
      const name = src.split("/").pop();
      const mark = highlightLast && i === uniq.length - 1 ? " · 실패 시점 후보" : "";
      const primary = mediaSrc(src);
      const refGuess = shotSrc(name);
      const onerr =
        refGuess && refGuess !== primary
          ? ` onerror="this.onerror=null;this.src='${refGuess.replace(/'/g, "%27")}';"`
          : "";
      return `<figure class="shot"><img src="${primary}" alt="${escHtml(name)}" data-lb-i="${i}"${onerr}><figcaption>${escHtml(name)}${mark}</figcaption></figure>`;
    })
    .join("")}</div>`;
}

function beforeAfter(paths) {
  const visible = (paths || []).filter((src) => !isOcrWorkShot(src));
  if (visible.length < 2) return "";
  const a = visible[0];
  const b = visible[visible.length - 1];
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

function anchorsHtml(anchors, compact) {
  const entries = Object.entries(anchors || {});
  if (!entries.length) return "";
  if (compact) {
    return `<ul class="anchor-compact">${entries
      .map(([k, v]) => {
        const on = !!v;
        const label = String(k).replace(/^\[|\]$/g, "");
        return `<li class="${on ? "hit" : "miss"}">${on ? "✓" : "–"} ${escHtml(label)}</li>`;
      })
      .join("")}</ul>`;
  }
  return `<ul class="anchor-list">${entries
    .map(([k, v]) => `<li class="${v ? "hit" : "miss"}">${v ? "확인" : "없음"} · ${escHtml(k)}</li>`)
    .join("")}</ul>`;
}

function slotLinesHtml(ocrText) {
  const raw = String(ocrText || "").trim();
  if (!raw) return "";
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const want = [
    { key: "title", re: /^\[title\]\s*(.+)$/i },
    { key: "body", re: /^\[body\]\s*(.+)$/i },
    { key: "rail", re: /^\[rail\]\s*(.+)$/i },
  ];
  const found = [];
  for (const w of want) {
    const hit = lines.find((l) => w.re.test(l));
    if (hit) {
      const m = hit.match(w.re);
      let val = (m && m[1] ? m[1] : hit).trim();
      if (w.key === "rail" && val.length > 72) val = val.slice(0, 72) + "…";
      found.push({ key: w.key, val });
    }
  }
  if (!found.length) {
    const short = raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
    return `<pre class="ocr-text ocr-short">${escHtml(short)}</pre>`;
  }
  return `<ul class="slot-lines">${found
    .map((f) => `<li><span class="slot-k">${escHtml(f.key)}</span><span class="slot-v">${escHtml(f.val)}</span></li>`)
    .join("")}</ul>`;
}

function topBoxesHtml(boxes) {
  const list = (boxes || [])
    .filter((b) => b && b.text)
    .slice()
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
    .slice(0, 6);
  if (!list.length) return "";
  return `<p class="box-chips">${list
    .map((b) => {
      const conf = b.confidence != null ? Number(b.confidence).toFixed(2) : "—";
      return `<span>${escHtml(b.text)} <em>${escHtml(conf)}</em></span>`;
    })
    .join("")}</p>`;
}

function readCard(rd, shots, opts) {
  const compact = !!(opts && opts.compact);
  let url = readShotUrl(rd, shots);
  if (isOcrWorkShot(rd.shot || rd.shot_url || url)) url = "";
  if (rd.shot_preview === "mock-stub") url = "";
  const mockBadge =
    rd.shot_preview === "mock-stub" || (rd.metrics && rd.metrics.mock)
      ? `<p class="muted mock-badge">mock 실행 · 슬롯/OCR 기준 (stub PNG는 표시하지 않음)</p>`
      : "";
  const label = shotBaseName(rd.shot || rd.shot_url || "") || rd.note || "샷";
  const img = url
    ? `<figure class="shot read-shot"><img src="${url}" alt="${escHtml(label)}"></figure>`
    : mockBadge;
  if (compact) {
    const layout = rd.metrics && rd.metrics.layout ? String(rd.metrics.layout) : "";
    return `<div class="read-card read-compact">
      ${img}
      <div class="read-body">
        <p class="howto-label">${escHtml(rd.note || "슬롯 앵커 대조")}${layout ? ` · ${escHtml(layout)}` : ""}</p>
        ${anchorsHtml(rd.anchors, true)}
        ${slotLinesHtml(rd.ocr_text)}
        ${topBoxesHtml(rd.boxes)}
        ${!url ? mockBadge : ""}
      </div>
    </div>`;
  }
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
      ${!url ? mockBadge : ""}
    </div>
  </div>`;
}

function pickSlotRead(L) {
  const shots = (L && L.shots) || [];
  const t = (L && L.trace) || (L && L.artifacts && L.artifacts.trace) || {};
  const prefer = /슬롯 앵커|앵커 대조|메뉴 포커스|설정 확인|판정/i;
  let best = null;
  for (const st of t.steps || []) {
    for (const rd of st.reads || []) {
      if (prefer.test(String(rd.note || ""))) best = rd;
    }
  }
  if (!best) {
    for (const st of [...(t.steps || [])].reverse()) {
      const reads = st.reads || [];
      if (reads.length) {
        best = reads[reads.length - 1];
        break;
      }
    }
  }
  if (!best) return null;
  return { rd: best, shots };
}

function slotReadSection(L) {
  if (!L) return "";
  const picked = pickSlotRead(L);
  if (!picked) {
    return `<section class="section slot-section">
      <h2>슬롯 앵커 대조</h2>
      <p class="muted">이 회차에는 슬롯 앵커 판독이 없습니다.</p>
    </section>`;
  }
  return `<section class="section slot-section">
    <h2>슬롯 앵커 대조</h2>
    <p class="muted tip">판정에 쓴 대표 샷과 슬롯 OCR·앵커입니다.</p>
    ${readCard(picked.rd, picked.shots, { compact: true })}
  </section>`;
}

function bddTechPanelHtml(st, panelId) {
  const keys = (st.keys || []).filter((k) => String(k).startsWith("press")).slice(-8);
  const rows = [
    st.step_def ? `<div><dt>Step</dt><dd><code>${escHtml(st.step_def)}</code></dd></div>` : "",
    st.page ? `<div><dt>Page</dt><dd><code>${escHtml(st.page)}</code></dd></div>` : "",
    keys.length ? `<div><dt>키</dt><dd>${escHtml(keys.join(" → "))}</dd></div>` : "",
  ].filter(Boolean);
  if (!rows.length) return { toggle: "", panel: "" };
  return {
    toggle: `<button type="button" class="bdd-tech-toggle" data-toggle="${escHtml(panelId)}" aria-expanded="false" aria-label="Step·Page·키 펼치기" title="Step · Page · 키">›</button>`,
    panel: `<div id="${escHtml(panelId)}" class="bdd-tech-panel" hidden>
      <dl class="bdd-meta">${rows.join("")}</dl>
    </div>`,
  };
}

function bddStepsCompactHtml(L, tc) {
  if (!L && !(tc && tc.bdd)) return "";
  const shots = (L && L.shots) || [];
  const t = (L && L.trace) || (L && L.artifacts && L.artifacts.trace) || {};
  const stored = (tc && tc.bdd) || (L && L.artifacts && L.artifacts.bdd) || {};
  if (!t.steps || !t.steps.length) {
    const gherkin = stored.gherkin || "";
    return `<section class="section bdd-section">
      <h2>BDD 실행</h2>
      <p class="muted">이 회차에는 Step 기록이 없습니다.${gherkin ? " 시나리오만 DB에 있습니다." : ""}</p>
      ${gherkin ? `<pre class="gherkin-block">${escHtml(gherkin)}</pre>` : ""}
    </section>`;
  }
  const head = [
    t.feature ? `<b>기능</b> ${escHtml(t.feature)}` : "",
    t.scenario ? `<b>시나리오</b> ${escHtml(t.scenario)}` : "",
    t.page ? `<b>Page</b> <code>${escHtml(t.page)}</code>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const tcSafe = String((tc && tc.id) || (L && L.tc_id) || "tc").replace(/[^A-Za-z0-9_-]/g, "-");
  const steps = t.steps
    .map((st, i) => {
      const stBadge =
        st.status === "FAIL"
          ? badge("FAIL")
          : st.status === "ERROR"
            ? badge("ERROR")
            : st.status === "PASS"
              ? badge("PASS")
              : "";
      const panelId = `bdd-tech-${tcSafe}-${i}`;
      const tech = bddTechPanelHtml(st, panelId);
      const evidence = stepReadsHtml(st, shots);
      return `<article class="bdd-step">
      <header class="bdd-step-head">
        <div class="bdd-step-main">
          <span class="bdd-kw">${escHtml(st.kw || "")}</span>
          <b class="bdd-step-text">${escHtml(st.text || "")}</b>
          ${stBadge}
        </div>
        ${tech.toggle}
      </header>
      ${tech.panel}
      ${st.detail ? `<p class="bdd-step-desc muted">${escHtml(st.detail)}</p>` : ""}
      ${
        evidence
          ? `<div class="bdd-step-evidence">${evidence}</div>`
          : `<p class="muted bdd-step-empty">이 단계의 대표 샷이 없습니다.</p>`
      }
    </article>`;
    })
    .join("");
  return `<section class="section bdd-section">
    <h2>BDD 실행</h2>
    ${head ? `<p class="muted bdd-head-line">${head}</p>` : ""}
    <p class="muted tip">조건·만일·그러면마다 대표 샷과 판독입니다. Step · Page · 키는 오른쪽 › 로 펼칩니다.</p>
    <div class="bdd-compact">${steps}</div>
  </section>`;
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
      const reads = stepReadsHtml(st, shots);
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

function lastRunId() {
  const tc = (CATALOG.cases || []).find((c) => c.id === "BTVTC-157249") || {};
  return (tc.latest && tc.latest.run_id) || (CATALOG.latest_run && CATALOG.latest_run.id) || "";
}

function lastRunShot(file) {
  const run = lastRunId();
  if (!run || !file) return "";
  const path = `data/shots/run-${run}/${file}`;
  const base = apiBase();
  if (CATALOG && CATALOG.source === "sqlite" && base) {
    return base + "/" + path;
  }
  return path;
}

function fillStepPairs(boxId, pairs) {
  const box = document.getElementById(boxId);
  if (!box) return;
  if (!pairs.length) {
    box.innerHTML = `<p class="muted">이 단계 샷이 없습니다.</p>`;
    return;
  }
  box.innerHTML = pairs
    .map((p) => {
      const lastSrc = p.lastFile ? lastRunShot(p.lastFile) : "";
      const lastFig = lastSrc
        ? `<figure class="shot"><img src="${lastSrc}" alt="마지막 결과" onerror="this.parentNode.outerHTML='<p class=\\'muted\\'>이번 회차 샷 없음</p>'"><figcaption>마지막 결과 · ${escHtml(p.lastFile)}</figcaption></figure>`
        : `<p class="muted">이번 회차 없음</p>`;
      return `<div class="compare-block">
        <p class="howto-label">${escHtml(p.label)}</p>
        <div class="compare">
          <figure class="shot"><img src="${mediaSrc(p.base)}" alt="기준"><figcaption>기준 · ${escHtml((p.base || "").split("/").pop())}</figcaption></figure>
          <div class="arrow">→</div>
          ${lastFig}
        </div>
      </div>`;
    })
    .join("");
}

function lastRunShotFiles() {
  const tc = (CATALOG.cases || []).find((c) => c.id === "BTVTC-157249") || {};
  const L = tc.latest || {};
  const arts = L.artifacts || {};
  const names = [];
  const add = (s) => {
    const n = String(s || "")
      .split(/[/\\]/)
      .pop();
    if (n && /\.png$/i.test(n) && !isOcrWorkShot(n) && !names.includes(n)) names.push(n);
  };
  (L.shots || []).forEach(add);
  (arts.shots || []).forEach(add);
  (arts.notes || []).forEach((n) => {
    const m = String(n).match(/([A-Za-z0-9._-]+\.png)/);
    if (m) add(m[1]);
  });
  return names;
}

function lastRunShotName(matchers, fallback) {
  const names = lastRunShotFiles();
  for (const re of matchers) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return fallback || "";
}

function fillProcessShots() {
  fillStepPairs("proc-step-1-shot-list", [
    {
      label: "0→171 · 미니 EPG",
      base: "data/process/goto-live/live-enter-01-ok.png",
      lastFile: lastRunShotName([/live-enter-.*digit/, /live-enter-.*epg/, /live-enter-.*ok/], "live-enter-00-digit.png"),
    },
    {
      label: "라이브 안내보기 · 편성표/맞춤 서비스",
      base: "data/process/goto-live/live-enter-02-ready.png",
      lastFile: lastRunShotName([/live-enter-.*guide/, /live-enter-.*ready/], "live-enter-01-guide.png"),
    },
    {
      label: "팝업 해제 후 준비",
      base: "data/process/goto-live/live-enter-02-ready.png",
      lastFile: lastRunShotName([/live-enter-.*ready/, /live-enter-.*exit/], "live-enter-00-ready.png"),
    },
  ]);
  fillStepPairs("proc-step-2-shot-list", [
    {
      label: "[우] 후 우측 Wing · 볼만한 콘텐츠",
      base: "data/process/open-right/open-right-01-right.png",
      lastFile: lastRunShotName([/open-right-.*right/, /open-right-00-right/], "open-right-00-right.png"),
    },
    {
      label: "[하]×4 음성 다중 설정",
      base: "data/process/open-right/open-right-02-target.png",
      lastFile: lastRunShotName([/^live-249\.png$/, /open-right-.*down/, /open-right-.*target/], "live-249.png"),
    },
  ]);
  fillStepPairs("proc-step-4-shot-list", [
    {
      label: "타이틀·본문 · 한국어 기본",
      base: "data/process/baseline/body.png",
      lastFile: lastRunShotName([/assert-layout-/, /^live-249\.png$/], "assert-layout-00-ko.png"),
    },
  ]);
  fillStepPairs("proc-step-5-shot-list", [
    {
      label: "본문 슬롯 · 한국어 체크",
      base: "data/process/baseline/body.png",
      lastFile: lastRunShotName([/audio-multi-.*body/, /audio-multi-00-/], "audio-multi-00-body.png"),
    },
    {
      label: "[확인] 후 한국어 하늘색 아웃라인",
      base: "data/process/baseline/focus.png",
      lastFile: lastRunShotName([/audio-multi-.*focus/, /audio-multi-01-/], "audio-multi-01-focus.png"),
    },
    {
      label: "audio_multi(\"en\") 영어 체크",
      base: "data/process/baseline/en.png",
      lastFile: lastRunShotName([/audio-multi-.*en/, /audio-multi-0[34]-/], "audio-multi-03-en.png"),
    },
  ]);
}

function processCycleHtml() {
  const tc = (CATALOG.cases || []).find((c) => c.id === "BTVTC-157249") || {};
  const L = tc.latest || {};
  const arts = L.artifacts || {};
  const ai = arts.ai_review || {};
  const cmp = arts.compare || {};
  const v = L.verdict || "";
  const changeTalk =
    v === "PASS_CHANGED" || v === "PASS(변경 감지)"
      ? `<p><b>변경 감지</b> · AI가 UI 변경으로 확정 · ${escHtml(ai.opinion || "")}</p>`
      : `<p class="muted">변경 감지는 PASS이고 AI가 변경이라고 한 뒤에만 표시합니다.</p>`;
  const suspect = cmp.changed || cmp.suspect;
  const timeoutTalk = /타임아웃/.test(String(L.message || ""))
    ? `<p><b>타임아웃은 셋톱 실패가 아닙니다.</b> 키 입력이 끝난 뒤 화면 글자 읽기(EasyOCR)가 300초를 넘긴 것입니다. 모니터에서 영어가 바뀌었다면 기능은 수행된 겁니다.</p>`
    : "";
  const ssimGate = (() => {
    const thr = cmp.ssim_threshold != null ? Number(cmp.ssim_threshold) : 0.98;
    const needed = cmp.ai_review_needed;
    const suppressed = cmp.ssim_suppressed || 0;
    const files = (cmp.suspect_files || [])
      .slice(0, 8)
      .map((f) => {
        const ok = f.ssim_ok === true ? "ssim_ok" : f.ssim_ok === false ? "ssim_diff" : "";
        const score = f.ssim_min != null ? ` SSIM ${Number(f.ssim_min).toFixed(3)}` : "";
        const tier = f.ai_tier ? ` · ${escHtml(String(f.ai_tier))}` : "";
        return `<li class="${ok}"><span class="ssim-badge">${escHtml(f.label || "?")}</span>${score}${tier} · ${escHtml(f.base || "-")} → ${escHtml(f.run || "-")}</li>`;
      })
      .join("");
    const gateLine =
      cmp.skipped
        ? ""
        : needed
          ? `<p>SSIM 게이트 · 임계 ${thr} · <b>AI 호출</b>${suppressed ? ` · 억제 ${suppressed}` : ""}</p>`
          : suspect
            ? `<p class="muted">SSIM 게이트 · 임계 ${thr} · 의심 있으나 AI 생략${suppressed ? ` · 억제 ${suppressed}` : ""}</p>`
            : `<p class="muted">SSIM 게이트 · 임계 ${thr} · 동일(≥임계) · AI 생략</p>`;
    return `${gateLine}${files ? `<ul class="howto-list ssim-list">${files}</ul>` : ""}`;
  })();
  const aiLine = cmp.skipped
    ? `<p class="muted">PASS가 아니라 샷 비교·AI를 생략했습니다.</p>`
    : ai.skipped
    ? `<p class="muted">AI 생략 · ${escHtml(ai.reason || ai.opinion || "ssim_ok")}</p>`
    : ai.opinion
    ? `<p>AI 의견 · ${ai.ok === false ? "미확정" : ai.changed ? "변경" : "변경 아님"}${ai.tier ? ` · ${escHtml(ai.tier)}` : ""} · ${escHtml(ai.opinion)}</p>`
    : suspect
      ? `<p class="muted">샷 불일치 의심. AI 결과가 아직 없습니다.</p>`
      : `<p class="muted">샷 불일치 의심 없음.</p>`;
  const notes = (arts.notes || []).slice(-8).map((n) => `<li>${escHtml(n)}</li>`).join("");
  return `<section class="section proc-section" id="proc-cycle">
      <h2>이번 회차 로그 · 판정</h2>
      <p>${badge(v)} 회차 ${escHtml(String(L.run_id || "—"))} · ${escHtml(L.message || "")}</p>
      ${timeoutTalk}
      ${ssimGate}
      ${aiLine}
      ${changeTalk}
      ${notes ? `<ul class="howto-list">${notes}</ul>` : ""}
    </section>`;
}

function renderStack() {
  const sections = [
    {
      title: "런타임 · 랩 API",
      lead: "스위트 실행, 대시보드 API, 뷰 서빙",
      items: [
        { name: "Python", ver: "3.11+", role: "메인 언어 · 스위트·Page·판정" },
        { name: "FastAPI / Uvicorn", ver: "0.115+", role: "랩 API · MJPEG 프리뷰 · /api/chat" },
        { name: "SQLite", ver: "표준", role: "회차·결과·BDD·챗 검색(FTS5)" },
      ],
    },
    {
      title: "시나리오 · 자동화",
      lead: "Gherkin → Step → Page → ADB",
      items: [
        { name: "pytest-bdd", ver: "8.x", role: "Gherkin 시나리오 → Step Definition" },
        { name: "ADB KeyEvent", ver: "시스템", role: "셋톱 원격 조작 · screencap" },
      ],
    },
    {
      title: "비전 · 판정",
      lead: "슬롯 OCR · SSIM · 증거 샷",
      items: [
        { name: "EasyOCR", ver: "1.7+", role: "화면 슬롯 OCR · 메뉴/타이틀" },
        { name: "scikit-image", ver: "0.24+", role: "SSIM 슬롯 비교 · AI 게이트" },
        { name: "NumPy / Pillow", ver: "1.26+ / 10.4+", role: "이미지 행렬 · 캡처 저장" },
      ],
    },
    {
      title: "챗봇 · LLM",
      lead: "탐색 Q&A · 시나리오 초안 · 명세 수정 (/api/chat)",
      items: [
        { name: "Gemini", ver: "API", role: "현재 답변·요약 LLM" },
        { name: "Claude", ver: "도입 예정", role: "고난도 요약·명세 편집 후보" },
        { name: "토큰/FTS 검색", ver: "랩 내장", role: "TC·BDD·실행결과 retrieval" },
      ],
    },
  ];
  const blocks = sections
    .map((sec) => {
      const cards = sec.items
        .map(
          (it) => `<article class="stack-card">
      <div class="stack-card-top">
        <p class="stack-name">${escHtml(it.name)}</p>
        <p class="stack-ver">${escHtml(it.ver)}</p>
      </div>
      <p class="stack-role">${escHtml(it.role)}</p>
    </article>`
        )
        .join("");
      return `<section class="stack-sec">
      <h2 class="stack-h2">${escHtml(sec.title)}</h2>
      <p class="stack-sec-lead">${escHtml(sec.lead)}</p>
      <div class="stack-grid">${cards}</div>
    </section>`;
    })
    .join("");
  return `<article class="stack-page">
    <p class="eyebrow">기술 및 도구</p>
    <h1>검증된 오픈소스 기술 조합</h1>
    <p class="stack-lead">용도별로 나눈 랩 핵심 스택입니다. 챗봇은 별도 프레임워크가 아니라 기존 FastAPI·SQLite 위에 LLM을 얹습니다.</p>
    ${blocks}
    <section class="stack-why">
      <h2>선택 이유</h2>
      <ul>
        <li><b>안정성</b> — Python·FastAPI·NumPy 등 검증된 표준 생태계</li>
        <li><b>확장성</b> — BDD → Page → ADB/OCR 모듈 분리, TC·슬롯 추가 용이</li>
        <li><b>성능</b> — NumPy 벡터화 + SSIM으로 불필요한 AI 호출 억제 · 챗봇은 FTS/토큰 검색 후 LLM 요약</li>
      </ul>
    </section>
  </article>`;
}

function renderProcess(id) {
  const tcId = id || "BTVTC-157249";
  const tc = (CATALOG.cases || []).find((c) => c.id === "BTVTC-157249") || {};
  const L = tc.latest || {};
  const gherkin = `# language: ko
기능: 우측 Wing UI
  원 TC: BTVTC-157249
  Page: LiveWingPage

  시나리오: 음성 다중 설정을 확인한다
    조건   음성 다중 채널(171) 실시간 라이브 화면에 진입한다
    만일   우측 Wing을 열고 음성 다중 설정까지 이동한다
    그러면 타이틀 슬롯에서 음성 다중 설정 포커스를 확인한다
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
      ${processCycleHtml()}
      ${bddFlowHtml(L, tc)}
      <p class="muted tip">1단계는 <code>goto_live("audio_multi")</code>가 <b>0 → 171</b>로 들어갑니다. 도착 후 미니 EPG 5초, 이어서 <b>라이브 안내보기</b>(하단 좌측 편성표 · 우측 맞춤 서비스) 5초를 기다립니다. 안내보기가 꺼지기 1초 전에 신호 복구 팝업이 뜨면 꺼질 때까지 기다린 다음 <code>[우]</code>로 우측 Wing을 엽니다. 번호 토글을 열면 <b>왼쪽이 기준 사진</b>, <b>오른쪽이 마지막 실행 샷</b>입니다. 3번은 이번 회차에서 실행하지 않습니다.</p>
      <p><a class="btn" href="#/cases/BTVTC-157249" data-go="/cases/BTVTC-157249">테스트케이스 보기</a></p>

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
              <td><b>그러면</b> 타이틀 슬롯에서 음성 다중 설정 포커스를 확인한다</td>
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
              <td class="proc-desc">모든 채널 이동은 <b>0번을 한 번 거친 뒤</b> 171로 간다.<br>→ 도착 후 하단 미니 EPG 5초. 이어서 <b>라이브 안내보기</b>(좌측 편성표 · 우측 맞춤 서비스) 5초. 안내보기 설정에서 켜/끌 수 있다.<br>→ 안내보기가 꺼지기 1초 전에 신호 복구 팝업이 뜨면, 꺼질 때까지 기다린다. 이 구간에서는 전체 OCR 대기 루프를 돌리지 않는다.</td>
            </tr>
            <tr id="proc-step-1-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">goto_live · 기준 (왼쪽) / 마지막 결과 (오른쪽)</p>
                <div id="proc-step-1-shot-list" class="proc-pairs"><p class="muted">샷 목록을 불러오는 중…</p></div>
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
              <td class="proc-desc">팝업이 꺼진 뒤에 <code>[우]</code>로 우측 Wing을 연다. 기본 포커스는 볼만한 콘텐츠.<br>→ DB <code>menu_rails</code>의 <code>audio_multi</code> <code>[하]</code> 횟수(4)만큼 내린다.<br>→ 우측 Wing은 5분 이상 유지되므로 닫힐 때까지 기다리지 않는다.</td>
            </tr>
            <tr id="proc-step-2-shots" class="proc-shot-row" hidden>
              <td colspan="3">
                <p class="howto-label">open_right("audio_multi") · 기준 (왼쪽) / 마지막 결과 (오른쪽)</p>
                <div id="proc-step-2-shot-list" class="proc-pairs"><p class="muted">샷 목록을 불러오는 중…</p></div>
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
                <p class="howto-label">assert_layout · 기준 (왼쪽) / 마지막 결과 (오른쪽)</p>
                <div id="proc-step-4-shot-list" class="proc-pairs"><p class="muted">샷 목록을 불러오는 중…</p></div>
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
                <p class="howto-label">audio_multi("ko"|"en") · 기준 (왼쪽) / 마지막 결과 (오른쪽)</p>
                <div id="proc-step-5-shot-list" class="proc-pairs"><p class="muted">샷 목록을 불러오는 중…</p></div>
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

function histRow(h, selected) {
  if (!h) return "";
  const on = selected ? " on" : "";
  const rid = String(h.run_id == null ? "" : h.run_id);
  return `<button type="button" class="hist-row${on}" data-hist-run="${escHtml(rid)}"><span>${badge(h.verdict)} <b>회차 ${escHtml(rid)}</b> ${when(h.started_at)}</span><span class="muted">${escHtml((h.message || "").slice(0, 80))}</span></button>`;
}

function findCase(id) {
  const want = decodeURIComponent(String(id || ""));
  return (CATALOG.cases || []).find((x) => x.id === want || String(x.id) === String(id));
}

function renderCase(id) {
  const tc = findCase(id);
  if (!tc) return `<p>TC를 찾지 못했습니다.</p>`;
  const hist = (tc.history || []).map((h) =>
    tc.latest && String(h.run_id) === String(tc.latest.run_id) ? Object.assign({}, h, tc.latest) : h
  );
  const selected =
    (CASE_HIST_RUN != null && hist.find((h) => String(h.run_id) === String(CASE_HIST_RUN))) ||
    tc.latest ||
    hist[0] ||
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
        ${slotReadSection(L)}
        ${bddStepsCompactHtml(L, tc)}
        <section class="section exec-section">
          <div class="exec-split">
            <div class="exec-steps">
              <h2>수행 절차</h2>
              ${stepsHtml(
                tc.steps,
                L && L.verdict,
                L && L.message,
                (L && L.trace && L.trace.steps) ||
                  (L && L.artifacts && L.artifacts.trace && L.artifacts.trace.steps) ||
                  null
              )}
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

function chatRefsHtml(refs) {
  const list = Array.isArray(refs) ? refs.filter((r) => r && (r.tc_id || r.run_id != null || r.path)) : [];
  if (!list.length) return "";
  return `<div class="chat-refs">${list
    .map((r) => {
      const tid = String(r.tc_id || "");
      const runId = r.run_id != null ? String(r.run_id) : "";
      const verd = r.verdict ? `<span class="chat-ref-verdict">${escHtml(r.verdict)}</span>` : "";
      const title = r.title ? `<span class="chat-ref-title">${escHtml(r.title)}</span>` : "";
      const path = r.path ? `<span class="chat-ref-path">${escHtml(r.path)}</span>` : "";
      if (tid) {
        return `<button type="button" class="chat-ref" data-go="/cases/${encodeURIComponent(tid)}">
          <code>${escHtml(tid)}</code>${title}${runId ? `<span class="chat-ref-run">#${escHtml(runId)}</span>` : ""}${verd}${path}
        </button>`;
      }
      if (runId) {
        return `<button type="button" class="chat-ref" data-go="/runs/${encodeURIComponent(runId)}">
          <span class="chat-ref-run">#${escHtml(runId)}</span>${title}
        </button>`;
      }
      if (r.path) {
        return `<span class="chat-ref chat-ref-static"><span class="chat-ref-path">${escHtml(r.path)}</span>${title}</span>`;
      }
      return "";
    })
    .join("")}</div>`;
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
    const refs = !isUser ? chatRefsHtml(m.refs) : "";
    return `<div class="chat-msg chat-${isUser ? "user" : "bot"}${pending}">
      <div class="chat-meta">${who}</div>
      <div class="chat-bubble"><p>${escHtml(m.text || "").replace(/\n/g, "<br>")}</p>${refs}${choices}</div>
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

function unwrapChatAnswer(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  if (t.startsWith("{") && t.includes('"answer"')) {
    try {
      const data = JSON.parse(t);
      if (data && typeof data.answer === "string" && data.answer.trim()) return data.answer.trim();
    } catch (_) {
      const m = t.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m) {
        try {
          return JSON.parse(`"${m[1]}"`);
        } catch {
          return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
      }
    }
  }
  return t;
}

function chatAnswerFromBody(res, body) {
  if (!res.ok) {
    const detail = body && (body.detail || body.error);
    if (typeof detail === "string" && detail.trim()) return `요청에 실패했습니다. ${detail}`;
    return `요청에 실패했습니다. (HTTP ${res.status})`;
  }
  let ans = body && body.answer;
  if (ans != null && typeof ans !== "string") {
    if (typeof ans === "object" && ans && typeof ans.answer === "string") ans = ans.answer;
    else ans = "";
  }
  ans = unwrapChatAnswer(ans);
  if (ans && !ans.trim().startsWith("{")) return ans.trim();
  return "답을 만들지 못했어요. 다른 키워드로 다시 물어봐 주세요.";
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
    const refs = Array.isArray(body && body.refs) ? body.refs : [];
    CHAT_LOG.push({ role: "bot", text: chatAnswerFromBody(res, body), refs });
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
    const goEl = e.target.closest("[data-go]");
    if (goEl && pop.contains(goEl)) {
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel.toString() || "").length) return;
      e.preventDefault();
      go(goEl.getAttribute("data-go"));
      return;
    }
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
    el.addEventListener("click", (e) => {
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel.toString() || "").length) return;
      if (el.tagName === "A") e.preventDefault();
      go(el.getAttribute("data-go"));
    });
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
        if (!rid) return;
        HOME_RUN_ID = rid;
        CASES_RUN_ID = rid;
        go("/home");
      });
    });
    wrap.addEventListener("mouseleave", hideTips);
  }
  const runFilter = document.getElementById("filter-run");
  if (runFilter) {
    runFilter.addEventListener("change", () => {
      CASES_RUN_ID = runFilter.value || null;
      HOME_RUN_ID = CASES_RUN_ID;
      CASE_PAGES.cases = 1;
      render();
    });
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

let LB_ITEMS = [];
let LB_INDEX = 0;

function lightbox() {
  return document.getElementById("lightbox");
}

function showLightboxAt(i) {
  const box = lightbox();
  if (!box || !LB_ITEMS.length) return;
  LB_INDEX = ((i % LB_ITEMS.length) + LB_ITEMS.length) % LB_ITEMS.length;
  const item = LB_ITEMS[LB_INDEX];
  const img = box.querySelector(".lb-stage img") || box.querySelector("img");
  img.src = item.src;
  img.alt = item.cap || "";
  const cap = box.querySelector(".lightbox-cap");
  if (cap) cap.textContent = item.cap || "";
  const idx = document.getElementById("lb-idx");
  if (idx) {
    idx.hidden = LB_ITEMS.length < 2;
    idx.textContent = `${LB_INDEX + 1} / ${LB_ITEMS.length}`;
  }
  const multi = LB_ITEMS.length > 1;
  ["lb-prev", "lb-next"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !multi;
  });
  box.querySelectorAll(".lb-hit").forEach((el) => {
    el.style.pointerEvents = multi ? "auto" : "none";
  });
  box.classList.add("on");
  box.removeAttribute("hidden");
  document.body.classList.add("lb-open");
}

function openLightbox(src, cap, gallery) {
  if (!src) return;
  if (Array.isArray(gallery) && gallery.length) {
    LB_ITEMS = gallery;
    const i = gallery.findIndex((g) => g.src === src);
    showLightboxAt(i < 0 ? 0 : i);
    return;
  }
  LB_ITEMS = [{ src, cap: cap || "" }];
  showLightboxAt(0);
}

function stepLightbox(delta) {
  if (!LB_ITEMS.length || LB_ITEMS.length < 2) return;
  showLightboxAt(LB_INDEX + delta);
}

function closeLightbox() {
  const box = lightbox();
  if (!box || !box.classList.contains("on")) return;
  box.classList.remove("on");
  box.setAttribute("hidden", "");
  const img = box.querySelector(".lb-stage img") || box.querySelector("img");
  if (img) img.removeAttribute("src");
  document.body.classList.remove("lb-open");
  LB_ITEMS = [];
  LB_INDEX = 0;
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
    if (e.target.closest("#lb-prev") || e.target.closest(".lb-hit-prev")) {
      e.preventDefault();
      e.stopPropagation();
      stepLightbox(-1);
      return;
    }
    if (e.target.closest("#lb-next") || e.target.closest(".lb-hit-next")) {
      e.preventDefault();
      e.stopPropagation();
      stepLightbox(1);
      return;
    }
    if (e.target.closest(".lb-stage")) return;
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
  const galleryRoot = img.closest("[data-gallery]");
  let gallery = null;
  if (galleryRoot) {
    gallery = [...galleryRoot.querySelectorAll("img")].map((el) => ({
      src: el.currentSrc || el.src,
      cap: el.alt || "",
    }));
  }
  openLightbox(img.currentSrc || img.src, img.alt || "", gallery);
});
document.addEventListener("keydown", (e) => {
  const lb = document.getElementById("lightbox");
  if (lb && !lb.hidden && lb.classList.contains("on")) {
    if (e.key === "Escape") {
      closeLightbox();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepLightbox(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stepLightbox(1);
      return;
    }
    return;
  }
  if (e.key !== "Escape") return;
  const pop = document.getElementById("chat-pop");
  if (pop && !pop.hidden) closeChat();
});

if (document.getElementById("app")) {
  mountChat();
  boot().catch((err) => {
    document.getElementById("app").innerHTML = `<p class="muted">${err.message}</p>`;
  });
}
