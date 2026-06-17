import * as XLSX from "xlsx-js-style";
import { getMonthDates, getMonthDegreeLabel, getShiftPeriodLabel, toDateKey, weekdayLabels } from "./date-utils";
import { getJapaneseHolidayName, isClosedDay } from "./holidays";
import type { ShiftAssignment, Staff } from "./types";

export function downloadShiftWorkbook(targetMonth: string, staff: Staff[], assignments: ShiftAssignment) {
  const dates = getMonthDates(targetMonth);
  const monthDegreeLabel = getMonthDegreeLabel(targetMonth);
  const targetPeriodLabel = getShiftPeriodLabel(targetMonth);
  const lastColumnIndex = dates.length + 1;
  const dateHeaderRowIndex = 2;
  const weekdayHeaderRowIndex = 3;
  const staffStartRowIndex = 4;
  const rows = [
    [`${monthDegreeLabel} シフト表`, ...Array.from({ length: dates.length + 1 }, () => "")],
    [`対象期間：${targetPeriodLabel}`, ...Array.from({ length: dates.length + 1 }, () => "")],
    ["氏名", ...dates.map((date) => date.getDate()), "合計"],
    ["曜日", ...dates.map((date) => weekdayLabels[date.getDay()]), ""],
    ...staff.map((member) => [
      member.name,
      ...dates.map((date) => (assignments[toDateKey(date)]?.includes(member.id) ? "○" : "")),
      dates.filter((date) => assignments[toDateKey(date)]?.includes(member.id)).length,
    ]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 18 }, ...dates.map(() => ({ wch: 3.6 })), { wch: 6 }];
  worksheet["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? 28 : index === 1 ? 20 : index < staffStartRowIndex ? 22 : 21 }));
  worksheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
  worksheet["!pageSetup"] = { fitToHeight: 1, fitToWidth: 1, orientation: "landscape", paperSize: 9, scale: 100 };
  worksheet["!merges"] = [
    { s: { c: 0, r: 0 }, e: { c: lastColumnIndex, r: 0 } },
    { s: { c: 0, r: 1 }, e: { c: lastColumnIndex, r: 1 } },
  ];

  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[ref] ?? { t: "s", v: "" };
      const isTitle = row === 0;
      const isPeriod = row === 1;
      const isHeader = row === dateHeaderRowIndex || row === weekdayHeaderRowIndex;
      const isStaffName = col === 0 && row >= staffStartRowIndex;
      const isTotal = col === lastColumnIndex;
      const tableCell = row >= dateHeaderRowIndex;
      cell.s = {
        alignment: { horizontal: isTitle || isPeriod || isStaffName ? "left" : "center", vertical: "center" },
        border: tableCell
          ? {
              top: { style: "thin", color: { rgb: "A3A3A3" } },
              right: { style: "thin", color: { rgb: "A3A3A3" } },
              bottom: { style: "thin", color: { rgb: "A3A3A3" } },
              left: { style: "thin", color: { rgb: "A3A3A3" } },
            }
          : undefined,
        fill: isHeader ? { fgColor: { rgb: "EAF4F4" } } : undefined,
        font: isTitle
          ? { bold: true, sz: 16 }
          : isPeriod
            ? { sz: 11 }
            : isHeader || col === 0 || isTotal
              ? { bold: true }
              : undefined,
      };
      worksheet[ref] = cell;
    }
  }

  dates.forEach((date, index) => {
    if (!isClosedDay(date)) return;
    const col = index + 1;
    for (let row = dateHeaderRowIndex; row < rows.length; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) {
        cell.s = { ...cell.s, fill: { fgColor: { rgb: "E5E7EB" } } };
      }
    }
  });

  const holidayNames = dates.map((date) => getJapaneseHolidayName(date)).filter(Boolean);
  if (holidayNames.length > 0) {
    const noteRow = rows.length + 1;
    const noteCell = XLSX.utils.encode_cell({ r: noteRow, c: 0 });
    worksheet[noteCell] = {
      s: {
        alignment: { horizontal: "left", vertical: "center" },
        font: { color: { rgb: "737373" }, sz: 9 },
      },
      t: "s",
      v: `祝日：${holidayNames.join(" / ")}`,
    };
    worksheet["!ref"] = XLSX.utils.encode_range({ s: range.s, e: { c: range.e.c, r: noteRow } });
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, monthDegreeLabel);
  XLSX.writeFile(workbook, `${monthDegreeLabel}_シフト表.xlsx`, { cellStyles: true });
}
