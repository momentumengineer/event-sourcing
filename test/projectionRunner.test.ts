import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { Event, EventStore, InMemoryEventStorage, type Projection, ProjectionRunner } from "../src";
import { increment, type Incremented, setup } from "./fixtures";

function recorder(name: string, options: Partial<Projection<Event, undefined>> = {}) {
  const seen: unknown[] = [];
  const projection: Projection<Event, undefined> = {
    name,
    reset: async () => {
      seen.length = 0;
    },
    project: async (_tx, event) => {
      seen.push(event.data);
    },
    ...options,
  };
  return { seen, projection };
}

describe("ProjectionRunner", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("projects all events in order", async () => {
    const { storage, handler } = setup();
    const { seen, projection } = recorder("all");
    await handler.handle(increment("c1", 1));
    await handler.handle(increment("c2", 2));

    await new ProjectionRunner({ storage, projections: [projection] }).catchUp();

    expect(seen).toEqual([{ by: 1 }, { by: 2 }]);
  });

  it("continues from its position on the next catch up", async () => {
    const { storage, handler } = setup();
    const { seen, projection } = recorder("all");
    const runner = new ProjectionRunner({ storage, projections: [projection] });
    await handler.handle(increment("c1", 1));
    await runner.catchUp();

    await handler.handle(increment("c1", 2));
    await runner.catchUp();

    expect(seen).toEqual([{ by: 1 }, { by: 2 }]);
    expect((await storage.getProjectionState("all")).position).toBe(2);
  });

  it("processes more events than one batch", async () => {
    const { storage, handler } = setup();
    const { seen, projection } = recorder("all");
    for (let i = 0; i < 5; i++) await handler.handle(increment("c1", 1));

    await new ProjectionRunner({ storage, projections: [projection], batchSize: 2 }).catchUp();

    expect(seen).toHaveLength(5);
  });

  it("only projects the configured aggregate types", async () => {
    const storage = new InMemoryEventStorage();
    const { handler } = setup(storage);
    await handler.handle(increment("c1", 1));
    await new EventStore({ storage, aggregateType: "other" }).append([new Event("o1", "Other", { other: true })]);
    const { seen, projection } = recorder("others", { aggregateTypes: ["other"] });

    await new ProjectionRunner({ storage, projections: [projection] }).catchUp();

    expect(seen).toEqual([{ other: true }]);
  });

  it("stops a failing projection, logs and stores the error, and keeps running the others", async () => {
    const { storage, handler } = setup();
    for (const by of [1, 2, 3]) await handler.handle(increment("c1", by));
    const failing = recorder("failing", {
      project: async (_tx, event) => {
        if ((event as Incremented).data.by === 2) throw new Error("boom");
      },
    });
    const healthy = recorder("healthy");

    await new ProjectionRunner({ storage, projections: [failing.projection, healthy.projection] }).catchUp();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Projection failing failed at position 2"), expect.any(Error));
    const state = await storage.getProjectionState("failing");
    expect(state.position).toBe(0);
    expect(state.failedPosition).toBe(2);
    expect(state.lastError).toContain("boom");
    expect(state.lastErrorAt).toBeInstanceOf(Date);
    expect(healthy.seen).toHaveLength(3);
    expect((await storage.getProjectionState("healthy")).position).toBe(3);
  });

  it("recovers on the next catch up once the projection works and clears the error", async () => {
    const { storage, handler } = setup();
    await handler.handle(increment("c1", 1));
    let broken = true;
    const { seen, projection } = recorder("flaky", {
      project: async (_tx, event) => {
        if (broken) throw new Error("boom");
        seen.push(event.data);
      },
    });
    const runner = new ProjectionRunner({ storage, projections: [projection] });
    await runner.catchUp();

    broken = false;
    await runner.catchUp();

    expect(seen).toEqual([{ by: 1 }]);
    const state = await storage.getProjectionState("flaky");
    expect(state).toMatchObject({ position: 1, failedPosition: null, lastError: null, lastErrorAt: null });
  });

  it("does not make the event store fail when a projection fails", async () => {
    const { storage, store, handler } = setup();
    const { projection } = recorder("failing", {
      project: async () => {
        throw new Error("boom");
      },
    });
    const runner = new ProjectionRunner({ storage, projections: [projection] });

    await handler.handle(increment("c1", 1));
    await expect(runner.catchUp()).resolves.toBeUndefined();
    await handler.handle(increment("c1", 2));

    expect(await store.loadAggregate("c1")).toHaveLength(2);
  });

  it("rebuilds a projection from the first event", async () => {
    const { storage, handler } = setup();
    const { seen, projection } = recorder("all");
    const runner = new ProjectionRunner({ storage, projections: [projection] });
    await handler.handle(increment("c1", 1));
    await handler.handle(increment("c1", 2));
    await runner.catchUp();

    await runner.rebuild("all");

    expect(seen).toEqual([{ by: 1 }, { by: 2 }]);
    expect((await storage.getProjectionState("all")).position).toBe(2);
  });

  it("rejects rebuilding an unknown projection", async () => {
    const { storage } = setup();

    await expect(new ProjectionRunner({ storage, projections: [] }).rebuild("nope")).rejects.toThrow(
      "Unknown projection nope",
    );
  });
});
