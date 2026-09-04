import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticWriteBlockReason,
  automaticWritesSupported,
} from "../src/platform.js";
import { nodeRuntimeSupported } from "../src/doctor.js";

test("Windows remains read-only until its write evidence gate is verified", () => {
  assert.equal(automaticWritesSupported("win32"), false);
  assert.match(automaticWriteBlockReason("win32") ?? "", /disabled on Windows/);
  assert.equal(automaticWritesSupported("darwin"), true);
  assert.equal(automaticWritesSupported("linux"), true);
  assert.equal(automaticWriteBlockReason("linux"), undefined);
});

test("doctor enforces the exact Node 22.14 minimum", () => {
  assert.equal(nodeRuntimeSupported("22.13.9"), false);
  assert.equal(nodeRuntimeSupported("22.14.0"), true);
  assert.equal(nodeRuntimeSupported("24.0.0"), true);
});
