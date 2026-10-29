import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createQueue } from "./queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A promise and the function that settles it, so a test decides when a job finishes. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

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

describe("createQueue slots", () => {
  it("gives each running job a different slot in 0..limit-1", async () => {
    const queue = createQueue(3);
    const gates = [gate(), gate(), gate()];
    const slots: number[] = [];
    const runs = gates.map((g) =>
      queue.run(async (slot) => {
        slots.push(slot);
        await g.opened;
      }),
    );
    await sleep(0);
    expect([...slots].sort()).toEqual([0, 1, 2]);
    gates.forEach((g) => g.open());
    await Promise.all(runs);
  });

  it("hands a finished job's slot to the next waiter, so concurrent slots never repeat", async () => {
    const queue = createQueue(2, { maxWaiting: 20 });
    const running = new Set<number>();
    let clash = false;
    const used: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        queue.run(async (slot) => {
          if (running.has(slot)) clash = true;
          running.add(slot);
          used.push(slot);
          await sleep(1 + (i % 3) * 3);
          running.delete(slot);
        }),
      ),
    );
    expect(clash).toBe(false);
    expect(new Set(used)).toEqual(new Set([0, 1]));
  });

  it("reuses a slot after a job fails", async () => {
    const queue = createQueue(1);
    await expect(queue.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await queue.run(async (slot) => slot)).toBe(0);
  });
});

describe("createQueue waiting cap", () => {
  it("refuses a job with a 503 once maxWaiting jobs are already waiting", async () => {
    const queue = createQueue(1, { maxWaiting: 2 });
    const g = gate();
    const running = queue.run(() => g.opened);
    const waiting = [queue.run(async () => "w1"), queue.run(async () => "w2")];
    const refused = queue.run(async () => "never");
    await expect(refused).rejects.toBeInstanceOf(AppError);
    await expect(refused).rejects.toMatchObject({
      status: 503,
      message: "Server busy, try again in a moment",
      details: { retryAfter: 10 },
    });
    g.open();
    await running;
    expect(await Promise.all(waiting)).toEqual(["w1", "w2"]);
  });

  it("accepts again once the wait list shrinks", async () => {
    const queue = createQueue(1, { maxWaiting: 1 });
    const g = gate();
    const running = queue.run(() => g.opened);
    const waiting = queue.run(async () => "waited");
    await expect(queue.run(async () => "refused")).rejects.toMatchObject({ status: 503 });
    g.open();
    await running;
    await waiting;
    expect(await queue.run(async () => "later")).toBe("later");
  });

  it("waits up to 8 by default", async () => {
    const queue = createQueue(1);
    const g = gate();
    const running = queue.run(() => g.opened);
    const waiting = Array.from({ length: 8 }, () => queue.run(async () => "ok"));
    await expect(queue.run(async () => "ninth")).rejects.toMatchObject({ status: 503 });
    g.open();
    await running;
    expect(await Promise.all(waiting)).toHaveLength(8);
  });

  it("refuses a limit below 1", () => {
    expect(() => createQueue(0)).toThrow();
  });
});
