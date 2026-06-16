import * as XLSX from "xlsx-js-style";
import { getMonthDates, toDateKey, weekdayLabels } from "./date-utils";
import { getJapaneseHolidayName, isClosedDay } from "./holidays";
import type { ShiftAssignment, Staff } from "./types";

export function downloadShiftWorkbook(targetMonth: string, staff: Staff[], assignments: ShiftAssignment) {
  const dates = getMonthDates(targetMonth);
  const rows = [
    ["氏名", ...dates.map((date) => date.getDate()), "合計"],
    ["曜日", ...dates.map((date) => weekdayLabels[date.getDay()]), ""],
    ...staff.map((member) => [
      member.name,
      ...dates.map((date) => (assignments[toDateKey(date)]?.includes(member.id) ? "○" : "")),
      dates.filter((date) => assignments[toDateKey(date)]?.includes(member.id)).length,
    ]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 14 }, ...dates.map(() => ({ wch: 4 })), { wch: 6 }];
  worksheet["!rows"] = rows.map((_, index) => ({ hpt: index < 2 ? 24 : 22 }));
  worksheet["!margins"] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  worksheet["!pageSetup"] = { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 1 };

  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[ref] ?? { t: "s", v: "" };
      cell.s = {
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "D4D4D4" } },
          right: { style: "thin", color: { rgb: "D4D4D4" } },
          bottom: { style: "thin", color: { rgb: "D4D4D4" } },
          left: { style: "thin", color: { rgb: "D4D4D4" } },
        },
        font: row < 2 || col === 0 ? { bold: true } : undefined,
      };
      worksheet[ref] = cell;
    }
  }

  dates.forEach((date, index) => {
    if (!isClosedDay(date)) return;
    const col = index + 1;
    for (let row = 0; row < rows.length; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) {
        cell.s = { fill: { fgColor: { rgb: "E5E7EB" } } };
      }
    }
  });

  const noteRow = rows.length + 2;
  worksheet[XLSX.utils.encode_cell({ r: noteRow, c: 0 })] = {
    t: "s",
    v: "土日祝は休業日: " + dates.map((date) => getJapaneseHolidayName(date)).filter(Boolean).join(" / "),
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, targetMonth);
  XLSX.writeFile(workbook, `shift-${targetMonth}.xlsx`, { cellStyles: true });
}
