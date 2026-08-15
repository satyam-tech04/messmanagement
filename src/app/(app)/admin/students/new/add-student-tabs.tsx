"use client";

/**
 * One student, or several.
 *
 * Both forms exist because the two jobs are genuinely different: adding a
 * student who turned up today is a considered entry with a plan and a room;
 * adding fifteen is transcription from a register. Making either do the other's
 * job produces a form that is wrong for both.
 *
 * The single form stays the default — it is the everyday case once the hostel
 * is loaded, and the bulk grid is mainly an intake tool.
 */
import { useState, type ReactNode } from "react";
import { User, Users } from "lucide-react";

export function AddStudentTabs({ single, bulk }: { single: ReactNode; bulk: ReactNode }) {
  const [tab, setTab] = useState<"single" | "bulk">("single");

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="How many students"
        className="bg-muted inline-flex rounded-lg p-1"
      >
        {(
          [
            ["single", "One student", User],
            ["bulk", "Several at once", Users],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Both are mounted-on-demand rather than hidden: two live forms would
          submit two sets of fields, and the inactive one's blank rows would
          arrive in the payload. */}
      {tab === "single" ? single : bulk}
    </div>
  );
}
