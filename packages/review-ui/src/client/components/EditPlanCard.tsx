import { ChevronDown, ChevronRight, Loader2, Play, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';

import type { EditPlan, ExecutedEditPlan } from '../../types/diff';

interface EditPlanCardProps {
  plan: EditPlan;
  onExecute: () => Promise<void>;
  onCancel: () => Promise<void>;
}

export const EditPlanCard = ({ plan, onExecute, onCancel }: EditPlanCardProps) => {
  const [busy, setBusy] = useState<'execute' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItem = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runWithBusy = async (kind: 'execute' | 'cancel', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청 처리 실패');
    } finally {
      setBusy(null);
    }
  };

  const fileGroupCount = new Set(plan.items.map((item) => item.filePath)).size;

  return (
    <div
      className="mt-3 rounded-md border border-blue-500/40 bg-blue-500/5 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
          직접 수정 계획
        </span>
        <span className="text-xs text-github-text-secondary">
          파일 {fileGroupCount}개 · 변경 {plan.items.length}건
        </span>
      </div>

      {plan.summary && (
        <p className="mb-3 whitespace-pre-wrap text-xs text-github-text-primary">
          {plan.summary}
        </p>
      )}

      <ul className="mb-3 space-y-1.5">
        {plan.items.map((item) => {
          const isExpanded = expandedItems.has(item.id);
          const lineLabel =
            item.startLine === item.endLine
              ? `L${item.startLine}`
              : `L${item.startLine}-${item.endLine}`;
          return (
            <li
              key={item.id}
              className="rounded border border-github-border bg-github-bg-primary"
            >
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-github-bg-tertiary"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="font-mono text-github-text-primary truncate">
                  {item.filePath}
                </span>
                <span className="font-mono text-github-text-secondary shrink-0">
                  {lineLabel}
                </span>
                {item.description && (
                  <span className="ml-2 truncate text-github-text-secondary">
                    {item.description}
                  </span>
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-github-border px-2 py-2 text-xs">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-github-text-secondary">
                    이전
                  </div>
                  <pre className="mb-2 overflow-x-auto rounded bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-900 dark:text-red-200 whitespace-pre">
                    {item.expectedOriginal || '(빈 내용)'}
                  </pre>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-github-text-secondary">
                    이후
                  </div>
                  <pre className="overflow-x-auto rounded bg-green-500/10 px-2 py-1 font-mono text-[11px] text-green-900 dark:text-green-200 whitespace-pre">
                    {item.replacement || '(빈 내용)'}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void runWithBusy('cancel', onCancel)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded border border-github-border bg-github-bg-tertiary px-3 py-1.5 text-xs text-github-text-primary hover:opacity-80 disabled:opacity-50"
        >
          {busy === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          취소
        </button>
        <button
          type="button"
          onClick={() => void runWithBusy('execute', onExecute)}
          disabled={busy !== null || plan.items.length === 0}
          className="inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === 'execute' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          실행
        </button>
      </div>
    </div>
  );
};

interface ExecutedPlanCardProps {
  executed: ExecutedEditPlan;
  onRollback: () => Promise<void>;
}

export const ExecutedPlanCard = ({ executed, onRollback }: ExecutedPlanCardProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRolledBack = executed.rolledBack === true;
  const fileGroupCount = new Set(executed.plan.items.map((item) => item.filePath)).size;

  const handleRollback = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRollback();
    } catch (err) {
      setError(err instanceof Error ? err.message : '되돌리기 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`mt-3 rounded-md border p-3 ${
        isRolledBack
          ? 'border-gray-500/40 bg-gray-500/5'
          : 'border-green-500/40 bg-green-500/5'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            isRolledBack
              ? 'border-gray-500/40 bg-gray-500/10 text-gray-700 dark:text-gray-300'
              : 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
          }`}
        >
          {isRolledBack ? '되돌림' : '직접 수정 적용됨'}
        </span>
        <span className="text-xs text-github-text-secondary">
          파일 {fileGroupCount}개 · 변경 {executed.plan.items.length}건
        </span>
      </div>

      {executed.plan.summary && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-github-text-primary">
          {executed.plan.summary}
        </p>
      )}

      <ul className="mb-2 space-y-1">
        {executed.plan.items.map((item) => {
          const lineLabel =
            item.startLine === item.endLine
              ? `L${item.startLine}`
              : `L${item.startLine}-${item.endLine}`;
          return (
            <li key={item.id} className="text-xs">
              <span className="font-mono text-github-text-primary">{item.filePath}</span>
              <span className="ml-2 font-mono text-github-text-secondary">{lineLabel}</span>
              {item.description && (
                <span className="ml-2 text-github-text-secondary">{item.description}</span>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!isRolledBack && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleRollback()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-github-border bg-github-bg-tertiary px-3 py-1.5 text-xs text-github-text-primary hover:opacity-80 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            되돌리기
          </button>
        </div>
      )}
    </div>
  );
};
