export interface RuntimeLayout {
  readonly placeholder: true;
}

export function createRuntimeLayoutPlaceholder(): RuntimeLayout {
  return { placeholder: true };
}
