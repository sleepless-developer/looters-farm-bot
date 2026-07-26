import test from "node:test";
import assert from "node:assert/strict";
import { formatGangAcceptedNotification } from "../src/notify.js";

test("accepted gang request notification contains only safe request summary", () => {
  const message = formatGangAcceptedNotification({ id: "908", earned: 5063 });
  assert.equal(message.title, "Looters: gang request accepted");
  assert.equal(message.body, "Accepted request id=908 · earned=5063");
  assert.equal(message.body.includes("PHPSESSID"), false);
});
