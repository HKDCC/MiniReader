import React, { useId } from 'react';

type ShelfActionProps = {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  isThemeSwitch?: boolean;
  checked?: boolean;
};

export default function ShelfAction({ label, onClick, children, isThemeSwitch, checked }: ShelfActionProps) {
  const tooltipId = useId();
  return (
    <span className="shelf-action">
      <button
        type="button"
        className={`shelf-control shelf-icon-button ${isThemeSwitch ? 'shelf-theme-switch' : ''}`}
        onClick={onClick}
        aria-label={label}
        aria-describedby={tooltipId}
        role={isThemeSwitch ? 'switch' : undefined}
        aria-checked={isThemeSwitch ? checked : undefined}
      >
        {children}
      </button>
      <span id={tooltipId} role="tooltip" className="shelf-acrylic-surface shelf-tooltip">{label}</span>
    </span>
  );
}
