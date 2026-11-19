import { useEffect, useState } from 'react';
import api from '../api/client';

export default function useCollection(url) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    rows: [],
    total: 0,
    pages: 1,
    loading: true,
    error: '',
    url: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    api
      .get(url, { signal: controller.signal })
      .then((res) => {
        if (!res.data?.success)
          throw new Error(
            res.data?.message || 'Could not load this information.'
          );
        setState({
          rows: res.data.data || [],
          total: res.data.total ?? res.data.data?.length ?? 0,
          pages: res.data.pages || 1,
          loading: false,
          error: '',
          url,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            rows: [],
            total: 0,
            pages: 1,
            loading: false,
            error:
              error.response?.data?.message ||
              error.message ||
              'Check your connection and try again.',
            url,
          });
      });
    return () => controller.abort();
  }, [url, revision]);
  const current = state.url === url;
  return {
    ...state,
    rows: current ? state.rows : [],
    error: current ? state.error : '',
    loading: state.loading || !current,
    refresh: () => {
      setState((previous) => ({ ...previous, loading: true }));
      setRevision((previous) => previous + 1);
    },
  };
}
