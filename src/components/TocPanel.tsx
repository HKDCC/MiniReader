import React from 'react';
import { motion } from 'motion/react';
import { X, List } from 'lucide-react';
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
        className="w-full text-left py-2 px-3 rounded-lg text-sm transition-colors hover:bg-current/5 opacity-80 hover:opacity-100 truncate disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
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
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="absolute top-24 left-8 w-80 p-6 rounded-2xl shadow-2xl backdrop-blur-xl z-50 border max-h-[80vh] flex flex-col"
      style={{
        backgroundColor: `${uiColor}E6`,
        color: textColor,
        borderColor: `${textColor}15`,
      }}
    >
      <div className="flex justify-between items-center mb-6 shrink-0">
        <h3 className="text-xs tracking-widest opacity-50 font-sans flex items-center gap-2">
          <List size={14} />
          {tocCopy.title}
        </h3>
        <button onClick={onClose} className="opacity-50 hover:opacity-100" title={tocCopy.close}>
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-1">
        {toc.length === 0 ? <div className="text-sm opacity-50 text-center py-8">{tocCopy.empty}</div> : toc.map((item, index) => <TocItem key={index} item={item} onSelect={onSelect} />)}
      </div>
    </motion.div>
  );
}
