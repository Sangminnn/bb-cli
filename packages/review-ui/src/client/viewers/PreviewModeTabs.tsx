import { Eye, FileDiff } from 'lucide-react';

export type PreviewMode = 'diff' | 'diff-preview' | 'full-preview';

type PreviewModeTabsProps = {
  mode: PreviewMode;
  hasFullPreview: boolean;
  onModeChange: (mode: PreviewMode) => void;
};

export const PreviewModeTabs = ({ mode, hasFullPreview, onModeChange }: PreviewModeTabsProps) => (
  <div className="flex items-center gap-1.5">
    <button
      onClick={() => onModeChange('diff')}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 flex items-center gap-1 cursor-pointer ${
        mode === 'diff'
          ? 'text-github-text-primary'
          : 'text-github-text-secondary hover:text-github-text-primary'
      }`}
      title="코드 Diff"
    >
      <FileDiff size={14} />
      Diff
    </button>
    <button
      onClick={() => onModeChange('diff-preview')}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 flex items-center gap-1 cursor-pointer ${
        mode === 'diff-preview'
          ? 'text-github-text-primary'
          : 'text-github-text-secondary hover:text-github-text-primary'
      }`}
      title="Diff 미리보기"
    >
      <Eye size={14} />
      Diff 미리보기
    </button>
    {hasFullPreview && (
      <button
        onClick={() => onModeChange('full-preview')}
        className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 flex items-center gap-1 cursor-pointer ${
          mode === 'full-preview'
            ? 'text-github-text-primary'
            : 'text-github-text-secondary hover:text-github-text-primary'
        }`}
        title="전체 미리보기"
      >
        <Eye size={14} />
        전체 미리보기
      </button>
    )}
  </div>
);
