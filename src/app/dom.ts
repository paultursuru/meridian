import type { initAutocomplete } from '../lib/autocomplete.js';

export const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const input = (id: string) => el<HTMLInputElement>(id);
export const button = (id: string) => el<HTMLButtonElement>(id);

export type Role = 'start' | 'end';
export type Autocomplete = ReturnType<typeof initAutocomplete>;
export type Place = Parameters<Autocomplete['setPlace']>[0];
