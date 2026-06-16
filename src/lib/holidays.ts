import { format } from "date-fns";

const fixedHolidays: Record<string, string> = {
  "01-01": "元日",
  "02-11": "建国記念の日",
  "02-23": "天皇誕生日",
  "04-29": "昭和の日",
  "05-03": "憲法記念日",
  "05-04": "みどりの日",
  "05-05": "こどもの日",
  "08-11": "山の日",
  "11-03": "文化の日",
  "11-23": "勤労感謝の日",
};

function nthMonday(year: number, monthIndex: number, nth: number) {
  const first = new Date(year, monthIndex, 1);
  const offset = (8 - first.getDay()) % 7;
  return new Date(year, monthIndex, 1 + offset + (nth - 1) * 7);
}

function equinoxDay(year: number, spring: boolean) {
  if (spring) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

export function getJapaneseHolidayName(date: Date) {
  const md = format(date, "MM-dd");
  const fixed = fixedHolidays[md];
  if (fixed) return fixed;

  const year = date.getFullYear();
  const key = format(date, "yyyy-MM-dd");
  const moving: Record<string, string> = {
    [format(nthMonday(year, 0, 2), "yyyy-MM-dd")]: "成人の日",
    [format(new Date(year, 2, equinoxDay(year, true)), "yyyy-MM-dd")]: "春分の日",
    [format(nthMonday(year, 6, 3), "yyyy-MM-dd")]: "海の日",
    [format(nthMonday(year, 8, 3), "yyyy-MM-dd")]: "敬老の日",
    [format(new Date(year, 8, equinoxDay(year, false)), "yyyy-MM-dd")]: "秋分の日",
    [format(nthMonday(year, 9, 2), "yyyy-MM-dd")]: "スポーツの日",
  };

  return moving[key] ?? null;
}

export function isClosedDay(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6 || Boolean(getJapaneseHolidayName(date));
}
