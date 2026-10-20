import { mockApi } from './mockApi.js';
import { restApi } from './restApi.js';

const useMock = import.meta.env.VITE_API === 'mock' || import.meta.env.MODE === 'single';

export const api = useMock ? mockApi : restApi;

if (typeof window !== 'undefined') window.api = api;
