import type React from 'react';

/**
 * Centralized 3-color Minimal Sci-Fi FUI design tokens strictly scoped to the Home screen.
 * Background stays Deep Navy / Near Black (#050811 / #080E1A).
 */
export const HOME_FUI_COLORS = {
  /** Electric Cyan: upward price/metric changes & positive correlations */
  cyan: '#35D6E8',
  /** Soft Coral Red: downward price/metric changes & negative correlations */
  coral: '#FF7185',
  /** Soft White: general UI chrome, neutral nodes, typography, labels & inactive elements */
  white: '#F2F5F7',
  /** Deep Navy / Near Black canvas surfaces */
  bgCanvas: '#050811',
  bgSurface: '#080E1A',
  bgElevated: '#0B1221',
} as const;

export const HOME_FUI_CSS_VARS: React.CSSProperties = {
  ['--home-fui-cyan' as string]: HOME_FUI_COLORS.cyan,
  ['--home-fui-coral' as string]: HOME_FUI_COLORS.coral,
  ['--home-fui-white' as string]: HOME_FUI_COLORS.white,
  ['--home-fui-bg' as string]: HOME_FUI_COLORS.bgCanvas,
  ['--home-fui-surface' as string]: HOME_FUI_COLORS.bgSurface,
};

export type FuiPolarity = 'positive' | 'negative' | 'neutral';

export function getValuePolarity(value: number | null | undefined): FuiPolarity {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return 'neutral';
  }
  return value > 0 ? 'positive' : 'negative';
}

export function getPolarityColor(polarity: FuiPolarity): string {
  switch (polarity) {
    case 'positive':
      return HOME_FUI_COLORS.cyan;
    case 'negative':
      return HOME_FUI_COLORS.coral;
    case 'neutral':
      return HOME_FUI_COLORS.white;
  }
}

export function getValueColor(value: number | null | undefined): string {
  return getPolarityColor(getValuePolarity(value));
}

export function rgbaFromPolarity(polarity: FuiPolarity, alpha: number): string {
  switch (polarity) {
    case 'positive':
      return `rgba(53, 214, 232, ${alpha})`;
    case 'negative':
      return `rgba(255, 113, 133, ${alpha})`;
    case 'neutral':
      return `rgba(242, 245, 247, ${alpha})`;
  }
}
