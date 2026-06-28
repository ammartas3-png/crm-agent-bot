import assert from "node:assert/strict";
import test from "node:test";

import { clearExportCache, getOrBuildExport } from "../lib/exportCache.js";

test("getOrBuildExport builds once and serves the cached value within TTL", async () => {
  clearExportCache();
  let builds = 0;
  const builder = async () => {
    builds += 1;
    return { value: builds };
  };

  const first = await getOrBuildExport("k1", builder);
  const second = await getOrBuildExport("k1", builder);

  assert.equal(builds, 1, "second call should be served from cache");
  assert.equal(first, second);

  // Different key rebuilds.
  await getOrBuildExport("k2", builder);
  assert.equal(builds, 2);

  clearExportCache();
  await getOrBuildExport("k1", builder);
  assert.equal(builds, 3, "after clear it rebuilds");
  clearExportCache();
});

test("getOrBuildExport rebuilds every call when TTL is 0", async () => {
  clearExportCache();
  const original = process.env.EXPORT_CACHE_TTL_MS;
  process.env.EXPORT_CACHE_TTL_MS = "0";
  let builds = 0;
  const builder = async () => {
    builds += 1;
    return builds;
  };
  try {
    await getOrBuildExport("z", builder);
    await getOrBuildExport("z", builder);
    assert.equal(builds, 2);
  } finally {
    if (original === undefined) {
      delete process.env.EXPORT_CACHE_TTL_MS;
    } else {
      process.env.EXPORT_CACHE_TTL_MS = original;
    }
    clearExportCache();
  }
});
