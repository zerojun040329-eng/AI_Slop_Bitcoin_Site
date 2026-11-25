export type DashboardPageId =
  | 'home'
  | 'derivatives'
  | 'long_term'
  | 'signal_analysis'
  | 'real_test';

export interface NavItemConfig {
  id: DashboardPageId;
  path: string;
  label: string;
  pageTitle: string;
}

export const NAV_ITEMS: readonly NavItemConfig[] = [
  {
    id: 'home',
    path: '/',
    label: 'Home',
    pageTitle: 'BTC Desk — Financial Market Analytics Platform',
  },
  {
    id: 'derivatives',
    path: '/derivatives',
    label: '파생상품 분석',
    pageTitle: '파생상품 분석 — BTC Desk',
  },
  {
    id: 'long_term',
    path: '/long-term',
    label: '장기투자지표',
    pageTitle: '장기투자지표 — BTC Desk',
  },
  {
    id: 'signal_analysis',
    path: '/signal-analysis',
    label: '시그널유사도',
    pageTitle: '시그널유사도 — BTC Desk',
  },
  {
    id: 'real_test',
    path: '/real-test',
    label: '실전테스트',
    pageTitle: '실전테스트 — BTC Desk',
  },
] as const;

export function resolvePageFromPathname(pathname: string): DashboardPageId {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/':
      return 'home';
    case '/derivatives':
      return 'derivatives';
    case '/long-term':
      return 'long_term';
    case '/signal-analysis':
      return 'signal_analysis';
    case '/real-test':
    case '/strategy-backtest':
      return 'real_test';
    default:
      return 'home';
  }
}

export function getNavConfig(page: DashboardPageId): NavItemConfig {
  return NAV_ITEMS.find((item) => item.id === page) ?? NAV_ITEMS[0];
}
