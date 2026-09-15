# TBELL-Btv / view

GitHub Pages 대시보드. 왼쪽은 **홈 · 기획 · 테스트케이스**.

- 홈: 최신 회차 집계와 실행 이력
- 기획: spec.md / 판정 규칙 / inbox의 HTML·PDF 미리보기, HWP는 다운로드
- 테스트케이스: TC를 누르면 최신 판정, 수행 설명, 첨부 화면, 실패 지점 또는 UI 이전/현재

랩에서 결과를 다시 올리면:

```powershell
cd c:\develop_folder\STE-Btv_server\dev
.\.venv\Scripts\python.exe -m ste_btv.scripts.publish_view
```

GitHub: Settings → Pages → GitHub Actions (`pages.yml`). 챗봇은 랩 FastAPI가 있을 때만 `chat.html`.
