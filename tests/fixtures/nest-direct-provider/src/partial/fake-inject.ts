// A local `InjectRepository` under a module whose FACTORY is the official one.
// The earlier checks all pass here, so this is the only fixture in which the
// decorator's own provenance is the deciding step.
export function InjectRepository(_entity: unknown): ParameterDecorator {
  return () => undefined;
}
