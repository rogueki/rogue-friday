import { createId, createCorrelationId } from "@jarvis/observability";

export { createCorrelationId };
export const newEventId = (): string => createId("evt");
export const newAuditId = (): string => createId("aud");
