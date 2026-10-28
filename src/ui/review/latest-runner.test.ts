import { describe, expect, it } from "vitest";
import { createLatestRunner } from "./latest-runner";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((res) => setTimeout(res, 0));
}

describe("createLatestRunner", () => {
  it("runs the first request immediately", async () => {
    const calls: string[] = [];
    const request = createLatestRunner<string>(async (input) => {
      calls.push(input);
    });
    request("a");
    await settle();
    expect(calls).toEqual(["a"]);
  });

  it("runs only the latest request made while one is in flight", async () => {
    const calls: string[] = [];
    const gates = [deferred(), deferred()];
    const request = createLatestRunner<string>((input) => {
      calls.push(input);
      return gates[calls.length - 1].promise;
    });
    request("a");
    request("b");
    request("c");
    expect(calls).toEqual(["a"]);
    gates[0].resolve();
    await settle();
    expect(calls).toEqual(["a", "c"]);
    gates[1].resolve();
    await settle();
    expect(calls).toEqual(["a", "c"]);
  });

  it("still runs the held-back request when the running one rejects", async () => {
    const calls: string[] = [];
    const gate = deferred();
    const request = createLatestRunner<string>(async (input) => {
      calls.push(input);
      if (input === "a") await gate.promise;
    });
    request("a");
    request("b");
    gate.reject(new Error("boom"));
    await settle();
    expect(calls).toEqual(["a", "b"]);
  });
});
