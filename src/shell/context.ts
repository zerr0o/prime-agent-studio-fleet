import { createContext, useContext } from 'react';

export type ShellValue = { openMenu(): void; closeMenu(): void; phone: boolean };

export const ShellContext = createContext<ShellValue>({ openMenu() {}, closeMenu() {}, phone: false });
export const useShell = () => useContext(ShellContext);
