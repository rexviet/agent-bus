import type { createDeliveryStore } from "../storage/delivery-store.js";
import type { createEventStore } from "../storage/event-store.js";
import type { createRunStore } from "../storage/run-store.js";

export type ReturnTypeOfCreateDeliveryStore = ReturnType<typeof createDeliveryStore>;
export type ReturnTypeOfCreateEventStore = ReturnType<typeof createEventStore>;
export type ReturnTypeOfCreateRunStore = ReturnType<typeof createRunStore>;
