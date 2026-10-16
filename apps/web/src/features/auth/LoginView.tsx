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
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === "authenticated") router.replace("/");
  }, [session.status, router]);

  const setupRequired = session.session?.setupRequired === true;

  const submit = (credentials: { username: string; password: string; rememberMe?: boolean; displayName?: string }): void => {
    setError(null);
    login.mutate(credentials, {
      onSuccess: () => router.replace("/"),
      onError: (failure) => setError(isFridayApiError(failure) && failure.status === 429 ? t("login.rateLimited") :
        setupRequired && isFridayApiError(failure) && failure.status === 422 ? t("login.setupInvalid") : t("login.failed")),
    });
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (setupRequired && (displayName.trim().length === 0 || password.length < 12 || password !== passwordConfirm)) {
      setError(t("login.setupInvalid"));
      return;
    }
    if (username.trim() && password) submit({ username: username.trim(), password, rememberMe, ...(setupRequired ? { displayName: displayName.trim() } : {}) });
  };

  return (
    <main className="web-fullscreen jv-bg-stage">
      <HudPanel level={2} glow cut="all" padding="lg" className="web-login" aria-label={t("login.title")}>
        <div className="web-login__brand">
          <BrandMark size={56} />
          <div>
            <h1 className="web-login__title">{setupRequired ? t("login.setupTitle") : assistantName}</h1>
            <p className="web-login__subtitle">{setupRequired ? t("login.setupDesc") : t("brand.subtitle")}</p>
          </div>
        </div>
        <form className="web-form" onSubmit={onSubmit}>
          {setupRequired ? <TextField label={t("login.displayName")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" autoFocus /> : null}
          <TextField label={t("login.username")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus={!setupRequired} />
          <TextField label={t("login.password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupRequired ? "new-password" : "current-password"} />
          {setupRequired ? <TextField label={t("login.passwordConfirm")} type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" /> : null}
          <label className="web-login__remember">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            <span>{t("login.rememberMe")}</span>
          </label>
          {error ? (
            <p className="web-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" icon={<LogIn size={16} />} loading={login.isPending} disabled={!username.trim() || !password}>
            {t(setupRequired ? "login.setupSubmit" : "login.submit")}
          </Button>
        </form>
        {meta.data?.dataMode === "mock" && !setupRequired ? (
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
