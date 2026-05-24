import { Check } from 'lucide-react';

interface ReviewCompleteOverlayProps {
  onAfterSubmit?: () => void;
}

export const ReviewCompleteOverlay = ({ onAfterSubmit }: ReviewCompleteOverlayProps) => {
  const handleCloseTab = () => {
    window.close();
    // Browsers reject window.close() on tabs not opened by JS, so fall back to
    // in-app dismiss when the tab survives the close attempt.
    setTimeout(() => {
      if (!window.closed && onAfterSubmit) {
        onAfterSubmit();
      }
    }, 100);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-complete-title"
    >
      <div
        className="flex flex-col items-center gap-4 rounded-lg p-8 max-w-md mx-4"
        style={{
          backgroundColor: 'var(--color-github-bg-secondary)',
          border: '1px solid var(--color-github-border)',
          boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 56,
            height: 56,
            backgroundColor: 'var(--color-github-accent)',
          }}
        >
          <Check size={28} color="white" />
        </div>
        <h2
          id="review-complete-title"
          className="text-lg font-semibold text-github-text-primary"
        >
          리뷰 완료
        </h2>
        <p className="text-sm text-github-text-secondary text-center">
          이 창은 닫으셔도 됩니다.
        </p>
        <button
          type="button"
          onClick={handleCloseTab}
          className="text-xs px-4 py-2 rounded transition-all hover:opacity-90"
          style={{
            backgroundColor: 'var(--color-github-accent)',
            color: 'white',
            border: '1px solid var(--color-github-accent)',
          }}
        >
          창 닫기
        </button>
      </div>
    </div>
  );
};
