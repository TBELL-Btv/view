# TBELL-Btv / view

GitHub Pages 대시보드. 왼쪽은 **홈 · 기획 · 테스트케이스**.
크롬은 흰 면·헤어라인·16px 라운드·Pretendard. PASS 포인트 색은 `#0064FF` / `#3182F6`.

- 홈: 최신 회차 집계와 실행 이력
- 기획: 화면 명세를 테스트케이스와 같은 칸(기능·조작·전제·참고)으로 표시. 원본 HTML은 참고 자료
- 테스트케이스: TC를 누르면 최신 판정, 수행 설명, 첨부 화면

## 랩 SQLite와 연동

GitHub Pages는 SQLite를 실행하지 못한다. 랩 FastAPI가 DB를 읽고, 페이지가 그 API를 호출한다.

1. 랩에서 `uvicorn ste_btv.api.app:app --host 127.0.0.1 --port 8080`
2. (공개 페이지) Cloudflare Tunnel 등으로 HTTPS 주소를 연다. `github.io`(HTTPS)는 `http://127.0.0.1`을 호출하지 못한다.
3. `config.js`에 `window.STE_BTV_API = "https://그-터널";` 한 줄.

이후 테스트가 끝나면 푸시 없이 대시보드가 갱신된다. API가 꺼져 있으면 `data/catalog.json` 스냅샷으로 떨어진다.

로컬에서만 볼 때는 `config.js`를 `http://127.0.0.1:8080`으로 두면 된다.

스냅샷만 쓰려면 예전처럼:

```powershell
cd c:\develop_folder\STE-Btv_server\dev
.\.venv\Scripts\python.exe -m ste_btv.scripts.publish_view
```
