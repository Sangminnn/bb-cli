import { X } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

import type { CommentThread } from '../../types/diff';

import { CommentThreadCard } from './CommentThreadCard';
import type { AppearanceSettings } from './SettingsModal';

interface CommentsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (thread: CommentThread) => void;
  comments: CommentThread[];
  showAuthorBadges?: boolean;
  onRemoveThread: (threadId: string) => void;
  onResolveThread?: (threadId: string, resolved: boolean) => Promise<void> | void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onApplySuggestion?: (threadId: string, suggestionIndex: number) => Promise<void> | void;
  onRequestDirectEdit?: (threadId: string, body: string) => Promise<void>;
  onCancelPlan?: (threadId: string) => Promise<void>;
  onExecutePlan?: (threadId: string) => Promise<void>;
  onRollbackPlan?: (threadId: string) => Promise<void>;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentsListModal({
  isOpen,
  onClose,
  onNavigate,
  comments,
  showAuthorBadges = false,
  onRemoveThread,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onApplySuggestion,
  onRequestDirectEdit,
  onCancelPlan,
  onExecutePlan,
  onRollbackPlan,
  syntaxTheme,
}: CommentsListModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { enableScope, disableScope } = useHotkeysContext();

  const sortedThreads = [...comments].sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;

    const aLine = Array.isArray(a.line) ? a.line[0] : a.line;
    const bLine = Array.isArray(b.line) ? b.line[0] : b.line;
    if (aLine !== bLine) return aLine - bLine;

    return a.createdAt.localeCompare(b.createdAt);
  });

  const handleThreadClick = useCallback(
    (thread: CommentThread) => {
      onNavigate(thread);
      onClose();
    },
    [onClose, onNavigate],
  );

  const handleResolveThread = useCallback(
    async (thread: CommentThread) => {
      const preview = thread.messages[0]?.body || '';
      if (!confirm(`이 스레드를 해결 처리하시겠습니까?\n\n"${preview}"`)) {
        return;
      }
      if (onResolveThread) {
        await onResolveThread(thread.id, true);
      } else {
        onRemoveThread(thread.id);
      }
      if (selectedIndex >= sortedThreads.length - 1 && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    },
    [onRemoveThread, onResolveThread, selectedIndex, sortedThreads.length],
  );

  useEffect(() => {
    if (isOpen) {
      enableScope('comments-list');
      disableScope('navigation');
    } else {
      enableScope('navigation');
      disableScope('comments-list');
      // oxlint-disable-next-line react-hooks-js/set-state-in-effect -- intentional: reset selection when modal closes
      setSelectedIndex(0);
    }

    return () => {
      enableScope('navigation');
      disableScope('comments-list');
    };
  }, [disableScope, enableScope, isOpen]);

  const hotkeyOptions = { scopes: 'comments-list', enableOnFormTags: false };

  useHotkeys('escape', () => onClose(), hotkeyOptions, [onClose]);

  useHotkeys(
    'j, down',
    () => setSelectedIndex((prev) => Math.min(prev + 1, sortedThreads.length - 1)),
    hotkeyOptions,
    [sortedThreads.length],
  );

  useHotkeys('k, up', () => setSelectedIndex((prev) => Math.max(prev - 1, 0)), hotkeyOptions, []);

  useHotkeys(
    'enter',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleThreadClick(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleThreadClick, selectedIndex, sortedThreads],
  );

  useHotkeys(
    'd',
    () => {
      if (sortedThreads[selectedIndex]) {
        void handleResolveThread(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleResolveThread, selectedIndex, sortedThreads],
  );

  useEffect(() => {
    if (commentRefs.current[selectedIndex]) {
      commentRefs.current[selectedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-github-border bg-github-bg-primary shadow-lg">
        <div className="sticky top-0 border-b border-github-border bg-github-bg-primary px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-github-text-primary">전체 댓글</h2>
            <button
              onClick={onClose}
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
              aria-label="코멘트 목록 닫기"
            >
              <X size={20} />
            </button>
          </div>
          <div className="text-xs text-github-text-secondary">
            <span className="font-mono">j/k</span> or <span className="font-mono">↑/↓</span> to 이동
            • <span className="font-mono">Enter</span> 점프 • <span className="font-mono">d</span>{' '}
            해결 • <span className="font-mono">Esc</span> 닫기
          </div>
        </div>

        <div className="max-h-[calc(80vh-120px)] overflow-y-auto">
          <div className="p-6">
            {sortedThreads.length === 0 ? (
              <p className="text-center text-github-text-secondary">아직 댓글이 없습니다</p>
            ) : (
              <>
                <div className="space-y-2">
                  {sortedThreads.map((thread, index) => (
                    <div
                      key={thread.id}
                      ref={(el) => {
                        commentRefs.current[index] = el;
                      }}
                      className={selectedIndex === index ? 'rounded ring-2 ring-blue-500' : ''}
                    >
                      <CommentThreadCard
                        thread={thread}
                        showAuthorBadges={showAuthorBadges}
                        confirmRootAction={false}
                        onRemoveThread={onRemoveThread}
                        onResolveThread={async (threadId, resolved) => {
                          if (threadId === thread.id && resolved) {
                            await handleResolveThread(thread);
                            return;
                          }
                          if (onResolveThread) {
                            await onResolveThread(threadId, resolved);
                          }
                        }}
                        onReplyToThread={onReplyToThread}
                        onRemoveMessage={onRemoveMessage}
                        onApplySuggestion={onApplySuggestion}
                        onRequestDirectEdit={onRequestDirectEdit}
                        onCancelPlan={onCancelPlan}
                        onExecutePlan={onExecutePlan}
                        onRollbackPlan={onRollbackPlan}
                        syntaxTheme={syntaxTheme}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(index);
                          handleThreadClick(thread);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-github-border pt-4 text-center text-xs text-github-text-secondary">
                  {selectedIndex + 1} of {sortedThreads.length} threads
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
