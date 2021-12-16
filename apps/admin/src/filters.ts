const ranges = [
  {
    name: "bytes",
    value: 1,
  },
  {
    name: "kB",
    value: 1024,
  },
  {
    name: "MB",
    value: 1024 * 1024,
  },
  {
    name: "GB",
    value: 1024 * 1024 * 1024,
  },
  {
    name: "TB",
    value: 1024 * 1024 * 1024 * 1024,
  },
];

export function filesize(value: number) {
  for (let i = 0; i < ranges.length; i++) {
    if (i === ranges.length - 1 || ranges[i + 1].value > value) {
      return `${(value / ranges[i].value).toPrecision(3)} ${ranges[i].name}`;
    }
  }
}
