import type {
  LiquidityFakeoutParams,
  StrategyMetadata,
} from '../../../types/strategyBacktest.ts';

export const DEFAULT_LIQUIDITY_FAKEOUT_PARAMS: LiquidityFakeoutParams = {
  pivotLeftBars: 12,
  pivotRightBars: 12,
  rvolPeriod: 48,
  minRvol: 1.8,
  minReversalStrength: 0.5,
  minRangeAtrMultiple: 1.2,
  minVolumeSurgeRatio: 1.5,
  atrPeriod: 14,
  tp1AtrMultiple: 1.5,
  tp2AtrMultiple: 3.0,
  sweepWindowBars: 2,
  maxPivotAgeBars: 288,
};

export const LIQUIDITY_FAKEOUT_METADATA: StrategyMetadata = {
  id: 'liquidity_fakeout',
  name: 'Liquidity Fakeout',
  koreanName: '유동성 페이크 아웃 (Liquidity Fakeout)',
  summary:
    '거래량·변동폭·반전 강도가 확인된 Pivot High/Low 기준선을 일시 이탈한 뒤 종가 기준으로 회복하는 시점에 반대 방향 추세 전환을 포착하는 단기 알고리즘 전략입니다.',
  rulesSummary: [
    'Pivot 확정: 좌우 N개 캔들 고저 비교 + RVOL · 거래량 증가율 · 반전 강도 · ATR 대비 변동폭 필터 (우측 N봉 완성 시점 이후에만 등록)',
    'LONG 진입: 확정 Pivot Low 하향 이탈 후 종가 회복 시 다음 5분봉 시가 매수 / SHORT 진입: 확정 Pivot High 상향 이탈 후 종가 회복 시 다음 5분봉 시가 매도',
    '손절/익절: 초기 손절은 기준선 종가 재이탈, 1차 익절(N×ATR) 도달 시 50% 청산 후 잔여 50% 평단가 스탑 이동, 2차 익절(M×ATR) 전량 청산 (N < M 강제)',
    '보수적 체결: 동일 캔들 내 손절·익절 동시 충족 시 손절 우선 처리, 갭 발생 시 다음 체결 가능 시가 반영',
  ],
  defaultParams: DEFAULT_LIQUIDITY_FAKEOUT_PARAMS,
  paramSchema: [
    {
      key: 'pivotLeftBars',
      label: 'Pivot 좌측 캔들 수',
      description: '스윙 고점/저점 형성을 검증하는 좌측 비교 봉 수',
      min: 2,
      max: 30,
      step: 1,
      unit: '봉',
    },
    {
      key: 'pivotRightBars',
      label: 'Pivot 우측 캔들 수',
      description: '스윙 확정까지 대기하는 우측 봉 수 (미래 참조 차단)',
      min: 2,
      max: 30,
      step: 1,
      unit: '봉',
    },
    {
      key: 'minRvol',
      label: '최소 RVOL 임계값',
      description: '스윙 시점 거래량 / 직전 48봉 중앙값 거래량 비율',
      min: 0.5,
      max: 5,
      step: 0.1,
      unit: 'x',
    },
    {
      key: 'minVolumeSurgeRatio',
      label: '거래량 증가율 임계값',
      description: '스윙 시점 거래량 / 직전 48봉 평균 거래량 비율',
      min: 0.5,
      max: 5,
      step: 0.1,
      unit: 'x',
    },
    {
      key: 'minReversalStrength',
      label: '최소 반전 강도',
      description: '스윙 전후 가격 반전 폭의 ATR 대비 정규화 강도',
      min: 0,
      max: 2,
      step: 0.05,
    },
    {
      key: 'minRangeAtrMultiple',
      label: 'ATR 대비 최소 변동폭',
      description: '스윙 캔들 (고가-저가) / ATR 최소 배수',
      min: 0.2,
      max: 4,
      step: 0.1,
      unit: 'ATR',
    },
    {
      key: 'atrPeriod',
      label: 'ATR 기간',
      description: '진입 시점 목표가 산정에 사용하는 Wilder ATR 기간',
      min: 5,
      max: 50,
      step: 1,
      unit: '봉',
    },
    {
      key: 'tp1AtrMultiple',
      label: '1차 익절 배수 (N)',
      description: '50% 부분 익절 및 평단가 스탑 전환 목표 (진입가 ± N×ATR)',
      min: 0.5,
      max: 8,
      step: 0.1,
      unit: 'ATR',
    },
    {
      key: 'tp2AtrMultiple',
      label: '2차 익절 배수 (M)',
      description: '잔여 50% 전량 익절 목표 (반드시 N < M 충족)',
      min: 0.8,
      max: 15,
      step: 0.1,
      unit: 'ATR',
    },
    {
      key: 'sweepWindowBars',
      label: '이탈 후 회복 허용 봉 수',
      description: '기준선 이탈 후 종가 회복까지 허용하는 최대 5분봉 수 (1=단일 캔들 꼬리)',
      min: 1,
      max: 6,
      step: 1,
      unit: '봉',
    },
    {
      key: 'maxPivotAgeBars',
      label: '기준선 유효 기간',
      description: '확정된 스윙 기준선이 활성 상태로 유지되는 최대 봉 수',
      min: 24,
      max: 1152,
      step: 24,
      unit: '봉',
    },
  ],
};

export function resolveLiquidityFakeoutParams(
  raw?: Partial<LiquidityFakeoutParams>,
): LiquidityFakeoutParams {
  const merged: LiquidityFakeoutParams = {
    ...DEFAULT_LIQUIDITY_FAKEOUT_PARAMS,
    ...(raw ?? {}),
  };

  merged.pivotLeftBars = Math.max(2, Math.min(40, Math.round(merged.pivotLeftBars)));
  merged.pivotRightBars = Math.max(2, Math.min(40, Math.round(merged.pivotRightBars)));
  merged.rvolPeriod = Math.max(10, Math.min(120, Math.round(merged.rvolPeriod)));
  merged.atrPeriod = Math.max(5, Math.min(60, Math.round(merged.atrPeriod)));
  merged.sweepWindowBars = Math.max(1, Math.min(8, Math.round(merged.sweepWindowBars)));
  merged.maxPivotAgeBars = Math.max(12, Math.min(2880, Math.round(merged.maxPivotAgeBars)));
  merged.minRvol = Math.max(0, Number(merged.minRvol));
  merged.minVolumeSurgeRatio = Math.max(0, Number(merged.minVolumeSurgeRatio));
  merged.minReversalStrength = Math.max(0, Number(merged.minReversalStrength));
  merged.minRangeAtrMultiple = Math.max(0, Number(merged.minRangeAtrMultiple));
  merged.tp1AtrMultiple = Math.max(0.2, Number(merged.tp1AtrMultiple));
  merged.tp2AtrMultiple = Math.max(0.3, Number(merged.tp2AtrMultiple));

  if (merged.tp1AtrMultiple >= merged.tp2AtrMultiple) {
    throw new Error(
      `1차 익절 배수(N=${merged.tp1AtrMultiple})는 2차 익절 배수(M=${merged.tp2AtrMultiple})보다 작아야 합니다 (N < M 필수).`,
    );
  }

  return merged;
}
