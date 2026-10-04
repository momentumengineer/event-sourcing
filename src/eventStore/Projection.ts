import type { Event } from "./Event";

export interface Projection<E extends Event, Tx = unknown> {
  name: string;
  reset(tx: Tx): Promise<void>;
  project(tx: Tx, event: E): Promise<void>;
}
