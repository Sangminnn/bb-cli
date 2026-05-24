import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DiffContextStorage } from '../../types/diff';
import { useDiffComments } from './useDiffComments';

// Mock StorageService
let mockDiffContextData: DiffContextStorage | null = null;
vi.mock('../services/StorageService', () => ({
  storageService: {
    getCommentThreads: vi.fn(() => mockDiffContextData?.threads || []),
    saveCommentThreads: vi.fn(
      (baseCommitish: string, targetCommitish: string, threads: DiffContextStorage['threads']) => {
        const now = new Date().toISOString();
        mockDiffContextData = {
          version: 2,
          baseCommitish,
          targetCommitish,
          createdAt: mockDiffContextData?.createdAt ?? now,
          lastModifiedAt: now,
          threads,
          viewedFiles: mockDiffContextData?.viewedFiles ?? [],
          appliedCommentImportIds: mockDiffContextData?.appliedCommentImportIds ?? [],
        };
      },
    ),
    getComments: vi.fn(() => []),
    saveComments: vi.fn(),
    getDiffContextData: vi.fn(() => mockDiffContextData),
    saveDiffContextData: vi.fn(
      (baseCommitish: string, targetCommitish: string, data: DiffContextStorage) => {
        mockDiffContextData = {
          ...data,
          baseCommitish,
          targetCommitish,
        };
      },
    ),
  },
}));

// Mock diffUtils
vi.mock('../utils/diffUtils', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    return 'plaintext';
  }),
}));

describe('useDiffComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiffContextData = null;
  });

  describe('comment CRUD operations', () => {
    it('should add comment with code snapshot', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'src/utils/test.ts',
          body: 'Test comment',
          side: 'new',
          line: 15,
          codeSnapshot: {
            content: 'const x = 42;',
            language: 'typescript',
          },
        });
      });

      expect(result.current.comments).toHaveLength(1);
      const comment = result.current.comments[0];
      expect(comment).toBeDefined();
      expect(comment!.filePath).toBe('src/utils/test.ts');
      expect(comment!.body).toBe('Test comment');
      expect(comment!.author).toBe('User');
      expect(comment!.position.side).toBe('new');
      expect(comment!.position.line).toBe(15);
      expect(comment!.codeSnapshot?.content).toBe('const x = 42;');
      expect(comment!.codeSnapshot?.language).toBe('typescript');
    });

    it('should remove comment by id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let commentId: string;
      act(() => {
        const comment = result.current.addComment({
          filePath: 'test.ts',
          body: 'To be removed',
          side: 'new',
          line: 1,
        });
        commentId = comment.id;
      });

      expect(result.current.comments).toHaveLength(1);

      act(() => {
        result.current.removeComment(commentId);
      });

      expect(result.current.comments).toHaveLength(0);
    });

    it('should update comment body', async () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let commentId: string;
      act(() => {
        const comment = result.current.addComment({
          filePath: 'test.ts',
          body: 'Original comment',
          side: 'new',
          line: 1,
        });
        commentId = comment.id;
      });

      // Wait a bit to ensure updatedAt timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.updateComment(commentId, 'Updated comment');
      });

      expect(result.current.comments[0]?.body).toBe('Updated comment');
      expect(result.current.comments[0]?.updatedAt).not.toBe(result.current.comments[0]?.createdAt);
    });

    it('should clear all comments', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'test1.ts',
          body: 'Comment 1',
          side: 'new',
          line: 1,
        });
      });

      act(() => {
        result.current.addComment({
          filePath: 'test2.ts',
          body: 'Comment 2',
          side: 'new',
          line: 2,
        });
      });

      expect(result.current.comments).toHaveLength(2);

      act(() => {
        result.current.clearAllComments();
      });

      expect(result.current.comments).toHaveLength(0);
    });

    it('applies imported thread comments once and skips reapplying the same import id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let warnings: string[] = [];
      act(() => {
        warnings = result.current.applyCommentImports(
          [
            {
              type: 'thread',
              id: 'imported-thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
              author: 'AI',
            },
          ],
          'import-bundle-1',
        );
      });

      expect(warnings).toEqual([]);
      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.messages[0]?.body).toBe('Imported comment');

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'thread',
              id: 'imported-thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
              author: 'AI',
            },
          ],
          'import-bundle-1',
        );
      });

      expect(result.current.threads).toHaveLength(1);
      expect(mockDiffContextData?.appliedCommentImportIds).toEqual(['import-bundle-1']);
    });

    it('adds imported replies to the newest matching thread', async () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let olderThreadId = '';
      let newerThreadId = '';

      act(() => {
        olderThreadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Older thread',
          side: 'new',
          line: 10,
        }).id;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        newerThreadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Newer thread',
          side: 'new',
          line: 10,
        }).id;
      });

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'reply',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported reply',
              author: 'AI',
            },
          ],
          'import-bundle-2',
        );
      });

      expect(
        result.current.threads.find((thread) => thread.id === olderThreadId)?.messages,
      ).toHaveLength(1);
      expect(
        result.current.threads.find((thread) => thread.id === newerThreadId)?.messages,
      ).toHaveLength(2);
    });

    it('warns when imported replies have no matching thread', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let warnings: string[] = [];
      act(() => {
        warnings = result.current.applyCommentImports(
          [
            {
              type: 'reply',
              filePath: 'missing.ts',
              position: { side: 'new', line: 99 },
              body: 'Imported reply',
            },
          ],
          'import-bundle-3',
        );
      });

      expect(result.current.threads).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    });

    it('clears applied import ids when requested', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
            },
          ],
          'import-bundle-4',
        );
      });

      expect(mockDiffContextData?.appliedCommentImportIds).toEqual(['import-bundle-4']);

      act(() => {
        result.current.clearAllComments({ resetAppliedCommentImportIds: true });
      });

      expect(result.current.threads).toHaveLength(0);
      expect(mockDiffContextData?.appliedCommentImportIds).toEqual([]);
    });

    it('should not remove a thread when reply deletion targets a missing message id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let threadId = '';
      act(() => {
        threadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Root comment',
          side: 'new',
          line: 1,
        }).id;
      });

      act(() => {
        result.current.replyToThread({
          threadId,
          body: 'Reply comment',
        });
      });

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.messages).toHaveLength(2);

      act(() => {
        result.current.removeMessage(threadId, 'missing-message-id');
      });

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.id).toBe(threadId);
      expect(result.current.threads[0]?.messages).toHaveLength(2);
      expect(result.current.threads[0]?.messages[1]?.body).toBe('Reply comment');
    });
  });
});
