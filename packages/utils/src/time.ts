const oneDay = 24 * 3600 * 1000;

/**
 * Calculates the elapsed seconds since `since` until `now`, without taking into accont
 * the activeTimer
 *
 * Could be optimized to remove the loop and run in O(1), as of now it runs in O(daysNow-daysSince)
 *
 * @param since Starting date
 * @param activeTimer Time range when time is counted every day
 * @param now End date
 */
export function elapsedSeconds(since: Date, activeTimer?: { start: number; end: number }, now = Date.now()): number {
  if (!activeTimer || activeTimer.start === undefined || activeTimer.end === undefined) {
    return Math.floor((now - since.getTime()) / 1000);
  }

  let total = 0;
  let date = new Date(since.getTime());

  if (isPaused(date, activeTimer)) {
    date = progressToUTCSeconds(date, activeTimer.start);
  }

  // console.log(since.getTime(), date.getTime(), now, (date.getTime() - since.getTime()) / 1000, (now - date.getTime()) / 1000, (now - since.getTime()) / 1000);

  while (date.getTime() < now) {
    const endDate = progressToUTCSeconds(date, activeTimer.end);

    if (endDate.getTime() > now) {
      total += now - date.getTime();
      break;
    }
    total += endDate.getTime() - date.getTime();
    date = progressToUTCSeconds(endDate, activeTimer.start);
  }

  return Math.floor(total / 1000);
}

/**
 * Calculates the date for which `elapsedSeconds(since, activeTimer, date)` is equal to `remainingSeconds`
 *
 * Could be optimized to remove the loop and run in O(1), as of now it runs in O(remainingSeconds/timerDuration)
 *
 * @param remainingSeconds Number of seconds remaning before the deadline
 * @param activeTimer Time range when time is counted every day
 * @Param since The start after which only remainingSeconds remain. Defaults to now.
 */
export function deadline(
  remainingSeconds: number,
  activeTimer?: { start: number; end: number },
  since = new Date()
): Date {
  if (!activeTimer || activeTimer.start === undefined || activeTimer.end === undefined) {
    return new Date(since.getTime() + remainingSeconds * 1000);
  }

  let date = new Date(since.getTime());

  if (isPaused(date, activeTimer)) {
    date = progressToUTCSeconds(date, activeTimer.start);
  }

  let remainingMs = remainingSeconds * 1000;

  while (1) {
    const endDate = progressToUTCSeconds(date, activeTimer.end);

    remainingMs -= endDate.getTime() - date.getTime();

    if (remainingMs <= 0) {
      return new Date(endDate.getTime() + remainingMs);
    }

    date = progressToUTCSeconds(endDate, activeTimer.start);
  }

  throw new Error("Unreachable code");
}

export function isPaused(date: Date, timerSeconds: { start: number; end: number }): boolean {
  const seconds = UTCsecondsSinceMidnight(date);

  if (timerSeconds.start < timerSeconds.end) {
    // eg 2 PM - 3 PM, needs to be before 2 PM OR after 3 PM
    return seconds < timerSeconds.start || seconds >= timerSeconds.end;
  } else {
    // eg 10 PM - 2 AM, needs to be before 10 PM AND after 2 PM
    return seconds < timerSeconds.start && seconds >= timerSeconds.end;
  }
}

export function timerDuration(timerSeconds: { start: number; end: number }): number {
  if (timerSeconds.start < timerSeconds.end) {
    return timerSeconds.end - timerSeconds.start;
  } else {
    return 24 * 3600 - timerSeconds.end + timerSeconds.start;
  }
}

function UTCsecondsSinceMidnight(date: Date) {
  const d = new Date(date.getTime());
  return Math.floor((date.getTime() - d.setUTCHours(0, 0, 0, 0)) / 1000);
}

function resetToUTCMidnight(date: Date) {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);

  return d;
}

function progressToUTCSeconds(date: Date, seconds: number) {
  const newDate = new Date(resetToUTCMidnight(date).getTime() + seconds * 1000);

  if (newDate <= date) {
    return new Date(newDate.getTime() + oneDay);
  }

  return newDate;
}
