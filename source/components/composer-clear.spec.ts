import test from "ava";
import { shouldOfferInputClear } from "./composer-clear";

test("does not offer to clear an empty composer", (t) => {
	t.false(shouldOfferInputClear("", 0));
});

test("offers to clear typed text or attachments", (t) => {
	t.true(shouldOfferInputClear("/model", 0));
	t.true(shouldOfferInputClear("", 1));
});
