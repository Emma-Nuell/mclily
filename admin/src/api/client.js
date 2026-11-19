import axios from 'axios';
import { resolveLocalApi } from '../../vendor/localApi.mjs';

const API_BASE_URL = resolveLocalApi(
  import.meta.env.VITE_API_URL || '/api',
  window.location
);

const api = axios.create({
  adapter: 'fetch',
  fetchOptions: { cache: 'no-store' },
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to handle unauthorized errors smoothly
api.interceptors.response.use(
  (response) => {
    if (
      typeof response.data === 'string' &&
      /^\s*(?:<!doctype\s+html|<html)/i.test(response.data)
    ) {
      const error = new Error(
        'The store connection is unavailable. Please contact the technical administrator.'
      );
      error.code = 'API_RETURNED_HTML';
      error.response = response;
      return Promise.reject(error);
    }
    return response;
  },
  (error) => {
    if (
      error.response?.status === 401 &&
      window.location.pathname !== import.meta.env.BASE_URL + 'login'
    ) {
      // Session expired or unauthenticated
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export default api;
