"use client";

import { isFridayApiError, type Role } from "@friday/sdk";
import { BrandMark, Button, HudPanel, TextField } from "@friday/ui";
import { LogIn, ShieldCheck, User, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useLogin } from "@/lib/api/domains/auth";
import { useSession } from "@/lib/session";

const DEV_ROLES: readonly { role: Role; icon: React.ReactNode }[] = [
  { role: "owner", icon: <ShieldCheck size={16} /> },
  { role: "operator", icon: <User size={16} /> },
  { role: "viewer", icon: <Eye size={16} /> },
];

/**
 * Login page (username + password). With `dataMode: mock` the Control API runs in dev auth mode (fixed identities
 * `dev-owner|operator|viewer`, SECURITY.md), so a role picker is offered in addition; it never appears for hybrid/live.
 */
export function LoginView() {
  const { t, assistantName } = useT();
  const router = useRouter();
  const session = useSession();
  const meta = useMeta();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === "authenticated") router.replace("/");
  }, [session.status, router]);

  const submit = (credentials: { username: string; password: string }): void => {
    setError(null);
    login.mutate(credentials, {
      onSuccess: () => router.replace("/"),
      onError: (failure) => setError(isFridayApiError(failure) && failure.status === 429 ? t("login.rateLimited") : t("login.failed")),
    });
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (username.trim() && password) submit({ username: username.trim(), password });
  };

  return (
    <main className="web-fullscreen jv-bg-stage">
      <HudPanel level={2} glow cut="all" padding="lg" className="web-login" aria-label={t("login.title")}>
        <div className="web-login__brand">
          <BrandMark size={56} />
          <div>
            <h1 className="web-login__title">{assistantName}</h1>
            <p className="web-login__subtitle">{t("brand.subtitle")}</p>
          </div>
        </div>
        <form className="web-form" onSubmit={onSubmit}>
          <TextField label={t("login.username")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          <TextField label={t("login.password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error ? (
            <p className="web-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" icon={<LogIn size={16} />} loading={login.isPending} disabled={!username.trim() || !password}>
            {t("login.submit")}
          </Button>
        </form>
        {meta.data?.dataMode === "mock" ? (
          <section className="web-login__dev" aria-label={t("login.dev.title")}>
            <h2>{t("login.dev.title")}</h2>
            <div className="web-login__roles">
              {DEV_ROLES.map(({ role, icon }) => (
                <Button key={role} variant="ghost" icon={icon} disabled={login.isPending} onClick={() => submit({ username: `dev-${role}`, password: "dev" })}>
                  {t(`role.${role}` as MessageKey)}
                </Button>
              ))}
            </div>
          </section>
        ) : null}
      </HudPanel>
    </main>
  );
}
