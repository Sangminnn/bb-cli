import { FileText } from 'lucide-react';

interface FileSummaryCardProps {
  summary: string;
}

export const FileSummaryCard = ({ summary }: FileSummaryCardProps) => {
  return (
    <div
      className="bg-blue-500/5 border-b border-l-4 border-l-blue-500 border-github-border px-5 py-3 text-sm text-github-text-primary"
      data-rationale="file-summary"
    >
      <div className="flex items-start gap-2">
        <FileText size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-blue-400">
            File summary
          </span>
          <p className="m-0 whitespace-pre-wrap leading-relaxed text-github-text-secondary">
            {summary}
          </p>
        </div>
      </div>
    </div>
  );
};
