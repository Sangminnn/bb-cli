import { useEffect, useRef, useState } from 'react';

import type { CommentThread } from '../../types/diff';

interface CommentsCountPopoverProps {
  comments: CommentThread[];
  onNavigate: (thread: CommentThread) => void;
  label?: string;
  emptyMessage?: string;
}

const formatLine = (line: number | number[]) => {
  if (Array.isArray(line)) {
    if (line.length === 0) return '';
    if (line.length === 1) return `:${line[0]}`;
    return `:${line[0]}-${line[line.length - 1]}`;
  }
  return line > 0 ? `:${line}` : '';
};

const truncate = (text: string, max: number) => {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
};

const kindLabel = (thread: CommentThread): string => {
  if (Array.isArray(thread.line)) return '범위';
  if (thread.line === 0 || thread.line === undefined || thread.line === null) return '파일';
  return '라인';
};

export const CommentsCountPopover = ({
  comments,
  onNavigate,
  label = '코멘트',
  emptyMessage = '아직 코멘트가 없습니다.',
}: CommentsCountPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const sorted = [...comments].sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;
    const aLine = Array.isArray(a.line) ? a.line[0] : a.line;
    const bLine = Array.isArray(b.line) ? b.line[0] : b.line;
    if (aLine !== bLine) return aLine - bLine;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const handleCardClick = (thread: CommentThread) => {
    onNavigate(thread);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="text-xs px-3 py-1.5 rounded transition-all flex items-center gap-1.5 whitespace-nowrap font-medium"
        style={{
          backgroundColor: isOpen
            ? 'var(--color-github-bg-tertiary)'
            : 'var(--color-github-bg-secondary)',
          color: 'var(--color-github-text-primary)',
          border: '1px solid var(--color-github-border)',
        }}
        title={`${label} ${comments.length}`}
      >
        <span>{label}</span>
        <span className="font-semibold">{comments.length}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[60vh] overflow-hidden rounded-lg border border-github-border bg-github-bg-primary shadow-lg z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-github-border">
            <span className="text-sm font-semibold text-github-text-primary">
              {label} {comments.length}
            </span>
          </div>

          <div className="overflow-y-auto flex-1">
            {sorted.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-github-text-secondary">
                {emptyMessage}
              </div>
            ) : (
              <ul className="divide-y divide-github-border">
                {sorted.map((thread) => {
                  const preview = thread.messages[0]?.body ?? '';
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        onClick={() => handleCardClick(thread)}
                        className="w-full text-left px-4 py-3 hover:bg-github-bg-tertiary transition-colors flex flex-col gap-1.5"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className="px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: 'var(--color-github-accent)',
                              color: 'white',
                            }}
                          >
                            {kindLabel(thread)}
                          </span>
                          <span className="font-mono text-github-text-secondary truncate">
                            {thread.file}
                            {formatLine(thread.line)}
                          </span>
                        </div>
                        <p className="text-sm text-github-text-primary whitespace-pre-wrap">
                          {truncate(preview, 140)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
