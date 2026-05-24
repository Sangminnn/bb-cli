# bb-bitbucket-cli

Bitbucket Cloud를 GitHub CLI(`gh`)와 비슷한 흐름으로 다루기 위한 TypeScript 기반 CLI입니다.

이 프로젝트는 단순 CLI뿐 아니라, Bitbucket PR diff를 브라우저 기반 리뷰 UI로 열어볼 수 있는 bundled review workspace를 함께 제공합니다.

## 현재 상태

MVP 구현 상태입니다.

지원되는 핵심 흐름:

```bash
bb auth login
bb api /user
bb repo view workspace/repo
bb pr list --repo workspace/repo
bb pr view 123 --repo workspace/repo
bb pr diff 123 --repo workspace/repo
bb pr review 123 --repo workspace/repo
```

아직 실제 Bitbucket 계정/PR 대상 end-to-end 검증은 완료하지 않았고, 현재는 mock Bitbucket API 기반으로 `bb pr diff`와 `bb pr review` 흐름을 검증했습니다.

## 패키지 구조

```text
packages/
  cli/        # bb CLI 본체
  review-ui/ # ko-difit 기반 bundled PR review workspace
```

역할 분리:

- `packages/cli`
  - Bitbucket 인증
  - Bitbucket Cloud API 호출
  - repository / pull request 명령
  - PR diff 조회
  - review-ui 실행
- `packages/review-ui`
  - unified diff 시각화
  - 브라우저 기반 split/unified diff viewer
  - 로컬 리뷰 코멘트
  - 선택적 agent ping-pong 기반 리뷰 보조

## 설치 및 개발

```bash
npm install
npm run build
npm test
```

CLI 도움말 확인:

```bash
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js pr --help
```

개발 중 전역 명령처럼 쓰려면:

```bash
npm link -w packages/cli
bb --help
```

## 인증

MVP는 Bitbucket Cloud username + app password/API token 방식을 사용합니다.

```bash
bb auth login
bb auth status
bb auth logout
```

비대화형 환경에서는 환경변수로도 사용할 수 있습니다.

```bash
BITBUCKET_USERNAME=your-id \
BITBUCKET_APP_PASSWORD=your-token \
bb api /user
```

인증 정보는 기본적으로 아래 위치에 저장됩니다.

```text
~/.config/bb-cli/config.json
```

## 주요 명령

### API 직접 호출

```bash
bb api /user
bb api /repositories/workspace/repo
bb api /repositories/workspace/repo/pullrequests
```

POST 예시:

```bash
bb api /repositories/workspace/repo/pullrequests \
  --method POST \
  --field title="New PR" \
  --raw-field source='{"branch":{"name":"feature/test"}}'
```

### Repository

```bash
bb repo view workspace/repo
bb repo clone workspace/repo
bb repo clone workspace/repo my-folder
```

현재 git remote가 Bitbucket URL이면 `workspace/repo`를 자동 추론합니다.

### Pull Request

```bash
bb pr list --repo workspace/repo
bb pr view 123 --repo workspace/repo
bb pr create --repo workspace/repo --title "Fix bug" --head fix/bug --base main
bb pr checkout 123 --repo workspace/repo
bb pr merge 123 --repo workspace/repo
```

### PR diff

터미널에 patch 출력:

```bash
bb pr diff 123 --repo workspace/repo
```

bundled review UI로 열기:

```bash
bb pr diff 123 --repo workspace/repo --web
```

### PR review workspace

```bash
bb pr review 123 --repo workspace/repo
```

동작:

1. Bitbucket Cloud PR diff를 가져옵니다.
2. bundled `review-ui`에 unified diff를 stdin으로 전달합니다.
3. 브라우저 기반 diff review workspace를 엽니다.
4. 기본적으로 agent orchestrator는 꺼진 상태로 실행합니다.

agent ping-pong을 명시적으로 켜려면:

```bash
bb pr review 123 --repo workspace/repo --agent
```

### Agent Provider

review-ui orchestrator는 이제 Claude Code에 하드코딩되지 않고 provider 계층을 통해 agent를 실행합니다.

