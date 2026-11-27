import React, { useEffect, useRef, useState } from 'react';
import {
  ChartCandlestick,
  FlaskConical,
  GitCompareArrows,
  Home,
  Menu,
  TrendingUp,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { NAV_ITEMS, type DashboardPageId } from '../../navigation/routes';

interface HomeFloatingMenuProps {
  activePage: DashboardPageId;
  onSelectPage: (page: DashboardPageId) => void;
}

const PAGE_ICONS: Record<DashboardPageId, React.ComponentType<{ className?: string }>> = {
  home: Home,
  derivatives: ChartCandlestick,
  long_term: TrendingUp,
  signal_analysis: GitCompareArrows,
  real_test: FlaskConical,
};

export const HomeFloatingMenu: React.FC<HomeFloatingMenuProps> = ({
  activePage,
  onSelectPage,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const prefersReducedMotion = Boolean(useReducedMotion());

  // Automatically close floating menu when leaving Home
  useEffect(() => {
    if (activePage !== 'home') {
      setIsOpen(false);
    }
  }, [activePage]);

  // Close on outside click (pointerdown + click fallback) and Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideEvent = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuContainerRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = itemRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
        if (items.length === 0) return;
        event.preventDefault();
        const activeIdx = items.findIndex((el) => el === document.activeElement);
        const nextIdx =
          event.key === 'ArrowDown'
            ? (activeIdx + 1) % items.length
            : (activeIdx - 1 + items.length) % items.length;
        items[nextIdx]?.focus();
      }
    };

    document.addEventListener('pointerdown', handleOutsideEvent);
    document.addEventListener('click', handleOutsideEvent);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideEvent);
      document.removeEventListener('click', handleOutsideEvent);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectItem = (page: DashboardPageId) => {
    setIsOpen(false);
    onSelectPage(page);
  };

  return (
    <div className="fixed top-4 left-4 z-50 pointer-events-none select-none">
      {/* Top-left minimal cluster: Compact Logo + Hamburger Button anchored Floating Menu */}
      <div className="inline-flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => handleSelectItem('home')}
          aria-label="Home으로 이동"
          className="pointer-events-auto flex items-center gap-2 rounded-md px-1 py-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded border border-[#F2F5F7]/20 bg-[#080E1A]/90 text-[11px] font-semibold font-mono-tabular text-[#F2F5F7]"
          >
            B
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-[#F2F5F7] whitespace-nowrap shrink-0">
            BTC Desk
          </span>
        </button>

        {/* Hamburger trigger + anchored floating menu */}
        <div ref={menuContainerRef} className="relative pointer-events-auto">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-controls="home-floating-nav-menu"
            aria-label={isOpen ? '메뉴 닫기' : '메뉴 열기'}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 cursor-pointer shrink-0 ${
              isOpen
                ? 'bg-[#F2F5F7]/14 text-[#F2F5F7]'
                : 'text-[#F2F5F7]/60 hover:bg-[#F2F5F7]/10 hover:text-[#F2F5F7]'
            }`}
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          <AnimatePresence>
            {isOpen && (
              <motion.div
                id="home-floating-nav-menu"
                role="menu"
                aria-label="페이지 탐색 메뉴"
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{
                  duration: prefersReducedMotion ? 0 : 0.18,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="absolute left-0 top-full mt-2 w-52 origin-top-left rounded-lg border border-slate-800/90 bg-[#0C121E]/95 p-1.5 shadow-xl shadow-black/60 backdrop-blur-md"
              >
                <nav className="space-y-0.5">
                  {NAV_ITEMS.map((item, idx) => {
                    const Icon = PAGE_ICONS[item.id];
                    const isActive = activePage === item.id;
                    return (
                      <a
                        key={item.id}
                        ref={(el) => {
                          itemRefs.current[idx] = el;
                        }}
                        href={item.path}
                        role="menuitem"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                          e.preventDefault();
                          handleSelectItem(item.id);
                        }}
                        className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 ${
                          isActive
                            ? 'bg-[#F2F5F7]/12 text-[#F2F5F7]'
                            : 'text-[#F2F5F7]/70 hover:bg-[#F2F5F7]/8 hover:text-[#F2F5F7]'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors duration-150 ${
                            isActive
                              ? 'text-[#F2F5F7]'
                              : 'text-[#F2F5F7]/55 group-hover:text-[#F2F5F7]'
                          }`}
                        />
                        <span className="whitespace-nowrap shrink-0">{item.label}</span>
                      </a>
                    );
                  })}
                </nav>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
