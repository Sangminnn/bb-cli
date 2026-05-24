import { useState, useEffect } from 'react';

import { type Comment, type LineNumber } from '../../types/diff';

export function useLocalComments(commitHash?: string) {
  const storageKey = commitHash ? `difit-comments-${commitHash}` : 'difit-comments';

  const [comments, setComments] = useState<Comment[]>(() => {
    const savedComments = localStorage.getItem(storageKey);
    if (savedComments) {
      try {
        return JSON.parse(savedComments) as Comment[];
      } catch (error) {
        console.error('Failed to parse saved comments:', error);
      }
    }
    return [];
  });

  // Save comments to localStorage whenever comments change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(comments));
  }, [comments, storageKey]);

  const addComment = (
    file: string,
    line: LineNumber,
    body: string,
    codeContent?: string,
  ): Comment => {
    console.log('Adding comment with codeContent:', codeContent);
    const comment: Comment = {
      id: `${file}:${Array.isArray(line) ? `${line[0]}-${line[1]}` : line}:${Date.now()}`,
      file,
      line,
      body,
      timestamp: new Date().toISOString(),
      codeContent,
    };

    setComments((prev) => [...prev, comment]);
    return comment;
  };

  const removeComment = (commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const updateComment = (commentId: string, newBody: string) => {
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body: newBody } : c)));
  };

  const clearAllComments = () => {
    setComments([]);
    localStorage.removeItem(storageKey);
  };

  return {
    comments,
    addComment,
    removeComment,
    updateComment,
    clearAllComments,
  };
}
