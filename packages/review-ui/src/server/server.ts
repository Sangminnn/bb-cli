import { execSync, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { type Server } from 'http';
import { extname, join, dirname, isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import express, { type Express } from 'express';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { type DiffMode } from '../types/watch.js';
import { formatCommentsOutput } from '../utils/commentFormatting.js';
import {
  mergeCommentImports,
  normalizeCommentImports,
  serializeCommentImports,
} from '../utils/commentImports.js';
import { normalizeDiffViewMode } from '../utils/diffMode.js';
import { resolveEditorOption } from '../utils/editorOptions.js';
import { getFileExtension } from '../utils/fileUtils.js';
import { hasSuggestionBlock, parseSuggestionBlocks } from '../utils/suggestionUtils.js';

import { FileWatcherService } from './file-watcher.js';
import { GitDiffParser } from './git-diff.js';

import {
  type BaseMode,
  type CommentImport,
  type Comment,
  type CommentThread,
  type DiffCommentMessage,
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type EditFileSnapshot,
  type EditPlan,
  type EditPlanItem,
  type ExecutedEditPlan,
  type GeneratedStatusResponse,
  type RationaleData,
  type RevisionsResponse,
} from '@/types/diff.js';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
} from '../utils/diffSelection.js';

interface ServerOptions {
  selection?: DiffSelection;
  stdinDiff?: string;
  preferredPort?: number;
  host?: string;
  openBrowser?: boolean;
  mode?: string;
  ignoreWhitespace?: boolean;
  clearComments?: boolean;
  commentImports?: CommentImport[];
  keepAlive?: boolean;
  diffMode?: DiffMode;
  repoPath?: string;
  contextLines?: number;
  rationalePath?: string;
}

function loadRationaleFile(rationalePath: string | undefined): RationaleData | undefined {
  if (!rationalePath) {
    return undefined;
  }

  try {
    const raw = readFileSync(rationalePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`Rationale file is not an object: ${rationalePath}`);
      return undefined;
    }

    const candidate = parsed as { summaries?: unknown; hunkRationales?: unknown };
    const result: RationaleData = {};

    if (candidate.summaries && typeof candidate.summaries === 'object') {
      const summaries: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.summaries)) {
        if (typeof value === 'string') summaries[key] = value;
      }
      if (Object.keys(summaries).length > 0) result.summaries = summaries;
    }

    if (candidate.hunkRationales && typeof candidate.hunkRationales === 'object') {
      const hunkRationales: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.hunkRationales)) {
        if (typeof value === 'string') hunkRationales[key] = value;
      }
      if (Object.keys(hunkRationales).length > 0) result.hunkRationales = hunkRationales;
    }

    return result;
  } catch (error) {
    console.warn(`Failed to load rationale file (${rationalePath}):`, error);
    return undefined;
  }
}

const GENERATED_STATUS_CACHE_TTL_MS = 60_000;
const MAX_DIFF_CACHE_ENTRIES = 8;

function createDiffCacheKey(selection: DiffSelection, ignoreWhitespace: boolean) {
  return `${getDiffSelectionKey(selection)}\u0000${ignoreWhitespace ? '1' : '0'}`;
}

function getCachedDiffResponse(
  cache: Map<string, DiffResponse>,
  key: string,
): DiffResponse | undefined {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }

  // Refresh insertion order to keep the most recently used entry.
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function setCachedDiffResponse(cache: Map<string, DiffResponse>, key: string, value: DiffResponse) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > MAX_DIFF_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    cache.delete(oldestKey);
  }
}

/**
 * Mutate cached diffs in-place to reflect an applied suggestion immediately on the new side.
 * Diff is normally a commit-vs-commit comparison, but apply-suggestion writes to the working
 * tree only, so the user would otherwise see stale lines until a new commit lands. This
 * keeps the visual diff in sync with the file change for the simple case where the
 * suggestion's line count matches the snapshot's line count.
 *
 * Returns true if at least one cached chunk was updated.
 */
const applyOverlayToCachedDiff = (
  cache: Map<string, DiffResponse>,
  filePath: string,
  newSideStartLine: number,
  newSideEndLine: number,
  suggestedLines: string[],
): boolean => {
  const originalLineCount = newSideEndLine - newSideStartLine + 1;
  if (suggestedLines.length !== originalLineCount) {
    return false;
  }

  let anyApplied = false;
  for (const diff of cache.values()) {
    const file = diff.files.find((f) => f.path === filePath);
    if (!file) continue;

    for (const chunk of file.chunks) {
      const chunkNewEnd = chunk.newStart + chunk.newLines - 1;
      if (chunk.newStart > newSideStartLine || chunkNewEnd < newSideEndLine) continue;

      const targetLines = chunk.lines.filter(
        (line) =>
          line.newLineNumber !== undefined &&
          line.newLineNumber >= newSideStartLine &&
          line.newLineNumber <= newSideEndLine &&
          (line.type === 'add' || line.type === 'normal' || line.type === 'context'),
      );
      if (targetLines.length !== originalLineCount) continue;

      targetLines
        .sort((a, b) => (a.newLineNumber ?? 0) - (b.newLineNumber ?? 0))
        .forEach((line, idx) => {
          line.content = suggestedLines[idx];
        });
      anyApplied = true;
    }
  }

  return anyApplied;
};

interface CommentSessionState {
  threads: DiffCommentThread[];
  version: number;
  submitted: boolean;
  submittedAt: string | null;
}

const isPendingReplyThread = (thread: DiffCommentThread) => {
  if (thread.resolved) return false;
  if (!thread.reviewRequested) return false;
  if (thread.directEditRequested) return false;
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastAuthor = lastMessage?.author?.trim().toLowerCase();
  return lastAuthor !== 'agent';
};

// Direct-edit "plan" pending: user clicked [직접 수정] but no plan generated yet.
// Once orchestrator submits the plan via /api/orchestrator/plan, directEditRequested
// is cleared and pendingPlan is set; from then on the user controls execution.
const isPendingPlanThread = (thread: DiffCommentThread) => {
  if (thread.resolved) return false;
  if (!thread.directEditRequested) return false;
  if (thread.pendingPlan) return false;
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastAuthor = lastMessage?.author?.trim().toLowerCase();
  return lastAuthor !== 'agent';
};

function createResolvedCommentSelection(
  responseDiffData: DiffResponse,
  fallbackSelection: DiffSelection,
  stdinDiff: boolean,
): DiffSelection {
  const baseCommitish =
    responseDiffData.baseCommitish ?? (stdinDiff ? 'stdin' : fallbackSelection.baseCommitish);
  const targetCommitish =
    responseDiffData.targetCommitish ?? (stdinDiff ? 'stdin' : fallbackSelection.targetCommitish);
  const baseMode = responseDiffData.requestedBaseMode ?? fallbackSelection.baseMode;

  return createDiffSelection(baseCommitish, targetCommitish, baseMode);
}

function createCommentSessionKey(selection: DiffSelection): string {
  return getDiffSelectionKey(selection);
}

