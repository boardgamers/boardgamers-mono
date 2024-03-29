export function timerTime(value: number): string {
  const d = new Date();
  const date = new Date(d.setHours(0, 0, 0, 0) - d.getTimezoneOffset() * 60000 + value * 1000);

  return `${date.getHours().toString().padStart(2, "0")}h${
    date.getMinutes() ? date.getMinutes().toString().padStart(2, "0") : ""
  }`;
}

export function niceDate(date: string | Date): string {
  if (!date) {
    return date as any;
  }
  if (typeof date === "string") {
    if (date.length > 10) {
      const ms = Date.parse(date);

      if (ms) {
        return niceDate(new Date(ms));
      }
      return date;
    }
    if (date.length === 8) {
      return date.substr(6, 2) + "/" + date.substr(4, 2) + "/" + date.substr(2, 2);
    } else {
      return date.substr(8, 2) + "/" + date.substr(5, 2) + "/" + date.substr(2, 2);
    }
  } else {
    return (
      String(date.getDate()).padStart(2, "0") +
      "/" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "/" +
      date.getFullYear().toString().substr(2, 2)
    );
  }
}

const timeRanges = [
  {
    name: "second",
    value: 1,
  },
  {
    name: "minute",
    value: 60,
  },
  {
    name: "hour",
    value: 3600,
  },
  {
    name: "day",
    value: 24 * 3600,
  },
];

export function pluralize(count: number, str: string, { showCount = true } = { showCount: true }): string {
  return showCount ? `${count} ${str}${+count >= 2 ? "s" : ""}` : `${str}${+count >= 2 ? "s" : ""}`;
}

export function duration(seconds: number): string {
  for (let i = 0; i < timeRanges.length; i++) {
    if (i === timeRanges.length - 1 || timeRanges[i + 1].value > seconds) {
      const n = seconds / timeRanges[i].value;
      const gap = timeRanges[i].value;
      if (
        gap < seconds &&
        seconds % gap !== 0 &&
        i > 0 &&
        Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) > 0
      ) {
        return (
          pluralize(Math.floor(n), timeRanges[i].name) +
          " " +
          pluralize(Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value), timeRanges[i - 1].name)
        );
      }
      return pluralize(Math.floor(n), timeRanges[i].name);
    }
  }

  return ">o>";
}

export function shortDuration(seconds: number): string | undefined {
  for (let i = 0; i < timeRanges.length; i++) {
    if (i === timeRanges.length - 1 || timeRanges[i + 1].value > seconds) {
      const n = seconds / timeRanges[i].value;
      const gap = timeRanges[i].value;
      if (
        gap < seconds &&
        seconds % gap !== 0 &&
        i > 0 &&
        Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) > 0
      ) {
        return (
          Math.floor(n) +
          timeRanges[i].name[0] +
          " " +
          Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) +
          timeRanges[i - 1].name[0]
        );
      }
      return pluralize(Math.floor(n), timeRanges[i].name);
    }
  }

  return "<o<";
}

export function dateFromObjectId(objectId: string): Date {
  return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
}

export function dateTime(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(
    2,
    "0"
  )} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function localTimezone(): string {
  return typeof window === "undefined" ? "Europe/Paris" : new window.Intl.DateTimeFormat().resolvedOptions().timeZone;
}
