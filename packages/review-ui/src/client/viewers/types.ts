import type { ComponentType } from 'react';

import type { CommentThread, DiffFile, DiffSide, DiffViewMode, LineNumber } from '../../types/diff';
import type { AppearanceSettings } from '../components/SettingsModal';
import type { CursorPosition } from '../hooks/keyboardNavigation';
import type { MergedChunk } from '../hooks/useExpandedLines';

export type DiffViewerBodyProps = {
  file: DiffFile;
  threads: CommentThread[];
  showAuthorBadges?: boolean;
  diffMode: DiffViewMode;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  baseCommitish?: string;
  targetCommitish?: string;
  cursor?: CursorPosition | null;
  fileIndex?: number;
  mergedChunks: MergedChunk[];
  isExpandLoading: boolean;
  expandHiddenLines: (
    file: DiffFile,
    chunkIndex: number,
    direction: 'up' | 'down',
    count?: number,
  ) => Promise<void>;
  expandAllBetweenChunks: (
    file: DiffFile,
    chunkIndex: number,
    hiddenLines: number,
  ) => Promise<void>;
  onAddComment: (
    line: LineNumber,
    body: string,
    codeContent?: string,
    side?: DiffSide,
    reviewRequested?: boolean,
  ) => Promise<void>;
  onRemoveThread: (threadId: string) => void;
  onResolveThread?: (threadId: string, resolved: boolean) => Promise<void> | void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onApplySuggestion?: (threadId: string, suggestionIndex: number) => Promise<void> | void;
  onRequestDirectEdit?: (threadId: string, body: string) => Promise<void>;
  onCancelPlan?: (threadId: string) => Promise<void>;
  onExecutePlan?: (threadId: string) => Promise<void>;
  onRollbackPlan?: (threadId: string) => Promise<void>;
  onOpenInEditor?: (filePath: string, lineNumber: number) => void;
  onLineClick?: (
    fileIndex: number,
    chunkIndex: number,
    lineIndex: number,
    side: 'left' | 'right',
  ) => void;
  commentTrigger?: { fileIndex: number; chunkIndex: number; lineIndex: number } | null;
  onCommentTriggerHandled?: () => void;
  hunkRationales?: Record<string, string>;
};

export type DiffViewerRegistration = {
  id: string;
  match: (file: DiffFile) => boolean;
  Component: ComponentType<DiffViewerBodyProps>;
  canExpandHiddenLines?: (file: DiffFile) => boolean;
};
