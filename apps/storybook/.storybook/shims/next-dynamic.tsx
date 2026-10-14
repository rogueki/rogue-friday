import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';

interface DynamicOptions {
  ssr?: boolean;
  loading?: () => ReactNode;
}

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

/** Minimal `next/dynamic`: `React.lazy` + Suspense with the optional `loading` fallback. */
export default function dynamic<P extends object>(loader: Loader<P>, options: DynamicOptions = {}): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return 'default' in loaded ? loaded : { default: loaded };
  }) as unknown as ComponentType<P>;
  function Dynamic(props: P) {
    return (
      <Suspense fallback={options.loading ? options.loading() : null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Dynamic;
}
