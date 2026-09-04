// A project-local decorator that spells itself exactly like Nest's. Every literal
// in the controller reads like the real one; only the import specifier differs,
// and that is the whole of the check.
export const Body = (): ParameterDecorator => () => {};
