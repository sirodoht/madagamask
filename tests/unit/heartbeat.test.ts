import assert from "node:assert/strict";
import { test } from "node:test";
import { startHeartbeat } from "../../src/browser/heartbeat.ts";

test("heartbeat writes immediately, every two seconds, and stops when disposed", (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now: 10_000 });
  const timestamps: number[] = [];
  const stop = startHeartbeat(async (timestamp) => {
    timestamps.push(timestamp);
  });
  assert.deepEqual(timestamps, [10_000]);
  context.mock.timers.tick(1_999);
  assert.equal(timestamps.length, 1);
  context.mock.timers.tick(1);
  assert.deepEqual(timestamps, [10_000, 12_000]);
  stop();
  context.mock.timers.tick(2_000);
  assert.equal(timestamps.length, 2);
});

test("storage rejection is contained and the next heartbeat still runs", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let attempts = 0;
  const stop = startHeartbeat(async () => {
    attempts += 1;
    throw new Error("storage unavailable");
  });
  await Promise.resolve();
  context.mock.timers.tick(2_000);
  await Promise.resolve();
  assert.equal(attempts, 2);
  stop();
});
