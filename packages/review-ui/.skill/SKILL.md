---
name: codereview
description: |
  Pre-PR self-review with live ping-pong. Boots the codereview-viewer (a difit
  fork) for the working tree of the current repository, with the orchestrator
  watcher attached so any comment you leave gets an automatic Agent reply
  inside the viewer (B-mode delta prompts via --session-id, ~5x token savings
  vs a naive full-history reply). Closing the browser tab ends the review.
allowed-tools:
  - Bash
---

## When to use

Invoke before opening a pull request, when you want to review your own
working-tree changes with the option to ping-pong with the agent on specific
lines or hunks. The viewer launches in your default browser; you read the
diff, leave comments where needed, the agent replies in-thread automatically,
and you close the tab when satisfied.

Triggers:
- "리뷰 띄워줘", "/codereview", "PR 올리기 전 한번 보자"
- 작업 단위 마무리 후, 본인이 직접 변경분을 훑고 싶을 때

Do **not** use:
- working tree에 변경이 전혀 없을 때 (보여줄 게 없음)
- 비대화형/CI 환경 (브라우저 필요)

## How it works

```
/codereview
   │
   ▼
codereview-skill.sh
   │  cd <viewer-repo>
   │  DIFIT_TARGET_CWD=<your-repo> pnpm dev working --include-untracked
   ▼
scripts/dev.js   spawns 3 children:
   ├── difit CLI  → Express 서버 (port 4966 등) + dist/client UI
   ├── Vite       → 개발 모드 UI 핫리로드 (port 5173)
   └── orchestrator-watcher → /api/comments-json 폴링 → 새 코멘트 시
                              claude CLI를 B-mode 프롬프트로 자동 호출 →
                              응답을 viewer에 reply로 게시
```

**라이프사이클**: 사용자가 브라우저 탭을 닫으면 server가 client disconnect를
감지해 process.exit → dev.js가 자식들 SIGTERM → 종료. 다음 호출 시 새 인스턴스.

**다중 인스턴스**: 포트 점유 시 difit이 자동 fallback (server.ts EADDRINUSE 처리).

## Tool

CLI entry: `<viewer-repo>/bin/codereview-skill.sh`

```
codereview-skill [<target-repo>]
```

- `<target-repo>` 생략 시 호출 시점의 cwd를 사용
- 사용자가 보는 diff = working tree (uncommitted) + untracked
- gitignore된 파일은 자동 제외 (working tree 본질)

## Standard procedure (caller skill 안에 임베드 시)

```bash
codereview-skill                # 현재 repo의 working tree 검토
# 종료 신호: 사용자가 탭 닫음
# 호출자 skill은 이 명령이 리턴할 때까지 블로킹
```

## Notes

- viewer가 `dist/cli/index.js`를 실행하므로 첫 사용 전 `pnpm build` 필요
- watcher는 `claude` CLI를 자식 프로세스로 호출 — 호출 머신에 Claude Code CLI가 설치되어 있어야 함
- watcher 비활성화: `DIFIT_DISABLE_ORCHESTRATOR=1` env로 끔
