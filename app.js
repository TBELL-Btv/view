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
  if (location.protocol === "http:" && (location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
    return "http://127.0.0.1:8080";
  }
  return "";
}

function mediaSrc(src) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  const base = apiBase();
  if (CATALOG && CATALOG.source === "sqlite" && base) {
    return base + "/" + String(src).replace(/^\//, "");
  }
  return src;
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

function caseTable(rows) {
  if (!rows.length) return `<p class="muted">테스트케이스가 없습니다.</p>`;
  return `<div class="card tablewrap"><table>
      <thead><tr><th>결과</th><th>TC ID</th><th>테스트 항목</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map((tc) => {
            const L = tc.latest;
            return `<tr data-go="/cases/${encodeURIComponent(tc.id)}">
              <td>${badge(L && L.verdict)}</td>
              <td class="tcid">${tc.id}</td>
              <td class="name"><b>${tc.title}</b><span>${(tc.expect || "").split("\n")[0] || (L && L.message) || tc.screen_id || ""}</span></td>
              <td class="muted">›</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;
}

function renderHome() {
  const run = CATALOG.latest_run || {};
  const c = tcTally();
  const device = CATALOG.device || {};
  const timeline = CATALOG.timeline || [];
  const whenRun = when(run.started_at || CATALOG.generated_at);
  return `
    <header>
      <div class="eyebrow">테스트케이스 ${c.total}건</div>
      <h1>최신 판정</h1>
    </header>
    ${failChart(timeline)}
    <section class="grid4">
      <button type="button" class="card metric pass" data-filter="PASS"><span>PASS</span><strong>${c.PASS}</strong><div class="muted">기준 일치</div></button>
      <button type="button" class="card metric change" data-filter="CHANGE"><span>PASS · 변경 감지</span><strong>${c.CHANGE}</strong><div class="muted">기능 정상 · UI 다름</div></button>
      <button type="button" class="card metric fail" data-filter="FAIL"><span>FAIL</span><strong>${c.FAIL}</strong><div class="muted">기능 결함</div></button>
      <button type="button" class="card metric error" data-filter="ERROR"><span>ERROR</span><strong>${c.ERROR}</strong><div class="muted">전제·판독 불가</div></button>
      ${c.NONE ? `<button type="button" class="card metric" data-filter="NONE"><span>미실행</span><strong>${c.NONE}</strong><div class="muted">아직 결과 없음</div></button>` : ""}
    </section>
    <div class="card runinfo">
      <div class="kv"><span>최근 회차</span><b>#${run.id || "—"} · ${whenRun}${run.trigger ? " · " + run.trigger : ""}</b></div>
      <div class="kv"><span>대상 단말</span><b>${device.model || "—"} · ${device.serial || ""}</b></div>
      <div class="kv"><span>제어 · 캡처</span><b>${device.control || "ADB"} · ${device.capture || ""}</b></div>
    </div>
    <section class="section">
      <div class="sectionhead"><h2>테스트케이스</h2><div class="desc muted">${c.total}건 · 각 TC의 최신 판정</div></div>
      ${caseTable(caseList())}
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
      <h1>화면 명세</h1>
    </header>
    <section class="section">
      <div class="sectionhead"><h2>공지 · 참고 자료</h2><div class="desc muted">원본 기획서 · TC 예시</div></div>
      <div class="doc-list">
        ${notices
          .map((b) => {
            const go = b.preview ? `/docs/${encodeURIComponent("file:" + b.id)}` : "";
            const extra = b.preview
              ? ""
              : `<a class="muted" href="${mediaSrc(b.href)}">다운로드</a>`;
            return `<button class="doc-item" type="button" ${go ? `data-go="${go}"` : ""}><span><b>${b.title}</b><span class="muted">참고</span></span><span class="muted">${extra || "열기"}</span></button>`;
          })
          .join("")}
      </div>
    </section>
    <section class="section">
      <div class="sectionhead"><h2>화면</h2><div class="desc muted">테스트케이스와 같은 칸</div></div>
      <div class="card tablewrap"><table>
        <thead><tr><th>화면</th><th>관련 TC</th><th>버전</th><th></th></tr></thead>
        <tbody>
          ${specs
            .map((d) => {
              const n = tcsForScreen(d.screen_id).length || (d.related_tcs || []).length;
              return `<tr data-go="/docs/${encodeURIComponent(d.id)}">
                <td class="name"><b>${d.title}</b><span>${d.screen_id || d.id}</span></td>
                <td class="tcid">${n}건</td>
                <td class="muted">${d.version || "—"}</td>
                <td class="muted">›</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="4" class="muted">등록된 화면 명세가 없습니다.</td></tr>`}
        </tbody>
      </table></div>
    </section>
  `;
}

function escHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tcsForScreen(sid) {
  if (!sid) return [];
  const related = new Set();
  const spec = (CATALOG.docs || []).find((d) => d.kind === "spec" && d.screen_id === sid);
  (spec && spec.related_tcs ? spec.related_tcs : []).forEach((id) => related.add(id));
  return caseList().filter((tc) => tc.screen_id === sid || related.has(tc.id));
}

function sectionHtml(text, asSteps) {
  const raw = String(text || "").trim();
  if (!raw) return `<p class="muted">없음</p>`;
  if (asSteps) return stepsHtml(raw);
  const lines = raw.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => /^[-*]\s/.test(l))) {
    return `<ul class="spec-list">${lines.map((l) => `<li>${escHtml(l.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
  }
  return `<div class="spec-prose">${escHtml(raw).replace(/\n/g, "<br>")}</div>`;
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
  const doc = (CATALOG.docs || []).find((d) => d.id === id);
  if (!doc) return `<p>문서를 찾지 못했습니다.</p>`;
  if (doc.kind === "spec") return renderSpec(doc);
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="doc-body">
      <div class="eyebrow">${doc.kind}</div>
      <h1>${doc.title}</h1>
      ${doc.html || ""}
    </article>
  `;
}

function renderSpec(doc) {
  const sec = doc.sections || {};
  const tcs = tcsForScreen(doc.screen_id);
  const notices = pinNotice().filter((b) => b.preview);
  return `
    <button class="btn" type="button" data-go="/docs">← 기획</button>
    <article class="card case-sheet">
      <div class="case-head">
        <div>
          <div class="eyebrow">화면 명세</div>
          <h1>${doc.title}</h1>
          <div class="tcid">${doc.screen_id || doc.id} · ${doc.status || ""}</div>
        </div>
        <div class="muted">${doc.version || ""}</div>
      </div>
      <div class="case-body">
        <div class="card runinfo spec-meta">
          <div class="kv"><span>화면 ID</span><b>${doc.screen_id || "—"}</b></div>
          <div class="kv"><span>시행일</span><b>${doc.effective_from || "—"}</b></div>
          <div class="kv"><span>관련 TC</span><b>${tcs.length}건</b></div>
        </div>
        <section class="section">
          <h2>기능</h2>
          ${sectionHtml(sec["기능"])}
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
          <h2>디자인</h2>
          <p class="muted">불일치여도 FAIL 아님 · PASS(변경 감지)</p>
          ${sectionHtml(sec["디자인"])}
        </section>
        <section class="section">
          <h2>참고</h2>
          ${sectionHtml(sec["참고"])}
          ${
            tcs.length
              ? `<p class="muted">이 화면 테스트케이스</p><div class="hist">${tcs
                  .map(
                    (tc) =>
                      `<button type="button" data-go="/cases/${encodeURIComponent(tc.id)}"><span>${badge(tc.latest && tc.latest.verdict)} <b>${tc.id}</b> ${escHtml(tc.title)}</span><span class="muted">›</span></button>`
                  )
                  .join("")}</div>`
              : ""
          }
          ${
            notices.length
              ? `<p class="muted">원본 자료</p><div class="hist">${notices
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
    const q = SEARCH.trim().toLowerCase();
    if (!q) return true;
    return `${tc.id} ${tc.title} ${tc.steps || ""}`.toLowerCase().includes(q);
  });
  const t = tcTally();
  return `
    <div class="page-compact">
    <header>
      <div class="eyebrow">테스트케이스 ${t.total}건</div>
      <h1>항목과 최신 판정</h1>
    </header>
    <div class="tools">
      <button class="filter ${FILTER === "all" ? "on" : ""}" data-filter="all">전체 ${t.total}</button>
      <button class="filter ${FILTER === "PASS" ? "on" : ""}" data-filter="PASS">PASS ${t.PASS}</button>
      <button class="filter ${FILTER === "CHANGE" ? "on" : ""}" data-filter="CHANGE">변경 ${t.CHANGE}</button>
      <button class="filter ${FILTER === "FAIL" ? "on" : ""}" data-filter="FAIL">FAIL ${t.FAIL}</button>
      <button class="filter ${FILTER === "ERROR" ? "on" : ""}" data-filter="ERROR">ERROR ${t.ERROR}</button>
      <button class="filter ${FILTER === "NONE" ? "on" : ""}" data-filter="NONE">미실행 ${t.NONE}</button>
      <input class="search" id="q" placeholder="TC ID 또는 항목 검색" value="${SEARCH.replace(/"/g, "&quot;")}">
    </div>
    ${caseTable(rows)}
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
      return `<figure class="shot"><img src="${mediaSrc(src)}" alt="${name}"><figcaption>${name}${mark}</figcaption></figure>`;
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
      FILTER = el.getAttribute("data-filter") || "all";
      if (page().name === "cases") render();
      else go("/cases");
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
  const img = e.target.closest(".shot img");
  if (!img) return;
  e.preventDefault();
  openLightbox(img.currentSrc || img.src, img.alt || "");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

load()
  .then(render)
  .catch((err) => {
    document.getElementById("app").innerHTML = `<p class="muted">${err.message}</p>`;
  });
