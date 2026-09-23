import { request } from './request';

export type UpdateInfo = { available: boolean; current: string | null; latest: string | null; supported: boolean; version: string; error?: string };
export const checkUpdate = () => request<UpdateInfo>('/api/system/update');
export const performUpdate = () => request<{ updated: boolean }>('/api/system/update', { method: 'POST' });
