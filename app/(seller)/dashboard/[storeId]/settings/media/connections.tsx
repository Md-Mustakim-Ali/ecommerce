"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  HardDrive,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  addGoogleProjectAction,
  type ConnectionOverview,
  removeGoogleAccountAction,
  removeGoogleProjectAction,
  startAccountConnectionAction,
} from "@/lib/actions/google-connections";
import { uploadsRemaining, YOUTUBE_COST } from "@/lib/media/quota";

/**
 * The two pools, and the pairings between them.
 *
 * The hardest thing to communicate here is why there are two lists at all, so
 * the page states it plainly rather than assuming a shop owner will infer it:
 * a Cloud project is a daily video allowance, an account is where files live,
 * and an upload needs one of each that have been introduced.
 */

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

const PROJECT_STATE_LABEL: Record<string, string> = {
  active: "Ready",
  quota_exhausted: "Out of quota today",
  invalid: "Credentials rejected",
  disabled: "Switched off",
};

const ACCOUNT_STATE_LABEL: Record<string, string> = {
  active: "Ready",
  storage_full: "Drive full",
  rate_limited: "Rate limited",
  revoked: "Access withdrawn",
  disabled: "Switched off",
};

export function MediaConnections({
  storeId,
  overview,
  connectedEmail,
  callbackError,
  redirectUri,
}: {
  storeId: string;
  overview: ConnectionOverview;
  connectedEmail: string | null;
  callbackError: string | null;
  /**
   * Resolved on the server, not from window.location.
   *
   * Branching on `typeof window` here renders one string during SSR and a
   * different one on hydration, which React reports as a hydration failure and
   * then discards the whole subtree — so the seller could be shown a redirect
   * URI that does not match what the callback route actually expects.
   */
  redirectUri: string;
}) {
  const [pending, startTransition] = useTransition();
  const [showGuide, setShowGuide] = useState(overview.projects.length === 0);
  const [form, setForm] = useState({
    label: "",
    clientId: "",
    clientSecret: "",
  });

  const now = new Date();

  const grantsByPair = new Set(
    overview.grants
      .filter((grant) => grant.state === "active")
      .map((grant) => `${grant.projectId}:${grant.accountId}`),
  );

  // Summed per project, never per grant. Four accounts sharing one project
  // share one allowance, and showing 4 × 6 there would be a straightforward
  // lie about what the seller can do today.
  const dailyUploads = overview.projects
    .filter(
      (project) => project.state !== "disabled" && project.state !== "invalid",
    )
    .reduce(
      (total, project) =>
        total +
        uploadsRemaining(
          {
            unitsUsed: project.unitsUsed,
            dailyUnitLimit: project.dailyUnitLimit,
            unitsResetAt: project.unitsResetAt,
          },
          now,
        ),
      0,
    );

  function addProject() {
    startTransition(async () => {
      const result = await addGoogleProjectAction({ storeId, ...form });
      if (result.ok) {
        setForm({ label: "", clientId: "", clientSecret: "" });
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  function connectAccount(projectId: string) {
    startTransition(async () => {
      const result = await startAccountConnectionAction({ storeId, projectId });
      if (result.ok && result.redirectUrl) {
        window.location.href = result.redirectUrl;
      } else {
        toast.error(result.message);
      }
    });
  }

  function removeProject(projectId: string) {
    startTransition(async () => {
      const result = await removeGoogleProjectAction({ storeId, projectId });
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  function removeAccount(accountId: string, email: string) {
    // Only the account that uploaded a file can serve it, so disconnecting one
    // takes its media down with it. That has to be said before the click, not
    // reported after.
    if (
      !window.confirm(
        `Disconnect ${email}? Any product photos or videos stored on this account will stop being shown.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removeGoogleAccountAction({ storeId, accountId });
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {connectedEmail ? (
        <p className="flex items-center gap-2 rounded-md border border-positive/30 bg-positive-muted px-3 py-2 text-sm">
          <Check className="h-4 w-4" />
          Connected {connectedEmail}.
        </p>
      ) : null}

      {callbackError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-muted px-3 py-2 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {callbackError}
        </p>
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm">
          <strong>{dailyUploads}</strong> video upload
          {dailyUploads === 1 ? "" : "s"} left today across{" "}
          {overview.projects.length} project
          {overview.projects.length === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          Each upload costs {YOUTUBE_COST.videosInsert.toLocaleString()} of a
          project&rsquo;s 10,000 daily units, and the allowance belongs to the
          project rather than the account — so adding more accounts to one
          project does not add uploads. Pasting a YouTube link instead of
          uploading costs 1 unit.
        </p>
      </div>

      {/* ── Projects ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">Cloud projects</h2>
          <button
            type="button"
            onClick={() => setShowGuide((open) => !open)}
            className="flex items-center gap-1 text-accent-text text-xs hover:underline"
          >
            How do I get these?
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showGuide ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {showGuide ? (
          <ol className="flex list-decimal flex-col gap-1.5 rounded-md bg-muted p-4 pl-8 text-sm">
            <li>
              Open{" "}
              <a
                href="https://console.cloud.google.com/projectcreate"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text underline"
              >
                Google Cloud Console
              </a>{" "}
              and create a project.
            </li>
            <li>
              Enable the <strong>YouTube Data API v3</strong> and the{" "}
              <strong>Google Drive API</strong>.
            </li>
            <li>
              Configure the OAuth consent screen as <strong>External</strong>,
              and add yourself as a test user.
            </li>
            <li>
              Create an <strong>OAuth client ID</strong> of type{" "}
              <strong>Web application</strong>.
            </li>
            <li>
              Add this exact authorised redirect URI:
              <code className="mt-1 block rounded bg-background px-2 py-1 text-xs">
                {redirectUri}
              </code>
            </li>
            <li>Paste the client ID and secret below.</li>
          </ol>
        ) : null}

        {overview.projects.map((project) => {
          const remaining = uploadsRemaining(
            {
              unitsUsed: project.unitsUsed,
              dailyUnitLimit: project.dailyUnitLimit,
              unitsResetAt: project.unitsResetAt,
            },
            now,
          );

          return (
            <div
              key={project.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{project.label}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {project.clientId}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      project.state === "active" ? "positive" : "critical"
                    }
                  >
                    {PROJECT_STATE_LABEL[project.state] ?? project.state}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => removeProject(project.id)}
                    disabled={pending}
                    aria-label={`Remove ${project.label}`}
                    className="rounded p-1.5 text-muted-foreground hover:text-critical"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <p className="text-muted-foreground text-xs">
                {remaining} upload{remaining === 1 ? "" : "s"} left today ·
                resets {project.unitsResetAt.toLocaleString()}
              </p>

              {project.lastError ? (
                <p className="text-critical text-xs">{project.lastError}</p>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                disabled={pending}
                onClick={() => connectAccount(project.id)}
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect a Google account through this project
              </Button>
            </div>
          );
        })}

        <div className="flex flex-col gap-3 rounded-lg border border-border border-dashed p-4">
          <p className="font-medium text-sm">Add a project</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-label">Name</Label>
            <Input
              id="project-label"
              value={form.label}
              onChange={(event) =>
                setForm({ ...form, label: event.target.value })
              }
              placeholder="My shop's project"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-client-id">Client ID</Label>
            <Input
              id="project-client-id"
              value={form.clientId}
              onChange={(event) =>
                setForm({ ...form, clientId: event.target.value })
              }
              placeholder="…apps.googleusercontent.com"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-client-secret">Client secret</Label>
            <Input
              id="project-client-secret"
              type="password"
              value={form.clientSecret}
              onChange={(event) =>
                setForm({ ...form, clientSecret: event.target.value })
              }
              placeholder="GOCSPX-…"
            />
            <p className="text-muted-foreground text-xs">
              Encrypted before it is stored, and never shown again.
            </p>
          </div>
          <Button
            type="button"
            className="w-fit gap-1.5"
            disabled={
              pending || !form.label || !form.clientId || !form.clientSecret
            }
            onClick={addProject}
          >
            <Plus className="h-4 w-4" />
            Add project
          </Button>
        </div>
      </section>

      <Separator />

      {/* ── Accounts ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Google accounts</h2>

        {overview.accounts.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed p-4 text-muted-foreground text-sm">
            No accounts yet. Add a project above, then connect an account
            through it.
          </p>
        ) : null}

        {overview.accounts.map((account, index) => (
          <div
            key={account.id}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{account.email}</p>
                <p className="flex items-center gap-1 text-muted-foreground text-xs">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(account.storageUsageBytes)} of{" "}
                  {formatBytes(account.storageLimitBytes)} used
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {index === 0 ? <Badge variant="outline">Primary</Badge> : null}
                <Badge
                  variant={account.state === "active" ? "positive" : "critical"}
                >
                  {ACCOUNT_STATE_LABEL[account.state] ?? account.state}
                </Badge>
                <button
                  type="button"
                  onClick={() => removeAccount(account.id, account.email)}
                  disabled={pending}
                  aria-label={`Disconnect ${account.email}`}
                  className="rounded p-1.5 text-muted-foreground hover:text-critical"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {account.lastError ? (
              <p className="text-critical text-xs">{account.lastError}</p>
            ) : null}

            {/*
              Coverage, spelled out. An account only works with the projects it
              has actually been authorised through — a refresh token issued by
              one project is rejected by another — so a seller with gaps here
              has less failover than the two lists suggest.
            */}
            {overview.projects.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Authorised via:</span>
                {overview.projects.map((project) => {
                  const linked = grantsByPair.has(
                    `${project.id}:${account.id}`,
                  );
                  return linked ? (
                    <Badge key={project.id} variant="neutral">
                      {project.label}
                    </Badge>
                  ) : (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => connectAccount(project.id)}
                      disabled={pending}
                      className="rounded border border-border border-dashed px-2 py-0.5 text-muted-foreground hover:border-accent hover:text-accent-text"
                    >
                      + {project.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}

        <p className="text-muted-foreground text-xs">
          The first account is used until it runs out of space or hits a limit,
          then the next one takes over. Videos go to whichever account&rsquo;s
          channel was used, so keeping your main account first keeps them
          together.
        </p>
      </section>
    </div>
  );
}
