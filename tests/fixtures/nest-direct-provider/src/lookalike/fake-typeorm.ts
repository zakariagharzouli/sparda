// Local decorators and a local module factory that SHARE THE NAMES of the
// official ones and have nothing to do with them. A name is not a provenance.
export function InjectRepository(_entity: unknown): ParameterDecorator {
  return () => undefined;
}

export const TypeOrmModule = {
  forFeature(_entities: unknown[]) {
    return { module: class LocalFeature {} };
  },
};
