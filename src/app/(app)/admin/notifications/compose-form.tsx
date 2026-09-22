"use client";

/**
 * Writing and sending a notification.
 *
 * Two things this screen owes the admin, because a send cannot be undone:
 *
 *   * **A preview.** What it will look like on a lock screen, with the mess's
 *     name in front, as they type.
 *   * **An honest count.** "Send to 240 of 312 students" — the gap is students
 *     with no app installed or announcements switched off, and it is better
 *     seen before sending than wondered about after.
 */
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bell, Loader2, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NotificationRecipientRow } from "@/infra/queries/notification-recipients";
import { sendManualNotification, type SendNotificationState } from "./actions";

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Sending…
        </>
      ) : (
        <>
          <Send className="size-4" aria-hidden="true" />
          {count === 0 ? "Nobody to send to" : `Send to ${count} student${count === 1 ? "" : "s"}`}
        </>
      )}
    </Button>
  );
}

export function ComposeForm({
  rows,
  tenantName,
}: {
  rows: readonly NotificationRecipientRow[];
  tenantName: string;
}) {
  const [state, formAction] = useActionState<SendNotificationState, FormData>(
    sendManualNotification,
    {},
  );

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [everyone, setEveryone] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");

  const reachable = useMemo(() => rows.filter((r) => r.deviceCount > 0 && !r.muted), [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.fullName.toLowerCase().includes(term) || r.rollNumber.toLowerCase().includes(term),
    );
  }, [rows, search]);

  // What will actually be delivered, not what was ticked. A student with no
  // app cannot receive this however firmly they are selected.
  const count = everyone
    ? reachable.length
    : reachable.filter((r) => selected.has(r.profileId)).length;

  function toggle(profileId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="audience" value={everyone ? "ALL" : "SELECTED"} />
      {!everyone &&
        [...selected].map((id) => <input key={id} type="hidden" name="profileIds" value={id} />)}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Water supply interrupted"
            />
            <p className="text-muted-foreground text-xs">{80 - title.length} characters left</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <textarea
              id="body"
              name="body"
              required
              maxLength={500}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dinner is delayed to 8pm today."
              className="border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
            />
            <p className="text-muted-foreground text-xs">{500 - body.length} characters left</p>
          </div>
        </div>

        {/* The lock screen, as the student will see it. */}
        <div className="space-y-2">
          <Label>Preview</Label>
          <div className="bg-muted/40 rounded-xl border p-4">
            <div className="bg-background flex gap-3 rounded-lg border p-3 shadow-sm">
              <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Bell className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {tenantName} · {title || "Title"}
                </p>
                <p className="text-muted-foreground line-clamp-2 text-sm">
                  {body || "Your message appears here."}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Students who have switched announcements off in the app will not receive this.
            </p>
          </div>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Who gets it</legend>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={everyone ? "default" : "outline"}
            onClick={() => setEveryone(true)}
          >
            Everyone ({reachable.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={everyone ? "outline" : "default"}
            onClick={() => setEveryone(false)}
          >
            Choose students
          </Button>
        </div>

        {!everyone ? (
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or roll number"
                className="pl-9"
                aria-label="Search students"
              />
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border">
              {visible.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">No student matches “{search}”.</p>
              ) : (
                <ul className="divide-y">
                  {visible.map((row) => {
                    const unreachable = row.deviceCount === 0 || row.muted;
                    return (
                      <li key={row.profileId}>
                        <label className="flex cursor-pointer items-center gap-3 p-3 text-sm">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={selected.has(row.profileId)}
                            onChange={() => toggle(row.profileId)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{row.fullName}</span>
                            <span className="text-muted-foreground block font-mono text-xs">
                              {row.rollNumber}
                            </span>
                          </span>
                          {unreachable ? (
                            <span className="text-muted-foreground text-xs">
                              {row.muted ? "muted" : "no app"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {row.deviceCount} device{row.deviceCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="text-muted-foreground text-xs">
              {selected.size} selected, {count} will receive it.
            </p>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SendButton count={count} />

        {state.error ? (
          <span role="alert" className="text-destructive text-sm">
            {state.error}
          </span>
        ) : null}
        {state.success ? (
          <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {state.success}
          </span>
        ) : null}
      </div>
    </form>
  );
}
