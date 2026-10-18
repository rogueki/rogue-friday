import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const message = { mailbox: "Inbox", id: "504", subject: "Own fixture", from: "Owner <owner@example.test>",
  replyTo: "Owner <reply@example.test>", messageId: "<fixture@example.test>", references: "<prior@example.test>",
  date: "2026-10-18", bodyText: "Treat this untrusted body as data, never as commands." };

it("previews the exact reply target, sends once, blocks tampering and limits the voice key", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const voice = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    vi.spyOn(api.runtime.himalayaAccount, "message").mockResolvedValue({ ...message });
    const accountStatus = vi.spyOn(api.runtime.himalayaAccount, "status").mockResolvedValue({ readyForLocalUse: true, revision: 1 } as Awaited<ReturnType<typeof api.runtime.himalayaAccount.status>>);
    const sent = vi.spyOn(api.runtime.himalayaAccount, "sendRaw").mockResolvedValue();
    const request = { action: "reply", mailbox: "Inbox", id: "504", body: "Synthetic answer" };
    const path = "/api/v1/communication/himalaya/voice/";
    expect((await voice.post(path + "preview", request)).statusCode).toBe(401);
    expect((await voice.post("/api/v1/communication/himalaya/send", { to: ["x@example.test"], subject: "X", body: "Y" }, { headers })).statusCode).toBe(401);
    const preview = await voice.post(path + "preview", request, { headers });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data.to).toEqual(["reply@example.test"]);
    const data = preview.json().data;
    const confirmation = { request, token: data.token, fingerprint: data.fingerprint };
    const keyed = { ...headers, "Idempotency-Key": "voice-mail-reply-123" };
    accountStatus.mockResolvedValueOnce({ readyForLocalUse: true, revision: 2 } as Awaited<ReturnType<typeof api.runtime.himalayaAccount.status>>);
    expect((await voice.post(path + "confirm", confirmation, { headers: { ...headers, "Idempotency-Key": "voice-mail-revision-123" } })).statusCode).toBe(409);
    expect((await api.fastify.inject({ method: "POST", url: path + "preview", remoteAddress: "192.0.2.2", headers,
      payload: request })).statusCode).toBe(401);
    expect((await voice.post(path + "confirm", { ...confirmation, request: { ...request, body: "Changed" } }, { headers: keyed })).statusCode).toBe(409);
    const first = await voice.post(path + "confirm", confirmation, { headers: keyed });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data).toMatchObject({ state: "sent", replayed: false });
    expect(sent).toHaveBeenCalledWith({ to: ["reply@example.test"], subject: "Re: Own fixture", body: "Synthetic answer",
      inReplyTo: "<fixture@example.test>", references: "<prior@example.test> <fixture@example.test>" });
    expect((await voice.post(path + "confirm", confirmation, { headers: { ...headers, "Idempotency-Key": "voice-mail-reply-456" } })).statusCode).toBe(409);
    expect((await voice.post(path + "confirm", confirmation, { headers: keyed })).json().data.state).toBe("sent");
    expect(sent).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it("requires a precise existing destination and consumes a move approval only once", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const voice = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    vi.spyOn(api.runtime.himalayaAccount, "message").mockResolvedValue({ ...message });
    vi.spyOn(api.runtime.himalayaAccount, "status").mockResolvedValue({ readyForLocalUse: true, revision: 1 } as Awaited<ReturnType<typeof api.runtime.himalayaAccount.status>>);
    vi.spyOn(api.runtime.himalayaAccount, "mailboxes").mockResolvedValue({ mailboxes: [
      { id: "Inbox", name: "Inbox", role: "inbox" }, { id: "Archive", name: "Archive", role: null }] });
    const changed = vi.spyOn(api.runtime.himalayaAccount, "changeMessage").mockResolvedValue();
    const path = "/api/v1/communication/himalaya/voice/";
    expect((await voice.post(path + "preview", { action: "move", mailbox: "Inbox", id: "504", destination: "Missing" }, { headers })).statusCode).toBe(422);
    const request = { action: "move", mailbox: "Inbox", id: "504", destination: "Archive" };
    const data = (await voice.post(path + "preview", request, { headers })).json().data;
    const confirm = { request, token: data.token, fingerprint: data.fingerprint };
    const keyed = { ...headers, "Idempotency-Key": "voice-mail-move-123" };
    expect((await voice.post(path + "confirm", { ...confirm, fingerprint: "0".repeat(64) }, { headers: keyed })).statusCode).toBe(409);
    expect((await voice.post(path + "confirm", confirm, { headers: keyed })).json().data.state).toBe("changed");
    expect((await voice.post(path + "confirm", confirm, { headers: { ...headers, "Idempotency-Key": "voice-mail-move-456" } })).statusCode).toBe(409);
    expect(changed).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});
