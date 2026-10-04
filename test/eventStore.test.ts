import { describe, expect, it } from "vitest";
import { ConcurrencyError, Event, EventStore, InMemoryEventStorage } from "../src";
import { setup } from "./fixtures";

describe("CommandHandler", () => {
  it("stores the events returned by handle with increasing versions", async () => {
    const { store, handler } = setup();

    await handler.handle("c1", { by: 2 });
    await handler.handle("c1", { by: 3 });

    const events = await store.loadAggregate("c1");
    expect(events.map((e) => [e.version, e.type, e.data])).toEqual([
      [1, "Incremented", { by: 2 }],
      [2, "Incremented", { by: 3 }],
    ]);
  });

  it("applies the history before handling so business rules see the current state", async () => {
    const { store, handler } = setup();
    await handler.handle("c1", { by: 8 });

    await expect(handler.handle("c1", { by: 3 })).rejects.toThrow("Counter cannot exceed 10");
    expect(await store.loadAggregate("c1")).toHaveLength(1);
  });

  it("returns the stored events", async () => {
    const { handler } = setup();

    const events = await handler.handle("c1", { by: 2 });

    expect(events.map((e) => e.data)).toEqual([{ by: 2 }]);
  });
});

describe("EventStore", () => {
  it("throws a ConcurrencyError when the expected version is stale", async () => {
    const { store, handler } = setup();
    await handler.handle("c1", { by: 1 });
    await handler.handle("c1", { by: 1 });

    const append = store.append([new Event("c1", "Incremented", { by: 1 })], { expectedVersion: 1 });

    await expect(append).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await store.loadAggregate("c1")).toHaveLength(2);
  });

  it("rejects events of different aggregates in one append", async () => {
    const { store } = setup();

    const append = store.append([
      new Event("c1", "Incremented", { by: 1 }),
      new Event("c2", "Incremented", { by: 1 }),
    ]);

    await expect(append).rejects.toThrow("same aggregate");
  });

  it("keeps aggregates and aggregate types apart", async () => {
    const storage = new InMemoryEventStorage();
    const { store, handler } = setup(storage);
    const other = new EventStore({ storage, aggregateType: "other" });
    await handler.handle("c1", { by: 1 });
    await handler.handle("c2", { by: 2 });
    await other.append([new Event("c1", "Other", {})]);

    expect((await store.loadAggregate("c1")).map((e) => e.data)).toEqual([{ by: 1 }]);
    expect((await other.loadAggregate("c1")).map((e) => e.type)).toEqual(["Other"]);
  });

  it("keeps id, createdAt and metadata of stored events", async () => {
    const { store } = setup();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const event = new Event("c1", "Incremented", { by: 1 }, { id: "e1", createdAt, metadata: { user: "u1" } });

    await store.append([event]);

    const [loaded] = await store.loadAggregate("c1");
    expect(loaded.id).toBe("e1");
    expect(loaded.createdAt).toEqual(createdAt);
    expect(loaded.metadata).toEqual({ user: "u1" });
  });
});

describe("InMemoryEventStorage", () => {
  it("is not affected by mutating events after append or load", async () => {
    const { store } = setup();
    const event = new Event("c1", "Incremented", { by: 1 });
    await store.append([event]);

    event.data.by = 99;
    const [loaded] = await store.loadAggregate("c1");
    loaded.data.by = 42;

    expect((await store.loadAggregate("c1"))[0].data).toEqual({ by: 1 });
  });
});
