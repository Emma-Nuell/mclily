import axios from 'axios';
import { markApiReachable } from '../pwa/client';
import { resolveLocalApi } from '../../vendor/localApi.mjs';

const api = axios.create({
  // Bypass the browser HTTP cache too; only explicit public catalog snapshots may be reused.
  adapter: 'fetch',
  fetchOptions: { cache: 'no-store' },
  baseURL: resolveLocalApi(import.meta.env.VITE_API_URL || '/api', window.location),
  withCredentials: true, // Enables HttpOnly cookie transmission
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const error = new Error(
      'You’re offline. Connect to check current availability, sign in or pay. Your bag stays saved.'
    );
    error.code = 'OFFLINE';
    return Promise.reject(error);
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    markApiReachable(true);
    return response;
  },
  (error) => {
    if (error.response) markApiReachable(true);
    else if (error.code !== 'ERR_CANCELED') markApiReachable(false);
    const customMessage =
      error.response?.data?.message || error.message || 'Something went wrong';
    error.message = customMessage;
    return Promise.reject(error);
  }
);

export default api;
