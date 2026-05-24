import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CommentThread } from '../../types/diff';

import { CommentsListModal } from './CommentsListModal';

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
  useHotkeysContext: vi.fn(() => ({
    enableScope: vi.fn(),
    disableScope: vi.fn(),
  })),
  HotkeysProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockThreads: CommentThread[] = [
  {
    id: 'thread-1',
    file: 'src/file1.ts',
    line: 10,
    side: 'new',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    codeContent: 'const value = 1;',
    messages: [
      {
        id: 'thread-1',
        body: 'First root comment',
        author: 'User',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'reply-1',
        body: 'First reply',
        author: 'Reviewer',
        createdAt: '2024-01-01T00:01:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      },
    ],
  },
  {
    id: 'thread-2',
    file: 'src/file2.ts',
    line: [20, 25],
    side: 'new',
    createdAt: '2024-01-01T00:02:00Z',
    updatedAt: '2024-01-01T00:02:00Z',
    messages: [
      {
        id: 'thread-2',
        body: 'Second root comment',
        author: 'User',
        createdAt: '2024-01-01T00:02:00Z',
        updatedAt: '2024-01-01T00:02:00Z',
      },
    ],
  },
];

const mockRemoveThread = vi.fn();
const mockReplyToThread = vi.fn().mockResolvedValue(undefined);
const mockRemoveMessage = vi.fn();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HotkeysProvider initiallyActiveScopes={['global']}>{children}</HotkeysProvider>
);

describe('CommentsListModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <CommentsListModal
        isOpen={false}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders thread content when open', () => {
    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    expect(screen.getByText('전체 댓글')).toBeInTheDocument();
    expect(screen.getByText('First root comment')).toBeInTheDocument();
    expect(screen.getByText('First reply')).toBeInTheDocument();
    expect(screen.getByText('Second root comment')).toBeInTheDocument();
  });

  it('shows the Agent badge for agent-authored messages and a User badge for the rest', () => {
    const threadsWithAgent: CommentThread[] = [
      {
        ...mockThreads[0]!,
        messages: [
          mockThreads[0]!.messages[0]!,
          {
            id: 'agent-reply-1',
            body: 'Agent generated reply',
            author: 'Agent',
            createdAt: '2024-01-01T00:01:30Z',
            updatedAt: '2024-01-01T00:01:30Z',
          },
        ],
      },
      mockThreads[1]!,
    ];

    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={threadsWithAgent}
        showAuthorBadges={true}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getAllByText('User').length).toBeGreaterThan(0);
  });

  it('navigates when clicking a thread', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText('First root comment'));

    expect(onNavigate).toHaveBeenCalledWith(mockThreads[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the modal open when clicking inside the reply form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    await user.click(screen.getAllByPlaceholderText('답글을 입력하세요...')[0]!);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the modal resolve handler from the resolve button', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);

    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    await user.click(screen.getAllByTitle('스레드 해결')[0]!);

    expect(confirmSpy).toHaveBeenCalledWith(
      '이 스레드를 해결 처리하시겠습니까?\n\n"First root comment"',
    );
    expect(mockRemoveThread).not.toHaveBeenCalled();
  });

  it('shows empty state when there are no threads', () => {
    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={[]}
        onRemoveThread={mockRemoveThread}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
      />,
      { wrapper },
    );

    expect(screen.getByText('아직 댓글이 없습니다')).toBeInTheDocument();
  });
});
