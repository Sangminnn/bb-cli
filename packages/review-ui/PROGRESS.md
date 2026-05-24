# codereview-viewer 진행 상황 메모

## 환경

- **dev 명령**: `cd /Users/sangminpark/projects/codereview-viewer && PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" pnpm dev`
- **빌드**: `pnpm build` (Vite 8 + ESM)
- **테스트**: `pnpm test --run`
- **Vite dev**: http://localhost:5173/
- **CLI API**: http://localhost:4966
- **Orchestrator watcher**: dev 시 자동 기동, `claude -p --model opus --effort high` 호출

## 핵심 흐름

- `scripts/dev.js`: tsc → dist/cli/index.js 실행 → CLI server URL 감지 시 Vite + orchestrator-watcher 동시 기동
- `scripts/orchestrator-watcher.js`: 2초마다 `/api/orchestrator/pending` 폴링, `reviewRequested=true && lastAuthor !== 'agent'` 스레드를 발견하면 `claude -p` 실행 후 `/api/orchestrator/reply` POST
- 서버 측 `updateCommentSession` (server.ts:729) → SSE `commentsChanged` 브로드캐스트
- 클라이언트 `useFileWatch` (`/api/watch` SSE) → `App.tsx:526 handleCommentsChanged` → `fetchServerThreads` → `replaceThreads`
- `App.tsx:247 skipNextCommentSyncRef` 로 SSE→fetch→setThreads→syncThreadsToServer 무한루프 방지

## 사용자 요구사항

1. ✅ orchestrator ping-pong 구현 (서버 + watcher)
2. ✅ "바로 리뷰" 버튼 → 클릭 시 reviewRequested=true 로 답글 등록 → watcher가 자동 응답
3. ✅ 답글 폼 카드 하단 상시 노출 (체이닝)
4. ✅ 헤더에서 file:line chip + Reply icon + User badge 제거
5. ✅ 한글화 + 노란 톤 일관성 (Edit→편집, Cancel→취소 등)
6. ✅ "바로 리뷰" 버튼 색상 → solid amber (`var(--color-yellow-btn-text)` 배경)
7. ✅ **답글이 UI에 안 뜸**: `useFileWatch` 의 `connectToWatch` 가 `onCommentsChanged` 의존성으로 매 부모 리렌더마다 SSE 재연결되던 문제. ref 패턴으로 stabilize. console.log 추가하여 검증 가능.
8. ⚠️ **"바로 리뷰" 클릭 무반응**: 버튼은 `disabled={!body.trim() || isSubmitting}` 이라 textarea 가 비어있으면 동작 안함. 사용자가 빈 상태에서 클릭한 것으로 추정. 추후 disabled hint UX 추가 검토.
9. ✅ **에이전트 응답 중 진행 UX**: `CommentThreadCard` 가 `thread.reviewRequested && lastAuthor !== 'Agent'` 일 때 노란 톤 "에이전트가 검토 중입니다…" 인디케이터 (Loader2 spinner) 표시.
10. ✅ **Add suggestion + ``` 코드폼**: `hasFencedCodeBlock` 신규 함수로 plain ```도 detect → Edit/Preview 토글 표시.`parseSuggestionBlocks`가`isSuggestion`플래그와 함께 양쪽 fence 모두 반환. 플레인 코드는 read-only`<pre><code>`로 렌더, suggestion 만 apply/reject 버튼 노출. server.ts / commentFormatting.ts 는 strict`hasSuggestionBlock` 유지.

## 핵심 파일 맵

| 경로                                                 | 역할                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/dev.js`                                     | dev 통합 런처 (CLI + Vite + watcher)                                      |
| `scripts/orchestrator-watcher.js`                    | claude -p 자동 응답 루프                                                  |
| `src/server/server.ts:819`                           | `/api/orchestrator/pending` 엔드포인트                                    |
| `src/server/server.ts:847`                           | `/api/orchestrator/reply` 엔드포인트                                      |
| `src/server/server.ts:729`                           | `updateCommentSession` (broadcast 트리거)                                 |
| `src/client/App.tsx:247-256`                         | `skipNextCommentSyncRef` + `fetchServerThreads`                           |
| `src/client/App.tsx:526`                             | `handleCommentsChanged` SSE 핸들러                                        |
| `src/client/hooks/useFileWatch.ts:42`                | EventSource `/api/watch`                                                  |
| `src/client/hooks/useDiffComments.ts:249`            | `replyToThread` (reviewRequested 세팅)                                    |
| `src/client/components/CommentForm.tsx`              | 한글 + amber 솔리드 "바로 리뷰"                                           |
| `src/client/components/CommentThreadCard.tsx`        | 카드 + 상시 답글 폼                                                       |
| `src/client/components/CommentsListModal.tsx:63`     | 한글 confirm 메시지                                                       |
| `src/client/components/SuggestionTemplateButton.tsx` | "Add suggestion" 버튼 (selectedCode 있어야 표시)                          |
| `src/client/components/CommentBodyRenderer.tsx:72`   | `hasSuggestionInBody` (현재 \`\`\`suggestion만 인식)                      |
| `src/utils/suggestionUtils.ts`                       | `hasSuggestionBlock`, `parseSuggestionBlocks`, `createSuggestionTemplate` |

## 알려진 코드 토큰

- `--color-yellow-btn-bg`: `rgba(180, 83, 9, 0.2)` (Submit translucent)
- `--color-yellow-btn-text`: `#fbbf24` (amber, 바로 리뷰 솔리드 배경)
- `--color-yellow-btn-hover-border`: `#d97706` (호버시 진한 amber)
- 카드/폼 보더: `border-yellow-600/50 border-l-4 border-l-yellow-400`

## 디버깅 메모

- 답글 안 보이는 원인 후보:
  1. SSE 이벤트는 도착하나 `fetchServerThreads`가 빈 배열 반환?
  2. `commentsContextKey` 가 비어 `setBootstrappedCommentsKey` 호출이 스킵되어 hasBootstrappedComments 가 false?
  3. dev 서버 재시작 직후 클라이언트 EventSource 미재연결 (탭 reload 필요)
  4. Vite 프록시가 SSE chunked stream을 버퍼링 → 이벤트 늦게/안 도착
- 다음 액션: 브라우저 DevTools Network 탭에서 `/api/watch` 응답 확인 + `console.log` 임시 삽입해서 handleCommentsChanged 호출 여부 검증
