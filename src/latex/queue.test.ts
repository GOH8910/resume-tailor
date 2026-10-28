import { describe, expect, it } from "vitest";
import { concurrencyFromEnv, createQueue } from "./queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createQueue", () => {
  it("runs at most `limit` jobs at once and preserves results", async () => {
    const queue = createQueue(2);
    let running = 0;
    let peak = 0;
    const job = (n: number) =>
      queue.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(20);
        running--;
        return n;
      });
    expect(await Promise.all([job(1), job(2), job(3), job(4)])).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("starts waiting jobs in arrival order", async () => {
    const queue = createQueue(1);
    const started: number[] = [];
    const job = (n: number) =>
      queue.run(async () => {
        started.push(n);
        await sleep(5);
      });
    await Promise.all([job(1), job(2), job(3), job(4)]);
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it("frees the slot of a rejected job and passes the rejection to its caller", async () => {
    const queue = createQueue(1);
    const failing = queue.run(async () => {
      await sleep(5);
      throw new Error("boom");
    });
    const next = queue.run(async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("ran");
  });

  it("frees the slot of a job that throws synchronously", async () => {
    const queue = createQueue(1);
    const failing = queue.run(() => {
      throw new Error("sync boom");
    });
    await expect(failing).rejects.toThrow("sync boom");
    expect(await queue.run(async () => "ran")).toBe("ran");
  });
});

describe("concurrencyFromEnv", () => {
  it.each([
    [undefined, 2],
    ["", 2],
    ["abc", 2],
    ["0", 2],
    ["-1", 2],
    ["1.5", 2],
    ["1", 1],
    ["4", 4],
  ])("maps %j to %i", (value, expected) => {
    expect(concurrencyFromEnv(value)).toBe(expected);
  });
});
