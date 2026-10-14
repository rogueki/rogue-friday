import type { SecretStatus } from "@jarvis/sdk";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SchemaForm } from "./SchemaForm";
import { validateConfig, type FieldSchema } from "./schemaLogic";

const SCHEMA: FieldSchema = {
  type: "object",
  required: ["host"],
  properties: {
    host: { type: "string", title: "Server", description: "Hostname des Dienstes" },
    port: { type: "integer", title: "Port", minimum: 1, maximum: 65535 },
    tls: { type: "boolean", title: "TLS verwenden" },
    mode: { type: "string", title: "Modus", enum: ["push", "pull"] },
    limits: { type: "object", title: "Grenzen", properties: { maxItems: { type: "integer", title: "Maximale Einträge" } } },
    folders: { type: "array", title: "Ordner", items: { type: "string" } },
    password: { type: "string", format: "password", title: "Passwort", writeOnly: true },
  },
};

function Harness({ initial, status, onSecrets }: { initial: Record<string, unknown>; status: Record<string, SecretStatus>; onSecrets?: (value: Record<string, string>) => void }) {
  const [value, setValue] = useState(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  return (
    <SchemaForm
      schema={SCHEMA}
      value={value}
      onChange={setValue}
      secretStatus={status}
      secretInput={secrets}
      onSecretChange={(name, next) => {
        const merged = { ...secrets, [name]: next };
        setSecrets(merged);
        onSecrets?.(merged);
      }}
      errors={validateConfig(SCHEMA, value, new Set(Object.keys(status)))}
    />
  );
}

describe("SchemaForm", () => {
  it("renders a control for every supported type", () => {
    render(<Harness initial={{ host: "imap.example", port: 993, tls: true, mode: "pull", limits: { maxItems: 5 }, folders: ["INBOX"] }} status={{ password: { configured: true } }} />);
    expect(screen.getByLabelText(/^Server/)).toHaveValue("imap.example");
    expect(screen.getByLabelText("Port")).toHaveValue(993);
    expect(screen.getByRole("switch", { name: "TLS verwenden" })).toBeChecked();
    expect(screen.getByLabelText("Modus")).toHaveValue("pull");
    expect(within(screen.getByLabelText("Modus")).getAllByRole("option").map((o) => o.textContent)).toEqual(["push", "pull"]);
    expect(screen.getByRole("group", { name: "Grenzen" }) ?? screen.getByText("Grenzen")).toBeTruthy();
    expect(screen.getByLabelText("Maximale Einträge")).toHaveValue(5);
    expect(screen.getByText("INBOX")).toBeInTheDocument();
  });

  it("edits values, adds list entries and validates ranges", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ host: "x", port: 80 }} status={{}} />);
    await user.clear(screen.getByLabelText("Port"));
    await user.type(screen.getByLabelText("Port"), "70000");
    expect(await screen.findByText("Höchstens 65535")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "TLS verwenden" }));
    expect(screen.getByRole("switch", { name: "TLS verwenden" })).toBeChecked();
    await user.type(screen.getByRole("textbox", { name: "Hinzufügen" }), "Archiv{Enter}");
    expect(screen.getByText("Archiv")).toBeInTheDocument();
  });

  it("masks secrets: shows set / not set, never the value, and keeps typed input write-only", async () => {
    const user = userEvent.setup();
    const seen: Record<string, string>[] = [];
    // The server never sends a secret value; even if one leaked into `value`, the form must not display it.
    const { container, rerender } = render(<Harness initial={{ host: "h", password: "LEAKED-SECRET" }} status={{ password: { configured: true, maskedHint: "••••••" } }} onSecrets={(v) => seen.push(v)} />);
    const field = container.querySelector('[data-secret-field="password"]') as HTMLElement;
    expect(within(field).getByText("gesetzt")).toBeInTheDocument();
    const input = within(field).getByLabelText("Neuer Wert für Passwort") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input).toHaveValue("");
    expect(container.innerHTML).not.toContain("LEAKED-SECRET");
    await user.type(input, "neu-geheim");
    expect(seen.at(-1)).toEqual({ password: "neu-geheim" });
    rerender(<Harness initial={{ host: "h" }} status={{ password: { configured: false } }} />);
    const unset = container.querySelector('[data-secret-field="password"]') as HTMLElement;
    expect(within(unset).getByText("nicht gesetzt")).toBeInTheDocument();
  });
});
