import React, { useEffect, useState } from 'react';
import {
  ChartCandlestick,
  FlaskConical,
  GitCompareArrows,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  X,
} from 'lucide-react';
import { NAV_ITEMS, type DashboardPageId } from '../../navigation/routes';

interface SidebarNavigationProps {
  activePage: DashboardPageId;
  onSelectPage: (page: DashboardPageId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const PAGE_ICONS: Record<DashboardPageId, React.ComponentType<{ className?: string }>> = {
  home: Home,
  derivatives: ChartCandlestick,
  long_term: TrendingUp,
  signal_analysis: GitCompareArrows,
  real_test: FlaskConical,
};

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  activePage,
  onSelectPage,
  collapsed,
  onToggleCollapse,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  const handleNavigate = (page: DashboardPageId) => {
    onSelectPage(page);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Desktop Slim Left Sidebar */}
      <aside
        aria-label="주 메뉴"
        className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen border-r border-slate-800/80 bg-[#0A0F1A] select-none transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none z-30 ${
          collapsed ? 'w-[64px]' : 'w-[216px]'
        }`}
      >
        {/* Minimal Brand Header + Collapse Toggle */}
        <div
          className={`flex items-center h-14 border-b border-slate-800/80 ${
            collapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          {!collapsed && (
            <button
              type="button"
              onClick={() => handleNavigate('home')}
              className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded cursor-pointer whitespace-nowrap shrink-0"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded border border-slate-700/80 bg-slate-900 text-[11px] font-semibold font-mono-tabular text-sky-400"
              >
                B
              </span>
              <span className="font-display text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
                BTC Desk
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 cursor-pointer shrink-0"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation Links (Strictly Icon + Short Page Label) */}
        <nav aria-label="플랫폼 페이지 이동" className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = PAGE_ICONS[item.id];
            const isActive = activePage === item.id;
            return (
              <a
                key={item.id}
                href={item.path}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  handleNavigate(item.id);
                }}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={`group flex items-center rounded-md text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-slate-800/80 text-slate-50 border border-slate-700/70'
                    : 'border border-transparent text-slate-400 hover:bg-slate-800/45 hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`h-[17px] w-[17px] shrink-0 transition-colors duration-150 ${
                    isActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {!collapsed && (
                  <span className="whitespace-nowrap shrink-0 truncate">{item.label}</span>
                )}
              </a>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Compact Header + Collapsible Drawer */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-12 px-4 border-b border-slate-800/80 bg-[#0A0F1A]/95 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => handleNavigate('home')}
          className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded cursor-pointer whitespace-nowrap shrink-0"
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-700/80 bg-slate-900 text-[11px] font-semibold font-mono-tabular text-sky-400"
          >
            B
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            BTC Desk
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800/70 hover:text-slate-50 transition-colors duration-150 cursor-pointer"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-[1px] transition-opacity duration-200"
          />
          <aside
            aria-label="모바일 내비게이션"
            className="relative z-50 w-64 max-w-[80vw] h-full bg-[#0A0F1A] border-r border-slate-800/90 flex flex-col page-enter"
          >
            <div className="flex items-center justify-between h-12 px-4 border-b border-slate-800/80">
              <span className="font-display text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
                BTC Desk
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="메뉴 닫기"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = PAGE_ICONS[item.id];
                const isActive = activePage === item.id;
                return (
                  <a
                    key={item.id}
                    href={item.path}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      handleNavigate(item.id);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'bg-slate-800/80 text-slate-50 border border-slate-700/70'
                        : 'border border-transparent text-slate-400 hover:bg-slate-800/45 hover:text-slate-100'
                    }`}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        isActive ? 'text-sky-400' : 'text-slate-400'
                      }`}
                    />
                    <span className="whitespace-nowrap shrink-0">{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
};
