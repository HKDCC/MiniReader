import React from 'react';
import { motion } from 'motion/react';
import { tocCopy } from '../shared/copy';

const TocItem = ({ item, onSelect, depth = 0 }: { item: any; onSelect: (href: string) => void; depth?: number }) => {
  const hasTarget = typeof item.href === 'string' && item.href.length > 0;

  return (
    <div className="w-full">
      <button
        onClick={() => {
          if (hasTarget) {
            onSelect(item.href);
          }
        }}
        disabled={!hasTarget}
        className="w-full truncate rounded px-4 py-2 text-left text-[12.5px] opacity-75 transition-colors hover:bg-current/5 hover:opacity-100 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
        style={{ paddingLeft: `${depth * 1 + 0.75}rem` }}
        title={item.label}
      >
        {item.label}
      </button>
      {item.subitems && item.subitems.length > 0 && (
        <div className="w-full">
          {item.subitems.map((subitem: any, index: number) => (
            <TocItem key={index} item={subitem} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function TocPanel({
  toc,
  onSelect,
  onClose,
  uiColor,
  textColor,
}: {
  toc: any[];
  onSelect: (href: string) => void;
  onClose: () => void;
  uiColor: string;
  textColor: string;
}) {
  return (
    <motion.aside
      data-reader-panel
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="reader-paper absolute bottom-0 left-0 top-[54px] z-50 flex w-[22rem] max-w-full flex-col border-r"
      style={{
        backgroundColor: uiColor,
        color: textColor,
        borderColor: `${textColor}14`,
      }}
    >
      <div className="flex h-[56px] shrink-0 items-center justify-between border-b px-5" style={{ borderColor: `${textColor}12` }}>
        <span className="reader-panel-eyebrow">{tocCopy.title}</span>
        <button onClick={onClose} className="reader-panel-close" title={tocCopy.close} aria-label={tocCopy.close}>×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {toc.length === 0 ? <div className="text-sm opacity-50 text-center py-8">{tocCopy.empty}</div> : toc.map((item, index) => <TocItem key={index} item={item} onSelect={onSelect} />)}
      </div>
    </motion.aside>
  );
}
