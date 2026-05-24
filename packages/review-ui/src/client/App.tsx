import { Columns, AlignLeft, Settings, PanelLeftClose, PanelLeft, Keyboard } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import {
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type DiffViewMode,
  type DiffSide,
  type LineNumber,
  type CommentThread,
  type RevisionsResponse,
} from '../types/diff';
import { DEFAULT_DIFF_VIEW_MODE, normalizeDiffViewMode } from '../utils/diffMode';
import { mergeCommentThreads } from '../utils/commentImports';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
  normalizeBaseMode,
} from '../utils/diffSelection';

import { Checkbox } from './components/Checkbox';
import { CommentsCountPopover } from './components/CommentsCountPopover';
import { CommentsDropdown } from './components/CommentsDropdown';
import { CommentsListModal } from './components/CommentsListModal';
import { SubmitReviewButton } from './components/SubmitReviewButton';
import { DiffQuickMenu } from './components/DiffQuickMenu';
import { DiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { GitHubIcon } from './components/GitHubIcon';
import { HelpModal } from './components/HelpModal';
import { Logo } from './components/Logo';
import { ReloadButton } from './components/ReloadButton';
import { ReviewCompleteOverlay } from './components/ReviewCompleteOverlay';
import { RevisionDetailModal } from './components/RevisionDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SparkleAnimation } from './components/SparkleAnimation';
import { WordHighlightProvider } from './contexts/WordHighlightContext';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';
import { useDiffComments } from './hooks/useDiffComments';
import { useExpandedLines, type MergedChunk } from './hooks/useExpandedLines';
import { useFileWatch } from './hooks/useFileWatch';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useLazyDiffRendering } from './hooks/useLazyDiffRendering';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';
import { hasMultipleCommentAuthors } from './utils/commentAuthors';
import { getFileElementId } from './utils/domUtils';
import { findCommentPosition } from './utils/navigation/positionHelpers';
import { resolveEventSourceUrl } from './utils/eventSourceUrl';
import {
  EMPTY_MERGED_CHUNKS_STATE,
  buildMergedChunksState,
  getMergedChunksForVersion,
} from './utils/mergedChunks';

const EMPTY_COMMENT_THREADS: CommentThread[] = [];
const EMPTY_MERGED_CHUNKS: MergedChunk[] = [];
const SIDEBAR_WIDTH_STORAGE_KEY = 'difit.sidebarWidth';
const SIDEBAR_OPEN_STORAGE_KEY = 'difit.sidebarOpen';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;

const getInitialSidebarWidth = () => {
  if (typeof window === 'undefined') {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed));
};

const getInitialFileTreeOpen = () => {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  if (stored === 'true') {
    return true;
  }
  if (stored === 'false') {
    return false;
  }
  return true;
};

