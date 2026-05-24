import { Check, Send } from 'lucide-react';

interface SubmitReviewButtonProps {
  commentsCount: number;
  isSubmitted: boolean;
  isSubmitting: boolean;
  onSubmit: () => Promise<void> | void;
}

export const SubmitReviewButton = ({
  commentsCount,
  isSubmitted,
  isSubmitting,
  onSubmit,
}: SubmitReviewButtonProps) => {
  if (isSubmitted) {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap"
        style={{
          backgroundColor: 'var(--color-github-accent)',
          color: 'white',
          border: '1px solid var(--color-github-accent)',
        }}
        title={`완료 — 코멘트 ${commentsCount}개`}
      >
        <Check size={12} />
        완료
      </div>
    );
  }

  const confirmMessage =
    commentsCount === 0
      ? '코멘트 없이 제출하시겠습니까? (승인으로 처리됩니다)'
      : `코멘트 ${commentsCount}개로 리뷰를 제출하시겠습니까?`;

  const handleClick = () => {
    if (isSubmitting) return;
    if (!confirm(confirmMessage)) return;
    void onSubmit();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isSubmitting}
      className="text-xs px-4 py-1.5 rounded transition-all flex items-center gap-1.5 whitespace-nowrap font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
      style={{
        backgroundColor: 'white',
        color: '#0d1117',
        border: '1px solid var(--color-github-border)',
      }}
      title={confirmMessage}
    >
      <Send size={12} />
      {isSubmitting ? '제출 중…' : '진행'}
    </button>
  );
};
