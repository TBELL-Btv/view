# TBELL-Btv / view

대시보드. 왼쪽은 **홈 · 기획 · 테스트케이스**.
크롬은 흰 면·헤어라인·16px 라운드·Pretendard. PASS 포인트 색은 `#0064FF` / `#3182F6`.

- 홈: 최신 회차 집계와 실행 이력
- 기획: 화면 명세를 테스트케이스와 같은 칸(기능·조작·전제·참고)으로 표시. 원본 HTML은 참고 자료
- 테스트케이스: TC를 누르면 최신 판정, 수행 설명, 첨부 화면

## Catalog SoT

런타임 조회는 **SQLite → 페이지별 API(`/api/dashboard`, `/api/runs/{id}/results`, `/api/test-cases`, `/api/docs`) → Web UI** 입니다.  
`data/catalog.json` 스냅샷 fallback은 제거되었습니다. API가 없으면 연결 오류를 표시합니다.

```text
SQLite (SoT)
   ↓
/api/dashboard · /api/runs/{id}/results · /api/test-cases · /api/docs
   ↓
Web UI
```

## 랩 SQLite와 연동

GitHub Pages(정적)만으로는 SQLite를 실행하지 못한다. 랩 FastAPI가 DB·챗봇·테스트를 하고, **같은 프로세스에서 대시보드 HTML도** 제공한다.

로컬(권장):

```powershell
cd c:\develop_folder\STE-Btv_server\dev
.\.venv\Scripts\python.exe -m ste_btv.scripts.serve_lab
```

- 이 PC: http://127.0.0.1:8080/

github.io에서 실시간으로 보려면 Cloudflare Tunnel로 8080을 HTTPS로 연 뒤 `config.js`에 그 주소를 넣는다. `github.io`는 `http://127.0.0.1`을 호출하지 못한다.

1. 랩에서 `uvicorn ste_btv.api.app:app --host 127.0.0.1 --port 8080`
2. (공개 페이지) Cloudflare Tunnel 등으로 HTTPS 주소를 연다
3. `config.js`에 `window.STE_BTV_API = "https://그-터널";`

로컬에서만 볼 때는 `config.js`를 `http://127.0.0.1:8080`으로 두거나, 랩이 대시보드를 직접 서빙하면 `apiBase()`가 origin을 씁니다.

선택적 스냅샷(런타임 미사용, 디버그/아카이브용):

```powershell
cd c:\develop_folder\STE-Btv_server\dev
.\.venv\Scripts\python.exe -m ste_btv.scripts.publish_view --snapshot
```
