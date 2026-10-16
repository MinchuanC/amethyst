import type { Backend } from './types';
import { createTauriBackend } from './tauri';
import { createMockBackend } from './mock';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const api: Backend = isTauri ? createTauriBackend() : createMockBackend();

export * from './types';
