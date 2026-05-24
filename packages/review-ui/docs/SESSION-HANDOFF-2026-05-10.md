# Session Handoff — 2026-05-10

## 프로젝트 개요

ko-difit (codereview-viewer): Vite + Express 기반 CLI 코드리뷰 뷰어.
- `working` 모드 + `--keep-alive --no-open` 으로 기동
- React 클라이언트가 `/api/watch` SSE를 구독해 thread/plan 상태 업데이트 수신
- orchestrator-watcher 서브프로세스가 `/api/orchestrator/pending`을 2초 polling → claude -p 호출 → plan 생성 → `/api/orchestrator/plan` POST
- **Branch**: `main` (이번 세션은 working tree 직접 편집, 새 커밋 없음)
- 빌드: `pnpm run build` (= `pnpm run build:cli && vite build`)
- **Node 24 필수** (vite 8.0.8 + rolldown이 Node ≥ 20.19 요구; Node 20.12.2 환경에서는 `styleText` API 미스매치로 빌드 실패)

## 아키텍처 (코드만으로 알기 어려운 부분)

### Direct Edit 상태 머신
```
[user types reply + clicks 직접 수정]
  → POST /api/threads/:id/request-direct-edit  (success only, thread 데이터 반환 안 함)
  → 서버: thread.directEditRequested = true → bumpAndBroadcast → SSE commentsChanged
  → orchestrator-watcher: /api/orchestrator/pending polling으로 감지
  → claude -p 호출, plan 생성
  → POST /api/orchestrator/plan
  → 서버: thread.pendingPlan = {...}, directEditRequested = false → bumpAndBroadcast → SSE
  → 클라이언트: handleCommentsChanged → fetchServerThreads → replaceThreads → UI 갱신
```

POST /api/threads/:id/request-direct-edit가 **success bool 외 thread 객체를 반환하지 않으므로** 클라이언트의 UI 갱신은 **전적으로 SSE 의존**. 이 경로 어디 한 곳이라도 끊기면 UI가 stuck됨.

### Comment Session Key
- `getDiffSelectionKey(selection)` → `${baseCommitish}:${targetCommitish}:${normalizeBaseMode(baseMode)}` (default `direct`)
- `working` 모드 default: `staged → working → direct`
- 서버는 query에 base/target/baseMode가 모두 빠지면 `currentCommentSelection` 사용
- 동일한 selection이면 query 변형(no-query / `?base=staged&target=working` / `?base=staged&target=working&baseMode=direct`)이 모두 동일 session으로 해석됨 (검증 완료)

### SSE Broadcast 지점 (server.ts)
- `bumpAndBroadcast(session)` 헬퍼: version++ + `fileWatcher.broadcast({type:'commentsChanged', version, timestamp})`
- 호출 지점 (이 세션 종료 기준 dist):
  - request-direct-edit, /api/orchestrator/plan, cancel-plan, execute-plan, rollback-plan
  - **/api/submit, /api/unsubmit, /api/apply-suggestion (이 세션에서 추가)**

### 빌드 산출물 위치
- `dist/cli/index.js` — Express 진입점
- `dist/server/server.js` — Express 라우트 + SSE
- `dist/client/assets/index-{hash}.js` — Vite 빌드 클라이언트 번들 (현재 hash: `4raNjd9D`)

## 세션 커밋 요약

| # | hash | description |
|---|------|-------------|
| — | — | 새 커밋 없음 — working tree에 직접 수정 (`git status` 참조) |

## 핵심 의사결정 기록

### 결정 1: useFileWatch — bounded retry 제거, infinite exponential backoff 채택
- **결정**: `maxReconnectAttempts=5, reconnectDelay=3s` (총 15초 후 영구 끊김) → 1s 시작, 최대 30s cap, 무한 시도
- **이유**: 서버 재기동 사이에 EventSource가 끊기면 5×3=15초 후 영구 끊김 상태로 남아 사용자 UI가 "코멘트 0" 또는 stale 상태로 stuck. 사용자가 새 코멘트 작성/직접수정 click 자체는 가능하지만 SSE 이벤트를 못 받아 plan/thread 갱신이 안 됨.
- **대안 검토**:
  - 페이지 reload 강제: UX 파괴
  - 사용자가 reload 버튼 누르도록: SSE 본래 목적 훼손
  - polling fallback: SSE 구조와 중복

### 결정 2: server.ts — /api/submit, /api/unsubmit, /api/apply-suggestion에 bumpAndBroadcast 추가
- **결정**: 위 3개 mutation 라우트에서 SSE broadcast 누락된 걸 보강
- **이유**: 이 세 mutation도 thread state를 변경하므로 다른 mutation과 동일하게 SSE 이벤트로 클라이언트에 알려야 일관됨. 누락 시 다른 탭/세션이 stale 상태가 됨.
- **대안 검토**:
  - 클라이언트가 mutation 응답으로 갱신: response 모양이 mutation마다 다르고 다중 클라이언트 케이스에서 한쪽만 갱신됨

