import { MessageSquare } from 'lucide-react';

import type { CommentThread, LineNumber } from '../../types/diff';

interface FileCommentPopoverProps {
  threads: CommentThread[];
  position: { top: number; left: number };
  onSelect: (thread: CommentThread) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const formatLine = (line: LineNumber) => {
  if (typeof line === 'number') return `L${line}`;
  if (Array.isArray(line)) return `L${line[0]}-${line[1]}`;
  return '';
};

const previewFirstLine = (thread: CommentThread) => {
  const body = thread.messages[0]?.body ?? '';
  const firstLine = body.split('\n')[0] ?? '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
};

export const FileCommentPopover = ({
  threads,
  position,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}: FileCommentPopoverProps) => {
  return (
    <div
      className="fixed z-50 w-80 max-h-96 overflow-y-auto rounded-md border border-github-border bg-github-bg-primary shadow-lg"
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="px-3 py-2 border-b border-github-border text-xs text-github-text-secondary">
        코멘트 {threads.length}개
      </div>
      <div className="divide-y divide-github-border">
        {threads.map((thread) => {
          const author = thread.messages[0]?.author ?? 'User';
          const preview = previewFirstLine(thread) || '(내용 없음)';
          const isResolved = thread.resolved === true;
          return (
            <button
              key={thread.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(thread);
              }}
              className="block w-full text-left px-3 py-2 hover:bg-github-bg-tertiary transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-github-text-primary truncate">
                  {author}
                  {isResolved && (
                    <span className="ml-1.5 text-[10px] text-green-500">해결됨</span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-github-text-secondary shrink-0">
                  <MessageSquare size={12} />
                  {thread.messages.length}
                  <span className="ml-1 font-mono">{formatLine(thread.line)}</span>
                </span>
              </div>
              <p className="text-xs text-github-text-secondary line-clamp-2 break-all">{preview}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
