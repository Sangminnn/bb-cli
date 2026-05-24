import { Eraser, ChevronDown, List, MessageSquare } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface CommentsDropdownProps {
  commentsCount: number;
  onDeleteAll: () => void;
  onViewAll?: () => void;
  direction?: 'down' | 'up';
  compact?: boolean;
}

export function CommentsDropdown({
  commentsCount,
  onDeleteAll,
  onViewAll,
  direction = 'down',
  compact = false,
}: CommentsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isUp = direction === 'up';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeleteAll = () => {
    onDeleteAll();
    setIsOpen(false);
  };

  const handleViewAll = () => {
    onViewAll?.();
    setIsOpen(false);
  };

  const triggerLabel = compact ? `Comments (${commentsCount})` : `Comments (${commentsCount})`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs px-3 py-1.5 rounded transition-all flex items-center gap-1.5 whitespace-nowrap"
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
        title="코멘트 액션"
      >
        <MessageSquare size={12} />
        {triggerLabel}
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 right-0 bg-github-bg-primary border border-github-border z-50 pb-px ${
            isUp ? 'bottom-full rounded-t' : 'top-full rounded-b'
          }`}
          style={{
            borderTop: isUp ? undefined : 'none',
            borderBottom: isUp ? 'none' : undefined,
          }}
        >
          {onViewAll && (
            <button
              onClick={handleViewAll}
              className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-github-text-primary hover:bg-github-bg-tertiary transition-colors"
              disabled={commentsCount === 0}
            >
              <List size={12} />
              전체 코멘트 보기
            </button>
          )}
          <button
            onClick={handleDeleteAll}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-github-text-primary hover:bg-github-bg-tertiary transition-colors"
          >
            <Eraser size={12} />
            모든 코멘트 정리
          </button>
        </div>
      )}
    </div>
  );
}
