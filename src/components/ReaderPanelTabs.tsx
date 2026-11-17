export default function ReaderPanelTabs({
  active,
  onSwitch,
  vocabCount,
}: {
  active: 'notes' | 'vocab';
  onSwitch: (tab: 'notes' | 'vocab') => void;
  vocabCount: number;
}) {
  return (
    <div className="flex items-center gap-4" role="tablist" aria-label="笔记与生词">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'notes'}
        className="reader-panel-tab"
        onClick={() => onSwitch('notes')}
      >
        笔记
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'vocab'}
        className="reader-panel-tab"
        onClick={() => onSwitch('vocab')}
      >
        生词<span className="count">{vocabCount}</span>
      </button>
    </div>
  );
}
