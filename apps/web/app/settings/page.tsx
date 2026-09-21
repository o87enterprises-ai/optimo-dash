"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, loadSession, setCsrfToken } from "../../lib/api";
import type { SessionState } from "../../lib/api";

/**
 * Settings — first-run setup, sign-in, and API credential entry.
 *
 * Credentials are write-only from the browser's point of view: the server
 * never returns a stored key, so a saved field shows only its masked tail.
 * Values sourced from the deployment environment are shown read-only, because
 * editing them here would be silently overridden on the next deploy.
 */

type Credential = {
  name: string;
  label: string;
  group: string;
  help: string;
  configured: boolean;
  source: "stored" | "env" | "none";
  masked: string | null;
  updatedAt: string | null;
};

export default function SettingsPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshCredentials = useCallback(async () => {
    try {
      const data = await api<{ encryptionConfigured: boolean; credentials: Credential[] }>(
        "/api/settings/credentials"
      );
      setCredentials(data.credentials);
      setEncryptionConfigured(data.encryptionConfigured);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setCredentials(null);
        return;
      }
      setError((e as Error).message);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const state = await loadSession();
      setSession(state);
      if (state.authenticated) await refreshCredentials();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshCredentials]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!session) {
    return (
      <main className="container">
        <div className="card auth-card">Loading…</div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="header">
        <div>
          <div className="title">Settings</div>
          <div className="subtitle">
            {session.authenticated ? `Signed in as ${session.username}` : "Sign in to manage API keys"}
          </div>
        </div>
        <nav className="nav">
          <a href="/">← Dashboard</a>
          {session.authenticated && (
            <button
              className="secondary"
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" });
                setCsrfToken(null);
                await refresh();
              }}
            >
              Sign out
            </button>
          )}
        </nav>
      </div>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}

      {!session.migrated && <MigrateNotice onDone={refresh} />}

      {session.migrated && !session.setupComplete && <SetupForm onDone={refresh} setError={setError} tokenRequired={session.setupTokenRequired} />}

      {session.migrated && session.setupComplete && !session.authenticated && (
        <LoginForm onDone={refresh} setError={setError} />
      )}

      {session.authenticated && (
        <>
          {!encryptionConfigured && (
            <div className="banner warn">
              <strong>ENCRYPTION_KEY is not set.</strong> Keys cannot be stored until it is. Generate one
              with <code className="mono">openssl rand -base64 32</code>, then set it with{" "}
              <code className="mono">wrangler pages secret put ENCRYPTION_KEY</code> (or add it to{" "}
              <code className="mono">.env</code> when self-hosting) and redeploy.
            </div>
          )}
          <CredentialList
            credentials={credentials}
            disabled={!encryptionConfigured}
            onChanged={async (message) => {
              setNotice(message);
              setError(null);
              await refreshCredentials();
            }}
            setError={setError}
          />
        </>
      )}
    </main>
  );
}

/** Shown on a fresh deployment whose D1 database has no tables yet. */
function MigrateNotice({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card auth-card stack">
      <div>
        <div className="cred-name">Initialise the database</div>
        <div className="hint">
          This deployment&apos;s database has no tables yet. Running the migration creates them. It is safe
          to run more than once.
        </div>
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api("/api/admin/migrate", { method: "POST" });
          await onDone();
          setBusy(false);
        }}
      >
        {busy ? "Running…" : "Run migration"}
      </button>
    </div>
  );
}

function SetupForm({
  onDone,
  setError,
  tokenRequired,
}: {
  onDone: () => Promise<void>;
  setError: (m: string | null) => void;
  tokenRequired: boolean;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card auth-card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (password !== confirm) return setError("passwords do not match");
        setBusy(true);
        try {
          await api("/api/auth/setup", {
            method: "POST",
            body: JSON.stringify({ username, password, setupToken: setupToken || undefined }),
          });
          await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <div className="cred-name">Create the admin account</div>
        <div className="hint">
          This dashboard stores live API keys, so it is protected by a password. Only one account can be
          created — this form stops working afterwards.
        </div>
      </div>
      <div>
        <label htmlFor="su-user">Username</label>
        <input id="su-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </div>
      <div>
        <label htmlFor="su-pass">Password</label>
        <input
          id="su-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
        <div className="hint">At least 12 characters. A passphrase is easier to remember and stronger.</div>
      </div>
      <div>
        <label htmlFor="su-confirm">Confirm password</label>
        <input
          id="su-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      {tokenRequired && (
        <div>
          <label htmlFor="su-token">Setup token</label>
          <input
            id="su-token"
            type="password"
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            autoComplete="off"
            required
          />
          <div className="hint">
            The value of <span className="mono">SETUP_TOKEN</span> in this deployment. It stops anyone
            else claiming the account before you do.
          </div>
        </div>
      )}
      <button disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
    </form>
  );
}

