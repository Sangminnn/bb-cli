import { Bot, Check, ChevronDown, ChevronRight, Loader2, RotateCcw, Trash2, User } from 'lucide-react';
import React, { useState } from 'react';

import { type CommentThread, type DiffCommentMessage } from '../../types/diff';
import { hasSuggestionBlock } from '../../utils/suggestionUtils';

import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm } from './CommentForm';
import { EditPlanCard, ExecutedPlanCard } from './EditPlanCard';
import type { AppearanceSettings } from './SettingsModal';

const COLLAPSE_THRESHOLD = 6;
const COLLAPSE_KEEP_HEAD = 2;
const COLLAPSE_KEEP_TAIL = 2;

interface ThreadMessageItemProps {
  message: DiffCommentMessage;
  isRootMessage?: boolean;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  originalCode?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  deleteConfirmMessage?: string;
  onClick?: (e: React.MouseEvent) => void;
  onApplySuggestion?: (suggestionIndex: number) => Promise<void> | void;
  onRejectSuggestion?: (suggestionIndex: number) => void;
}

function ThreadMessageItem({
  message,
  isRootMessage = false,
  syntaxTheme,
  filename,
  originalCode,
  onDelete,
  deleteLabel,
  deleteConfirmMessage,
  onClick,
  onApplySuggestion,
  onRejectSuggestion,
}: ThreadMessageItemProps) {
  const isAgentAuthored = message.author?.trim().toLowerCase() === 'agent';
  const authorLabel = message.author?.trim() || 'User';
  const containerClassName = isAgentAuthored
    ? '-mx-1 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2'
    : '-mx-1 rounded-md border border-github-border bg-github-bg-primary px-3 py-2';
  const badgeClassName = isAgentAuthored
    ? 'border-blue-500/40 bg-blue-500/10 text-blue-700'
    : 'border-github-border bg-github-bg-tertiary text-github-text-primary';

  const showDeleteButton = !isRootMessage && onDelete;

  return (
    <div className="flex min-w-0 items-start gap-3" onClick={onClick}>
      <div className={`min-w-0 flex-1 ${containerClassName}`}>
        <div className="mb-2 flex min-w-0 items-center gap-2 pr-2 text-xs text-github-text-secondary">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClassName}`}
          >
            {isAgentAuthored ? <Bot size={11} /> : <User size={11} />}
            {authorLabel}
          </span>
        </div>

        <CommentBodyRenderer
          body={message.body}
          originalCode={originalCode}
          filename={filename}
          syntaxTheme={syntaxTheme}
          appliedSuggestionIndices={message.appliedSuggestions}
          onApplySuggestion={onApplySuggestion}
          onRejectSuggestion={onRejectSuggestion}
        />
      </div>
      {showDeleteButton && (
        <div className="flex shrink-0 items-start gap-2 pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (deleteConfirmMessage && !confirm(deleteConfirmMessage)) {
                return;
              }
              onDelete?.();
            }}
            className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-danger transition-all hover:bg-github-bg-primary"
            title={deleteLabel}
            aria-label={deleteLabel}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

interface CommentThreadCardProps {
  thread: CommentThread;
  showAuthorBadges?: boolean;
  confirmRootAction?: boolean;
  onRemoveThread: (threadId: string) => void;
  onResolveThread?: (threadId: string, resolved: boolean) => Promise<void> | void;
  onReplyToThread: (threadId: string, body: string, reviewRequested?: boolean) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onApplySuggestion?: (threadId: string, suggestionIndex: number) => Promise<void> | void;
  onRequestDirectEdit?: (threadId: string, body: string) => Promise<void>;
  onCancelPlan?: (threadId: string) => Promise<void>;
  onExecutePlan?: (threadId: string) => Promise<void>;
  onRollbackPlan?: (threadId: string) => Promise<void>;
  onClick?: (e: React.MouseEvent) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentThreadCard({
  thread,
  showAuthorBadges: _showAuthorBadges = false,
  confirmRootAction = true,
  onRemoveThread,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onApplySuggestion,
  onRequestDirectEdit,
  onCancelPlan,
  onExecutePlan,
  onRollbackPlan,
  onClick,
  syntaxTheme,
}: CommentThreadCardProps) {
  const isResolved = thread.resolved === true;
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [middleExpanded, setMiddleExpanded] = useState(false);

  const lastSuggestionMessageId = (() => {
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const candidate = thread.messages[i];
      if (candidate && hasSuggestionBlock(candidate.body)) {
        return candidate.id;
      }
    }
    return null;
  })();

  const buildApplyHandler = (messageId: string) => {
    if (!onApplySuggestion || messageId !== lastSuggestionMessageId) return undefined;
    return async (suggestionIndex: number) => {
      if (isResolved) {
        const ok = confirm(
          '해결된 스레드입니다. 적용 시 다시 열림 상태로 전환됩니다. 계속할까요?',
        );
        if (!ok) return;
        if (onResolveThread) {
          await onResolveThread(thread.id, false);
        }
      }
      await onApplySuggestion(thread.id, suggestionIndex);
    };
  };

  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastAuthorIsAgent = lastMessage?.author?.trim().toLowerCase() === 'agent';
  const isAgentReviewing = thread.reviewRequested === true && !lastAuthorIsAgent;
  const isAgentPlanning = thread.directEditRequested === true && !thread.pendingPlan;
  const pendingPlan = thread.pendingPlan;
  const executedPlan = thread.executedPlan;
  const canRequestDirectEdit =
    !!onRequestDirectEdit && !pendingPlan && !isAgentPlanning && !isResolved;

  const handleResolveClick = async () => {
    if (onResolveThread) {
      if (
        confirmRootAction &&
        !confirm(`이 스레드를 해결 처리하시겠습니까?\n\n"${rootMessage.body}"`)
      ) {
        return;
      }
      await onResolveThread(thread.id, true);
      return;
    }
    if (
      confirmRootAction &&
      !confirm(`이 스레드를 삭제하시겠습니까?\n\n"${rootMessage.body}"`)
    ) {
      return;
    }
    onRemoveThread(thread.id);
  };

  const handleUnresolveClick = async () => {
    if (!onResolveThread) return;
    await onResolveThread(thread.id, false);
  };

  const replyMessages = thread.messages.slice(1);
  const totalCount = thread.messages.length;

  const shouldCollapseMiddle =
    !middleExpanded &&
    !isResolved &&
    replyMessages.length > COLLAPSE_THRESHOLD - 1;

  const visibleReplyMessages = shouldCollapseMiddle
    ? [
        ...replyMessages.slice(0, COLLAPSE_KEEP_HEAD - 1),
        ...replyMessages.slice(replyMessages.length - COLLAPSE_KEEP_TAIL),
      ]
    : replyMessages;

  const hiddenMiddleCount = shouldCollapseMiddle
    ? replyMessages.length - visibleReplyMessages.length
    : 0;
  const middleSplitIndex = COLLAPSE_KEEP_HEAD - 1;

  if (isResolved && !resolvedExpanded) {
    return (
      <div
        id={`comment-thread-${thread.id}`}
        className="rounded-md border border-l-4 border-green-600/40 border-l-green-500 bg-green-500/5 px-3 py-2 text-xs"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setResolvedExpanded(true);
          }}
          className="flex w-full items-center gap-2 text-left text-green-800 hover:text-green-900 dark:text-green-300 dark:hover:text-green-200"
        >
          <Check size={14} />
          <span className="font-medium">해결됨</span>
          <span className="text-github-text-secondary">·</span>
          <span className="truncate text-github-text-secondary">
            {rootMessage.body.split('\n')[0]?.slice(0, 80) ?? ''}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-github-text-secondary">
            <span>메시지 {totalCount}개 보기</span>
            <ChevronRight size={12} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      id={`comment-thread-${thread.id}`}
      className={`rounded-md border p-3 shadow-sm transition-all ${
        isResolved
          ? 'border-green-600/40 border-l-4 border-l-green-500 bg-green-500/5'
          : 'border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary'
      } ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      {isResolved && (
        <div
          className="mb-3 flex items-center justify-between gap-2 rounded-md border border-green-600/30 bg-green-500/10 px-2 py-1 text-xs text-green-800 dark:text-green-200"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setResolvedExpanded(false)}
            className="inline-flex items-center gap-1 hover:underline"
            title="접기"
          >
            <ChevronDown size={12} />
            <Check size={12} />
            <span className="font-medium">해결됨</span>
          </button>
          {onResolveThread && (
            <button
              type="button"
              onClick={handleUnresolveClick}
              className="inline-flex items-center gap-1 rounded border border-green-600/40 bg-green-500/10 px-2 py-0.5 text-[11px] font-medium hover:bg-green-500/20"
              title="다시 열기"
            >
              <RotateCcw size={11} />
              다시 열기
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <ThreadMessageItem
              message={rootMessage}
              isRootMessage={true}
              syntaxTheme={syntaxTheme}
              filename={thread.file}
              originalCode={rootMessage.codeSnapshotAtCreation ?? thread.codeContent}
              onApplySuggestion={buildApplyHandler(rootMessage.id)}
            />
          </div>
          {!isResolved && (
            <div
              className="flex shrink-0 items-start gap-2 pt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleResolveClick}
                className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-green-700 transition-all hover:bg-github-bg-primary hover:text-green-800"
                title="스레드 해결"
                aria-label="스레드 해결"
              >
                <Check size={12} />
              </button>
            </div>
          )}
        </div>

        {visibleReplyMessages.map((message, idx) => {
          const showHiddenIndicator =
            shouldCollapseMiddle && idx === middleSplitIndex && hiddenMiddleCount > 0;
          return (
            <React.Fragment key={message.id}>
              {showHiddenIndicator && (
                <div className="ml-4 border-l border-github-border pl-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMiddleExpanded(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-dashed border-github-border bg-github-bg-primary/40 px-3 py-1.5 text-xs text-github-text-secondary hover:bg-github-bg-primary"
                  >
                    <ChevronDown size={12} />
                    중간 메시지 {hiddenMiddleCount}개 펼치기
                  </button>
                </div>
              )}
              <div className="ml-4 border-l border-github-border pl-3">
                <ThreadMessageItem
                  message={message}
                  syntaxTheme={syntaxTheme}
                  filename={thread.file}
                  originalCode={message.codeSnapshotAtCreation ?? thread.codeContent}
                  onDelete={
                    isResolved ? undefined : () => onRemoveMessage(thread.id, message.id)
                  }
                  deleteLabel="답글 삭제"
                  deleteConfirmMessage={`이 답글을 삭제하시겠습니까?\n\n"${message.body}"`}
                  onApplySuggestion={buildApplyHandler(message.id)}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {isAgentReviewing && !isResolved && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-yellow-700/50 bg-yellow-500/15 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-600/40 dark:bg-yellow-500/10 dark:text-yellow-200"
          onClick={(e) => e.stopPropagation()}
          role="status"
          aria-live="polite"
        >
          <Loader2 size={14} className="animate-spin" />
          <span>에이전트가 검토 중입니다…</span>
        </div>
      )}

      {isAgentPlanning && !isResolved && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-blue-600/50 bg-blue-500/15 px-3 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200"
          onClick={(e) => e.stopPropagation()}
          role="status"
          aria-live="polite"
        >
          <Loader2 size={14} className="animate-spin" />
          <span>에이전트가 수정 계획을 작성 중입니다…</span>
        </div>
      )}

      {pendingPlan && onExecutePlan && onCancelPlan && (
        <EditPlanCard
          plan={pendingPlan}
          onExecute={() => onExecutePlan(thread.id)}
          onCancel={() => onCancelPlan(thread.id)}
        />
      )}

      {executedPlan && onRollbackPlan && (
        <ExecutedPlanCard executed={executedPlan} onRollback={() => onRollbackPlan(thread.id)} />
      )}

      <div className="mt-3 border-t border-github-border pt-3" onClick={(e) => e.stopPropagation()}>
        <CommentForm
          onSubmit={async (body) => {
            if (isResolved && onResolveThread) {
              await onResolveThread(thread.id, false);
            }
            await onReplyToThread(thread.id, body, false);
          }}
          onSubmitWithReview={async (body) => {
            if (isResolved && onResolveThread) {
              await onResolveThread(thread.id, false);
            }
            await onReplyToThread(thread.id, body, true);
          }}
          onSubmitWithDirectEdit={
            canRequestDirectEdit && onRequestDirectEdit
              ? async (body) => {
                  if (isResolved && onResolveThread) {
                    await onResolveThread(thread.id, false);
                  }
                  await onRequestDirectEdit(thread.id, body);
                }
              : undefined
          }
          onCancel={() => {}}
          selectedCode={thread.codeContent}
          syntaxTheme={syntaxTheme}
          embedded={true}
          title={isResolved ? '답글 (등록 시 다시 열림)' : '답글'}
          submitLabel="답글 등록"
          placeholder="답글을 입력하세요..."
        />
      </div>
    </div>
  );
}
