import type { HalvingEpochId, HalvingSchedule } from '../../types/realTest';

const MS_PER_DAY = 86_400_000;

interface HalvingDefinition {
  epoch: HalvingEpochId;
  cycleLabel: string;
  halvingDate: string;
  blockHeight: number;
  rewardAfterBtc: number;
}

/**
 * Historical Bitcoin halving cycles compatible with 2015+ daily dataset.
 * (2012-11-28 1st halving is excluded because +18M falls in 2014-05 before 2015 start.)
 */
export const HALVING_DEFINITIONS: readonly HalvingDefinition[] = [
  {
    epoch: 2,
    cycleLabel: '2016 반감기 (2차)',
    halvingDate: '2016-07-09',
    blockHeight: 420_000,
    rewardAfterBtc: 12.5,
  },
  {
    epoch: 3,
    cycleLabel: '2020 반감기 (3차)',
    halvingDate: '2020-05-11',
    blockHeight: 630_000,
    rewardAfterBtc: 6.25,
  },
  {
    epoch: 4,
    cycleLabel: '2024 반감기 (4차)',
    halvingDate: '2024-04-20',
    blockHeight: 840_000,
    rewardAfterBtc: 3.125,
  },
];

export function parseUtcIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatUtcIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarDaysUtc(isoDate: string, days: number): string {
  const dt = parseUtcIsoDate(isoDate);
  return formatUtcIsoDate(new Date(dt.getTime() + days * MS_PER_DAY));
}

export function addCalendarMonthsUtc(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetZeroMonth = m - 1 + months;
  const targetYear = y + Math.floor(targetZeroMonth / 12);
  const targetMonth = ((targetZeroMonth % 12) + 12) % 12;
  const maxDayInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, maxDayInMonth);
  return formatUtcIsoDate(new Date(Date.UTC(targetYear, targetMonth, clampedDay)));
}

/**
 * Generates inclusive-start, exclusive-end UTC daily date list: [startIso, endExclusiveIso)
 */
export function enumerateUtcDates(startIso: string, endExclusiveIso: string): string[] {
  const startMs = parseUtcIsoDate(startIso).getTime();
  const endMs = parseUtcIsoDate(endExclusiveIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }
  const count = Math.round((endMs - startMs) / MS_PER_DAY);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(formatUtcIsoDate(new Date(startMs + i * MS_PER_DAY)));
  }
  return dates;
}

export function buildHalvingSchedules(): HalvingSchedule[] {
  return HALVING_DEFINITIONS.map((def) => {
    const optionEntryDate = addCalendarMonthsUtc(def.halvingDate, 18);
    const optionExpiryDate = addCalendarDaysUtc(optionEntryDate, 365);
    const dcaStartDate = addCalendarMonthsUtc(def.halvingDate, 24);
    const dcaEndExclusiveDate = addCalendarMonthsUtc(def.halvingDate, 36);
    const dcaLastScheduledBuyDate = addCalendarDaysUtc(dcaEndExclusiveDate, -1);
    const totalScheduledDays = enumerateUtcDates(dcaStartDate, dcaEndExclusiveDate).length;

    return {
      epoch: def.epoch,
      cycleLabel: def.cycleLabel,
      halvingDate: def.halvingDate,
      blockHeight: def.blockHeight,
      rewardAfterBtc: def.rewardAfterBtc,
      optionEntryDate,
      optionExpiryDate,
      dcaStartDate,
      dcaEndExclusiveDate,
      dcaLastScheduledBuyDate,
      totalScheduledDays,
    };
  });
}
