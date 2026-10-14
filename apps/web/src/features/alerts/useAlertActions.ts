"use client";

import type { Notification } from "@jarvis/sdk";
import { useRouter } from "next/navigation";
import { useAcknowledgeNotification, useResolveNotification, useSnoozeNotification } from "@/lib/api/domains/notifications";
import { useCapability, useCapabilityState, type CapabilityState } from "@/lib/capabilities";

export interface AlertActions {
  can: { acknowledge: boolean; snooze: boolean; resolve: boolean };
  /** `read-only` when the module can be read but not acted on (shows "Lesen verfügbar"). */
  writeState: CapabilityState;
  pending: boolean;
  acknowledge: (notification: Notification) => void;
  snooze: (notification: Notification, durationMinutes: number, onDone?: () => void) => void;
  resolve: (notification: Notification, onDone?: () => void) => void;
  openSource: (notification: Notification) => void;
}

/** All state changes of an alert (PLAN §39.2) with their capability gates; each call carries the version the user saw (If-Match). */
export function useAlertActions(): AlertActions {
  const router = useRouter();
  const ack = useAcknowledgeNotification();
  const snoozeMutation = useSnoozeNotification();
  const resolveMutation = useResolveNotification();
  const can = {
    acknowledge: useCapability("notifications", "acknowledge"),
    snooze: useCapability("notifications", "snooze"),
    resolve: useCapability("notifications", "resolve"),
  };
  const acknowledgeState = useCapabilityState("notifications", "acknowledge");
  return {
    can,
    writeState: can.acknowledge && can.snooze && can.resolve ? "available" : acknowledgeState === "missing" ? "missing" : "read-only",
    pending: ack.isPending || snoozeMutation.isPending || resolveMutation.isPending,
    acknowledge: (notification) => ack.mutate({ id: notification.id, version: notification.version }),
    snooze: (notification, durationMinutes, onDone) =>
      snoozeMutation.mutate({ id: notification.id, version: notification.version, durationMinutes }, { onSuccess: onDone }),
    resolve: (notification, onDone) => resolveMutation.mutate({ id: notification.id, version: notification.version }, { onSuccess: onDone }),
    openSource: (notification) => {
      if (notification.targetRoute) router.push(notification.targetRoute);
    },
  };
}
