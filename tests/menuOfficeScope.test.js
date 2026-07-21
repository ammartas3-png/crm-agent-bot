import assert from "node:assert/strict";
import test from "node:test";

import { officeMonthRecordsForOffice } from "../lib/dashboardService.js";

test("officeMonthRecordsForOffice does not merge global month files from other offices", () => {
  const officeMap = {
    byOffice: {
      "Dubai Office": [
        { key: "2026-05", month_label: "May 2026", sheet_id: "dubai-may", active: true },
      ],
      "Turkiye Office": [
        { key: "2026-05", month_label: "May 2026", sheet_id: "turkiye-may", active: true },
      ],
    },
  };
  const dubaiMonths = officeMonthRecordsForOffice(officeMap, "Dubai Office");
  assert.equal(dubaiMonths.length, 1);
  assert.equal(dubaiMonths[0].sheet_id, "dubai-may");
  assert.equal(dubaiMonths[0].office_name, "Dubai Office");

  const turkiyeMonths = officeMonthRecordsForOffice(officeMap, "Turkiye Office");
  assert.equal(turkiyeMonths.length, 1);
  assert.equal(turkiyeMonths[0].sheet_id, "turkiye-may");
});
