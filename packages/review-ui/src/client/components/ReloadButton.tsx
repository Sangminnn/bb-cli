import { RefreshCw } from 'lucide-react';

interface ReloadButtonProps {
  shouldReload: boolean;
  isReloading: boolean;
  onReload: () => void;
  changeType?: 'file' | 'commit' | 'staging' | null;
  className?: string;
  compact?: boolean;
}

export function ReloadButton({
  shouldReload,
  isReloading,
  onReload,
  changeType,
  className = '',
  compact = false,
}: ReloadButtonProps) {
  if (!shouldReload) {
    return null;
  }

  const getChangeMessage = () => {
    switch (changeType) {
      case 'commit':
        return '새 커밋이 있습니다';
      case 'staging':
        return '스테이징 변경 감지됨';
      case 'file':
        return '파일 변경 감지됨';
      default:
        return '변경 감지됨';
    }
  };

  return (
    <button
      onClick={onReload}
      disabled={isReloading}
      className={`
        flex items-center gap-1.5 text-xs rounded-md border ${className} ${
          compact ? 'px-2 py-2' : 'px-3 py-1.5'
        }
        ${
          isReloading
            ? 'bg-github-text-primary text-github-bg-primary border-github-text-primary cursor-not-allowed'
            : 'bg-github-text-primary text-github-bg-primary border-github-text-primary'
        }
      `}
      title={`${getChangeMessage()} - 클릭하여 새로고침`}
      aria-label={compact ? '새로고침' : undefined}
    >
      <RefreshCw size={12} className={`${isReloading ? 'animate-spin' : ''}`} />
      {compact ? <span className="sr-only">새로고침</span> : '새로고침'}
    </button>
  );
}
