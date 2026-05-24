import { Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { type DiffLine, type ExpandedLine } from '../../types/diff';
import { hasFencedCodeBlock, parseSuggestionBlocks } from '../../utils/suggestionUtils';

import { DiffCodeLine } from './DiffCodeLine';
import type { AppearanceSettings } from './SettingsModal';

type SuggestionPart = {
  type: 'text';
  content: string;
};

type ParsedCommentPart =
  | SuggestionPart
  | {
      type: 'suggestion';
      code: string;
      original?: string;
      isSuggestion: boolean;
    };

const getSuggestionLineTypeClass = (type: 'add' | 'delete') =>
  type === 'add' ? 'bg-diff-addition-bg' : 'bg-diff-deletion-bg';

const createSuggestionLine = (
  type: 'add' | 'delete',
  content: string,
): Pick<DiffLine | ExpandedLine, 'type' | 'content'> => ({
  type,
  content,
});

function SuggestionLines({
  code,
  type,
  filename,
  keyPrefix,
  syntaxTheme,
}: {
  code: string;
  type: 'add' | 'delete';
  filename?: string;
  keyPrefix: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}) {
  return (
    <>
      {code.split('\n').map((line, index) => (
        <div key={`${keyPrefix}-${index}`} className={getSuggestionLineTypeClass(type)}>
          <DiffCodeLine
            line={createSuggestionLine(type, line)}
            filename={filename}
            syntaxTheme={syntaxTheme}
            showPrefixBorder={false}
          />
        </div>
      ))}
    </>
  );
}

interface CommentBodyRendererProps {
  body: string;
  originalCode?: string;
  filename?: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  appliedSuggestionIndices?: number[];
  onApplySuggestion?: (suggestionIndex: number) => Promise<void> | void;
  onRejectSuggestion?: (suggestionIndex: number) => void;
}

export function hasSuggestionInBody(body: string) {
  return hasFencedCodeBlock(body);
}

type ApplyState = 'idle' | 'applying' | 'applied' | 'rejected' | 'failed';

const formatApplyFailure = (detail: string | undefined) => {
  if (!detail) return '적용 실패 (사유 불명)';
  if (detail.startsWith('conflict')) {
    return '코멘트 단 라인이 그 사이에 변경됨 — 파일 직접 확인 후 재시도';
  }
  if (detail.startsWith('old-side-not-supported')) {
    return '삭제된(old-side) 라인에는 자동 적용 불가 — new-side에 다시 코멘트 후 시도';
  }
  if (detail.startsWith('out-of-range')) {
    return '코멘트 위치가 파일 범위를 벗어남 — 파일이 단축됐을 수 있음';
  }
  if (detail.startsWith('invalid-line')) {
    return '라인 위치 정보 누락 — 스레드를 다시 작성해주세요';
  }
  if (detail.startsWith('multiple-matches')) {
    const match = detail.match(/matches (\d+) times/);
    const count = match ? match[1] : '여러';
    return `원본 코드가 파일 내 ${count}곳에 중복 — 자동 적용 불가, 직접 수정해주세요`;
  }
  if (detail.startsWith('file-not-found')) {
    return '파일을 못 찾음 (이동/삭제 가능)';
  }
  if (detail.startsWith('no-original')) {
    return '원본 코드 스냅샷이 없는 스레드';
  }
  if (detail.startsWith('invalid-path')) {
    return '경로 오류 (저장소 밖)';
  }
  if (detail.startsWith('not-found')) {
    return '서버에서 스레드/스니펫을 찾지 못함';
  }
  if (detail.startsWith('invalid-input')) {
    return '요청 형식 오류';
  }
  if (detail.startsWith('already-applied')) {
    return '이미 적용된 제안';
  }
  return `적용 실패: ${detail}`;
};

export function CommentBodyRenderer({
  body,
  originalCode,
  filename,
  syntaxTheme,
  appliedSuggestionIndices,
  onApplySuggestion,
  onRejectSuggestion,
}: CommentBodyRendererProps) {
  const [applyStates, setApplyStates] = useState<Record<number, ApplyState>>({});
  const [applyDetails, setApplyDetails] = useState<Record<number, string>>({});
  const persistedAppliedSet = useMemo(
    () => new Set(appliedSuggestionIndices ?? []),
    [appliedSuggestionIndices],
  );

  const handleApply = async (suggestionIndex: number) => {
    if (!onApplySuggestion) return;
    setApplyStates((prev) => ({ ...prev, [suggestionIndex]: 'applying' }));
    try {
      await onApplySuggestion(suggestionIndex);
      setApplyStates((prev) => ({ ...prev, [suggestionIndex]: 'applied' }));
      setApplyDetails((prev) => {
        const next = { ...prev };
        delete next[suggestionIndex];
        return next;
      });
    } catch (error) {
      console.error('Apply suggestion failed:', error);
      const detail = error instanceof Error ? error.message : String(error);
      setApplyStates((prev) => ({ ...prev, [suggestionIndex]: 'failed' }));
      setApplyDetails((prev) => ({ ...prev, [suggestionIndex]: detail }));
    }
  };

  const handleReject = (suggestionIndex: number) => {
    setApplyStates((prev) => ({ ...prev, [suggestionIndex]: 'rejected' }));
    onRejectSuggestion?.(suggestionIndex);
  };

  const parts = useMemo(() => {
    const suggestions = parseSuggestionBlocks(body);
    if (suggestions.length === 0) {
      return [{ type: 'text' as const, content: body }] as ParsedCommentPart[];
    }

    const result: ParsedCommentPart[] = [];
    let lastIndex = 0;

    for (const suggestion of suggestions) {
      if (suggestion.startIndex > lastIndex) {
        result.push({
          type: 'text',
          content: body.slice(lastIndex, suggestion.startIndex),
        });
      }

      result.push({
        type: 'suggestion',
        code: suggestion.suggestedCode,
        original: suggestion.isSuggestion ? originalCode || '' : '',
        isSuggestion: suggestion.isSuggestion,
      });

      lastIndex = suggestion.endIndex;
    }

    if (lastIndex < body.length) {
      result.push({
        type: 'text',
        content: body.slice(lastIndex),
      });
    }

    return result;
  }, [body, originalCode]);

  let suggestionRenderIndex = -1;

  return (
    <div className="text-github-text-primary text-sm leading-6">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {part.content}
            </span>
          );
        }

        if (!part.isSuggestion) {
          return (
            <pre
              key={index}
              className="my-2 overflow-x-auto rounded-md border border-github-border bg-github-bg-secondary px-3 py-2 font-mono text-xs leading-5 text-github-text-primary"
            >
              <code>{part.code}</code>
            </pre>
          );
        }

        suggestionRenderIndex += 1;
        const blockSuggestionIndex = suggestionRenderIndex;
        const localState = applyStates[blockSuggestionIndex];
        const state: ApplyState =
          localState ?? (persistedAppliedSet.has(blockSuggestionIndex) ? 'applied' : 'idle');
        const showActions = Boolean(onApplySuggestion);

        return (
          <div key={index} className="my-2 border border-github-border rounded-md overflow-hidden">
            <div className="font-mono text-sm">
              {part.original && (
                <SuggestionLines
                  code={part.original}
                  type="delete"
                  filename={filename}
                  keyPrefix={`orig-${index}`}
                  syntaxTheme={syntaxTheme}
                />
              )}
              <SuggestionLines
                code={part.code}
                type="add"
                filename={filename}
                keyPrefix={`sugg-${index}`}
                syntaxTheme={syntaxTheme}
              />
            </div>
            {showActions && (
              <div className="flex items-center justify-end gap-2 border-t border-github-border bg-github-bg-secondary px-3 py-2">
                {state === 'applied' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                    <Check size={12} /> 적용됨
                  </span>
                )}
                {state === 'rejected' && (
                  <span className="inline-flex items-center gap-1 text-xs text-github-text-secondary">
                    <X size={12} /> 거부됨
                  </span>
                )}
                {state === 'failed' && (
                  <span
                    className="text-xs text-github-danger"
                    title={applyDetails[blockSuggestionIndex]}
                  >
                    {formatApplyFailure(applyDetails[blockSuggestionIndex])}
                  </span>
                )}
                {(state === 'idle' || state === 'failed') && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReject(blockSuggestionIndex);
                      }}
                      className="rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs text-github-text-primary transition-all hover:bg-github-bg-primary"
                    >
                      거부
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleApply(blockSuggestionIndex);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-github-accent bg-github-accent px-2 py-1 text-xs font-medium text-white transition-all hover:opacity-90"
                    >
                      <Check size={12} /> 적용
                    </button>
                  </>
                )}
                {state === 'applying' && (
                  <span className="text-xs text-github-text-secondary">적용 중…</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
