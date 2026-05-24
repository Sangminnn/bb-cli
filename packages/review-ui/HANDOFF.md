# Handoff — codereview-viewer 진행 메모

작성: 2026-05-05
작업 디렉터리: `/Users/sangminpark/projects/codereview-viewer`

## 한 줄 요약

사용자 메시지 **수정 UX 제거 + Agent 메시지 삭제 허용** 리팩터를 진행 중. `CommentThreadCard.tsx`는 이미 재작성 완료. **prop 체인에서 `onUpdateMessage` 제거 작업이 미완료**. 별개로 "에이전트가 검토 중입니다…" 인디케이터가 SSE 도착 후에도 안 뜨는 버그가 미해결.

## 사용자 요구사항 (그대로)

> "그리고 내 답글을 삭제할 수 있으면 agent의 답변도 삭제할 수 있어야하는거 아닌지?
> 애초에 내가 남겼던 답변을 수정하는것 자체도 전혀 유효하지않은 ux인데 뭔지"

→ (1) Agent 답글도 삭제 가능해야 함
→ (2) 메시지 **수정** 버튼/UX 자체를 통째로 제거

## 완료된 작업

- `src/client/components/CommentThreadCard.tsx` 재작성:
  - `Edit2` import 제거, `useState` 제거, `isEditing` state 및 편집 폼 분기 제거
  - `onUpdateMessage` prop 제거
  - 모든 메시지(루트 + 답글)가 항상 액션 버튼 노출
    - root → ✓ Check (스레드 해결)
    - reply → 🗑 Trash2 (답글 삭제) — **Agent 답글 포함**
- ```` typing → 편집/미리보기 토글` 동작은 브라우저 검증 완료 (Playwright snapshot 상의 e707/e708/e709)

## 남은 작업 (우선순위 순)

### 1. `onUpdateMessage` prop 체인 sweep

`CommentThreadCard`에서 prop을 제거했으므로 호출하는 모든 상위 체인에서도 제거해야 함. 빌드가 깨진 상태일 가능성이 높다.

production 파일:

- [ ] `src/client/components/DiffChunk.tsx` — lines 40, 67, 327, 469
- [ ] `src/client/components/SideBySideDiffChunk.tsx` — lines 41, 99, 706
- [ ] `src/client/components/CommentsListModal.tsx` — lines 19, 33, 185
- [ ] `src/client/components/DiffViewer.tsx` — lines 40, 187, 343
- [ ] `src/client/viewers/TextDiffViewer.tsx` — lines 25, 127
- [ ] `src/client/viewers/types.ts` — line 41 (DiffViewerBodyProps interface)
- [ ] `src/client/App.tsx` — lines 1384, 1464에서 `onUpdateMessage={updateMessage}` 전달 제거
  - Line 166의 `updateMessage` 구조분해는 `useDiffComments`의 legacy `updateComment` (hooks/useDiffComments.ts:343)에서만 사용되므로 그대로 두되, **export 자체가 더 이상 필요 없으면 hooks도 정리** 검토

테스트 파일:

- [ ] `src/client/components/CommentThreadCard.test.tsx`
  - lines 48, 81, 102, 134, 153: `onUpdateMessage={vi.fn()}` 제거
  - lines 44, 77, 98, 130, 149: `onGeneratePrompt` (이미 삭제된 prop) 제거
  - line 55, 86: `getAllByTitle('메시지 수정')` / `queryByTitle('메시지 수정')` 단언 제거
  - lines 144-169: `"shows the shared comment form layout while editing"` 테스트 **전체 제거**
- [ ] `src/client/components/CommentsListModal.test.tsx` — lines 93, 111, 150, 172, 197, 222, 250, 271
- [ ] `src/client/components/DiffViewer.test.tsx` — line 80
- [ ] `src/client/viewers/ImageDiffViewer.test.tsx` — line 21
- [ ] `src/client/viewers/MarkdownDiffViewer.test.tsx` — line 58
- [ ] `src/client/viewers/NotebookDiffViewer.test.tsx` — line 76

검증:

- [ ] `pnpm build`
- [ ] `pnpm test --run`
- [ ] Playwright로 Agent 메시지에 답글 삭제 버튼이 보이는지, 메시지 수정 버튼이 어디에도 없는지 확인

### 2. (별도 이슈) "에이전트가 검토 중입니다…" 인디케이터 미노출 버그

- 증상: 사용자가 "바로 리뷰" 클릭 후 서버에는 `reviewRequested: true`가 5초 이상 유지되는데 UI에 노란 인디케이터가 안 뜸.
- 의심 원인: `src/client/hooks/useDiffComments.ts:145-162`의 `saveThreads`가 `!baseCommitish || !targetCommitish`일 때 early-return → SSE-driven `replaceThreads` 이후 `setThreads`가 안 돌아 UI가 갱신되지 않을 가능성.
- 다음 액션:
  1. `useDiffComments.ts:145-162` 다시 확인. early-return 조건이 `replaceThreads` 경로까지 막는지 검증.
  2. 실제로 `App.tsx:526 handleCommentsChanged` → `replaceThreads` → `setThreads` 흐름에서 어디까지 호출되는지 console.log로 확인.
  3. `CommentThreadCard.tsx`의 `isAgentReviewing` 분기는 정상이므로, 데이터가 컴포넌트까지 도달하는지가 핵심.

## 핵심 파일 / 라인 메모

- `CommentThreadCard.tsx`의 인디케이터 로직 (변경 없음, 그대로 유지):
  ```tsx
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastAuthorIsAgent = lastMessage?.author?.trim().toLowerCase() === 'agent';
  const isAgentReviewing = thread.reviewRequested === true && !lastAuthorIsAgent;
  ```
- `updateMessage`가 `useDiffComments.ts:322`에 정의돼 있고 동일 파일 line 343의 legacy `updateComment`에서만 사용. 외부 export가 사라지면 양쪽 다 제거 가능.

## 아키텍처 컨텍스트 (잊지 말 것)

- React 19 + Vite 8 + Express 로컬 diff viewer (difit fork)
- claude -p headless로 watcher가 자동 응답 (`scripts/orchestrator-watcher.js`)
- SSE: `/api/watch` → `App.tsx:526 handleCommentsChanged` → `fetchServerThreads` → `replaceThreads`
- 무한 루프 가드: `App.tsx:247 skipNextCommentSyncRef`
- 댓글 GET 엔드포인트는 `/api/comments-json` (서버 server.ts:787). `/api/comments`는 HTML index를 반환하니 사용 금지.

## 빠른 재시작 커맨드

```bash
cd /Users/sangminpark/projects/codereview-viewer
PATH="/Users/sangminpark/.nvm/versions/node/v24.15.0/bin:$PATH" pnpm dev
# Vite: http://localhost:5173/  CLI API: http://localhost:4966
```

빌드/테스트:

```bash
pnpm build
pnpm test --run src/utils/suggestionUtils.test.ts
```

## 다음 세션 첫 액션 권장

1. `grep -rn "onUpdateMessage\|onGeneratePrompt" src/` 로 잔존 위치 정확히 확인
2. production 파일 6개를 병렬 Read → 병렬 Edit
3. 테스트 파일 6개 동일하게 처리
4. `pnpm build && pnpm test --run`
5. 통과하면 (1)에서 1번 인디케이터 버그로 넘어감
