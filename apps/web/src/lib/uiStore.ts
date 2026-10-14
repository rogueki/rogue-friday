"use client";

import { create } from "zustand";

/** Cross-feature UI state: global overlays that several features open (orb click, top bar, shortcuts). */
interface UiStore {
  paletteOpen: boolean;
  notificationsOpen: boolean;
  activityDrawerOpen: boolean;
  errorDetailOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setNotificationsOpen: (open: boolean) => void;
  setActivityDrawerOpen: (open: boolean) => void;
  setErrorDetailOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  paletteOpen: false,
  notificationsOpen: false,
  activityDrawerOpen: false,
  errorDetailOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
  setActivityDrawerOpen: (activityDrawerOpen) => set({ activityDrawerOpen }),
  setErrorDetailOpen: (errorDetailOpen) => set({ errorDetailOpen }),
}));
