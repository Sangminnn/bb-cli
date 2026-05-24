import { Lightbulb } from 'lucide-react';

interface HunkRationaleCardProps {
  rationale: string;
}

export const HunkRationaleCard = ({ rationale }: HunkRationaleCardProps) => {
  return (
    <div
      className="bg-amber-500/5 border-l-4 border-l-amber-500 px-4 py-2 text-sm text-github-text-primary"
      data-rationale="hunk"
    >
      <div className="flex items-start gap-2">
        <Lightbulb size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
            Why this change
          </span>
          <p className="m-0 whitespace-pre-wrap leading-relaxed text-github-text-secondary">
            {rationale}
          </p>
        </div>
      </div>
    </div>
  );
};
