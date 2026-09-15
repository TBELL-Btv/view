const BADGE = {
  PASS: "bp",
  PASS_CHANGED: "bc",
  "PASS(변경 감지)": "bc",
  FAIL: "bf",
  ERROR: "be",
};

let CATALOG = null;
let FILTER = "all";
let SEARCH = "";

function badge(v) {
  if (!v) return `<span class="badge bn">미실행</span>`;
  const cls = BADGE[v] || "bn";
  const label = v === "PASS_CHANGED" ? "PASS · 변경 감지" : v;
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

function page() {
  const h = location.hash.replace(/^#/, "") || "/home";
  const parts = h.split("/").filter(Boolean);
  return { name: parts[0] || "home", id: decodeURIComponent(parts.slice(1).join("/") || "") };
}

function go(path) {
  location.hash = path.startsWith("/") ? path : "/" + path;
}

async function load() {
  const res = await fetch("data/catalog.json", { cache: "no-store" });
  if (!res.ok) throw new Error("catalog.json 없음");
  CATALOG = await res.json();
}

function render() {
  const { name, id } = page();
  document.querySelectorAll(".nav button").forEach((b) => {
    b.classList.toggle("on", b.dataset.page === name);
  });
  document.getElementById("generated").textContent = CATALOG
    ? `생성 ${when(CATALOG.generated_at)}`
    : "";
  const app = document.getElementById("app");
  if (!CATALOG) {
    app.innerHTML = `<p class="muted">랩에서 publish_view 후 data/catalog.json 이 생깁니다.</p>`;
    return;
  }
  if (name === "docs") app.innerHTML = id ? renderDoc(id) : renderDocs();
  else if (name === "cases") app.innerHTML = id ? renderCase(id) : renderCases();
  else app.innerHTML = renderHome();
  bind();
}

function failChart(timeline) {
  const runs = [...(timeline || [])].reverse();
  if (!runs.length) return "";
  const w = 720;
  const h = 168;
  const l = 36;
  const r = 12;
  const t = 22;
  const b = 28;
  const iw = w - l - r;
  const ih = h - t - b;
  const fails = runs.map((x) => countsOf(x.counts).FAIL);
  const ymax = Math.max(1, ...fails);
  const n = runs.length;
  const xAt = (i) => l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v) => t + ih - (v / ymax) * ih;
  const d = fails.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const peak = Math.max(...fails);
  const dots = fails
    .map((v, i) => {
      const hi = v === peak && v > 0;
      return `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="${hi ? 5 : 3.5}" fill="${hi ? "var(--brand)" : "var(--fg)"}"></circle>
        <text class="chart-x" x="${xAt(i)}" y="${h - 8}" text-anchor="middle">#${runs[i].run.id}</text>
        ${hi ? `<text class="chart-peak" x="${xAt(i)}" y="${yAt(v) - 10}" text-anchor="middle">FAIL ${v}</text>` : ""}`;
    })
    .join("");
  return `<div class="chart">
      <div class="chart-head"><b>회차별 FAIL</b><span class="muted">점이 높을수록 그 회차에 결함이 많습니다</span></div>
      <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="회차별 FAIL 추이">
        <line x1="${l}" y1="${t}" x2="${l}" y2="${t + ih}" stroke="var(--hairline)"></line>
        <line x1="${l}" y1="${t + ih}" x2="${l + iw}" y2="${t + ih}" stroke="var(--hairline)"></line>
        <path d="${d}" fill="none" stroke="var(--fg)" stroke-width="2"></path>
        ${dots}
      </svg>
    </div>`;
}

function latestRows(timeline) {
  const latest = (timeline || [])[0];
  const rows = (latest && latest.results) || [];
  if (!rows.length) return `<p class="muted">최근 실행 결과가 없습니다.</p>`;
  return `<div class="card tablewrap"><table>
      <thead><tr><th>결과</th><th>TC ID</th><th>테스트 항목</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr data-go="/cases/${encodeURIComponent(r.tc_id)}">
              <td>${badge(r.verdict)}</td>
              <td class="tcid">${r.tc_id}</td>
              <td class="name"><b>${r.title || r.tc_id}</b><span>${(r.message || "").slice(0, 80)}</span></td>
              <td class="muted">›</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table></div>`;
}

function renderHome() {
  const run = CATALOG.latest_run || {};
  const c = countsOf(CATALOG.counts);
  const n = c.PASS + c.CHANGE + c.FAIL + c.ERROR;
  const device = CATALOG.device || {};
  const timeline = CATALOG.timeline || [];
  const whenRun = when(run.started_at || CATALOG.generated_at);
  return `
    <header>
      <div class="eyebrow">최근 회차${run.id ? " · #" + run.id : ""}</div>
      <h1>최신 랩 결과</h1>
    </header>
    ${failChart(timeline)}
    <section class="grid4">
      <div class="card metric pass"><span>PASS</span><strong>${c.PASS}</strong><div class="muted">기준 일치</div></div>
      <div class="card metric change"><span>PASS · 변경 감지</span><strong>${c.CHANGE}</strong><div class="muted">기능 정상 · UI 다름</div></div>
      <div class="card metric fail"><span>FAIL</span><strong>${c.FAIL}</strong><div class="muted">기능 결함</div></div>
      <div class="card metric error"><span>ERROR</span><strong>${c.ERROR}</strong><div class="muted">전제·판독 불가</div></div>
    </section>
    <div class="card runinfo">
      <div class="kv"><span>최근 회차</span><b>#${run.id || "—"} · ${whenRun}${run.trigger ? " · " + run.trigger : ""}</b></div>
      <div class="kv"><span>대상 단말</span><b>${device.model || "—"} · ${device.serial || ""}</b></div>
      <div class="kv"><span>제어 · 캡처</span><b>${device.control || "ADB"} · ${device.capture || ""}</b></div>
    </div>
    <section class="section">
      <div class="sectionhead"><h2>테스트 결과</h2><div class="desc muted">${n}건 · 행을 누르면 상세</div></div>
      ${latestRows(timeline)}
    </section>
  `;
}

function pinNotice() {
  const bins = CATALOG.binaries || [];
  const ids = [
    "셋톱박스 테스트 자동화 用 테스트케이스 예시-V1.html",
    "셋톱박스 테스트 자동화 기획서-V1.html",
  ];
  const pinned = ids.map((id) => bins.find((b) => b.id === id)).filter(Boolean);
  const rest = bins.filter((b) => !ids.includes(b.id));
  return [...pinned, ...rest];
}

function renderDocs() {
  const specs = (CATALOG.docs || []).filter((d) => d.kind === "spec");
  const notices = pinNotice();
  return `
    <header>
      <div class="eyebrow">기획</div>
      <h1>Btv 서비스 기획</h1>
    </header>
    <section class="section">
      <div class="sectionhead"><h2>공지</h2><div class="desc muted">상단 고정</div></div>
      <div class="doc-list">
        ${notices
          .map((b) => {
            const go = b.preview ? `/docs/${encodeURIComponent("file:" + b.id)}` : "";
            const extra = b.preview
              ? ""
              : `<a class="muted" href="${b.href}">다운로드</a>`;
            return `<button class="doc-item" type="button" ${go ? `data-go="${go}"` : ""}><span><b>${b.title}</b><span class="muted">공지</span></span><span class="muted">${extra || "열기"}</span></button>`;
          })
          .join("")}
      </div>
    </section>
    <section class="section">
      <div class="sectionhead"><h2>화면 명세</h2><div class="desc muted">행을 누르면 상세</div></div>
      <div class="doc-list">
        ${specs
          .map(
            (d) =>
              `<button class="doc-item" type="button" data-go="/docs/${encodeURIComponent(d.id)}"><span><b>${d.title}</b><span class="muted">${d.screen_id || d.id}</span></span><span class="muted">›</span></button>`
          )
          .join("") || `<p class="muted">등록된 화면 명세가 없습니다.</p>`}
      </div>
    </section>
  `;
}

function renderDoc(id) {
  if (id.startsWith("file:")) {
    const name = id.slice(5);
    const bin = (CATALOG.binaries || []).find((b) => b.id === name);
    if (!bin) return `<p>파일을 찾지 못했습니다.</p>`;
    if (!bin.preview) {
      return `<p>${bin.note || "미리보기 불가"}</p><p><a href="${bin.href}">${bin.title} 다운로드</a></p>`;
    }
    const isPdf = (bin.kind || "").includes("pdf");
    return `
      <button class="btn" type="button" data-go="/docs">← 기획</button>
      <header style="margin-top:12px"><div class="eyebrow">공지</div><h1>${bin.title}</h1></header>
      ${isPdf ? `<embed class="frame" src="${bin.href}" type="application/pdf">` : `<iframe class="frame" src="${bin.href}" title="${bin.title}"></iframe>`}
    `;
  }
  const doc = (CATALOG.docs || []).find((d) => d.id === id);
  if (!doc) return `<p>문서를 찾지 못했습니다.</p>`;
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="doc-body">
      <div class="eyebrow">${doc.kind}</div>
      <h1>${doc.title}</h1>
      ${doc.html || ""}
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
    const q = SEARCH.trim().toLowerCase();
    if (!q) return true;
    return `${tc.id} ${tc.title} ${tc.steps || ""}`.toLowerCase().includes(q);
  });
  const all = caseList();
  const n = (v) => all.filter((t) => ((t.latest && t.latest.verdict) || "NONE") === v).length;
  const nChange = all.filter((t) => ["PASS_CHANGED", "PASS(변경 감지)"].includes((t.latest || {}).verdict)).length;
  return `
    <div class="page-compact">
    <header>
      <div class="eyebrow">테스트케이스</div>
      <h1>항목과 최신 판정</h1>
    </header>
    <div class="tools">
      <button class="filter ${FILTER === "all" ? "on" : ""}" data-filter="all">전체 ${all.length}</button>
      <button class="filter ${FILTER === "PASS" ? "on" : ""}" data-filter="PASS">PASS ${n("PASS")}</button>
      <button class="filter ${FILTER === "CHANGE" ? "on" : ""}" data-filter="CHANGE">변경 ${nChange}</button>
      <button class="filter ${FILTER === "FAIL" ? "on" : ""}" data-filter="FAIL">FAIL ${n("FAIL")}</button>
      <button class="filter ${FILTER === "ERROR" ? "on" : ""}" data-filter="ERROR">ERROR ${n("ERROR")}</button>
      <button class="filter ${FILTER === "NONE" ? "on" : ""}" data-filter="NONE">미실행 ${n("NONE")}</button>
      <input class="search" id="q" placeholder="TC ID 또는 항목 검색" value="${SEARCH.replace(/"/g, "&quot;")}">
    </div>
    <div class="card tablewrap"><table>
      <thead><tr><th>결과</th><th>TC ID</th><th>테스트 항목</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map((tc) => {
            const L = tc.latest;
            return `<tr data-go="/cases/${encodeURIComponent(tc.id)}">
              <td>${badge(L && L.verdict)}</td>
              <td class="tcid">${tc.id}</td>
              <td class="name"><b>${tc.title}</b><span>${(tc.expect || "").split("\n")[0] || tc.screen_id}</span></td>
              <td class="muted">›</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>
    </div>
  `;
}

function stepsHtml(text) {
  const lines = (text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return `<p class="muted">단계 없음</p>`;
  return `<div class="steplist">${lines
    .map((line, i) => `<div class="step"><div class="num">${i + 1}</div><p>${line.replace(/</g, "&lt;")}</p><span></span></div>`)
    .join("")}</div>`;
}

function shotsHtml(paths, highlightLast) {
  if (!paths || !paths.length) return `<p class="muted">첨부 화면 없음</p>`;
  return `<div class="shots">${paths
    .map((src, i) => {
      const name = src.split("/").pop();
      const mark = highlightLast && i === paths.length - 1 ? " · 실패 시점 후보" : "";
      return `<figure class="shot"><img src="${src}" alt="${name}"><figcaption>${name}${mark}</figcaption></figure>`;
    })
    .join("")}</div>`;
}

function beforeAfter(paths) {
  if (!paths || paths.length < 2) return "";
  const a = paths[0];
  const b = paths[paths.length - 1];
  return `<div class="compare">
    <figure class="shot"><img src="${a}" alt="before"><figcaption>이전 / 기준</figcaption></figure>
    <div class="arrow">→</div>
    <figure class="shot"><img src="${b}" alt="after"><figcaption>현재</figcaption></figure>
  </div>`;
}

function histRow(h) {
  return `<div class="hist-row"><span>${badge(h.verdict)} <b>회차 ${h.run_id}</b> ${when(h.started_at)}</span><span class="muted">${(h.message || "").slice(0, 80)}</span></div>`;
}

function renderCase(id) {
  const tc = caseList().find((x) => x.id === id);
  if (!tc) return `<p>TC를 찾지 못했습니다.</p>`;
  const L = tc.latest;
  const fp = tc.fail_point;
  let callout = `<div class="callout">아직 실기 결과가 없습니다.</div>`;
  if (L && fp && fp.kind === "function") {
    callout = `<div class="callout bad"><b>기능 실패</b><br>${fp.detail}</div>`;
  } else if (L && fp && fp.kind === "error") {
    callout = `<div class="callout err"><b>ERROR · 제품 결함 아님</b><br>${fp.detail}</div>`;
  } else if (L && fp && fp.kind === "ui") {
    callout = `<div class="callout ui"><b>기능은 성공 · UI가 기준과 다름</b><br>${fp.detail}</div>`;
  } else if (L && L.verdict === "PASS") {
    callout = `<div class="callout good"><b>기능 정상 · UI 기준 일치</b><br>${L.message || ""}</div>`;
  }
  const shots = (L && L.shots) || [];
  const uiBlock =
    L && (L.verdict === "PASS_CHANGED" || L.verdict === "PASS(변경 감지)" || L.verdict === "FAIL")
      ? `<section class="section"><h2>${L.verdict === "FAIL" ? "실패 화면" : "UI 이전 / 현재"}</h2>${beforeAfter(shots)}</section>`
      : "";
  const hist = tc.history || [];
  const latestH = hist[0];
  const older = hist.slice(1);
  return `
    <button class="btn" type="button" data-go="/cases">← 테스트케이스</button>
    <article class="card case-sheet">
      <div class="case-head">
        <div>
          ${badge(L && L.verdict)}
          <h1>${tc.title}</h1>
          <div class="tcid">${tc.id} · ${tc.screen_id || ""}</div>
        </div>
        <div class="muted">${L ? "회차 " + L.run_id + " · " + when(L.started_at) : "미실행"}</div>
      </div>
      <div class="case-body">
        ${callout}
        <section class="section">
          <h2>작동 설명</h2>
          <p class="muted">전제</p>
          <p>${(tc.precondition || "없음").replace(/\n/g, "<br>")}</p>
          <p class="muted">수행 절차</p>
          ${stepsHtml(tc.steps)}
          <p class="muted">기대 결과</p>
          <p>${(tc.expect || "").replace(/\n/g, "<br>")}</p>
        </section>
        <section class="section">
          <h2>최신 결과</h2>
          <p>${L ? L.message : "—"}</p>
          ${shotsHtml(shots, L && L.verdict === "FAIL")}
        </section>
        ${uiBlock}
        <section class="section">
          <h2>실행 이력</h2>
          <div class="hist">
            ${latestH ? histRow(latestH) : `<p class="muted">이력 없음</p>`}
          </div>
          ${
            older.length
              ? `<details class="hist-more"><summary>이전 회차 ${older.length}건</summary><div class="hist">${older.map(histRow).join("")}</div></details>`
              : ""
          }
        </section>
      </div>
    </article>
  `;
}

function bind() {
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => go(el.getAttribute("data-go")));
  });
  document.querySelectorAll("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      FILTER = el.getAttribute("data-filter");
      render();
    });
  });
  const q = document.getElementById("q");
  if (q) {
    q.addEventListener("input", () => {
      SEARCH = q.value;
      render();
    });
  }
}

document.querySelectorAll(".nav button").forEach((b) => {
  b.addEventListener("click", () => go("/" + b.dataset.page));
});
window.addEventListener("hashchange", render);

load()
  .then(render)
  .catch((err) => {
    document.getElementById("app").innerHTML = `<p class="muted">${err.message}</p>`;
  });
