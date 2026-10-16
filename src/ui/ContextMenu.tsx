import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  hide(): void;
}

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  show: (x, y, items) => set({ menu: { x, y, items } }),
  hide: () => set({ menu: null }),
}));

export function ContextMenu() {
  const menu = useContextMenu((s) => s.menu);
  const hide = useContextMenu((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, hide]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 32 - 16);
  return (
    <div className="context-menu" ref={ref} role="menu" style={{ left: x, top: y }}>
      {menu.items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="context-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'is-danger' : ''}
            onClick={() => {
              hide();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