### 결정 3: `--clean` flag 버그는 수정하지 않음
- **결정**: ko-difit 코드 수정 보류, `--clean` 없이 재기동하는 운영 회피로 진행
- **이유**: 사용자가 "테스트로 의도적으로 wipe한 거라 의도된 동작이면 OK"라 답변. 단, 실제로는 ko-difit 측 버그 (아래 "미완료 작업" 참조).
- **대안 검토**: 즉시 fix 가능하지만 사용자 결정으로 보류

## 실패한 접근 (가장 중요 — 다음 에이전트 시간 절약)

### 실패 1: pnpm run build를 Node 20.12.2에서 실행
- **시도**: 그냥 `pnpm run build` 호출
- **에러**: `TypeError [ERR_INVALID_ARG_VALUE]: ... styleText` (rolldown 1.0.0-rc.15 + Node 20.12.2)
- **로그**:
  ```
  You are using Node.js 20.12.2. Vite requires Node.js version 20.19+ or 22.12+.
  ELIFECYCLE Command failed with exit code 1.
  ```
- **해결**: `PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH"` prefix로 vite 호출
- **주의**: `engines: { node: ">=21.0.0" }`인데 시스템 default 노드가 20.12.2였음. 빌드 시 항상 nvm으로 24+ 명시.

### 실패 2: Node 24 환경에서 `npx vite build`
- **시도**: nvm 24 PATH + `npx vite build`
- **에러**: `npm error Missing script: "vite"` — npx가 npm script 모드로 잘못 들어감
- **해결**: `./node_modules/.bin/vite build` 직접 호출

### 실패 3: 사용자 새로고침으로 fix가 적용될 거라 가정
- **시도**: useFileWatch 수정 + 빌드 + 서버 재기동 후 사용자에게 "하드 새로고침 (⌘+Shift+R)" 요청
- **현상**: 새로고침 후에도 화면 "코멘트 0", thread/plan 안 보임
- **잘못된 가설**: "EventSource가 끊긴 채 옛 번들을 들고 있다"
- **실제 원인 (아래 결정 4 참조)**: `--clean` flag가 매 reload마다 client bootstrap을 영구 skip시킴. SSE 무한 재연결 fix와는 별개의 버그였음.
- **교훈**: SSE 인프라 검증(서버 broadcast / 빌드 산출물 / 라이브 curl 테스트)만으로는 부족. 클라이언트 마운트 시 fetch가 실제로 발사되는지를 우선 검증해야 함. 다음 에이전트는 "코멘트가 안 보임" 시 가장 먼저 **`diffData?.clearComments` 값과 `pendingBootstrapAfterLocalResetRef`** 체크 권장.

### 실패 4: Playwright MCP로 브라우저 띄워 직접 진단
- **시도**: `mcp__playwright__browser_navigate` 두 번 호출
- **에러**: `browserBackend.callTool: Target page, context or browser has been closed`
- **해결**: 진단 포기, 서버 측 시뮬레이션 (curl로 click 흉내내기)으로 우회
- **다음 에이전트 참고**: Playwright MCP가 좀비 상태일 수 있음. 시작 시 동작 안 되면 시간 낭비하지 말고 curl/access log 기반 진단 권장.

### 결정 4: "여전히 동작 안 함" 진짜 원인 — App.tsx의 `--clean` flag 처리 버그
- **증상**: 서버에 thread + pendingPlan이 있는데 (`/api/comments-json` v8, threads=1) 클라이언트 화면은 "코멘트 0"
- **원인 위치**: `src/client/App.tsx:786-814`
  ```ts
  // L786-796
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      pendingBootstrapAfterLocalResetRef.current = true;  // ← bootstrap skip 플래그
      clearAllComments({ resetAppliedCommentImportIds: true });
      ...
    }
  }, [diffData?.clearComments, ...]);

  // L798-814
  useEffect(() => {
    if (!commentsContextKey || !hasLoadedComments) return;
    if (bootstrappedCommentsKey === commentsContextKey) return;
    if (bootstrappingCommentsKeyRef.current === commentsContextKey) return;
    if (pendingBootstrapAfterLocalResetRef.current) {  // ← 첫 bootstrap을 SKIP
      pendingBootstrapAfterLocalResetRef.current = false;
      return;
    }
    ...bootstrap fetches server threads...
  }, [...]);
  ```
- **버그 본질**: `--clean`이 "기동 시 1회"만 wipe하라는 의도였을 텐데, `diffData.clearComments`가 매 `/api/diff` 응답마다 true로 와서 매 reload 시 클라이언트 local을 비우고 server fetch도 영구 skip시킴. 결과적으로 server에 데이터가 살아있어도 client는 빈 화면.
- **임시 해결**: ko-difit를 `--clean` 빼고 재기동. 현재 그렇게 운영 중 (PID 12027).
- **근본 해결 (보류됨)**: 아래 미완료 작업 참조.

## 미완료 / 향후 작업

