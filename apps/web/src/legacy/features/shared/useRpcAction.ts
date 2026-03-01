import { useCallback } from 'react';

type UseRpcActionOptions = {
  formatError: (err: unknown) => string;
  setError: (message: string) => void;
};

export function useRpcAction({ formatError, setError }: UseRpcActionOptions) {
  const runAction = useCallback(
    async <T>(action: () => Promise<T>, onError?: (message: string, err: unknown) => void): Promise<T | undefined> => {
      try {
        return await action();
      } catch (err) {
        const message = formatError(err);
        setError(message);
        onError?.(message, err);
        return undefined;
      }
    },
    [formatError, setError]
  );

  return { runAction };
}
