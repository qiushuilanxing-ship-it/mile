import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireUserRequest,
  clearRequestGuards,
  getActiveRequest,
} from "./request-guard.js";

test("allows only one active generation per user", () => {
  clearRequestGuards();
  const first = acquireUserRequest(1, "request-a");
  const duplicate = acquireUserRequest(1, "request-b");
  const otherUser = acquireUserRequest(2, "request-c");

  assert.equal(first.acquired, true);
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.activeRequestId, "request-a");
  assert.equal(otherUser.acquired, true);

  first.release();
  assert.equal(getActiveRequest(1), null);
  assert.equal(acquireUserRequest(1, "request-d").acquired, true);
  clearRequestGuards();
});

test("release is idempotent", () => {
  clearRequestGuards();
  const guard = acquireUserRequest(1, "request-a");

  guard.release();
  guard.release();
  assert.equal(getActiveRequest(1), null);
});