function LoginForm({
  onDone,
  setError,
}: {
  onDone: () => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card auth-card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const res = await api<{ csrfToken: string }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
          });
          setCsrfToken(res.csrfToken);
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="cred-name">Sign in</div>
      <div>
        <label htmlFor="li-user">Username</label>
        <input id="li-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      </div>
      <div>
        <label htmlFor="li-pass">Password</label>
        <input
          id="li-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function CredentialList({
  credentials,
  disabled,
  onChanged,
  setError,
}: {
  credentials: Credential[] | null;
  disabled: boolean;
  onChanged: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  if (!credentials) return <div className="card">Loading credentials…</div>;

  const groups = credentials.reduce<Record<string, Credential[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});

  return (
    <>
      <div className="banner">
        Keys are encrypted before they are stored and are never sent back to this page — a saved key shows
        only its last four characters. Adding a key enables its connector immediately, with no redeploy.
      </div>
      {Object.entries(groups).map(([group, items]) => (
        <section key={group}>
          <div className="section-title">{group}</div>
          <div className="card">
            {items.map((credential) => (
              <CredentialRow
                key={credential.name}
                credential={credential}
                disabled={disabled}
                onChanged={onChanged}
                setError={setError}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function CredentialRow({
  credential,
  disabled,
  onChanged,
  setError,
}: {
  credential: Credential;
  disabled: boolean;
  onChanged: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  // The Search Console credential is a JSON document, not a single-line key.
  const multiline = credential.name === "GOOGLE_SEARCH_CONSOLE_CREDENTIALS";
  const fromEnv = credential.source === "env";

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/settings/credentials/${credential.name}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      // Drop the plaintext from component state as soon as it is stored.
      setValue("");
      setEditing(false);
      await onChanged(`${credential.label} saved.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove the ${credential.label} key? Its connector will stop working.`)) return;
    setBusy(true);
    try {
      await api(`/api/settings/credentials/${credential.name}`, { method: "DELETE" });
      await onChanged(`${credential.label} removed.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cred">
      <div className="cred-head">
        <div>
          <div className="cred-name">{credential.label}</div>
          <div className="hint">
            {credential.help} <span className="mono">{credential.name}</span>
          </div>
        </div>
        <div className="row">
          {credential.configured && (
            <span className={`pill ${fromEnv ? "env" : "ok"}`}>
              {fromEnv ? "from environment" : `saved ${credential.masked}`}
            </span>
          )}
          {!credential.configured && <span className="pill">not set</span>}
          {!fromEnv && !editing && (
            <button className="secondary" disabled={disabled || busy} onClick={() => setEditing(true)}>
              {credential.configured ? "Replace" : "Add key"}
            </button>
          )}
          {!fromEnv && credential.source === "stored" && !editing && (
            <button className="danger" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>

      {fromEnv && (
        <div className="hint">
          Set by the deployment environment, so it cannot be edited here. Remove it from your environment
          to manage it from this page.
        </div>
      )}

      {editing && (
        <div className="stack" style={{ marginTop: 12 }}>
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='{"type":"service_account","client_email":"…","private_key":"—–BEGIN PRIVATE KEY—–…"}'
              spellCheck={false}
              aria-label={`${credential.label} credential JSON`}
            />
          ) : (
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the key"
              autoComplete="off"
              spellCheck={false}
              aria-label={`${credential.label} key`}
            />
          )}
          <div className="row">
            <button disabled={busy || !value.trim()} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setValue("");
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
