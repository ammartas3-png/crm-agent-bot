import * as XLSX from "xlsx";

export const REVIEW_COLUMNS = [
  "Brand",
  "Account No",
  "Client Name",
  "Country",
  "Campaign",
  "Sub-Campaign",
  "Current Assigned Agent",
  "Current Agent Office",
  "Current Agent Desk",
  "Customer Status",
  "Suggested Status",
  "Review Type",
  "Reason",
  "Matched Positive Keywords",
  "Matched Negative Keywords",
  "Appointment Detected",
  "Appointment Date/Time Extracted",
  "Call Check Result",
  "Last Relevant Comment",
  "Full Last 10 Comments",
];

export function readInputWorkbookRows(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

export function buildReviewWorkbookBuffer(rows = []) {
  const normalizedRows = rows.map((row) =>
    REVIEW_COLUMNS.reduce((acc, column) => {
      acc[column] = row[column] ?? "";
      return acc;
    }, {}),
  );
  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: REVIEW_COLUMNS,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Review");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
