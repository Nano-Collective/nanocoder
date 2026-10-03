import test from "ava";
import { isExactSingleCommand } from "./exact-command";

test("treats one exact slash command as already complete", (t) => {
	t.true(isExactSingleCommand("/model", ["model"]));
});

test("does not treat a prefix or several matches as exact", (t) => {
	t.false(isExactSingleCommand("/mod", ["model"]));
	t.false(isExactSingleCommand("/model", ["model", "models"]));
});