export async function startServer(
  options: ServerOptions,
): Promise<{ port: number; url: string; isEmpty?: boolean; server?: Server }> {
  const app = express();
  const repositoryPath = resolve(options.repoPath ?? process.cwd());
  const repositoryId = createHash('sha256').update(repositoryPath).digest('hex');
  const initialCommentImports = options.commentImports || [];
  const initialSelection = options.selection ?? createDiffSelection('', '');
  const commentImportId =
    initialCommentImports.length > 0
      ? createHash('sha256').update(serializeCommentImports(initialCommentImports)).digest('hex')
      : undefined;
  const parser = new GitDiffParser(repositoryPath);
  const fileWatcher = new FileWatcherService();
  const generatedStatusCache = new Map<
    string,
    { value: GeneratedStatusResponse; expiresAt: number }
  >();
  const diffDataCache = new Map<string, DiffResponse>();
  const initialIgnoreWhitespace = options.ignoreWhitespace || false;
  const diffMode = normalizeDiffViewMode(options.mode);
  const rationaleData = loadRationaleFile(options.rationalePath);
  const parseBaseMode = (value: unknown): BaseMode | undefined => {
    if (value === 'merge-base') {
      return 'merge-base';
    }

    return undefined;
  };

  app.use(express.json({ limit: '8mb' }));
  app.use(express.text()); // For sendBeacon text/plain requests

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  // Skip validation if using stdin diff
  if (!options.stdinDiff) {
    const isValidCommit = await parser.validateCommit(initialSelection.targetCommitish);
    if (!isValidCommit) {
      throw new Error(`Invalid or non-existent commit: ${initialSelection.targetCommitish}`);
    }
  }

  // Generate initial diff data for isEmpty check
  let initialDiffData: DiffResponse;
  if (options.stdinDiff) {
    // Parse stdin diff directly
    initialDiffData = parser.parseStdinDiff(options.stdinDiff);
  } else {
    initialDiffData = await parser.parseDiff(
      initialSelection,
      initialIgnoreWhitespace,
      options.contextLines,
    );
    setCachedDiffResponse(
      diffDataCache,
      createDiffCacheKey(initialSelection, initialIgnoreWhitespace),
      initialDiffData,
    );
  }

  // Function to invalidate cache when file changes are detected
  const invalidateCache = () => {
    diffDataCache.clear();
    generatedStatusCache.clear();
    parser.clearResolvedCommitCache();
  };

  // Track current revisions for cache invalidation
  let currentSelection = initialSelection;
  let currentCommentSelection = createResolvedCommentSelection(
    initialDiffData,
    initialSelection,
    Boolean(options.stdinDiff),
  );

  function parseRepositoryRelativePath(
    filepath: unknown,
  ):
    | { ok: true; path: string }
    | { ok: false; error: 'Invalid file path' | 'File path outside repository' } {
    if (typeof filepath !== 'string' || filepath.length === 0) {
      return { ok: false, error: 'Invalid file path' };
    }

    const normalizedFilepath = filepath.replace(/\\/g, '/');
    const hasParentTraversal = normalizedFilepath.split('/').some((segment) => segment === '..');
    if (isAbsolute(filepath) || normalizedFilepath.startsWith('/') || hasParentTraversal) {
      return { ok: false, error: 'File path outside repository' };
    }

    const resolvedPath = resolve(repositoryPath, normalizedFilepath);
    if (resolvedPath !== repositoryPath && !resolvedPath.startsWith(`${repositoryPath}${sep}`)) {
      return { ok: false, error: 'File path outside repository' };
    }

    return { ok: true, path: normalizedFilepath };
  }

  const ATTACHMENTS_DIR_NAME = '.difit-attachments';
  const ATTACHMENTS_DIR = resolve(repositoryPath, ATTACHMENTS_DIR_NAME);
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
  const FILE_CONTENT_MAX_BYTES = 256_000;
  const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

  const ensureAttachmentsDir = () => {
    if (!existsSync(ATTACHMENTS_DIR)) {
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    }
    const gitignorePath = resolve(repositoryPath, '.gitignore');
    const ignoreLine = `${ATTACHMENTS_DIR_NAME}/`;
    try {
      if (existsSync(gitignorePath)) {
        const current = readFileSync(gitignorePath, 'utf-8');
        const lines = current.split('\n').map((line) => line.trim());
        const alreadyIgnored = lines.some(
          (line) => line === ignoreLine || line === ATTACHMENTS_DIR_NAME,
        );
        if (!alreadyIgnored) {
          const prefix = current.endsWith('\n') || current.length === 0 ? '' : '\n';
          appendFileSync(gitignorePath, `${prefix}${ignoreLine}\n`);
        }
      }
    } catch (error) {
      console.warn('[attachments] failed to update .gitignore:', error);
    }
  };

  const isImageExtension = (filePath: string) => IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());

  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  const isValidUtf8 = (buffer: Buffer): boolean => {
    try {
      utf8Decoder.decode(buffer);
      return true;
    } catch {
      return false;
    }
  };

  type FileContextResult =
    | { kind: 'text'; content: string }
    | { kind: 'image'; relativePath: string; absolutePath: string }
    | { kind: 'binary'; reason: 'too-large' | 'not-utf8' | 'unreadable' | 'missing' };

  const classifyFileForReview = (filePath: string): FileContextResult => {
    const parsed = parseRepositoryRelativePath(filePath);
    if (!parsed.ok) return { kind: 'binary', reason: 'unreadable' };
    const resolvedPath = resolve(repositoryPath, parsed.path);
    let buffer: Buffer;
    try {
      buffer = readFileSync(resolvedPath);
    } catch {
      return { kind: 'binary', reason: 'missing' };
    }
    if (isImageExtension(parsed.path)) {
      return { kind: 'image', relativePath: parsed.path, absolutePath: resolvedPath };
    }
    if (buffer.byteLength > FILE_CONTENT_MAX_BYTES) {
      return { kind: 'binary', reason: 'too-large' };
    }
    if (!isValidUtf8(buffer)) {
      return { kind: 'binary', reason: 'not-utf8' };
    }
    return { kind: 'text', content: buffer.toString('utf-8') };
  };

  const getHeadSha = () => {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: repositoryPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };

  const commentSessions = new Map<string, CommentSessionState>();
  const initialCommentThreads = mergeCommentImports([], initialCommentImports).threads;
  if (initialCommentThreads.length > 0) {
    commentSessions.set(createCommentSessionKey(currentCommentSelection), {
      threads: initialCommentThreads,
      version: 1,
      submitted: false,
      submittedAt: null,
    });
  }

  function getCommentSelectionFromQuery(query: Record<string, unknown>): DiffSelection {
    const hasBase = typeof query.base === 'string';
    const hasTarget = typeof query.target === 'string';
    const hasBaseMode = typeof query.baseMode === 'string';

    if (!hasBase && !hasTarget && !hasBaseMode) {
      return currentCommentSelection;
    }

    return createDiffSelection(
      hasBase ? (query.base as string) : currentCommentSelection.baseCommitish,
      hasTarget ? (query.target as string) : currentCommentSelection.targetCommitish,
      hasBaseMode
        ? parseBaseMode(query.baseMode)
        : hasBase || hasTarget
          ? undefined
          : currentCommentSelection.baseMode,
    );
  }

  function getOrCreateCommentSession(selection: DiffSelection): CommentSessionState {
    const key = createCommentSessionKey(selection);
    const existing = commentSessions.get(key);
    if (existing) {
      return existing;
    }

    const nextSession: CommentSessionState = {
      threads: [],
      version: 0,
      submitted: false,
      submittedAt: null,
    };
    commentSessions.set(key, nextSession);
    return nextSession;
  }

  app.get('/api/diff', async (req, res) => {
    const ignoreWhitespace = req.query.ignoreWhitespace === 'true';
    const hasBase = typeof req.query.base === 'string';
    const hasTarget = typeof req.query.target === 'string';
    const hasBaseMode = typeof req.query.baseMode === 'string';
    const requestedSelection = createDiffSelection(
      hasBase ? (req.query.base as string) : currentSelection.baseCommitish,
      hasTarget ? (req.query.target as string) : currentSelection.targetCommitish,
      hasBaseMode
        ? parseBaseMode(req.query.baseMode)
        : hasBase || hasTarget
          ? undefined
          : currentSelection.baseMode,
    );
    const shouldIncludeCommentImports =
      initialCommentImports.length > 0 &&
      (Boolean(options.stdinDiff) || diffSelectionsEqual(requestedSelection, initialSelection));
    currentSelection = requestedSelection;

    let responseDiffData = initialDiffData;
    if (!options.stdinDiff) {
      const cacheKey = createDiffCacheKey(requestedSelection, ignoreWhitespace);
      const cached = getCachedDiffResponse(diffDataCache, cacheKey);
      if (cached) {
        responseDiffData = cached;
      } else {
        responseDiffData = await parser.parseDiff(
          requestedSelection,
          ignoreWhitespace,
          options.contextLines,
        );
        setCachedDiffResponse(diffDataCache, cacheKey, responseDiffData);
        generatedStatusCache.clear();
      }
    }

    currentCommentSelection = createResolvedCommentSelection(
      responseDiffData,
      requestedSelection,
      Boolean(options.stdinDiff),
    );

    const baseCommitish =
      responseDiffData.baseCommitish ?? (options.stdinDiff ? 'stdin' : undefined);
    const targetCommitish =
      responseDiffData.targetCommitish ?? (options.stdinDiff ? 'stdin' : undefined);
    const requestedBaseCommitish =
      responseDiffData.requestedBaseCommitish ??
      (requestedSelection.baseCommitish || (options.stdinDiff ? 'stdin' : undefined));
    const requestedTargetCommitish =
      responseDiffData.requestedTargetCommitish ??
      (requestedSelection.targetCommitish || (options.stdinDiff ? 'stdin' : undefined));
    const requestedBaseMode = responseDiffData.requestedBaseMode ?? requestedSelection.baseMode;

    const clearCommentsForThisResponse = options.clearComments;
    options.clearComments = false;
    res.json({
      ...responseDiffData,
      ignoreWhitespace,
      mode: diffMode,
      openInEditorAvailable: !options.stdinDiff,
      baseCommitish,
      targetCommitish,
      requestedBaseCommitish,
      requestedTargetCommitish,
      requestedBaseMode,
      clearComments: clearCommentsForThisResponse,
      repositoryId,
      commentImports: shouldIncludeCommentImports ? initialCommentImports : undefined,
      commentImportId: shouldIncludeCommentImports ? commentImportId : undefined,
      rationale: rationaleData,
    });
  });

  app.get(/^\/api\/generated-status\/(.*)$/, async (req, res) => {
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Generated status is not available for stdin diff' });
      return;
    }

    try {
      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const normalizedFilepath = filepathResult.path;

      const ref = (req.query.ref as string) || currentSelection.targetCommitish || 'HEAD';
      const cacheKey = `${ref}:${normalizedFilepath}`;
      const now = Date.now();
      const cached = generatedStatusCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        res.json(cached.value);
        return;
      }

      const status = await parser.getGeneratedStatus(normalizedFilepath, ref);
      const response: GeneratedStatusResponse = {
        path: normalizedFilepath,
        ref,
        ...status,
      };
      generatedStatusCache.set(cacheKey, {
        value: response,
        expiresAt: now + GENERATED_STATUS_CACHE_TTL_MS,
      });

      res.json(response);
    } catch (error) {
      console.error('Error fetching generated status:', error);
      res.status(500).json({ error: 'Failed to get generated status' });
    }
  });

  // Get available revisions for revision selector
  app.get('/api/revisions', async (_req, res) => {
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Revision selection not available for stdin diff' });
      return;
    }

    try {
      const { branches, commits, originDefaultBranch, resolvedBase, resolvedTarget } =
        await parser.getRevisionOptions(
          currentSelection.baseCommitish,
          currentSelection.targetCommitish,
        );

      const response: RevisionsResponse = {
        specialOptions: [
          { value: '.', label: 'All Uncommitted Changes' },
          { value: 'staged', label: 'Staging Area' },
          { value: 'working', label: 'Working Directory' },
        ],
        branches,
        commits,
        originDefaultBranch,
        resolvedBase,
        resolvedTarget,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching revisions:', error);
      res.status(500).json({ error: 'Failed to fetch revisions' });
    }
  });

  app.get(/^\/api\/line-count\/(.*)$/, async (req, res) => {
    try {
      if (options.stdinDiff) {
        res.status(404).json({ error: 'Line count not available for stdin diff' });
        return;
      }

      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const filepath = filepathResult.path;
      const oldRef = req.query.oldRef as string | undefined;
      const oldPathResult = req.query.oldPath
        ? parseRepositoryRelativePath(req.query.oldPath)
        : { ok: true as const, path: filepath };
      if (!oldPathResult.ok) {
        res.status(400).json({ error: oldPathResult.error });
        return;
      }
      const newRef = req.query.newRef as string | undefined;
      const oldPath = oldPathResult.path;

      const result: { oldLineCount?: number; newLineCount?: number } = {};

      if (oldRef) {
        try {
          result.oldLineCount = await parser.getLineCount(oldPath, oldRef);
        } catch {
          result.oldLineCount = 0;
        }
      }
      if (newRef) {
        try {
          result.newLineCount = await parser.getLineCount(filepath, newRef);
        } catch {
          result.newLineCount = 0;
        }
      }

      res.json(result);
    } catch (error) {
      console.error('Error fetching line count:', error);
      res.status(500).json({ error: 'Failed to get line count' });
    }
  });

  app.get(/^\/api\/blob\/(.*)$/, async (req, res) => {
    try {
      // If using stdin diff, blob content is not available
      if (options.stdinDiff) {
        res.status(404).json({ error: 'Blob content not available for stdin diff' });
        return;
      }

      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const filepath = filepathResult.path;
      const ref = (req.query.ref as string) || 'HEAD';

      const blob = await parser.getBlobContent(filepath, ref);

      // Determine content type based on file extension
      const ext = getFileExtension(filepath);
      const contentTypes: { [key: string]: string } = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        ico: 'image/x-icon',
        tiff: 'image/tiff',
        tif: 'image/tiff',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
      };

      const contentType = contentTypes[ext || ''] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(blob);
    } catch (error) {
      console.error('Error fetching blob:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  function normalizeLineValue(line: unknown): DiffCommentThread['position']['line'] {
    if (Array.isArray(line) && line.length === 2) {
      const start = line[0] as unknown;
      const end = line[1] as unknown;
      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start > 0 &&
        end > 0 &&
        start <= end
      ) {
        return { start, end };
      }
    }

    if (typeof line === 'number' && Number.isInteger(line) && line > 0) {
      return line;
    }

    return 1;
  }

  function normalizeComment(comment: Comment): DiffCommentThread {
    const now = new Date().toISOString();
    const timestamp = typeof comment.timestamp === 'string' ? comment.timestamp : now;
    const threadId =
      typeof comment.id === 'string' && comment.id.length > 0
        ? comment.id
        : createHash('sha256').update(JSON.stringify(comment)).digest('hex').slice(0, 12);
    const filePath =
      typeof comment.file === 'string' && comment.file.length > 0 ? comment.file : '<unknown file>';

    return {
      id: threadId,
      filePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      position: {
        side: comment.side ?? 'new',
        line: normalizeLineValue(comment.line),
      },
      codeSnapshot:
        typeof comment.codeContent === 'string'
          ? {
              content: comment.codeContent,
            }
          : undefined,
      messages: [
        {
          id: threadId,
          body: comment.body,
          author: comment.author,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
  }

  function toCommentThread(thread: DiffCommentThread): CommentThread {
    const positionLine = thread.position.line;

    let line: CommentThread['line'];
    if (typeof positionLine === 'number') {
      line = positionLine;
    } else if (positionLine && 'start' in positionLine && 'end' in positionLine) {
      line = [positionLine.start, positionLine.end];
    } else {
      line = 0;
    }

    return {
      id: thread.id,
      file: thread.filePath,
      line,
      side: thread.position.side,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      codeContent: thread.codeSnapshot?.content,
      messages: thread.messages,
    };
  }

  function normalizeThreadPayload(thread: CommentThread | DiffCommentThread): DiffCommentThread {
    if ('filePath' in thread && 'position' in thread) {
      return thread;
    }

    const threadId =
      typeof thread.id === 'string' && thread.id.length > 0
        ? thread.id
        : createHash('sha256').update(JSON.stringify(thread)).digest('hex').slice(0, 12);
    const now = new Date().toISOString();
    const messages =
      Array.isArray(thread.messages) && thread.messages.length > 0
        ? thread.messages.map((message, index) => ({
            id:
              typeof message.id === 'string' && message.id.length > 0
                ? message.id
                : `${threadId}:${index}`,
            body: message.body,
            author: message.author,
            createdAt: message.createdAt || thread.createdAt || now,
            updatedAt: message.updatedAt || message.createdAt || thread.updatedAt || now,
            appliedSuggestions: Array.isArray(message.appliedSuggestions)
              ? message.appliedSuggestions.filter((idx) => typeof idx === 'number')
              : undefined,
          }))
        : [
            {
              id: threadId,
              body: '',
              createdAt: thread.createdAt || now,
              updatedAt: thread.updatedAt || thread.createdAt || now,
            },
          ];
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    return {
      id: threadId,
      filePath:
        typeof thread.file === 'string' && thread.file.length > 0 ? thread.file : '<unknown file>',
      createdAt: thread.createdAt || firstMessage?.createdAt || now,
      updatedAt: thread.updatedAt || lastMessage?.updatedAt || thread.createdAt || now,
      position: {
        side: thread.side ?? 'new',
        line: normalizeLineValue(thread.line),
      },
      codeSnapshot:
        typeof thread.codeContent === 'string'
          ? {
              content: thread.codeContent,
            }
          : undefined,
      messages,
    };
  }

  function parseCommentsPayload(body: unknown): DiffCommentThread[] {
    const payload =
      typeof body === 'string'
        ? (JSON.parse(body) as {
            comments?: Comment[];
            threads?: Array<CommentThread | DiffCommentThread>;
          })
        : (body as {
            comments?: Comment[];
            threads?: Array<CommentThread | DiffCommentThread>;
          });

    if (Array.isArray(payload.threads)) {
      return payload.threads.map(normalizeThreadPayload);
    }

    if (Array.isArray(payload.comments)) {
      return payload.comments.map(normalizeComment);
    }

    return [];
  }

  function parseCommentImportsPayload(body: unknown): CommentImport[] {
    if (typeof body === 'string') {
      return normalizeCommentImports(JSON.parse(body));
    }

    return normalizeCommentImports(body);
  }

  function reconcileThreadsWithServerState(
    nextThreads: DiffCommentThread[],
    prevThreads: DiffCommentThread[],
  ): DiffCommentThread[] {
    const prevById = new Map(prevThreads.map((t) => [t.id, t]));
    return nextThreads.map((next) => {
      const prev = prevById.get(next.id);
      if (!prev) return next;

      const prevMessageById = new Map(prev.messages.map((m) => [m.id, m]));
      const nextMessageById = new Map(next.messages.map((m) => [m.id, m]));

      // Preserve server-stored messages; only append new IDs from next.
      // A stale client POST must never erase an Agent reply the server
      // already accepted via /api/orchestrator/reply.
      const mergedMessages: DiffCommentMessage[] = [
        ...prev.messages.map((prevMsg) => {
          const nextMsg = nextMessageById.get(prevMsg.id);
          if (!nextMsg) return prevMsg;
          if (prevMsg.appliedSuggestions?.length) {
            return { ...nextMsg, appliedSuggestions: prevMsg.appliedSuggestions };
          }
          return nextMsg;
        }),
        ...next.messages.filter((m) => !prevMessageById.has(m.id)),
      ];

      // Keep the original snapshot frozen at thread creation — refreshing on
      // message growth or apply corrupts the diff display for the existing
      // suggestion (the snippet must show original→suggestion, not new→new).
      const codeSnapshot = prev.codeSnapshot ?? next.codeSnapshot;

      // Server is authoritative for reviewRequested. Only honor the client's
      // value when the sync actually carries a new (non-agent) message;
      // otherwise a stale closure could revive a flag the agent reply cleared
      // and trigger a duplicate dispatch.
      const newMessages = next.messages.filter((m) => !prevMessageById.has(m.id));
      const hasNewUserMessage = newMessages.some(
        (m) => m.author?.trim().toLowerCase() !== 'agent',
      );
      const reviewRequested = hasNewUserMessage
        ? next.reviewRequested
        : prev.reviewRequested;

      // Server is authoritative for resolved — only the dedicated
      // /api/threads/:id/resolve endpoint may change it. A stale /api/comments
      // POST must not flip it back.
      const resolved = prev.resolved;

      // Direct-edit fields are server-authoritative — only dedicated endpoints
      // (request-direct-edit, /api/orchestrator/plan, execute-plan, rollback-plan,
      // cancel-plan) may mutate them.
      const directEditRequested = prev.directEditRequested;
      const pendingPlan = prev.pendingPlan;
      const executedPlan = prev.executedPlan;

      return {
        ...next,
        messages: mergedMessages,
        codeSnapshot,
        reviewRequested,
        resolved,
        directEditRequested,
        pendingPlan,
        executedPlan,
      };
    });
  }

  function updateCommentSession(
    selection: DiffSelection,
    nextThreads: DiffCommentThread[],
  ): boolean {
    const session = getOrCreateCommentSession(selection);
    const refreshedThreads = reconcileThreadsWithServerState(nextThreads, session.threads);
    const previous = JSON.stringify(session.threads);
    const next = JSON.stringify(refreshedThreads);
    session.threads = refreshedThreads;

    if (previous === next) {
      return false;
    }

    session.version += 1;
    fileWatcher.broadcast({
      type: 'commentsChanged',
      version: session.version,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  app.post('/api/comments', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const nextThreads = parseCommentsPayload(req.body);
      updateCommentSession(selection, nextThreads);
      res.json({ success: true });
    } catch (error) {
      console.error('Error parsing comments:', error);
      res.status(400).json({ error: 'Invalid comment data' });
    }
  });

  app.post('/api/threads/:id/resolve', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const threadId = req.params.id;
      const body = (req.body ?? {}) as { resolved?: unknown };
      const resolved = body.resolved !== false;

      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      if (thread.resolved === resolved) {
        res.json({ success: true, resolved });
        return;
      }

      thread.resolved = resolved;
      thread.updatedAt = new Date().toISOString();
      session.version += 1;
      fileWatcher.broadcast({
        type: 'commentsChanged',
        version: session.version,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, resolved });
    } catch (error) {
      console.error('Error resolving thread:', error);
      res.status(400).json({ error: 'Invalid resolve request' });
    }
  });

  function bumpAndBroadcast(session: CommentSessionState) {
    session.version += 1;
    fileWatcher.broadcast({
      type: 'commentsChanged',
      version: session.version,
      timestamp: new Date().toISOString(),
    });
  }

  function isPathWithinRepository(absolutePath: string) {
    const repoPrefix = repositoryPath.endsWith(sep) ? repositoryPath : repositoryPath + sep;
    return absolutePath.startsWith(repoPrefix) || absolutePath === repositoryPath;
  }

  function validateEditPlanItem(item: unknown): EditPlanItem | { error: string } {
    if (!item || typeof item !== 'object') return { error: 'item is not an object' };
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      return { error: 'item.id required' };
    }
    if (typeof candidate.filePath !== 'string' || candidate.filePath.length === 0) {
      return { error: 'item.filePath required' };
    }
    if (typeof candidate.startLine !== 'number' || candidate.startLine < 1) {
      return { error: 'item.startLine must be ≥ 1' };
    }
    if (typeof candidate.endLine !== 'number' || candidate.endLine < candidate.startLine) {
      return { error: 'item.endLine must be ≥ startLine' };
    }
    if (typeof candidate.expectedOriginal !== 'string') {
      return { error: 'item.expectedOriginal required' };
    }
    if (typeof candidate.replacement !== 'string') {
      return { error: 'item.replacement required' };
    }
    return {
      id: candidate.id,
      filePath: candidate.filePath,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      expectedOriginal: candidate.expectedOriginal,
      replacement: candidate.replacement,
      description:
        typeof candidate.description === 'string' ? candidate.description : undefined,
    };
  }

  app.post('/api/threads/:id/request-direct-edit', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const threadId = req.params.id;
      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ success: false, reason: 'not-found' });
        return;
      }
      if (thread.resolved) {
        res
          .status(400)
          .json({ success: false, reason: 'invalid-state', detail: 'thread is resolved' });
        return;
      }
      if (thread.pendingPlan) {
        res
          .status(409)
          .json({ success: false, reason: 'plan-pending', detail: 'a plan is already pending' });
        return;
      }
      thread.directEditRequested = true;
      thread.updatedAt = new Date().toISOString();
      bumpAndBroadcast(session);
      res.json({ success: true });
    } catch (error) {
      console.error('Error requesting direct edit:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/orchestrator/plan', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const { threadId, summary, items } = (req.body ?? {}) as {
        threadId?: unknown;
        summary?: unknown;
        items?: unknown;
      };

      if (typeof threadId !== 'string' || threadId.length === 0) {
        res.status(400).json({ success: false, reason: 'invalid-input', detail: 'threadId required' });
        return;
      }
      if (typeof summary !== 'string') {
        res.status(400).json({ success: false, reason: 'invalid-input', detail: 'summary required' });
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        res
          .status(400)
          .json({ success: false, reason: 'invalid-input', detail: 'items must be a non-empty array' });
        return;
      }

      const validatedItems: EditPlanItem[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const result = validateEditPlanItem(items[i]);
        if ('error' in result) {
          res.status(400).json({
            success: false,
            reason: 'invalid-input',
            detail: `items[${i}]: ${result.error}`,
          });
          return;
        }
        validatedItems.push(result);
      }

      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ success: false, reason: 'not-found' });
        return;
      }
      if (!thread.directEditRequested) {
        res
          .status(409)
          .json({ success: false, reason: 'not-requested', detail: 'thread did not request direct edit' });
        return;
      }

      const now = new Date().toISOString();
      const plan: EditPlan = {
        id: createHash('sha256').update(`${threadId}:${now}`).digest('hex').slice(0, 12),
        threadId,
        createdAt: now,
        summary,
        items: validatedItems,
      };
      thread.pendingPlan = plan;
      thread.directEditRequested = false;
      thread.updatedAt = now;
      bumpAndBroadcast(session);
      res.json({ success: true, plan });
    } catch (error) {
      console.error('Error submitting plan:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/threads/:id/cancel-plan', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const threadId = req.params.id;
      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ success: false, reason: 'not-found' });
        return;
      }
      thread.pendingPlan = undefined;
      thread.directEditRequested = false;
      thread.updatedAt = new Date().toISOString();
      bumpAndBroadcast(session);
      res.json({ success: true });
    } catch (error) {
      console.error('Error canceling plan:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/threads/:id/execute-plan', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const threadId = req.params.id;
      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ success: false, reason: 'not-found' });
        return;
      }
      const plan = thread.pendingPlan;
      if (!plan) {
        res.status(400).json({ success: false, reason: 'no-plan' });
        return;
      }

      // Group items by file and pre-validate everything before writing anything.
      const filesTouched = new Map<string, EditPlanItem[]>();
      for (const item of plan.items) {
        const list = filesTouched.get(item.filePath) ?? [];
        list.push(item);
        filesTouched.set(item.filePath, list);
      }

      const snapshots: EditFileSnapshot[] = [];
      const fileBuffers = new Map<string, string[]>();

      for (const [relativePath, fileItems] of filesTouched.entries()) {
        const absolutePath = resolve(repositoryPath, relativePath);
        if (!isPathWithinRepository(absolutePath)) {
          res.status(400).json({
            success: false,
            reason: 'invalid-path',
            detail: `${relativePath} escapes repository`,
          });
          return;
        }
        let content: string;
        try {
          content = readFileSync(absolutePath, 'utf-8');
        } catch (err) {
          res.status(404).json({
            success: false,
            reason: 'file-not-found',
            detail: `${relativePath}: ${String(err)}`,
          });
          return;
        }
        snapshots.push({ filePath: relativePath, contentBeforeExecution: content });
        const lines = content.split(/\r?\n/);

        // Pre-flight: ranges must not overlap and expectedOriginal must match.
        const sortedItems = [...fileItems].sort((a, b) => a.startLine - b.startLine);
        for (let i = 0; i < sortedItems.length; i += 1) {
          const item = sortedItems[i];
          if (item.endLine > lines.length) {
            res.status(400).json({
              success: false,
              reason: 'out-of-range',
              detail: `${relativePath}:${item.startLine}-${item.endLine} exceeds file (${lines.length} lines)`,
            });
            return;
          }
          if (i > 0 && item.startLine <= sortedItems[i - 1].endLine) {
            res.status(400).json({
              success: false,
              reason: 'overlap',
              detail: `${relativePath}:${item.startLine}-${item.endLine} overlaps previous item`,
            });
            return;
          }
          const actualSlice = lines.slice(item.startLine - 1, item.endLine).join('\n');
          const expectedNormalized = item.expectedOriginal.replace(/\r\n/g, '\n').replace(/\n+$/, '');
          const actualNormalized = actualSlice.replace(/\n+$/, '');
          if (actualNormalized !== expectedNormalized) {
            res.status(409).json({
              success: false,
              reason: 'mismatch',
              detail: `${relativePath}:${item.startLine}-${item.endLine} content drifted since plan was made`,
            });
            return;
          }
        }
        fileBuffers.set(relativePath, lines);
      }

      // Apply edits per file (descending line order to keep indices stable).
      let totalLinesChanged = 0;
      for (const [relativePath, fileItems] of filesTouched.entries()) {
        const lines = fileBuffers.get(relativePath);
        if (!lines) continue;
        const descending = [...fileItems].sort((a, b) => b.startLine - a.startLine);
        for (const item of descending) {
          const replacementLines = item.replacement.replace(/\r\n/g, '\n').split('\n');
          // .splice removes (endLine - startLine + 1) lines and inserts replacement.
          const deleteCount = item.endLine - item.startLine + 1;
          lines.splice(item.startLine - 1, deleteCount, ...replacementLines);
          totalLinesChanged += deleteCount + replacementLines.length;
        }
        const absolutePath = resolve(repositoryPath, relativePath);
        writeFileSync(absolutePath, lines.join('\n'), 'utf-8');
      }
      invalidateCache();

      const now = new Date().toISOString();
      const executed: ExecutedEditPlan = { plan, executedAt: now, snapshots };
      thread.executedPlan = executed;
      thread.pendingPlan = undefined;
      thread.directEditRequested = false;
      thread.updatedAt = now;
      bumpAndBroadcast(session);
      res.json({
        success: true,
        executedAt: now,
        filesChanged: snapshots.length,
        linesChanged: totalLinesChanged,
      });
    } catch (error) {
      console.error('Error executing plan:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/threads/:id/rollback-plan', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const threadId = req.params.id;
      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res.status(404).json({ success: false, reason: 'not-found' });
        return;
      }
      const executed = thread.executedPlan;
      if (!executed) {
        res.status(400).json({ success: false, reason: 'no-executed-plan' });
        return;
      }
      if (executed.rolledBack) {
        res.status(409).json({ success: false, reason: 'already-rolled-back' });
        return;
      }
      for (const snap of executed.snapshots) {
        const absolutePath = resolve(repositoryPath, snap.filePath);
        if (!isPathWithinRepository(absolutePath)) {
          res.status(400).json({
            success: false,
            reason: 'invalid-path',
            detail: `${snap.filePath} escapes repository`,
          });
          return;
        }
        writeFileSync(absolutePath, snap.contentBeforeExecution, 'utf-8');
      }
      invalidateCache();
      const now = new Date().toISOString();
      thread.executedPlan = { ...executed, rolledBack: true, rolledBackAt: now };
      thread.updatedAt = now;
      bumpAndBroadcast(session);
      res.json({ success: true, filesRestored: executed.snapshots.length });
    } catch (error) {
      console.error('Error rolling back plan:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/comment-imports', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const commentImports = parseCommentImportsPayload(req.body);
      const importId = createHash('sha256')
        .update(serializeCommentImports(commentImports))
        .digest('hex');
      const merged = mergeCommentImports(session.threads, commentImports);
      const changed = updateCommentSession(selection, merged.threads);

      res.json({
        success: true,
        changed,
        count: commentImports.length,
        importId,
        warnings: merged.warnings,
      });
    } catch (error) {
      console.error('Error parsing comment imports:', error);
      res.status(400).json({ error: 'Invalid comment import data' });
    }
  });

  app.get('/api/comments-json', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    res.json({
      version: session.version,
      threads: session.threads,
      submitted: session.submitted,
      submittedAt: session.submittedAt,
    });
  });

  app.post('/api/submit', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    session.submitted = true;
    session.submittedAt = new Date().toISOString();
    bumpAndBroadcast(session);
    res.json({
      success: true,
      submitted: true,
      submittedAt: session.submittedAt,
      threadCount: session.threads.length,
    });
  });

  app.post('/api/unsubmit', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    session.submitted = false;
    session.submittedAt = null;
    bumpAndBroadcast(session);
    res.json({ success: true, submitted: false });
  });

  app.get('/api/review-status', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    const pendingReplies = session.threads.filter(isPendingReplyThread).length;
    res.json({
      pendingReplies,
      submitted: session.submitted,
      submittedAt: session.submittedAt,
    });
  });

  app.get('/api/orchestrator/pending', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    const includeFullContext = req.query.context === 'full';

    const buildFileContext = (filePath: string) => {
      if (!includeFullContext) return undefined;
      const result = classifyFileForReview(filePath);
      if (result.kind === 'text') {
        return { kind: 'text' as const, content: result.content };
      }
      if (result.kind === 'image') {
        return {
          kind: 'image' as const,
          relativePath: result.relativePath,
          absolutePath: result.absolutePath,
        };
      }
      return { kind: 'binary' as const, reason: result.reason };
    };

    const buildPendingEntry = (thread: DiffCommentThread, mode: 'review' | 'plan') => {
      const fileContext = buildFileContext(thread.filePath);
      return {
        threadId: thread.id,
        filePath: thread.filePath,
        position: thread.position,
        codeSnapshot: thread.codeSnapshot,
        fileContext,
        messages: thread.messages,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        mode,
      };
    };

    const pending = [
      ...session.threads.filter(isPendingReplyThread).map((t) => buildPendingEntry(t, 'review')),
      ...session.threads.filter(isPendingPlanThread).map((t) => buildPendingEntry(t, 'plan')),
    ];

    res.json({
      version: session.version,
      pendingCount: pending.length,
      headSha: includeFullContext ? getHeadSha() : null,
      attachmentsDir: includeFullContext ? ATTACHMENTS_DIR : null,
      repositoryPath: includeFullContext ? repositoryPath : null,
      pending,
    });
  });

  app.post('/api/orchestrator/reply', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const { threadId, body, author, clearReviewRequested } = (req.body ?? {}) as {
        threadId?: unknown;
        body?: unknown;
        author?: unknown;
        clearReviewRequested?: unknown;
      };

      if (typeof threadId !== 'string' || threadId.length === 0) {
        res
          .status(400)
          .json({ success: false, reason: 'invalid-input', detail: 'threadId required' });
        return;
      }
      if (typeof body !== 'string' || body.trim().length === 0) {
        res.status(400).json({ success: false, reason: 'invalid-input', detail: 'body required' });
        return;
      }

      const targetIndex = session.threads.findIndex((thread) => thread.id === threadId);
      if (targetIndex < 0) {
        res
          .status(404)
          .json({ success: false, reason: 'not-found', detail: `thread ${threadId} not found` });
        return;
      }

      const now = new Date().toISOString();
      const target = session.threads[targetIndex];
      const replyMessage: DiffCommentMessage = {
        id: createHash('sha256').update(`${threadId}:${now}:${body}`).digest('hex').slice(0, 12),
        body: body.trim(),
        author: typeof author === 'string' && author.length > 0 ? author : 'Agent',
        createdAt: now,
        updatedAt: now,
        codeSnapshotAtCreation: target.codeSnapshot?.content,
      };

      const shouldClearFlag = clearReviewRequested !== false;
      const updatedThread: DiffCommentThread = {
        ...target,
        updatedAt: now,
        messages: [...target.messages, replyMessage],
        reviewRequested: shouldClearFlag ? false : target.reviewRequested,
      };

      const nextThreads = session.threads.map((thread, idx) =>
        idx === targetIndex ? updatedThread : thread,
      );
      updateCommentSession(selection, nextThreads);

      res.json({
        success: true,
        threadId,
        messageId: replyMessage.id,
        clearedReviewRequested: shouldClearFlag,
      });
    } catch (error) {
      console.error('Error posting orchestrator reply:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.post('/api/attachments', (req, res) => {
    try {
      const { filename, dataUrl } = (req.body ?? {}) as {
        filename?: unknown;
        dataUrl?: unknown;
      };
      if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
        res.status(400).json({ success: false, reason: 'invalid-input', detail: 'dataUrl required' });
        return;
      }
      const dataUrlMatch = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
      if (!dataUrlMatch) {
        res
          .status(400)
          .json({ success: false, reason: 'invalid-input', detail: 'dataUrl must be base64' });
        return;
      }
      const mimeType = dataUrlMatch[1].toLowerCase();
      const base64 = dataUrlMatch[2];
      const allowedMime: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      };
      const extFromMime = allowedMime[mimeType];
      if (!extFromMime) {
        res
          .status(400)
          .json({ success: false, reason: 'unsupported-type', detail: `mime ${mimeType}` });
        return;
      }
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.byteLength === 0) {
        res.status(400).json({ success: false, reason: 'invalid-input', detail: 'empty payload' });
        return;
      }
      if (buffer.byteLength > ATTACHMENT_MAX_BYTES) {
        res.status(413).json({
          success: false,
          reason: 'too-large',
          detail: `max ${ATTACHMENT_MAX_BYTES} bytes`,
        });
        return;
      }
      const requestedName = typeof filename === 'string' ? filename : '';
      const requestedExt = extname(requestedName).toLowerCase();
      const finalExt = IMAGE_EXTENSIONS.has(requestedExt) ? requestedExt : extFromMime;
      ensureAttachmentsDir();
      const id = randomUUID();
      const storedName = `${id}${finalExt}`;
      const storedPath = resolve(ATTACHMENTS_DIR, storedName);
      writeFileSync(storedPath, buffer);
      const relativePath = `${ATTACHMENTS_DIR_NAME}/${storedName}`;
      const servedUrl = `/attachments/${storedName}`;
      res.json({
        success: true,
        relativePath,
        url: servedUrl,
        markdown: `![${requestedName || 'attachment'}](${relativePath})`,
        bytes: buffer.byteLength,
      });
    } catch (error) {
      console.error('Error saving attachment:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.get('/attachments/:filename', (req, res) => {
    const { filename } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      res.status(400).json({ success: false, reason: 'invalid-name' });
      return;
    }
    const ext = extname(filename).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      res.status(400).json({ success: false, reason: 'unsupported-type' });
      return;
    }
    const filePath = resolve(ATTACHMENTS_DIR, filename);
    if (!filePath.startsWith(`${ATTACHMENTS_DIR}${sep}`)) {
      res.status(400).json({ success: false, reason: 'invalid-path' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ success: false, reason: 'not-found' });
      return;
    }
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    res.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(filePath);
  });

  app.post('/api/apply-suggestion', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const { threadId, suggestionIndex } = (req.body ?? {}) as {
        threadId?: unknown;
        suggestionIndex?: unknown;
      };

      if (typeof threadId !== 'string' || typeof suggestionIndex !== 'number') {
        res.status(400).json({
          success: false,
          reason: 'invalid-input',
          detail: 'threadId (string) and suggestionIndex (number) required',
        });
        return;
      }

      const thread = session.threads.find((t) => t.id === threadId);
      if (!thread) {
        res
          .status(404)
          .json({ success: false, reason: 'not-found', detail: `thread ${threadId} not found` });
        return;
      }

      const messagesWithSuggestions = thread.messages.filter((m) => hasSuggestionBlock(m.body));
      if (messagesWithSuggestions.length === 0) {
        res.status(400).json({
          success: false,
          reason: 'not-found',
          detail: 'no suggestion blocks in thread',
        });
        return;
      }

      const lastMsg = messagesWithSuggestions[messagesWithSuggestions.length - 1];
      const blocks = parseSuggestionBlocks(lastMsg.body).filter((b) => b.isSuggestion);
      if (suggestionIndex < 0 || suggestionIndex >= blocks.length) {
        res.status(400).json({
          success: false,
          reason: 'not-found',
          detail: `suggestionIndex out of range (0..${blocks.length - 1})`,
        });
        return;
      }

      if (lastMsg.appliedSuggestions?.includes(suggestionIndex)) {
        res.status(409).json({
          success: false,
          reason: 'already-applied',
          detail: 'this suggestion has already been applied',
        });
        return;
      }

      const suggested = blocks[suggestionIndex].suggestedCode;
      const original = thread.codeSnapshot?.content;
      if (!original) {
        res.status(400).json({
          success: false,
          reason: 'no-original',
          detail: 'thread has no codeSnapshot to replace',
        });
        return;
      }

      const filePath = resolve(repositoryPath, thread.filePath);
      const repoPrefix = repositoryPath.endsWith(sep) ? repositoryPath : repositoryPath + sep;
      if (!filePath.startsWith(repoPrefix) && filePath !== repositoryPath) {
        res.status(400).json({
          success: false,
          reason: 'invalid-path',
          detail: 'path escapes repository root',
        });
        return;
      }

      if (thread.position.side === 'old') {
        res.status(400).json({
          success: false,
          reason: 'old-side-not-supported',
          detail:
            'cannot apply suggestion to a deleted (old-side) line; reapply the comment on the new-side line',
        });
        return;
      }

      const linePosition = thread.position.line;
      const startLine =
        typeof linePosition === 'number' ? linePosition : linePosition?.start;
      const endLine =
        typeof linePosition === 'number' ? linePosition : linePosition?.end;

      if (typeof startLine !== 'number' || typeof endLine !== 'number') {
        res.status(400).json({
          success: false,
          reason: 'invalid-line',
          detail: `thread has no valid line position: ${JSON.stringify(linePosition)}`,
        });
        return;
      }

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (err) {
        res.status(404).json({ success: false, reason: 'file-not-found', detail: String(err) });
        return;
      }

      const lines = content.split(/\r?\n/);
      const expectedStartIdx = startLine - 1;
      const expectedEndIdx = endLine - 1;

      const normalizedOriginal = original.replace(/\r\n/g, '\n');
      const originalLines = normalizedOriginal.split('\n');

      let actualStartIdx = -1;
      let actualEndIdx = -1;

      if (
        expectedStartIdx >= 0 &&
        expectedEndIdx < lines.length &&
        lines.slice(expectedStartIdx, expectedEndIdx + 1).join('\n') === normalizedOriginal
      ) {
        actualStartIdx = expectedStartIdx;
        actualEndIdx = expectedEndIdx;
      } else {
        const matches: number[] = [];
        for (let i = 0; i + originalLines.length <= lines.length; i += 1) {
          const candidate = lines.slice(i, i + originalLines.length).join('\n');
          if (candidate === normalizedOriginal) {
            matches.push(i);
          }
        }

        if (matches.length === 0) {
          res.status(409).json({
            success: false,
            reason: 'conflict',
            detail: `line ${startLine}${startLine === endLine ? '' : `..${endLine}`}: original snapshot no longer present in file`,
          });
          return;
        }

        if (matches.length > 1) {
          res.status(409).json({
            success: false,
            reason: 'multiple-matches',
            detail: `original code matches ${matches.length} times in file — cannot auto-apply, please edit manually`,
          });
          return;
        }

        actualStartIdx = matches[0];
        actualEndIdx = actualStartIdx + originalLines.length - 1;
      }

      const suggestedLineList = suggested.replace(/\r\n/g, '\n').split('\n');
      const nextLines = [
        ...lines.slice(0, actualStartIdx),
        ...suggestedLineList,
        ...lines.slice(actualEndIdx + 1),
      ];
      writeFileSync(filePath, nextLines.join('\n'), 'utf-8');

      thread.updatedAt = new Date().toISOString();
      lastMsg.appliedSuggestions = [...(lastMsg.appliedSuggestions ?? []), suggestionIndex];

      if (thread.codeSnapshot) {
        thread.codeSnapshot.content = suggested;
      }

      const originalLineCount = originalLines.length;
      const suggestedLineCount = suggestedLineList.length;

      const overlayApplied = applyOverlayToCachedDiff(
        diffDataCache,
        thread.filePath,
        startLine,
        endLine,
        suggestedLineList,
      );

      bumpAndBroadcast(session);
      res.json({
        success: true,
        file: thread.filePath,
        linesChanged: suggestedLineCount - originalLineCount,
        overlayApplied,
      });
    } catch (error) {
      console.error('Error applying suggestion:', error);
      res.status(500).json({ success: false, reason: 'internal-error', detail: String(error) });
    }
  });

  app.get('/api/comments-output', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    res.type('text/plain');

    if (session.threads.length > 0) {
      const output = formatCommentsOutput(session.threads.map(toCommentThread));
      res.send(output);
    } else {
      res.send('');
    }
  });

  app.post('/api/open-in-editor', async (req, res) => {
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Open in editor is not available for stdin diff' });
      return;
    }

    const { filePath, line, editor } = (req.body ?? {}) as {
      filePath?: unknown;
      line?: unknown;
      editor?: unknown;
    };

    if (typeof filePath !== 'string') {
      res.status(400).json({ error: 'Invalid request payload' });
      return;
    }

    const filepathResult = parseRepositoryRelativePath(filePath);
    if (!filepathResult.ok) {
      res.status(400).json({ error: filepathResult.error });
      return;
    }
    const resolvedPath = resolve(repositoryPath, filepathResult.path);

    const editorInput =
      typeof editor === 'string' ? editor : (process.env.DIFIT_EDITOR ?? process.env.EDITOR);
    const resolvedEditor = resolveEditorOption(editorInput);
    if (resolvedEditor.protocol === null) {
      res.status(400).json({ error: 'Open in editor is disabled' });
      return;
    }

    const lineNumber = (() => {
      const parsed = Number.parseInt(String(line ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();

    const tryOpenWithCli = async (): Promise<boolean> => {
      if (!resolvedEditor.cliCommand) return false;
      const args: string[] = [...resolvedEditor.cliArgs];
      if (lineNumber !== null) {
        const fileWithLine = `${resolvedPath}:${lineNumber}`;
        if (resolvedEditor.lineFormat === 'goto-flag') {
          args.push('-g', fileWithLine);
        } else {
          args.push(fileWithLine);
        }
      } else {
        args.push(resolvedPath);
      }
      args.push(repositoryPath);

      return await new Promise<boolean>((resolvePromise) => {
        const child = spawn(resolvedEditor.cliCommand, args, { stdio: 'ignore', detached: true });
        child.once('error', (error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && code !== 'ENOENT') {
            console.error('Failed to launch editor CLI:', error);
          }
          resolvePromise(false);
        });
        child.once('spawn', () => {
          child.unref();
          resolvePromise(true);
        });
      });
    };

    if (await tryOpenWithCli()) {
      res.json({ success: true });
      return;
    }

    const lineSuffix = lineNumber !== null ? `:${lineNumber}` : '';
    const fileUri = `${resolvedEditor.protocol}://file${encodeURI(resolvedPath)}${lineSuffix}`;

    try {
      await open(fileUri);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to open file in editor:', error);
      res.status(500).json({ error: 'Failed to open file in editor' });
    }
  });

  // Function to output comments when server shuts down
  function outputFinalComments() {
    const session = getOrCreateCommentSession(currentCommentSelection);
    if (session.threads.length > 0) {
      console.log(formatCommentsOutput(session.threads.map(toCommentThread)));
    }
  }

  // SSE endpoint for file watching
  app.get('/api/watch', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    fileWatcher.addClient(res);

    req.on('close', () => {
      fileWatcher.removeClient(res);
    });
  });

  // SSE endpoint to detect when tab is closed
  app.get('/api/heartbeat', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial heartbeat
    res.write('data: connected\n\n');

    // Send heartbeat every 5 seconds
    const heartbeatInterval = setInterval(() => {
      res.write('data: heartbeat\n\n');
    }, 5000);

    // When client disconnects (tab closed, navigation, etc.)
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      if (options.keepAlive) {
        console.log('Client disconnected, but server is staying alive (--keep-alive)');
        console.log('Press Ctrl+C to stop the server');
      } else {
        // Add a small delay to ensure any pending sendBeacon requests are processed
        setTimeout(async () => {
          console.log('Client disconnected, shutting down server...');

          // Stop file watcher
          await fileWatcher.stop();

          outputFinalComments();
          process.exit(0);
        }, 100);
      }
    });
  });

  // Always runs in production mode when distributed as a CLI tool
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV !== 'development';

  if (isProduction) {
    // Find client files relative to the CLI executable location
    const distPath = join(__dirname, '..', 'client');
    app.use(express.static(distPath));
  } else {
    app.get('/', (_req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>difit - Dev Mode</title>
          </head>
          <body>
            <div id="root"></div>
            <script>
              console.log('difit development mode');
              console.log('Diff data available at /api/diff');
            </script>
          </body>
        </html>
      `);
    });
  }

  const { port, url, server } = await startServerWithFallback(
    app,
    options.preferredPort || 4966,
    options.host || 'localhost',
  );

  // Security warning for non-localhost binding
  if (options.host && options.host !== '127.0.0.1' && options.host !== 'localhost') {
    console.warn('\n⚠️  WARNING: Server is accessible from external network!');
    console.warn(`   Binding to: ${options.host}:${port}`);
    console.warn('   Make sure this is intended and your network is secure.\n');
  }

  // Start file watcher
  if (options.diffMode) {
    try {
      await fileWatcher.start(options.diffMode, repositoryPath, 300, invalidateCache);
    } catch (error) {
      console.warn('⚠️  File watcher failed to start:', error);
      console.warn('   Continuing without file watching...');
    }
  }

  // Check if diff is empty and skip browser opening
  if (initialDiffData.isEmpty) {
    // Don't open browser if no differences found
  } else if (options.openBrowser) {
    try {
      await open(url);
    } catch {
      console.warn('Failed to open browser automatically');
    }
  }

  return { port, url, isEmpty: initialDiffData.isEmpty || false, server };
}

async function startServerWithFallback(
  app: Express,
  preferredPort: number,
  host: string,
): Promise<{ port: number; url: string; server: Server }> {
  return new Promise((resolve, reject) => {
    // express's listen() method uses listen() method in node:net Server instance internally
    // https://expressjs.com/en/5x/api.html#app.listen
    // so, an error will be an instance of NodeJS.ErrnoException
    const server = app.listen(preferredPort, host, (err: NodeJS.ErrnoException | undefined) => {
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      const url = `http://${displayHost}:${preferredPort}`;
      if (!err) {
        resolve({ port: preferredPort, url, server });
        return;
      }

      // Handling errors when failed to launch a server
      switch (err.code) {
        // Try another port until it succeeds
        case 'EADDRINUSE': {
          console.log(`Port ${preferredPort} is busy, trying ${preferredPort + 1}...`);
          return startServerWithFallback(app, preferredPort + 1, host)
            .then(({ port, url, server }) => {
              resolve({ port, url, server });
            })
            .catch(reject);
        }
        // Unexpected error
        default: {
          reject(new Error(`Failed to launch a server: ${err.message}`));
        }
      }
    });
  });
}
