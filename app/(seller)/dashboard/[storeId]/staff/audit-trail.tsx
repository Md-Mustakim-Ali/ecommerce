import { Badge } from "@/components/ui/badge";

type Entry = {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

const ACTION_LABEL: Record<string, string> = {
  "role.create": "created a role",
  "role.update": "edited a role",
  "role.delete": "deleted a role",
  "member.invite": "invited someone",
  "member.remove": "removed someone",
  "member.assign_role": "changed someone's roles",
  "order.cancel": "cancelled an order",
};

/** Pulls the permission or role names out of an audit payload, if any. */
function names(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null) return [];
  const field = (value as Record<string, unknown>)[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string");
}

/**
 * The audit trail.
 *
 * Append-only and never edited, which is the point: when somebody asks who
 * granted refund access, this is the only thing that can answer.
 *
 * Renders the diff rather than the full state. "Added order.refund" is the
 * sentence a person needs; a dump of both permission arrays is not.
 */
export function AuditTrail({ entries }: { entries: Entry[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-medium text-sm">Recent changes</h2>
        <p className="text-secondary-text text-xs">
          Every change to roles and staff, kept permanently.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-border border-dashed px-4 py-6 text-center text-secondary-text text-sm">
          Nothing recorded yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
          {entries.map((entry) => {
            const added = [
              ...names(entry.after, "added"),
              ...names(entry.after, "permissions"),
            ];
            const removed = names(entry.before, "removed");
            const rolesAfter = names(entry.after, "roles");
            const rolesBefore = names(entry.before, "roles");

            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 bg-surface-1 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">
                    <span className="font-medium">
                      {entry.actorEmail ?? "System"}
                    </span>{" "}
                    <span className="text-secondary-text">
                      {ACTION_LABEL[entry.action] ?? entry.action}
                    </span>
                    {entry.targetLabel ? (
                      <span className="font-medium"> {entry.targetLabel}</span>
                    ) : null}
                  </span>

                  {added.length > 0 || removed.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {added.map((key) => (
                        <Badge key={`+${key}`} variant="positive">
                          +{key}
                        </Badge>
                      ))}
                      {removed.map((key) => (
                        <Badge key={`-${key}`} variant="critical">
                          −{key}
                        </Badge>
                      ))}
                    </span>
                  ) : null}

                  {entry.action === "member.assign_role" ? (
                    <span className="text-secondary-text text-xs">
                      {rolesBefore.length > 0 ? rolesBefore.join(", ") : "none"}{" "}
                      → {rolesAfter.length > 0 ? rolesAfter.join(", ") : "none"}
                    </span>
                  ) : null}
                </div>

                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="shrink-0 text-tertiary-text text-xs"
                >
                  {entry.createdAt.toLocaleString()}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