function App() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffDataVersion, setDiffDataVersion] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(DEFAULT_DIFF_VIEW_MODE);
  const hasUserSetDiffModeRef = useRef(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(getInitialFileTreeOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [hasTriggeredSparkles, setHasTriggeredSparkles] = useState(false);
  const [isCommentsListOpen, setIsCommentsListOpen] = useState(false);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [isReviewSubmitted, setIsReviewSubmitted] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const collapsedInitializedRef = useRef(false);
  const diffScrollContainerRef = useRef<HTMLElement | null>(null);
  const [viewportFileIndex, setViewportFileIndex] = useState<number | null>(null);

  // Revision selector state
  const [revisionOptions, setRevisionOptions] = useState<RevisionsResponse | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<DiffSelection>(
    createDiffSelection('', ''),
  );
  const [resolvedBaseRevision, setResolvedBaseRevision] = useState<string>('');
  const [resolvedTargetRevision, setResolvedTargetRevision] = useState<string>('');
  const hasUserSelectedRevisionRef = useRef(false);
  const currentRequestedBaseModeRef = useRef(selectedRevision.baseMode);
  currentRequestedBaseModeRef.current = diffData?.requestedBaseMode ?? selectedRevision.baseMode;
  const selectedRevisionRef = useRef(selectedRevision);
  selectedRevisionRef.current = selectedRevision;
  const diffRequestIdRef = useRef(0);
  const activeDiffAbortControllerRef = useRef<AbortController | null>(null);
  const resolvedSelection = useMemo<DiffSelection | null>(() => {
    if (!diffData?.baseCommitish || !diffData?.targetCommitish) {
      return null;
    }

    return createDiffSelection(
      diffData.baseCommitish,
      diffData.targetCommitish,
      diffData.requestedBaseMode,
    );
  }, [diffData]);
  const resolvedSelectionKey = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    return getDiffSelectionKey(resolvedSelection);
  }, [resolvedSelection]);

  const { settings, updateSettings } = useAppearanceSettings();
  const { isMobile, isDesktop } = useViewport();

  // New diff-aware comment system
  const {
    hasLoadedComments,
    threads,
    replaceThreads,
    addThread,
    addFileThread,
    replyToThread,
    removeThread,
    removeMessage,
    markSuggestionApplied,
    setThreadResolved,
    clearAllComments,
  } = useDiffComments(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit, // Using commit as currentCommitHash
    undefined, // branchToHash map - could be populated from server data
    diffData?.repositoryId, // Repository identifier for storage isolation
    resolvedSelection?.baseMode,
  );

  const normalizedThreads = useMemo<CommentThread[]>(
    () =>
      threads.flatMap((thread) => {
        const line = thread.position.line;
        if (line === undefined) return [];
        return [
          {
            id: thread.id,
            file: thread.filePath,
            line: typeof line === 'number' ? line : ([line.start, line.end] as [number, number]),
            side: thread.position.side,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            codeContent: thread.codeSnapshot?.content,
            messages: thread.messages,
            reviewRequested: thread.reviewRequested,
            directEditRequested: thread.directEditRequested,
            pendingPlan: thread.pendingPlan,
            executedPlan: thread.executedPlan,
            resolved: thread.resolved,
          },
        ];
      }),
    [threads],
  );
  const showAuthorBadges = useMemo(
    () => hasMultipleCommentAuthors(normalizedThreads.flatMap((thread) => thread.messages)),
    [normalizedThreads],
  );

  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    normalizedThreads.forEach((thread) => {
      const entry = map.get(thread.file);
      if (entry) {
        entry.push(thread);
      } else {
        map.set(thread.file, [thread]);
      }
    });
    return map;
  }, [normalizedThreads]);
  const showMobileCommentsBar = isMobile && threads.length > 0;
  const commentsContextKey = useMemo(() => {
    if (!resolvedSelectionKey) {
      return null;
    }

    return `${diffData?.repositoryId ?? 'default'}:${resolvedSelectionKey}`;
  }, [diffData?.repositoryId, resolvedSelectionKey]);
  const commentSessionQueryString = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    const params = new URLSearchParams({
      base: resolvedSelection.baseCommitish,
      target: resolvedSelection.targetCommitish,
    });
    if (resolvedSelection.baseMode === 'merge-base') {
      params.set('baseMode', resolvedSelection.baseMode);
    }

    return params.toString();
  }, [resolvedSelection]);
  const getCommentApiUrl = useCallback(
    (path: string) => {
      if (!commentSessionQueryString) {
        return path;
      }
      return `${path}?${commentSessionQueryString}`;
    },
    [commentSessionQueryString],
  );
  const [bootstrappedCommentsKey, setBootstrappedCommentsKey] = useState<string | null>(null);
  const hasBootstrappedComments =
    commentsContextKey !== null && commentsContextKey === bootstrappedCommentsKey;
  const bootstrappingCommentsKeyRef = useRef<string | null>(null);
  const skipNextCommentSyncRef = useRef(false);
  const pendingBootstrapAfterLocalResetRef = useRef(false);

  useEffect(() => {
    if (commentsContextKey !== bootstrappedCommentsKey) {
      skipNextCommentSyncRef.current = false;
    }
  }, [bootstrappedCommentsKey, commentsContextKey]);

  const fetchServerThreads = useCallback(async (): Promise<DiffCommentThread[]> => {
    const response = await fetch(getCommentApiUrl('/api/comments-json'));
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      threads?: DiffCommentThread[];
      submitted?: boolean;
    };
    if (typeof payload.submitted === 'boolean') {
      setIsReviewSubmitted(payload.submitted);
    }
    return Array.isArray(payload.threads) ? payload.threads : [];
  }, [getCommentApiUrl]);

  const handleSubmitReview = useCallback(async () => {
    setIsSubmittingReview(true);
    try {
      const statusResponse = await fetch(getCommentApiUrl('/api/review-status'));
      if (statusResponse.ok) {
        const status = (await statusResponse.json()) as { pendingReplies?: number };
        if (typeof status.pendingReplies === 'number' && status.pendingReplies > 0) {
          alert(
            `에이전트 답변을 기다리는 코멘트가 ${status.pendingReplies}개 있습니다. 잠시 후 다시 시도해 주세요.`,
          );
          return;
        }
      }

      const response = await fetch(getCommentApiUrl('/api/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Submit failed: ${response.status} ${response.statusText}`);
      }
      const result = (await response.json()) as { submitted?: boolean };
      if (result.submitted) {
        setIsReviewSubmitted(true);
      }
    } catch (error) {
      console.error('Failed to submit review:', error);
      alert('Failed to submit review. Check console.');
    } finally {
      setIsSubmittingReview(false);
    }
  }, [getCommentApiUrl]);

  const syncThreadsToServer = useCallback(
    async (nextThreads: DiffCommentThread[]) => {
      await fetch(getCommentApiUrl('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threads: nextThreads }),
      });
    },
    [getCommentApiUrl],
  );

  // Viewed files management
  const { viewedFiles, hasLoadedInitialViewedFiles, toggleFileViewed, clearViewedFiles } =
    useViewedFiles(
      resolvedSelection?.baseCommitish,
      resolvedSelection?.targetCommitish,
      diffData?.commit,
      undefined,
      diffData?.files,
      diffData?.repositoryId, // Repository identifier for storage isolation
      settings.autoViewedPatterns,
      resolvedSelection?.baseMode,
    );

  // Reset initialization flag when diff context changes
  useEffect(() => {
    collapsedInitializedRef.current = false;
  }, [diffData?.repositoryId, resolvedSelectionKey, diffData?.commit]);

  // Initialize collapsed files from viewed files (only once per diff)
  useEffect(() => {
    if (!collapsedInitializedRef.current && hasLoadedInitialViewedFiles) {
      setCollapsedFiles(new Set(viewedFiles));
      collapsedInitializedRef.current = true;
    }
  }, [viewedFiles, hasLoadedInitialViewedFiles]);
  const {
    renderedFilePaths,
    ensureFileRendered,
    ensureFilesRenderedUpTo,
    registerLazyFileContainer,
    scrollFileIntoDiffContainer,
  } = useLazyDiffRendering({
    diffData,
    diffScrollContainerRef,
    setDiffData,
  });

  const toggleFileReviewed = useCallback(
    async (filePath: string) => {
      if (!diffData) return;

      const file = diffData.files.find((f) => f.path === filePath);
      if (!file) return;

      const wasViewed = viewedFiles.has(filePath);
      await toggleFileViewed(filePath, file);

      // Update collapsed state based on viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        if (!wasViewed) {
          // Marking as viewed -> collapse the file
          newSet.add(filePath);
        } else {
          // Marking as not viewed -> expand the file
          newSet.delete(filePath);
        }
        return newSet;
      });

      // When marking as reviewed (closing file), scroll to the file header
      if (!wasViewed) {
        setTimeout(() => {
          scrollFileIntoDiffContainer(filePath);
        }, 100);
      }
    },
    [diffData, scrollFileIntoDiffContainer, toggleFileViewed, viewedFiles],
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const toggleAllFilesCollapsed = useCallback(
    (shouldCollapse: boolean) => {
      if (!diffData) return;

      if (shouldCollapse) {
        // Collapse all files
        setCollapsedFiles(new Set(diffData.files.map((f) => f.path)));
      } else {
        // Expand all files
        setCollapsedFiles(new Set());
      }
    },
    [diffData],
  );

  const handleMobileFileSelected = useCallback(() => {
    setIsFileTreeOpen(false);
  }, []);

  const handleDiffModeChange = useCallback((mode: DiffViewMode) => {
    hasUserSetDiffModeRef.current = true;
    setDiffMode(mode);
  }, []);

  // Lift expand state to App level so navigation and rendering share the same merged chunks
  const {
    isLoading: isExpandLoading,
    expandLines,
    expandAllBetweenChunks,
    prefetchFileContent,
    getMergedChunks,
    lastUpdatedAt,
  } = useExpandedLines({
    baseCommitish: diffData?.baseCommitish,
    targetCommitish: diffData?.targetCommitish,
    diffIdentity: diffDataVersion,
  });

  const getMergedChunksRef = useRef(getMergedChunks);
  useEffect(() => {
    getMergedChunksRef.current = getMergedChunks;
  }, [getMergedChunks]);

  const [mergedChunksState, setMergedChunksState] = useState(EMPTY_MERGED_CHUNKS_STATE);
  const filesByPath = useMemo(() => {
    const map = new Map<string, DiffResponse['files'][number]>();
    diffData?.files.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [diffData]);

  // Recompute merged chunks for the current fetched diff only.
  useEffect(() => {
    if (!diffData) {
      setMergedChunksState(EMPTY_MERGED_CHUNKS_STATE);
      return;
    }

    setMergedChunksState(
      buildMergedChunksState(diffDataVersion, renderedFilePaths, filesByPath, (file) =>
        getMergedChunksRef.current(file),
      ),
    );
  }, [diffData, diffDataVersion, filesByPath, renderedFilePaths, lastUpdatedAt]);

  useEffect(() => {
    if (!diffData) {
      setViewportFileIndex(null);
      return;
    }

    const filePathToIndex = new Map<string, number>();
    diffData.files.forEach((file, index) => filePathToIndex.set(file.path, index));

    const visibleFilePaths = new Set<string>();

    const recomputeTopMostVisibleFile = () => {
      if (visibleFilePaths.size === 0) {
        setViewportFileIndex((prev) => (prev === null ? prev : null));
        return;
      }
      let topMostIndex: number | null = null;
      visibleFilePaths.forEach((path) => {
        const index = filePathToIndex.get(path);
        if (index === undefined) return;
        if (topMostIndex === null || index < topMostIndex) {
          topMostIndex = index;
        }
      });
      setViewportFileIndex((prev) => (prev === topMostIndex ? prev : topMostIndex));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const path = (entry.target as HTMLElement).dataset.filePath;
          if (!path) return;
          if (entry.isIntersecting) {
            visibleFilePaths.add(path);
          } else {
            visibleFilePaths.delete(path);
          }
        });
        recomputeTopMostVisibleFile();
      },
      {
        root: null,
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      },
    );

    const containers = document.querySelectorAll<HTMLElement>('[data-file-path]');
    containers.forEach((container) => observer.observe(container));

    return () => observer.disconnect();
  }, [diffData]);

  // Create files with merged chunks for keyboard navigation
  const navigableFiles = useMemo(() => {
    if (!diffData) return [];
    return diffData.files.map((file) => ({
      ...file,
      chunks:
        getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) || file.chunks,
    }));
  }, [diffData, diffDataVersion, mergedChunksState]);

  // State to trigger comment creation from keyboard
  const [commentTrigger, setCommentTrigger] = useState<{
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null>(null);
  const fetchDiffDataRef = useRef<((selection?: DiffSelection) => Promise<void>) | null>(null);
  const handleWatchReload = useCallback(async () => {
    await fetchDiffDataRef.current?.();
  }, []);
  const handleCommentsChanged = useCallback(async () => {
    try {
      const serverThreads = await fetchServerThreads();
      skipNextCommentSyncRef.current = true;
      replaceThreads(serverThreads);
      if (commentsContextKey) {
        setBootstrappedCommentsKey(commentsContextKey);
      }
    } catch (commentsError) {
      console.error('Failed to refresh comments from server:', commentsError);
    }
  }, [commentsContextKey, fetchServerThreads, replaceThreads]);

  // File watch for reload functionality - initialize with callback
  const { shouldReload, reload, watchState } = useFileWatch(
    handleWatchReload,
    handleCommentsChanged,
  );

  const { cursor, isHelpOpen, setIsHelpOpen, setCursorPosition } = useKeyboardNavigation({
    files: navigableFiles,
    comments: normalizedThreads,
    viewMode: diffMode,
    reviewedFiles: viewedFiles,
    onToggleReviewed: toggleFileReviewed,
    onCreateComment: () => {
      if (cursor) {
        setCommentTrigger({
          fileIndex: cursor.fileIndex,
          chunkIndex: cursor.chunkIndex,
          lineIndex: cursor.lineIndex,
        });
      }
    },
    onDeleteAllComments: () => {
      if (threads.length > 0 && confirm('Delete all comments?')) {
        clearAllComments();
      }
    },
    onShowCommentsList: () => {
      setIsCommentsListOpen(true);
    },
    onRefresh: () => {
      reload();
    },
  });

  useEffect(() => {
    if (!diffData || !cursor) return;

    const filePath = diffData.files[cursor.fileIndex]?.path;
    if (!filePath || renderedFilePaths.has(filePath)) return;

    ensureFilesRenderedUpTo(filePath);
    requestAnimationFrame(() => {
      setCursorPosition(cursor);
    });
  }, [cursor, diffData, ensureFilesRenderedUpTo, renderedFilePaths, setCursorPosition]);

  const handleLineClick = useCallback(
    (fileIndex: number, chunkIndex: number, lineIndex: number, side: 'left' | 'right') => {
      setCursorPosition({
        fileIndex,
        chunkIndex,
        lineIndex,
        side,
      });
    },
    [setCursorPosition],
  );

  const handleCommentTriggerHandled = useCallback(() => {
    setCommentTrigger(null);
  }, [setCommentTrigger]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + (e.clientX - startX)),
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const fetchDiffData = useCallback(
    async (selection?: DiffSelection) => {
      const requestId = diffRequestIdRef.current + 1;
      diffRequestIdRef.current = requestId;
      activeDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeDiffAbortControllerRef.current = controller;
      try {
        const requestedSelection =
          selection ??
          (hasUserSelectedRevisionRef.current ? selectedRevisionRef.current : undefined);
        const params = new URLSearchParams({
          ignoreWhitespace: String(ignoreWhitespace),
        });
        if (requestedSelection?.baseCommitish) params.set('base', requestedSelection.baseCommitish);
        if (requestedSelection?.targetCommitish)
          params.set('target', requestedSelection.targetCommitish);
        if (requestedSelection?.baseMode === 'merge-base')
          params.set('baseMode', requestedSelection.baseMode);

        const response = await fetch(`/api/diff?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to fetch diff data');
        const data = (await response.json()) as DiffResponse;
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setDiffData(data);
        setDiffDataVersion((prev) => prev + 1);

        // Update resolved revision state from server response
        setResolvedBaseRevision(
          data.baseCommitish && data.requestedBaseMode !== 'merge-base' ? data.baseCommitish : '',
        );
        if (data.targetCommitish) setResolvedTargetRevision(data.targetCommitish);

        if (!hasUserSelectedRevisionRef.current) {
          const requestedBase = data.requestedBaseCommitish ?? data.baseCommitish;
          const requestedTarget = data.requestedTargetCommitish ?? data.targetCommitish;
          if (requestedBase && requestedTarget) {
            setSelectedRevision(
              createDiffSelection(requestedBase, requestedTarget, data.requestedBaseMode),
            );
          }
        }

        // Set diff mode from server response if provided
        if (data.mode && !hasUserSetDiffModeRef.current) {
          setDiffMode(normalizeDiffViewMode(data.mode));
        }

        // Lock files are now automatically marked as viewed by useViewedFiles hook
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          return;
        }
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (activeDiffAbortControllerRef.current === controller) {
          activeDiffAbortControllerRef.current = null;
        }
        if (diffRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [ignoreWhitespace],
  );
  fetchDiffDataRef.current = fetchDiffData;

  useEffect(() => {
    void fetchDiffData();
  }, [fetchDiffData]);

  useEffect(() => {
    return () => {
      activeDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isMobile && diffMode !== 'unified') {
      setDiffMode('unified');
    }
  }, [diffMode, isMobile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(isFileTreeOpen));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
  }, [isFileTreeOpen]);

  // Fetch revision options on mount
  useEffect(() => {
    fetch('/api/revisions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RevisionsResponse | null) => {
        setRevisionOptions(data);
        if (
          data?.resolvedBase &&
          normalizeBaseMode(currentRequestedBaseModeRef.current) !== 'merge-base'
        ) {
          setResolvedBaseRevision((prev) => prev || data.resolvedBase || '');
        }
        if (data?.resolvedTarget) {
          setResolvedTargetRevision((prev) => prev || data.resolvedTarget || '');
        }
      })
      .catch(() => setRevisionOptions(null));
  }, []);

  // Handle revision change
  const handleRevisionChange = useCallback(
    async (nextSelection: DiffSelection) => {
      // Skip if no actual change
      if (diffSelectionsEqual(nextSelection, selectedRevision)) return;

      hasUserSelectedRevisionRef.current = true;
      selectedRevisionRef.current = nextSelection;
      setSelectedRevision(nextSelection);
      setLoading(true);
      setError(null);
      await fetchDiffData(nextSelection);
    },
    [fetchDiffData, selectedRevision],
  );

  // Clear comments and viewed files on initial load if requested via CLI flag
  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      pendingBootstrapAfterLocalResetRef.current = true;
      clearAllComments({ resetAppliedCommentImportIds: true });
      clearViewedFiles();
      console.log(
        '✅ All existing comments and viewed files cleared as requested via --clean flag',
      );
    }
  }, [diffData?.clearComments, clearAllComments, clearViewedFiles]);

  useEffect(() => {
    if (!commentsContextKey || !hasLoadedComments) {
      return;
    }

    if (bootstrappedCommentsKey === commentsContextKey) {
      return;
    }

    if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
      return;
    }

    if (pendingBootstrapAfterLocalResetRef.current) {
      pendingBootstrapAfterLocalResetRef.current = false;
      return;
    }

    bootstrappingCommentsKeyRef.current = commentsContextKey;
    let cancelled = false;

    const bootstrapComments = async () => {
      try {
        const serverThreads = await fetchServerThreads();
        const mergedThreads = mergeCommentThreads(serverThreads, threads).threads;
        if (cancelled) {
          return;
        }

        skipNextCommentSyncRef.current = true;
        replaceThreads(mergedThreads);

        if (JSON.stringify(serverThreads) !== JSON.stringify(mergedThreads)) {
          await syncThreadsToServer(mergedThreads);
        }
      } catch (commentsError) {
        if (!cancelled) {
          console.error('Failed to bootstrap comments from server:', commentsError);
        }
      } finally {
        if (!cancelled) {
          setBootstrappedCommentsKey(commentsContextKey);
        }
        if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
          bootstrappingCommentsKeyRef.current = null;
        }
      }
    };

    void bootstrapComments();

    return () => {
      cancelled = true;
      if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
        bootstrappingCommentsKeyRef.current = null;
      }
    };
  }, [
    bootstrappedCommentsKey,
    commentsContextKey,
    fetchServerThreads,
    hasLoadedComments,
    replaceThreads,
    syncThreadsToServer,
    threads,
  ]);

  // Trigger sparkle animation when all files are viewed
  useEffect(() => {
    if (diffData) {
      // Reset the trigger flag when not all files are viewed
      if (viewedFiles.size < diffData.files.length) {
        setHasTriggeredSparkles(false);
      }
      // Show sparkles when all files are viewed and not already triggered
      else if (viewedFiles.size === diffData.files.length && !hasTriggeredSparkles) {
        setShowSparkles(true);
        setHasTriggeredSparkles(true);
        // Hide sparkles after animation completes
        setTimeout(() => {
          setShowSparkles(false);
        }, 1000);
      }
    }
  }, [viewedFiles.size, diffData, hasTriggeredSparkles]);

  // Send comments to server whenever they change and before page unload
  useEffect(() => {
    if (!hasBootstrappedComments) {
      return;
    }

    const data = JSON.stringify({ threads });
    const commentsApiUrl = getCommentApiUrl('/api/comments');

    // Also handle page unload
    const sendCommentsBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload, including empty states.
      navigator.sendBeacon(commentsApiUrl, data);
    };

    window.addEventListener('beforeunload', sendCommentsBeforeUnload);

    if (skipNextCommentSyncRef.current) {
      skipNextCommentSyncRef.current = false;
      return () => {
        window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
      };
    }

    syncThreadsToServer(threads).catch((syncError) => {
      console.error('Failed to sync comments:', syncError);
    });

    return () => {
      window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
    };
  }, [getCommentApiUrl, hasBootstrappedComments, syncThreadsToServer, threads]);

  // Establish SSE connection for tab close detection
  useEffect(() => {
    const eventSource = new EventSource(resolveEventSourceUrl('/api/heartbeat'));

    eventSource.onopen = () => {
      console.log('Connected to server heartbeat');
    };

    eventSource.onerror = () => {
      console.log('Server connection lost');
      eventSource.close();
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  const handleAddComment = useCallback(
    (
      file: string,
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
      reviewRequested?: boolean,
    ): Promise<void> => {
      addThread({
        filePath: file,
        body,
        side: side || 'new',
        line: typeof line === 'number' ? line : { start: line[0], end: line[1] },
        codeSnapshot: codeContent
          ? {
              content: codeContent,
              language: undefined,
            }
          : undefined,
        reviewRequested,
      });
      return Promise.resolve();
    },
    [addThread],
  );

  const handleAddFileComment = useCallback(
    (file: string, body: string): Promise<void> => {
      addFileThread({ filePath: file, body });
      return Promise.resolve();
    },
    [addFileThread],
  );

  const handleReplyToThread = useCallback(
    (threadId: string, body: string, reviewRequested?: boolean): Promise<void> => {
      replyToThread({ threadId, body, reviewRequested });
      return Promise.resolve();
    },
    [replyToThread],
  );

  const handleResolveThread = useCallback(
    async (threadId: string, resolved: boolean): Promise<void> => {
      const response = await fetch(getCommentApiUrl(`/api/threads/${threadId}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      setThreadResolved(threadId, resolved);
    },
    [getCommentApiUrl, setThreadResolved],
  );

  const postThreadAction = useCallback(
    async (threadId: string, path: string): Promise<void> => {
      const response = await fetch(getCommentApiUrl(`/api/threads/${threadId}/${path}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `${response.status} ${response.statusText}`);
      }
    },
    [getCommentApiUrl],
  );

  const handleRequestDirectEdit = useCallback(
    async (threadId: string, body: string): Promise<void> => {
      await replyToThread({ threadId, body, reviewRequested: false });
      await postThreadAction(threadId, 'request-direct-edit');
    },
    [postThreadAction, replyToThread],
  );

  const handleCancelPlan = useCallback(
    async (threadId: string): Promise<void> => {
      await postThreadAction(threadId, 'cancel-plan');
    },
    [postThreadAction],
  );

  const handleExecutePlan = useCallback(
    async (threadId: string): Promise<void> => {
      await postThreadAction(threadId, 'execute-plan');
      const scrollContainer = diffScrollContainerRef.current;
      const savedScrollTop = scrollContainer?.scrollTop ?? null;
      await fetchDiffDataRef.current?.();
      if (scrollContainer && savedScrollTop !== null) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = savedScrollTop;
        });
      }
    },
    [postThreadAction],
  );

  const handleRollbackPlan = useCallback(
    async (threadId: string): Promise<void> => {
      await postThreadAction(threadId, 'rollback-plan');
      const scrollContainer = diffScrollContainerRef.current;
      const savedScrollTop = scrollContainer?.scrollTop ?? null;
      await fetchDiffDataRef.current?.();
      if (scrollContainer && savedScrollTop !== null) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = savedScrollTop;
        });
      }
    },
    [postThreadAction],
  );

  const handleApplySuggestion = useCallback(
    async (threadId: string, suggestionIndex: number): Promise<void> => {
      const response = await fetch(getCommentApiUrl('/api/apply-suggestion'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, suggestionIndex }),
      });
      const result = (await response.json().catch(() => null)) as
        | { success: true; file: string; linesChanged: number }
        | { success: false; reason: string; detail?: string }
        | null;
      if (!response.ok || !result || result.success === false) {
        const detail =
          result && result.success === false
            ? `${result.reason}${result.detail ? `: ${result.detail}` : ''}`
            : `${response.status} ${response.statusText}`;
        throw new Error(detail);
      }
      markSuggestionApplied(threadId, suggestionIndex);
      const scrollContainer = diffScrollContainerRef.current;
      const savedScrollTop = scrollContainer?.scrollTop ?? null;
      await fetchDiffDataRef.current?.();
      if (scrollContainer && savedScrollTop !== null) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = savedScrollTop;
        });
      }
    },
    [getCommentApiUrl, markSuggestionApplied],
  );

  const handleNavigateToComment = (thread: CommentThread) => {
    if (!diffData) return;

    const position = findCommentPosition(thread, diffData.files);
    if (position) {
      setCursorPosition(position);
    }
  };

  const handleOpenInEditor = useCallback(
    async (filePath: string, lineNumber: number) => {
      try {
        const response = await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, line: lineNumber, editor: settings.editor }),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          let message = response.statusText;
          if (
            payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof (payload as { error?: unknown }).error === 'string'
          ) {
            message = (payload as { error: string }).error;
          }
          console.error('Failed to open file in editor:', message);
        }
      } catch (error) {
        console.error('Failed to open file in editor:', error);
      }
    },
    [settings.editor],
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    // Clear cursor position
    setCursorPosition(null);

    // Check if clicking on a comment button
    const target = e.target as HTMLElement;
    const isCommentButton = target.closest('[data-comment-button="true"]');
    const isOpenInEditorButton = target.closest('[data-open-in-editor-button="true"]');

    // Close empty comment forms (unless clicking on a comment button)
    if (!isCommentButton && !isOpenInEditorButton) {
      closeEmptyCommentForms(e);
    }
  };

  const closeEmptyCommentForms = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't close any form if the click landed inside a form — a textarea click
    // (capture phase) was incorrectly triggering close before bubble-phase stopPropagation.
    if (target.closest('form')) return;

    const emptyForms = document.querySelectorAll('form[data-empty="true"]');
    emptyForms.forEach((form) => {
      const cancelButton = form.querySelector('button[type="button"]') as HTMLButtonElement;
      cancelButton?.click();
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-github-bg-primary">
        <div className="text-github-text-secondary text-base">diff 로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">오류</h2>
        <p className="text-github-text-secondary text-base">{error}</p>
      </div>
    );
  }

  if (!diffData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">데이터 없음</h2>
        <p className="text-github-text-secondary text-base">사용 가능한 diff 데이터가 없습니다</p>
      </div>
    );
  }

  const canOpenInEditor = settings.editor !== 'none' && diffData.openInEditorAvailable !== false;

  return (
    <WordHighlightProvider>
      <div className="h-screen flex flex-col" onClickCapture={handleGlobalClick}>
        <header
          className={`bg-github-bg-secondary border-b border-github-border flex ${
            isMobile ? 'flex-col' : 'flex-row items-center'
          }`}
        >
          <div
            className={`flex items-center justify-between w-full ${
              isMobile ? 'px-3 py-2 gap-3' : 'px-4 py-3 gap-4 w-auto'
            } ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '100%' : isFileTreeOpen ? `${sidebarWidth}px` : 'auto',
              minWidth: isMobile ? '0px' : isFileTreeOpen ? '200px' : 'auto',
              maxWidth: isMobile ? 'none' : isFileTreeOpen ? '600px' : 'none',
            }}
          >
            <h1>
              <Logo style={{ height: '18px', color: 'var(--color-github-text-secondary)' }} />
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsFileTreeOpen(!isFileTreeOpen)}
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title={isFileTreeOpen ? 'Collapse file tree' : 'Expand file tree'}
                aria-expanded={isFileTreeOpen}
                aria-controls="file-tree-panel"
                aria-label="파일 트리 패널 토글"
              >
                {isFileTreeOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title="설정"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
          {!isMobile && (
            <div
              className={`border-r border-github-border ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
                height: 'calc(100% - 16px)',
                margin: '8px 0',
                transform: 'translateX(-2px)',
              }}
            />
          )}
          <div
            className={`flex-1 flex flex-wrap items-center justify-between ${
              isMobile ? 'px-3 pb-2 gap-3' : 'px-4 py-3 gap-4'
            }`}
          >
            <div className={`flex flex-wrap items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
              {!isMobile && (
                <div className="flex bg-github-bg-tertiary border border-github-border rounded-md p-1">
                  <button
                    onClick={() => handleDiffModeChange('split')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'split'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <Columns size={14} />
                    분할
                  </button>
                  <button
                    onClick={() => handleDiffModeChange('unified')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'unified'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <AlignLeft size={14} />
                    통합
                  </button>
                </div>
              )}
              <Checkbox
                checked={ignoreWhitespace}
                onChange={setIgnoreWhitespace}
                label="공백 무시"
                title={ignoreWhitespace ? '공백 변경 표시' : '공백 변경 무시'}
              />
              {/* File Watch Reload Button */}
              <ReloadButton
                shouldReload={shouldReload}
                isReloading={watchState.isReloading}
                onReload={reload}
                changeType={watchState.lastChangeType}
                compact={isMobile}
              />
            </div>
            <div
              className={`flex flex-wrap items-center text-sm text-github-text-secondary ${
                isMobile ? 'gap-3' : 'gap-4'
              }`}
            >
              {!isMobile && (
                <CommentsCountPopover
                  comments={normalizedThreads}
                  onNavigate={handleNavigateToComment}
                />
              )}
              {!isMobile && (
                <SubmitReviewButton
                  commentsCount={threads.length}
                  isSubmitted={isReviewSubmitted}
                  isSubmitting={isSubmittingReview}
                  onSubmit={handleSubmitReview}
                />
              )}
              <div className="flex flex-col gap-1 items-center">
                <div className="text-xs relative">
                  {viewedFiles.size === diffData.files.length
                    ? '모든 diff 확인 완료!'
                    : `${viewedFiles.size} / ${diffData.files.length} 파일 확인됨`}
                  <SparkleAnimation isActive={showSparkles} />
                </div>
                <div
                  className="relative h-2 bg-github-bg-tertiary rounded-full overflow-hidden"
                  style={{
                    width: '90px',
                    border: '1px solid var(--color-github-border)',
                  }}
                >
                  <div
                    className="absolute top-0 right-0 h-full transition-all duration-300 ease-out"
                    style={{
                      width: `${((diffData.files.length - viewedFiles.size) / diffData.files.length) * 100}%`,
                      backgroundColor: (() => {
                        const remainingPercent =
                          ((diffData.files.length - viewedFiles.size) / diffData.files.length) *
                          100;
                        if (remainingPercent > 50) return 'var(--color-github-accent)'; // green
                        if (remainingPercent > 20) return 'var(--color-github-warning)'; // yellow
                        return 'var(--color-github-danger)'; // red
                      })(),
                    }}
                  />
                </div>
              </div>
              {revisionOptions ? (
                <DiffQuickMenu
                  options={revisionOptions}
                  selection={selectedRevision}
                  resolvedBaseRevision={resolvedBaseRevision}
                  resolvedTargetRevision={resolvedTargetRevision}
                  onSelectDiff={(selection) => void handleRevisionChange(selection)}
                  onOpenAdvanced={() => setIsRevisionModalOpen(true)}
                  compact={!isDesktop}
                />
              ) : (
                <span className="text-xs">
                  Reviewing:{' '}
                  <code className="bg-github-bg-tertiary px-1.5 py-0.5 rounded text-xs text-github-text-primary">
                    {diffData.commit.includes('...') ? (
                      <>
                        <span className="text-github-text-secondary font-medium">
                          {diffData.commit.split('...')[0]}...
                        </span>
                        <span className="font-medium">{diffData.commit.split('...')[1]}</span>
                      </>
                    ) : (
                      diffData.commit
                    )}
                  </code>
                </span>
              )}
            </div>
          </div>
        </header>
        {revisionOptions && (
          <RevisionDetailModal
            key={isRevisionModalOpen ? getDiffSelectionKey(selectedRevision) : 'closed'}
            isOpen={isRevisionModalOpen}
            onClose={() => setIsRevisionModalOpen(false)}
            options={revisionOptions}
            selection={selectedRevision}
            resolvedBaseRevision={resolvedBaseRevision}
            resolvedTargetRevision={resolvedTargetRevision}
            onApply={(selection) => void handleRevisionChange(selection)}
          />
        )}

        {isMobile && isFileTreeOpen && (
          <button
            type="button"
            aria-label="파일 트리 닫기"
            className="fixed inset-0 bg-black/40 z-30"
            onClick={() => setIsFileTreeOpen(false)}
          />
        )}

        <div className="flex flex-1 overflow-hidden relative">
          <div
            className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '0px' : isFileTreeOpen ? `${sidebarWidth}px` : '0px',
            }}
          >
            <aside
              id="file-tree-panel"
              className={`bg-github-bg-secondary overflow-y-auto flex flex-col ${
                isMobile
                  ? 'fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] border-l border-github-border transition-transform duration-300 ease-out'
                  : 'relative border-r border-github-border'
              }`}
              style={{
                width: isMobile ? 'min(85vw, 360px)' : `${sidebarWidth}px`,
                minWidth: isMobile ? '0px' : '200px',
                maxWidth: isMobile ? 'none' : '600px',
                height: '100%',
                transform: isMobile
                  ? isFileTreeOpen
                    ? 'translateX(0)'
                    : 'translateX(100%)'
                  : undefined,
              }}
            >
              <div className="flex-1 overflow-y-auto">
                <FileList
                  files={diffData.files}
                  onScrollToFile={scrollFileIntoDiffContainer}
                  onFileSelected={isMobile ? handleMobileFileSelected : undefined}
                  comments={normalizedThreads}
                  reviewedFiles={viewedFiles}
                  onToggleReviewed={toggleFileReviewed}
                  selectedFileIndex={cursor?.fileIndex ?? null}
                  viewportFileIndex={viewportFileIndex}
                  onNavigateToComment={handleNavigateToComment}
                />
              </div>
              {!isMobile && (
                <div className="p-4 border-t border-github-border flex justify-between items-center">
                  <button
                    onClick={() => setIsHelpOpen(true)}
                    className="flex items-center gap-1.5 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="키보드 단축키 (Shift+?)"
                  >
                    <Keyboard size={16} />
                    <span className="text-sm">단축키</span>
                  </button>
                  <a
                    href="https://github.com/yoshiko-pg/difit"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="GitHub에서 보기"
                  >
                    <span className="text-sm">GitHub에서 별표</span>
                    <GitHubIcon style={{ height: '18px', width: '18px' }} />
                  </a>
                </div>
              )}
            </aside>
          </div>

          {!isMobile && (
            <div
              className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
              }}
              onMouseDown={handleMouseDown}
              title="드래그하여 파일 목록 크기 조절"
            />
          )}

          <main
            ref={diffScrollContainerRef}
            className={`flex-1 overflow-y-auto ${showMobileCommentsBar ? 'pb-16' : ''}`}
          >
            {diffData.files.map((file, fileIndex) => {
              const fileThreads = threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS;
              const mergedChunks =
                getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) ??
                EMPTY_MERGED_CHUNKS;
              const isRendered = renderedFilePaths.has(file.path);
              return (
                <div
                  key={file.path}
                  id={getFileElementId(file.path)}
                  data-file-path={file.path}
                  data-rendered={isRendered ? 'true' : 'false'}
                  ref={(node) => registerLazyFileContainer(file.path, node)}
                  className="mb-6"
                >
                  {isRendered ? (
                    <DiffViewer
                      file={file}
                      threads={fileThreads}
                      showAuthorBadges={showAuthorBadges}
                      diffMode={diffMode}
                      reviewedFiles={viewedFiles}
                      onToggleReviewed={toggleFileReviewed}
                      collapsedFiles={collapsedFiles}
                      onToggleCollapsed={toggleFileCollapsed}
                      onToggleAllCollapsed={toggleAllFilesCollapsed}
                      onAddComment={handleAddComment}
                      onAddFileComment={handleAddFileComment}
                      onRemoveThread={removeThread}
                      onResolveThread={handleResolveThread}
                      onReplyToThread={handleReplyToThread}
                      onRemoveMessage={removeMessage}
                      onApplySuggestion={handleApplySuggestion}
                      onRequestDirectEdit={handleRequestDirectEdit}
                      onCancelPlan={handleCancelPlan}
                      onExecutePlan={handleExecutePlan}
                      onRollbackPlan={handleRollbackPlan}
                      onOpenInEditor={canOpenInEditor ? handleOpenInEditor : undefined}
                      syntaxTheme={settings.syntaxTheme}
                      baseCommitish={diffData.baseCommitish}
                      targetCommitish={diffData.targetCommitish}
                      cursor={cursor?.fileIndex === fileIndex ? cursor : null}
                      fileIndex={fileIndex}
                      onLineClick={handleLineClick}
                      commentTrigger={
                        commentTrigger?.fileIndex === fileIndex ? commentTrigger : null
                      }
                      onCommentTriggerHandled={handleCommentTriggerHandled}
                      mergedChunks={mergedChunks}
                      expandLines={expandLines}
                      expandAllBetweenChunks={expandAllBetweenChunks}
                      prefetchFileContent={prefetchFileContent}
                      fileSummary={diffData.rationale?.summaries?.[file.path]}
                      hunkRationales={diffData.rationale?.hunkRationales}
                      isExpandLoading={isExpandLoading}
                    />
                  ) : (
                    <div className="bg-github-bg-secondary border border-github-border rounded-md px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs uppercase tracking-wide text-github-text-muted">
                            Deferred Rendering
                          </div>
                          <div className="text-sm font-mono text-github-text-primary truncate">
                            {file.path}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => ensureFileRendered(file.path)}
                          className="px-3 py-1.5 text-xs rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary"
                        >
                          Load now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </main>
        </div>

        {showMobileCommentsBar && (
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-github-bg-secondary border-t border-github-border px-4 py-2 flex justify-end">
            <CommentsDropdown
              commentsCount={threads.length}
              onDeleteAll={clearAllComments}
              onViewAll={() => setIsCommentsListOpen(true)}
              direction="up"
              compact
            />
          </div>
        )}

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSettingsChange={updateSettings}
          />
        )}

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

        <CommentsListModal
          isOpen={isCommentsListOpen}
          onClose={() => setIsCommentsListOpen(false)}
          onNavigate={handleNavigateToComment}
          comments={normalizedThreads}
          showAuthorBadges={showAuthorBadges}
          onRemoveThread={removeThread}
          onResolveThread={handleResolveThread}
          onReplyToThread={handleReplyToThread}
          onRemoveMessage={removeMessage}
          onApplySuggestion={handleApplySuggestion}
          onRequestDirectEdit={handleRequestDirectEdit}
          onCancelPlan={handleCancelPlan}
          onExecutePlan={handleExecutePlan}
          onRollbackPlan={handleRollbackPlan}
          syntaxTheme={settings.syntaxTheme}
        />

        {isReviewSubmitted && (
          <ReviewCompleteOverlay onAfterSubmit={() => setIsReviewSubmitted(false)} />
        )}
      </div>
    </WordHighlightProvider>
  );
}

export default App;
