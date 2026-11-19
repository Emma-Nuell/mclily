import { useEffect, useState } from 'react';
import api from '../api/client';

export default function useApiData(url, revision = 0) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState(null);
  const key = JSON.stringify([url, revision, retry]);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api
      .get(url, { signal: controller.signal })
      .then(({ data }) => {
        if (!data?.success)
          throw new Error('The server did not confirm this information.');
        setState({ key, response: data, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            response: null,
            error:
              error.response?.data?.message ||
              error.message ||
              'Check your connection and try again.',
          });
      });
    return () => controller.abort();
  }, [url, key]);
  const current = state?.key === key;
  return {
    response: current ? state.response : null,
    data: current ? state.response?.data : null,
    error: current ? state.error : '',
    loading: Boolean(url) && !current,
    refresh: () => setRetry((value) => value + 1),
  };
}
