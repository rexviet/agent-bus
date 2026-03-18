import { Ajv, type AnySchema, type ValidateFunction } from "ajv";
import * as AjvFormats from "ajv-formats";

const addFormats = (AjvFormats as unknown as {
  readonly default: (ajv: Ajv) => void;
}).default;

export type SchemaEnforcement = "warn" | "reject";
export type SchemaSource = "manifest" | "programmatic";

export interface SchemaDeclaration {
  readonly enforcement?: SchemaEnforcement;
  readonly schema: unknown;
}

interface StoredSchema {
  readonly enforcement: SchemaEnforcement;
  readonly schema: unknown;
  readonly source: SchemaSource;
  readonly validate: ValidateFunction;
}

export class SchemaRegistry {
  readonly #ajv: Ajv;
  readonly #schemas = new Map<string, StoredSchema>();

  constructor() {
    this.#ajv = new Ajv({
      strict: false,
      strictSchema: false
    });
    addFormats(this.#ajv);
  }

  register(topic: string, declaration: SchemaDeclaration, source: SchemaSource): void {
    const enforcement = declaration.enforcement ?? "warn";
    let validate: ValidateFunction;

    try {
      validate = this.#ajv.compile(declaration.schema as AnySchema);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      throw new Error(`Failed to compile JSON Schema for topic ${topic}: ${detail}`);
    }

    this.#schemas.set(topic, {
      enforcement,
      schema: declaration.schema,
      source,
      validate
    });
  }

  getSchema(topic: string): {
    readonly enforcement: SchemaEnforcement;
    readonly source: SchemaSource;
    readonly validate: ValidateFunction;
  } | undefined {
    const schema = this.#schemas.get(topic);

    if (!schema) {
      return undefined;
    }

    return {
      enforcement: schema.enforcement,
      source: schema.source,
      validate: schema.validate
    };
  }
}
