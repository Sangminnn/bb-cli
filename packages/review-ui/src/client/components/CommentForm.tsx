import React, { useRef, useState } from 'react';

import { CommentBodyRenderer, hasSuggestionInBody } from './CommentBodyRenderer';
import type { AppearanceSettings } from './SettingsModal';

interface CommentFormProps {
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  selectedCode?: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  initialValue?: string;
  embedded?: boolean;
  title?: string;
  submitLabel?: string;
  placeholder?: string;
  onSubmitWithReview?: (body: string) => Promise<void>;
  reviewLabel?: string;
  onSubmitWithDirectEdit?: (body: string) => Promise<void>;
  directEditLabel?: string;
}

type CommentFormMode = 'edit' | 'preview';

export function CommentForm({
  onSubmit,
  onCancel,
  selectedCode,
  syntaxTheme,
  filename,
  initialValue = '',
  embedded = false,
  title = '댓글 작성',
  submitLabel = '등록',
  placeholder = '댓글을 입력하세요...',
  onSubmitWithReview,
  reviewLabel = '바로 리뷰',
  onSubmitWithDirectEdit,
  directEditLabel = '직접 수정',
}: CommentFormProps) {
  const [body, setBody] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<CommentFormMode>('edit');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasSuggestion = hasSuggestionInBody(body);
  const effectiveMode: CommentFormMode = hasSuggestion ? mode : 'edit';

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolveRead, rejectRead) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolveRead(reader.result);
        else rejectRead(new Error('FileReader returned non-string'));
      };
      reader.onerror = () => rejectRead(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });

  const insertMarkdownAtCursor = (markdown: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((prev) => (prev.length === 0 ? markdown : `${prev}\n${markdown}`));
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const needsLeadingNewline = before.length > 0 && !before.endsWith('\n');
    const insertion = `${needsLeadingNewline ? '\n' : ''}${markdown}\n`;
    const next = `${before}${insertion}${after}`;
    setBody(next);
    requestAnimationFrame(() => {
      const cursor = before.length + insertion.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const uploadImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return false;
    setUploadError(null);
    setIsUploading(true);
    try {
      for (const file of imageFiles) {
        const dataUrl = await readFileAsDataUrl(file);
        const response = await fetch('/api/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name || 'attachment', dataUrl }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`업로드 실패 (${response.status}): ${detail}`);
        }
        const result = (await response.json()) as { markdown?: string; relativePath?: string };
        const markdown =
          result.markdown ?? `![${file.name || 'attachment'}](${result.relativePath ?? ''})`;
        insertMarkdownAtCursor(markdown);
      }
      return true;
    } catch (error) {
      console.error('Failed to upload attachment:', error);
      setUploadError(error instanceof Error ? error.message : '업로드 실패');
      return true;
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    const hasImage = files.some((file) => file.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    void uploadImageFiles(files);
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    setIsDropTarget(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    const hasImage = files.some((file) => file.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    void uploadImageFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) {
      e.preventDefault();
      setIsDropTarget(true);
    }
  };

  const handleDragLeave = () => {
    setIsDropTarget(false);
  };

  const runSubmission = async (handler: (body: string) => Promise<void>) => {
    if (!body.trim()) return;

    setIsSubmitting(true);
    try {
      await handler(body.trim());
      setBody('');
      setMode('edit');
    } catch (error) {
      console.error('Failed to submit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSubmission(onSubmit);
  };

  const submitWithReview = async () => {
    if (!onSubmitWithReview) return;
    await runSubmission(onSubmitWithReview);
  };

  const submitWithDirectEdit = async () => {
    if (!onSubmitWithDirectEdit) return;
    await runSubmission(onSubmitWithDirectEdit);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey || !onSubmitWithReview) {
        void handleSubmit(e);
      } else {
        e.preventDefault();
        void submitWithReview();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <form
      className={
        embedded
          ? 'bg-transparent'
          : 'm-2 mx-3 rounded-md border border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary p-3'
      }
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      data-empty={!body.trim()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: 'var(--color-yellow-path-text)' }}>
          {title}
        </span>
        {hasSuggestion && (
          <div className="flex items-center border border-github-border rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`text-xs px-2.5 py-1.5 ${
                effectiveMode === 'edit'
                  ? 'bg-github-bg-tertiary text-github-text-primary'
                  : 'bg-github-bg-secondary text-github-text-secondary'
              } transition-colors`}
            >
              편집
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`text-xs px-2.5 py-1.5 border-l border-github-border ${
                effectiveMode === 'preview'
                  ? 'bg-github-bg-tertiary text-github-text-primary'
                  : 'bg-github-bg-secondary text-github-text-secondary'
              } transition-colors`}
            >
              미리보기
            </button>
          </div>
        )}
      </div>

      {hasSuggestion && effectiveMode === 'preview' ? (
        <div className="min-h-[60px] mb-2 bg-github-bg-secondary border border-github-border rounded px-3 py-2">
          <CommentBodyRenderer
            body={body}
            originalCode={selectedCode}
            filename={filename}
            syntaxTheme={syntaxTheme}
          />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className={`w-full min-h-[60px] mb-2 resize-y bg-github-bg-secondary border ${
            isDropTarget ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-github-border'
          } rounded px-3 py-2 text-github-text-primary text-sm leading-6 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 focus:min-h-[80px] disabled:opacity-50`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          placeholder={placeholder}
          rows={Math.max(3, body.split('\n').length)}
          autoFocus={!embedded}
          disabled={isSubmitting}
        />
      )}

      {uploadError && (
        <div className="text-xs text-red-400 mb-2" role="alert">
          {uploadError}
        </div>
      )}
      {isUploading ? (
        <div className="text-xs text-github-text-secondary mb-2">이미지 업로드 중...</div>
      ) : (
        <div className="text-[11px] text-github-text-secondary/70 mb-2">
          이미지는 클립보드 붙여넣기 또는 드래그 앤 드롭으로 첨부할 수 있습니다.
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 bg-github-bg-tertiary text-github-text-primary border border-github-border rounded hover:opacity-80 transition-all disabled:opacity-50"
          disabled={isSubmitting}
        >
          취소
        </button>
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded transition-all disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-yellow-btn-bg)',
            color: 'var(--color-yellow-btn-text)',
            border: '1px solid var(--color-yellow-btn-border)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-hover-bg)';
            e.currentTarget.style.borderColor = 'var(--color-yellow-btn-hover-border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-bg)';
            e.currentTarget.style.borderColor = 'var(--color-yellow-btn-border)';
          }}
          disabled={!body.trim() || isSubmitting}
        >
          {isSubmitting ? '등록 중...' : submitLabel}
        </button>
        {onSubmitWithReview && (
          <button
            type="button"
            onClick={() => void submitWithReview()}
            className="text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-all disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-yellow-btn-text)',
              color: '#1c1917',
              border: '1px solid var(--color-yellow-btn-hover-border)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-hover-border)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-text)';
              e.currentTarget.style.color = '#1c1917';
            }}
            disabled={!body.trim() || isSubmitting}
            title="Cmd/Ctrl+Enter로 저장 후 즉시 리뷰 요청 (Shift는 일반 등록)"
          >
            {isSubmitting ? '...' : reviewLabel}
          </button>
        )}
        {onSubmitWithDirectEdit && (
          <button
            type="button"
            onClick={() => void submitWithDirectEdit()}
            className="text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-all disabled:opacity-50 border border-blue-600/60 bg-blue-600 text-white hover:bg-blue-700"
            disabled={!body.trim() || isSubmitting}
            title="이 스레드 대화를 토대로 여러 줄/파일 직접 수정 계획을 요청합니다"
          >
            {isSubmitting ? '...' : directEditLabel}
          </button>
        )}
      </div>
    </form>
  );
}
