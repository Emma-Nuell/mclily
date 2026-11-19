import axios from 'axios';
import { resolveLocalApi } from '../../vendor/localApi.mjs';

const API_BASE_URL = resolveLocalApi(
  import.meta.env.VITE_API_URL || '/api',
  window.location
);

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to handle unauthorized errors smoothly
api.interceptors.response.use(
  (response) => response,
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
