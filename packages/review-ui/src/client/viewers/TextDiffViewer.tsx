import { DiffChunk } from '../components/DiffChunk';
import { ExpandButton } from '../components/ExpandButton';
import { HunkRationaleCard } from '../components/HunkRationaleCard';

import type { DiffViewerBodyProps } from './types';

export function TextDiffViewer({
  file,
  threads,
  showAuthorBadges,
  diffMode,
  syntaxTheme,
  cursor,
  fileIndex,
  mergedChunks,
  isExpandLoading,
  expandHiddenLines,
  expandAllBetweenChunks,
  onAddComment,
  onRemoveThread,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onApplySuggestion,
  onRequestDirectEdit,
  onCancelPlan,
  onExecutePlan,
  onRollbackPlan,
  onLineClick,
  onOpenInEditor,
  commentTrigger,
  onCommentTriggerHandled,
  hunkRationales,
}: DiffViewerBodyProps) {
  const collectRationale = (originalIndices: number[]): string | null => {
    if (!hunkRationales) return null;
    const parts: string[] = [];
    originalIndices.forEach((index) => {
      const value = hunkRationales[`${file.path}#${index}`];
      if (typeof value === 'string' && value.trim().length > 0) {
        parts.push(value.trim());
      }
    });
    return parts.length > 0 ? parts.join('\n\n') : null;
  };
  const renderExpandButton = (
    position: 'top' | 'middle' | 'bottom',
    mergedChunk: (typeof mergedChunks)[number],
    firstOriginalIndex: number,
    lastOriginalIndex: number,
  ) => {
    if (position === 'top' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="down"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandDown={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'middle' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="both"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandUp={() => expandHiddenLines(file, firstOriginalIndex - 1, 'down')}
          onExpandDown={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'bottom' && mergedChunk.hiddenLinesAfter > 0) {
      return (
        <ExpandButton
          direction="up"
          hiddenLines={mergedChunk.hiddenLinesAfter}
          onExpandUp={() => expandHiddenLines(file, lastOriginalIndex, 'down')}
          onExpandAll={() =>
            expandHiddenLines(file, lastOriginalIndex, 'down', mergedChunk.hiddenLinesAfter)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    return null;
  };

  return (
    <>
      {mergedChunks.map((mergedChunk, mergedIndex) => {
        const isFirstMerged = mergedIndex === 0;
        const isLastMerged = mergedIndex === mergedChunks.length - 1;
        const firstOriginalIndex = mergedChunk.originalIndices[0] ?? 0;
        const lastOriginalIndex =
          mergedChunk.originalIndices[mergedChunk.originalIndices.length - 1] ?? 0;

        const rationaleText = collectRationale(mergedChunk.originalIndices);

        return (
          <div key={mergedIndex} className={isFirstMerged ? '' : 'mt-3'}>
            {isFirstMerged &&
              renderExpandButton('top', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            {!isFirstMerged &&
              renderExpandButton('middle', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            {rationaleText && <HunkRationaleCard rationale={rationaleText} />}

            <div id={`chunk-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}-${mergedIndex}`}>
              <DiffChunk
                chunk={mergedChunk}
                chunkIndex={mergedIndex}
                threads={threads}
                showAuthorBadges={showAuthorBadges}
                onAddComment={onAddComment}
                onRemoveThread={onRemoveThread}
                onResolveThread={onResolveThread}
                onReplyToThread={onReplyToThread}
                onRemoveMessage={onRemoveMessage}
                onApplySuggestion={onApplySuggestion}
                onRequestDirectEdit={onRequestDirectEdit}
                onCancelPlan={onCancelPlan}
                onExecutePlan={onExecutePlan}
                onRollbackPlan={onRollbackPlan}
                onOpenInEditor={onOpenInEditor}
                mode={diffMode}
                syntaxTheme={syntaxTheme}
                cursor={cursor && cursor.chunkIndex === mergedIndex ? cursor : null}
                fileIndex={fileIndex}
                onLineClick={onLineClick}
                commentTrigger={
                  commentTrigger && commentTrigger.chunkIndex === mergedIndex
                    ? commentTrigger
                    : null
                }
                onCommentTriggerHandled={onCommentTriggerHandled}
                filename={file.path}
              />
            </div>

            {isLastMerged &&
              renderExpandButton('bottom', mergedChunk, firstOriginalIndex, lastOriginalIndex)}
          </div>
        );
      })}
    </>
  );
}
