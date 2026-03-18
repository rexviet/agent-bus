export class EventSchemaValidationError extends Error {
  readonly topic: string;
  readonly issue: string;
  readonly code = "SCHEMA_VALIDATION_FAILED" as const;

  constructor(topic: string, issue: string) {
    super(`Schema validation failed for topic ${topic}: ${issue}`);
    this.name = "EventSchemaValidationError";
    this.topic = topic;
    this.issue = issue;
  }
}
