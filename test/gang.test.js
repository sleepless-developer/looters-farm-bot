import test from "node:test";
import assert from "node:assert/strict";
import { acceptGangRequests, normalizeGangRequests, watchGangRequests } from "../src/gang.js";

test("gang request normalizer keeps only safe request fields", () => {
  const requests = normalizeGangRequests({
    requests: [
      { id: 222, earned: "1500", handle: "hidden", avatar: "hidden" },
      { id: "", earned: 1 },
    ],
  });
  assert.deepEqual(requests, [{ id: "222", earned: 1500 }]);
});

test("auto-accept dry-run does not post", async () => {
  let posts = 0;
  const api = {
    async get(action) {
      assert.equal(action, "gang");
      return { ok: true, requests: [{ id: 222, earned: 1500 }] };
    },
    async post() {
      posts += 1;
    },
  };
  const result = await acceptGangRequests(api, { dryRun: true });
  assert.equal(posts, 0);
  assert.equal(result.selected, 1);
  assert.equal(result.results[0].dryRun, true);
});

test("auto-accept live posts request_respond with accept true", async () => {
  const calls = [];
  const api = {
    async get(action) {
      assert.equal(action, "gang");
      return { ok: true, requests: [{ id: 222, earned: 1500 }] };
    },
    async post(action, body) {
      calls.push({ action, body });
      return { ok: true };
    },
  };
  const result = await acceptGangRequests(api, { dryRun: false });
  assert.deepEqual(calls, [{ action: "request_respond", body: { request_id: "222", accept: true } }]);
  assert.equal(result.results[0].accepted, true);
});

test("gang watch can run exactly one live tick without lock in tests", async () => {
  const calls = [];
  const api = {
    async get(action) {
      assert.equal(action, "gang");
      return { ok: true, requests: [{ id: 333, earned: 2500 }] };
    },
    async post(action, body) {
      calls.push({ action, body });
      return { ok: true };
    },
  };
  await watchGangRequests(api, { dryRun: false, once: true, lock: false, intervalSeconds: 1 });
  assert.deepEqual(calls, [{ action: "request_respond", body: { request_id: "333", accept: true } }]);
});
