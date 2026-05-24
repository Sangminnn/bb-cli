import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const { enableScope, disableScope } = useHotkeysContext();

  // Handle Escape key to close modal
  useHotkeys('escape', () => onClose(), { enabled: isOpen }, [onClose, isOpen]);

  // Manage scopes when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Disable navigation scope when help modal is open
      disableScope('navigation');
    } else {
      // Re-enable navigation scope when modal closes
      enableScope('navigation');
    }

    return () => {
      // Cleanup: ensure navigation scope is enabled
      enableScope('navigation');
    };
  }, [isOpen, enableScope, disableScope]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-github-bg-primary border border-github-border rounded-lg shadow-lg max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-github-bg-primary border-b border-github-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-github-text-primary">키보드 단축키</h2>
          <button
            onClick={onClose}
            className="text-github-text-secondary hover:text-github-text-primary transition-colors"
            aria-label="도움말 모달 닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">라인 이동</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <div className="flex gap-2">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    j
                  </kbd>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    ↓
                  </kbd>
                </div>
                <span className="text-github-text-secondary">다음 라인</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex gap-2">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    k
                  </kbd>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    ↑
                  </kbd>
                </div>
                <span className="text-github-text-secondary">이전 라인</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">파일 이동</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  ]
                </kbd>
                <span className="text-github-text-secondary">다음 파일</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  [
                </kbd>
                <span className="text-github-text-secondary">이전 파일</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    [
                  </kbd>
                </div>
                <span className="text-github-text-secondary">첫 파일로 이동</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    ]
                  </kbd>
                </div>
                <span className="text-github-text-secondary">마지막 파일로 이동</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">청크 이동</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  n
                </kbd>
                <span className="text-github-text-secondary">다음 변경 청크 (추가/삭제 라인)</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  p
                </kbd>
                <span className="text-github-text-secondary">이전 변경 청크 (추가/삭제 라인)</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">코멘트 이동</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  N
                </kbd>
                <span className="text-github-text-secondary">다음 코멘트</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  P
                </kbd>
                <span className="text-github-text-secondary">이전 코멘트</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">
              좌우 이동 (분할 모드)
            </h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <div className="flex gap-2">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    h
                  </kbd>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    ←
                  </kbd>
                </div>
                <span className="text-github-text-secondary">좌측 포커스</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex gap-2">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    l
                  </kbd>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    →
                  </kbd>
                </div>
                <span className="text-github-text-secondary">우측 포커스</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">코멘트 관리</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    L
                  </kbd>
                </div>
                <span className="text-github-text-secondary">전체 코멘트 목록 보기</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    C
                  </kbd>
                </div>
                <span className="text-github-text-secondary">모든 코멘트 프롬프트 복사</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    D
                  </kbd>
                </div>
                <span className="text-github-text-secondary">모든 코멘트 삭제</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-github-text-primary mb-2">동작</h3>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  v
                </kbd>
                <span className="text-github-text-secondary">현재 파일 확인 상태 토글</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    Shift
                  </kbd>
                  <span className="text-github-text-muted">+</span>
                  <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                    R
                  </kbd>
                </div>
                <span className="text-github-text-secondary">변경 감지 시 diff 새로고침</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  c
                </kbd>
                <span className="text-github-text-secondary">현재 라인에 코멘트 추가</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  .
                </kbd>
                <span className="text-github-text-secondary">커서를 화면 중앙으로 이동</span>
              </div>
              <div className="flex justify-between text-sm">
                <kbd className="px-2 py-1 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary font-mono">
                  ?
                </kbd>
                <span className="text-github-text-secondary">이 도움말 표시/숨김</span>
              </div>
            </div>
          </section>

          <div className="pt-4 border-t border-github-border lg:col-span-2">
            <p className="text-xs text-github-text-secondary">
              입력 필드에 타이핑 중에는 단축키가 비활성화됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
