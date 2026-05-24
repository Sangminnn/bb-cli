import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CommentThread,
  EditPlan,
  ExecutedEditPlan,
} from '../../types/diff';

import { CommentThreadCard } from './CommentThreadCard';

const buildPendingPlan = (overrides?: Partial<EditPlan>): EditPlan => ({
  id: 'plan-1',
  threadId: 'thread-1',
  createdAt: '2024-01-01T00:02:00Z',
  summary: '두 곳을 수정합니다',
  items: [
    {
      id: 'item-1',
      filePath: 'src/foo.ts',
      startLine: 10,
      endLine: 10,
      expectedOriginal: 'const a = 1;',
      replacement: 'const a = 2;',
      description: 'bump',
    },
  ],
  ...overrides,
});

const buildExecutedPlan = (
  overrides?: Partial<ExecutedEditPlan>,
): ExecutedEditPlan => ({
  plan: buildPendingPlan(),
  executedAt: '2024-01-01T00:03:00Z',
  snapshots: [
    { filePath: 'src/foo.ts', contentBeforeExecution: 'const a = 1;\n' },
  ],
  ...overrides,
});

const mockThread: CommentThread = {
  id: 'thread-1',
  file: 'src/client/components/CommentThreadCard.tsx',
  line: 80,
  side: 'new',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  codeContent: 'const value = 1;',
  messages: [
    {
      id: 'message-1',
      body: 'Root comment',
      author: 'User',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'message-2',
      body: 'Reply comment',
      author: 'Reviewer',
      createdAt: '2024-01-01T00:01:00Z',
      updatedAt: '2024-01-01T00:01:00Z',
    },
  ],
};

describe('CommentThreadCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders messages inline while keeping the reply indentation line', () => {
    const { container } = render(
      <CommentThreadCard
        thread={mockThread}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Root comment')).toBeInTheDocument();
    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    expect(screen.getByTitle('스레드 해결')).toBeInTheDocument();
    expect(screen.getAllByTitle('답글 삭제')).toHaveLength(1);
    expect(screen.queryByTitle('메시지 수정')).not.toBeInTheDocument();
    expect(container.querySelector('.ml-4.border-l.border-github-border.pl-3')).toBeTruthy();
  });

  it('keeps resolve available for root comments even when not authored by the user', () => {
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            {
              ...mockThread.messages[0]!,
              author: 'Reviewer',
            },
          ],
        }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
      />,
    );

    expect(screen.getByTitle('스레드 해결')).toBeInTheDocument();
    expect(screen.queryByTitle('답글 삭제')).not.toBeInTheDocument();
  });

  it('confirms before resolving a root comment by default', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => false);
    const onResolveThread = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);

    render(
      <CommentThreadCard
        thread={mockThread}
        onRemoveThread={vi.fn()}
        onResolveThread={onResolveThread}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('스레드 해결'));

    expect(confirmSpy).toHaveBeenCalledWith(
      '이 스레드를 해결 처리하시겠습니까?\n\n"Root comment"',
    );
    expect(onResolveThread).not.toHaveBeenCalled();
  });

  it('confirms before deleting a reply', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => false);
    const onRemoveMessage = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);

    render(
      <CommentThreadCard
        thread={mockThread}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
      />,
    );

    await user.click(screen.getByTitle('답글 삭제'));

    expect(confirmSpy).toHaveBeenCalledWith('이 답글을 삭제하시겠습니까?\n\n"Reply comment"');
    expect(onRemoveMessage).not.toHaveBeenCalled();
  });

  it('allows deleting an agent-authored reply', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => false);
    const onRemoveMessage = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);

    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            mockThread.messages[0]!,
            {
              ...mockThread.messages[1]!,
              author: 'Agent',
              body: 'Agent reply',
            },
          ],
        }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
      />,
    );

    expect(screen.getAllByTitle('답글 삭제')).toHaveLength(1);
    await user.click(screen.getByTitle('답글 삭제'));

    expect(confirmSpy).toHaveBeenCalledWith('이 답글을 삭제하시겠습니까?\n\n"Agent reply"');
  });

  it('shows the [직접 수정] button when onRequestDirectEdit is provided', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRequestDirectEdit={vi.fn().mockResolvedValue(undefined)}
        onCancelPlan={vi.fn().mockResolvedValue(undefined)}
        onExecutePlan={vi.fn().mockResolvedValue(undefined)}
        onRollbackPlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: '직접 수정' })).toBeInTheDocument();
  });

  it('hides the [직접 수정] button while a pending plan exists', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, pendingPlan: buildPendingPlan() }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRequestDirectEdit={vi.fn().mockResolvedValue(undefined)}
        onCancelPlan={vi.fn().mockResolvedValue(undefined)}
        onExecutePlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByRole('button', { name: '직접 수정' })).not.toBeInTheDocument();
  });

  it('shows the planning banner when directEditRequested but no pendingPlan yet', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, directEditRequested: true }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRequestDirectEdit={vi.fn().mockResolvedValue(undefined)}
        onCancelPlan={vi.fn().mockResolvedValue(undefined)}
        onExecutePlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('에이전트가 수정 계획을 작성 중입니다…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '직접 수정' })).not.toBeInTheDocument();
  });

  it('renders the EditPlanCard with summary and execute/cancel actions when pendingPlan is present', async () => {
    const user = userEvent.setup();
    const onExecutePlan = vi.fn().mockResolvedValue(undefined);
    const onCancelPlan = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          directEditRequested: true,
          pendingPlan: buildPendingPlan(),
        }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRequestDirectEdit={vi.fn().mockResolvedValue(undefined)}
        onCancelPlan={onCancelPlan}
        onExecutePlan={onExecutePlan}
      />,
    );

    const planCard = screen.getByText('직접 수정 계획').closest('div')!.parentElement!;
    expect(within(planCard).getByText('두 곳을 수정합니다')).toBeInTheDocument();
    expect(within(planCard).getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.queryByText('에이전트가 수정 계획을 작성 중입니다…')).not.toBeInTheDocument();

    await user.click(within(planCard).getByRole('button', { name: '실행' }));
    expect(onExecutePlan).toHaveBeenCalledWith('thread-1');

    await user.click(within(planCard).getByRole('button', { name: '취소' }));
    expect(onCancelPlan).toHaveBeenCalledWith('thread-1');
  });

  it('renders the ExecutedPlanCard with rollback action when executedPlan is present', async () => {
    const user = userEvent.setup();
    const onRollbackPlan = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentThreadCard
        thread={{ ...mockThread, executedPlan: buildExecutedPlan() }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRollbackPlan={onRollbackPlan}
      />,
    );

    expect(screen.getByText('직접 수정 적용됨')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /되돌리기/ }));
    expect(onRollbackPlan).toHaveBeenCalledWith('thread-1');
  });

  it('marks the executed plan as rolled back and hides the rollback button', () => {
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          executedPlan: buildExecutedPlan({
            rolledBack: true,
            rolledBackAt: '2024-01-01T00:04:00Z',
          }),
        }}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onRollbackPlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('되돌림')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /되돌리기/ })).not.toBeInTheDocument();
  });
});
