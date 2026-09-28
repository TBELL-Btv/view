# copy to config.js — 랩 FastAPI 주소
# Web은 {STE_BTV_API}/api/dashboard 등 페이지별 API만 사용 (catalog.json fallback 없음).
# 랩이 :8080 에서 대시보드를 직접 서빙하면 비워도 origin을 쓴다.
# github.io → 터널 HTTPS 필수. 예: window.STE_BTV_API = "https://lab.example.com";
window.STE_BTV_API = "http://127.0.0.1:8080";
