import { fullDate, monthKey, relDate } from '../dates';

const NBSP = ' ';

describe('dates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 6, 0, 30)); // 6 Nov 2026, just after midnight
  });
  afterEach(() => jest.useRealTimers());

  it('relDate says Today and Yesterday by calendar day, not by 24 hours', () => {
    expect(relDate(new Date(2026, 10, 6, 0, 5).getTime())).toBe('Today');
    expect(relDate(new Date(2026, 10, 5, 23, 55).getTime())).toBe('Yesterday');
  });

  it('relDate shows day and short month for older dates, with a no-break space', () => {
    expect(relDate(new Date(2026, 10, 3, 12).getTime())).toBe(`3${NBSP}Nov`);
  });

  it('fullDate and monthKey', () => {
    const t = new Date(2026, 10, 3, 12).getTime();
    expect(fullDate(t)).toBe(`3${NBSP}November${NBSP}2026`);
    expect(monthKey(t)).toBe('November 2026');
  });
});
