import * as path from "node:path";
import { readFile } from "node:fs/promises";

import { parseEventEnvelope, type EventEnvelope } from "../domain/event-envelope.js";

export async function loadEventEnvelopeFromFile(
  envelopePath: string,
  cwd: string
): Promise<EventEnvelope> {
  const absolutePath = path.resolve(cwd, envelopePath);
  const envelopeText = await readFile(absolutePath, "utf8");

  return parseEventEnvelope(JSON.parse(envelopeText));
}
