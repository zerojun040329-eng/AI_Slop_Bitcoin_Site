import React from 'react';

export type DashboardPageId = 'derivatives' | 'long_term';

interface TopBarProps {
  activePage: DashboardPageId;
  onSelectPage: (page: DashboardPageId) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ activePage, onSelectPage }) => {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-8 border-b border-slate-800/90 bg-[#090D16]/95 px-5 py-3 backdrop-blur-sm">
      {/* Zone 1: Single-line Wordmark */}
      <button
        type="button"
        onClick={() => {
          onSelectPage('derivatives');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="font-display text-base font-semibold tracking-tight text-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
      >
        BTC Derivatives Desk
      </button>

      {/* Zone 2: Clean single-line page navigation + contextual section anchors */}
      <nav
        aria-label="대시보드 페이지 및 섹션 이동"
        className="flex items-center gap-6 text-xs font-medium text-slate-400 overflow-x-auto"
      >
        <button
          type="button"
          onClick={() => {
            onSelectPage('derivatives');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activePage === 'derivatives'
              ? 'border-sky-400 text-slate-50 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          파생상품 분석
        </button>

        <button
          type="button"
          onClick={() => {
            onSelectPage('long_term');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activePage === 'long_term'
              ? 'border-amber-400 text-slate-50 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          장기투자지표
        </button>

        <span className="hidden lg:inline-block h-3.5 w-px bg-slate-800 shrink-0" aria-hidden="true" />

        {activePage === 'derivatives' ? (
          <>
            <button
              type="button"
              onClick={() => scrollTo('unified-chart')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              통합 차트
            </button>
            <button
              type="button"
              onClick={() => scrollTo('iv-analysis')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              만기별 IV
            </button>
            <button
              type="button"
              onClick={() => scrollTo('max-pain')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Max Pain
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => scrollTo('powerlaw-chart')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              초장기 차트
            </button>
            <button
              type="button"
              onClick={() => scrollTo('halving-countdown')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              반감기 카운트다운
            </button>
            <button
              type="button"
              onClick={() => scrollTo('mining-economics')}
              className="hidden lg:inline-block hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              채굴 경제성
            </button>
          </>
        )}
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={() => scrollTo('architecture')}
          className="rounded-md border border-slate-700 bg-slate-800/80 px-3.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          데이터 구조 안내
        </button>
      </div>
    </header>
  );
};
