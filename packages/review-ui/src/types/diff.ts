export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  chunks: DiffChunk[];
  isGenerated?: boolean;
}

export interface FileDiff {
  path: string;
  status: 'A' | 'M' | 'D';
  diff: string;
  additions: number;
  deletions: number;
}

export interface DiffChunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'normal' | 'hunk' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface ParsedDiff {
  chunks: DiffChunk[];
}

export type DiffViewMode = 'split' | 'unified';
export type LegacyDiffViewMode = 'side-by-side' | 'inline';
export type DiffSide = 'old' | 'new';
export type DiffLineRange = number | { start: number; end: number };

export interface DiffCommentPosition {
  /**
   * 코멘트 범위 구분자.
   * - 'line' (기본값): 특정 side의 라인(들)에 연결. 하위 호환 — undefined인 경우 'line'으로 취급.
   * - 'file': 파일 단위 코멘트로, line/side 앵커가 없음.
   */
  kind?: 'line' | 'file';
  side?: DiffSide;
  line?: DiffLineRange;
}

/**
 * 코드리뷰 rationale — 사람이 단 코멘트와 분리된 out-of-band 채널.
 * 서버가 `--rationale <path>`로 로드하며 FileSummaryCard / HunkRationaleCard에서 렌더링됨.
 */
export interface RationaleData {
  summaries?: Record<string, string>;
  hunkRationales?: Record<string, string>;
}

export interface DiffCommentCodeSnapshot {
  content: string;
  language?: string;
}

export type BaseMode = 'direct' | 'merge-base';

export interface DiffSelection {
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
}

export interface DiffResponse {
  commit: string;
  files: DiffFile[];
  ignoreWhitespace?: boolean;
  isEmpty?: boolean;
  mode?: DiffViewMode | LegacyDiffViewMode;
  openInEditorAvailable?: boolean;
  baseCommitish?: string;
  targetCommitish?: string;
  requestedBaseCommitish?: string;
  requestedTargetCommitish?: string;
  requestedBaseMode?: BaseMode;
  clearComments?: boolean;
  repositoryId?: string;
  commentImports?: CommentImport[];
  commentImportId?: string;
  rationale?: RationaleData;
}

export interface GeneratedStatusResponse {
  path: string;
  ref: string;
  isGenerated: boolean;
  source: 'path' | 'content';
}

export type LineNumber = number | [number, number];

export interface Comment {
  id: string;
  file: string;
  line: LineNumber;
  body: string;
  timestamp: string;
  author?: string;
  codeContent?: string; // 해당 라인의 실제 코드 내용
  side?: DiffSide; // 코멘트가 달린 side
}

export interface LineSelection {
  side: DiffSide;
  lineNumber: number;
}

export interface LegacyDiffComment {
  id: string;
  filePath: string;
  body: string;
  author?: string;
  createdAt: string; // ISO 8601 형식
  updatedAt: string; // ISO 8601 형식

  position: DiffCommentPosition;

  codeSnapshot?: DiffCommentCodeSnapshot;
}

export interface DiffCommentMessage {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  appliedSuggestions?: number[];
  codeSnapshotAtCreation?: string;
}

// 직접 수정(다중 위치, dry-run 2단계) 플로우 타입.
// 1. 사용자가 [직접 수정] 클릭 → directEditRequested=true → orchestrator가 픽업
// 2. 에이전트가 스레드를 읽고 /api/orchestrator/plan 으로 EditPlan 생성 → pendingPlan 설정
// 3. 사용자가 diff 프리뷰 검토 후 [실행] 클릭 → /api/threads/:id/execute-plan
//    → 서버가 검증·적용하고 원본 스냅샷 저장, executedPlan 설정
// 4. (선택) [되돌리기] 클릭 → /api/threads/:id/rollback-plan 으로 스냅샷 복원
export interface EditPlanItem {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  expectedOriginal: string;
  replacement: string;
  description?: string;
}

export interface EditPlan {
  id: string;
  threadId: string;
  createdAt: string;
  summary: string;
  items: EditPlanItem[];
}

export interface EditFileSnapshot {
  filePath: string;
  contentBeforeExecution: string;
}

export interface ExecutedEditPlan {
  plan: EditPlan;
  executedAt: string;
  snapshots: EditFileSnapshot[];
  rolledBack?: boolean;
  rolledBackAt?: string;
}

// 코멘트 및 viewed 상태 관리를 강화하기 위한 새 데이터 구조
export interface DiffCommentThread {
  id: string;
  filePath: string;
  createdAt: string; // ISO 8601 형식
  updatedAt: string; // ISO 8601 형식

  position: DiffCommentPosition;

  codeSnapshot?: DiffCommentCodeSnapshot;

  messages: DiffCommentMessage[];

  reviewRequested?: boolean;
  directEditRequested?: boolean;
  pendingPlan?: EditPlan;
  executedPlan?: ExecutedEditPlan;
  resolved?: boolean;
}

interface CommentImportBase {
  id?: string;
  filePath: string;
  position: DiffCommentPosition;
  body: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  codeSnapshot?: DiffCommentCodeSnapshot;
}

export interface ThreadCommentImport extends CommentImportBase {
  type: 'thread';
}

export interface ReplyCommentImport extends CommentImportBase {
  type: 'reply';
}

export type CommentImport = ThreadCommentImport | ReplyCommentImport;

export interface ViewedFileRecord {
  filePath: string;
  viewedAt: string; // ISO 8601 형식
  diffContentHash: string; // SHA-256 해시
}

export interface LegacyDiffContextStorage {
  version: 1; // 스키마 버전
  baseCommitish: string;
  targetCommitish: string;
  createdAt: string; // ISO 8601 형식
  lastModifiedAt: string; // ISO 8601 형식

  comments: LegacyDiffComment[];
  viewedFiles: ViewedFileRecord[];
}

export interface DiffContextStorage {
  version: 2; // 스키마 버전
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
  createdAt: string; // ISO 8601 형식
  lastModifiedAt: string; // ISO 8601 형식

  threads: DiffCommentThread[];
  viewedFiles: ViewedFileRecord[];
  appliedCommentImportIds: string[];
}

export interface CommentThread {
  id: string;
  file: string;
  line: LineNumber;
  side?: DiffSide;
  createdAt: string;
  updatedAt: string;
  codeContent?: string;
  messages: DiffCommentMessage[];
  reviewRequested?: boolean;
  directEditRequested?: boolean;
  pendingPlan?: EditPlan;
  executedPlan?: ExecutedEditPlan;
  resolved?: boolean;
}

// 리비전 선택기 관련 타입
export interface RevisionOption {
  value: string;
  label: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
}

export interface RevisionsResponse {
  specialOptions: RevisionOption[];
  branches: BranchInfo[];
  commits: CommitInfo[];
  originDefaultBranch?: string;
  resolvedBase?: string;
  resolvedTarget?: string;
}

// diff에서 추가 컨텍스트를 보여주기 위한 확장 라인 타입
export interface ExpandedLinesState {
  [filePath: string]: FileExpandedState;
}

export interface FileExpandedState {
  oldContent?: string[];
  newContent?: string[];
  expandedRanges: ExpandedRange[];
  oldTotalLines?: number;
  newTotalLines?: number;
}

export interface ExpandedRange {
  chunkIndex: number;
  direction: 'up' | 'down';
  count: number;
}

export interface ExpandedLine extends DiffLine {
  isExpanded?: boolean;
}