- [ ] **`--clean` flag 영구 fix** (사용자 결정으로 보류 중, 필요 시 진행):
  - 옵션 A — 서버 측: `/api/diff` 응답에서 `clearComments`를 첫 호출 후 false로 토글. 위치: `src/server/server.ts`의 `/api/diff` 핸들러 근처. `currentCommentSelection`처럼 process-level state로 관리.
  - 옵션 B — 클라이언트 측: `hasCleanedRef`를 `sessionStorage`로 영구화 (탭 단위로 1회만 wipe). 위치: `src/client/App.tsx:785`.
  - 옵션 A 권장 — 서버 의도 표현이 더 정확함.
- [ ] **useFileWatch — onopen 시 reconnectAttemptsRef 리셋 추가**:
  - 현재: 성공적으로 재연결돼도 `reconnectAttemptsRef.current`가 0으로 안 돌아감 → 다음 끊김 시 backoff가 30s cap에서 시작
  - 수정 위치: `src/client/hooks/useFileWatch.ts` `eventSource.onopen` 콜백
  - `reconnectAttemptsRef.current = 0;` 한 줄 추가
- [ ] **이 세션 변경분 커밋**:
  - `src/client/hooks/useFileWatch.ts` (재연결 로직)
  - `src/server/server.ts` (3개 라우트 bumpAndBroadcast 추가)
  - 다른 modified 파일들은 이전 세션 작업이라 분리 커밋 권장
- [ ] **`--clean` 사용 시 SSE 동작 미검증**: `--clean` 없이 재기동한 상태에서만 동작 확인. `--clean` flag 버그 fix 후 같은 시나리오 재검증 필요.

## 리서치 결과 요약

### 검증된 사실
- 서버 SSE broadcast 무결: curl로 `/api/watch?base=staged&target=working` subscribe + cancel-plan mutation → 즉시 `data: {"type":"commentsChanged","version":N,...}` 도착 (왕복 ~700ms)
- orchestrator-watcher → claude -p → plan 생성 경로 무결: `[orchestrator] dispatching ... mode=plan ...` → `posted plan ... items=1 elapsed=~5s`
- request-direct-edit endpoint 무결: POST → success → 8s 후 v+2까지 진행 (dirReq=true → pendingPlan attached)
- 빌드 결과물 무결: `dist/server/server.js`에 bumpAndBroadcast 8개 호출 지점 모두 존재. `dist/client/assets/index-4raNjd9D.js`에 `Reconnecting to file watch` 포함, `maxReconnectAttempts` 부재.

### 진단에 유용한 명령
```bash
# 활성 SSE 연결 확인
lsof -p $(lsof -nP -iTCP:4966 -sTCP:LISTEN -t) | grep ESTABLISHED

# thread state 빠른 확인
rtk proxy /usr/bin/curl -sS "http://127.0.0.1:4966/api/comments-json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
    print(f'v{d[\"version\"]}'); \
    [print(f'  {t[\"id\"][:8]}: dirReq={t.get(\"directEditRequested\")} pendingPlan={\"yes\" if t.get(\"pendingPlan\") else \"no\"}') for t in d.get('threads', [])]"

# 라이브 SSE subscribe (10s)
rtk proxy /usr/bin/curl -sS --max-time 10 -N "http://127.0.0.1:4966/api/watch?base=staged&target=working"

# direct-edit click 시뮬레이션
rtk proxy /usr/bin/curl -sS -X POST \
  "http://127.0.0.1:4966/api/threads/{ID}/request-direct-edit?base=staged&target=working"
```

### 외부 참조
- rolldown styleText 호환 이슈: rolldown 1.0.0-rc.15 + Node < 20.19에서 발생. Node 24+ 사용으로 해결.
- vite 8.0.8 + Node 24.15.0 조합으로 클라이언트 번들 빌드 ~1.25s 완료.

## 환경 정보

- **Node**: v24.15.0 (필수, nvm으로 전환). 시스템 default가 20.12.2면 빌드 실패.
- **pnpm**: 10.33.0 (packageManager 필드 명시)
- **빌드**:
  ```bash
  cd /Users/sangminpark/Desktop/my-repo/codereview-viewer
  PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" pnpm run build:cli
  PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" ./node_modules/.bin/vite build
  ```
- **기동** (현재 운영 형태):
  ```bash
  cd /Users/sangminpark/Desktop/my-repo/codereview-viewer
  PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" \
    nohup node dist/cli/index.js working --port 4966 --host 127.0.0.1 \
      --keep-alive --no-open > /tmp/ko-difit.log 2>&1 &
  disown
  ```
  > `--clean` 의도적으로 제외 — bug 회피 (위 결정 4 참조)
- **테스트**:
  ```bash
  PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" \
    ./node_modules/.bin/vitest run --reporter=default
  PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" \
    ./node_modules/.bin/tsc --noEmit
  ```
  세션 종료 시점: 41/41 passing, tsc clean.
- **현재 서버 상태**:
  - PID 12027, port 4966 LISTEN
  - 로그: `/tmp/ko-difit.log`
  - 클라이언트 번들 hash: `index-4raNjd9D.js`
- **사용자 접속 URL**: http://127.0.0.1:4966/