```bash
DIFIT_AGENT_PROVIDER=claude # 기본값, 기존 동작 유지
DIFIT_AGENT_PROVIDER=pi
DIFIT_AGENT_PROVIDER=codex
DIFIT_AGENT_PROVIDER=auto
DIFIT_AGENT_PROVIDER=custom
DIFIT_AGENT_PROVIDER=none
```

provider별 주요 환경변수:

```bash
# Claude Code 호환 provider
CLAUDE_BIN=claude
CLAUDE_MODEL=opus

# pi provider
PI_BIN=pi
PI_MODEL=openai/gpt-4o

# Codex provider
CODEX_BIN=codex
CODEX_MODEL=gpt-5.1-codex

# stdin/stdout 기반 custom agent command
DIFIT_AGENT_PROVIDER=custom
DIFIT_AGENT_COMMAND=/path/to/agent-command
```

동작 방식:

- `claude`: Claude Code print mode를 사용하며 session resume을 지원합니다.
- `pi`: `pi -p`를 no-session/full-history 방식으로 사용합니다.
- `codex`: `codex exec`를 full-history 방식으로 사용합니다.
- `custom`: stdin/stdout 기반 명령을 실행합니다.
- `auto`: 사용 가능한 provider를 `pi`, `claude`, `codex` 순서로 선택합니다.
- `none`: agent 응답을 비활성화합니다.

## GitHub CLI 스타일 매핑

| GitHub CLI | bb CLI |
|---|---|
| `gh auth login` | `bb auth login` |
| `gh repo clone owner/repo` | `bb repo clone workspace/repo` |
| `gh repo view` | `bb repo view` |
| `gh pr list` | `bb pr list` |
| `gh pr view 123` | `bb pr view 123` |
| `gh pr create` | `bb pr create` |
| `gh pr checkout 123` | `bb pr checkout 123` |
| `gh pr merge 123` | `bb pr merge 123` |
| `gh api ...` | `bb api ...` |

## 실제 Bitbucket 없이 테스트하기

실제 Bitbucket 계정이나 PR을 만들기 애매한 상황을 위해 mock 테스트 경로를 지원합니다.

환경변수:

```bash
BB_API_BASE_URL=http://127.0.0.1:4000/2.0
```

테스트에서는 mock Bitbucket API 서버를 띄운 뒤 다음 흐름을 검증합니다.

```text
bb pr diff
→ mock Bitbucket API에서 diff 수신
→ patch 출력

bb pr review
→ mock Bitbucket API에서 diff 수신
→ review-ui stdin으로 전달
```

현재 자동 테스트는 이 mock E2E까지 포함합니다.

```bash
npm test
```

## 검증된 항목

현재 로컬에서 확인한 항목:

- TypeScript build 통과
- CLI unit test 통과
- mock Bitbucket API E2E 통과
- `bb pr diff` mock 검증 통과
- `bb pr review` → review-ui stdin 전달 검증 통과
- review-ui stdin diff 서버 시작 검증 통과

아직 남은 실제 환경 검증:

- 실제 Bitbucket 계정으로 `bb auth login`
- 실제 PR 대상으로 `bb pr review <id>` 실행
- 브라우저에서 review-ui 화면 육안 확인
- 실제 Bitbucket inline comment 게시 기능 검증

## 향후 로드맵

우선순위가 높은 확장 후보:

1. Bitbucket PR metadata를 review-ui에 전달
2. 로컬 메모 / agent 질문 / PR 게시 후보 코멘트 분리
3. 선택한 코멘트를 Bitbucket PR inline comment로 게시
4. `bb pr comments publish <id> --file comments.json`
5. agent provider abstraction
   - `none`
   - `auto`
   - `claude`
   - `pi`
   - `codex`
6. pipeline 조회 / 로그 확인
7. workspace / project 탐색

## 설계 원칙

- `bb`는 Bitbucket API와 인증을 담당합니다.
- `review-ui`는 diff 시각화와 로컬 리뷰 워크스페이스를 담당합니다.
- agent 기능은 기본값이 아니라 명시 옵션으로 다룹니다.
- 실제 PR에 올라가는 코멘트와 agent에게 묻는 질문은 분리하는 방향으로 발전시킵니다.
