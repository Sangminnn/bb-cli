import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useLocalComments } from './useLocalComments';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useLocalComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('should initialize with empty comments when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    expect(result.current.comments).toEqual([]);
  });

  it('should load comments from localStorage on mount', () => {
    const savedComments = [
      {
        id: 'test-id-1',
        file: 'test.ts',
        line: 10,
        body: 'Test comment',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    ];

    localStorageMock.getItem.mockReturnValue(JSON.stringify(savedComments));

    const { result } = renderHook(() => useLocalComments('test-commit'));

    expect(localStorageMock.getItem).toHaveBeenCalledWith('difit-comments-test-commit');
    expect(result.current.comments).toEqual(savedComments);
  });

  it('should add a comment correctly', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    act(() => {
      result.current.addComment('test.ts', 10, 'New comment', 'const x = 1;');
    });

    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]).toMatchObject({
      file: 'test.ts',
      line: 10,
      body: 'New comment',
      codeContent: 'const x = 1;',
    });
    expect(result.current.comments[0]?.id).toContain('test.ts:10:');
  });

  it('should remove a comment by id', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    // Add two comments
    act(() => {
      result.current.addComment('test.ts', 10, 'Comment 1');
      result.current.addComment('test.ts', 20, 'Comment 2');
    });

    const commentId = result.current.comments[0]!.id;

    act(() => {
      result.current.removeComment(commentId);
    });

    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]?.body).toBe('Comment 2');
  });

  it('should update a comment body', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    act(() => {
      result.current.addComment('test.ts', 10, 'Original comment');
    });

    const commentId = result.current.comments[0]!.id;

    act(() => {
      result.current.updateComment(commentId, 'Updated comment');
    });

    expect(result.current.comments[0]?.body).toBe('Updated comment');
  });

  it('should clear all comments and remove from localStorage', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    // Add multiple comments
    act(() => {
      result.current.addComment('test.ts', 10, 'Comment 1');
      result.current.addComment('test.ts', 20, 'Comment 2');
      result.current.addComment('other.ts', 5, 'Comment 3');
    });

    expect(result.current.comments).toHaveLength(3);

    act(() => {
      result.current.clearAllComments();
    });

    expect(result.current.comments).toEqual([]);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('difit-comments-test-commit');
  });

  it('should save comments to localStorage whenever they change', () => {
    const { result } = renderHook(() => useLocalComments('test-commit'));

    act(() => {
      result.current.addComment('test.ts', 10, 'Comment 1');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'difit-comments-test-commit',
      expect.stringContaining('Comment 1'),
    );

    act(() => {
      result.current.clearAllComments();
    });

    // Should set empty array before removing
    expect(localStorageMock.setItem).toHaveBeenCalledWith('difit-comments-test-commit', '[]');
  });

  it('should use default storage key when no commit hash provided', () => {
    const { result } = renderHook(() => useLocalComments());

    act(() => {
      result.current.addComment('test.ts', 10, 'Comment');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith('difit-comments', expect.any(String));
  });

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.getItem.mockReturnValue('invalid json');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useLocalComments('test-commit'));

    expect(result.current.comments).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to parse saved comments:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });
});
