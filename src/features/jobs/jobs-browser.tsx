"use client";

import { useEffect, useRef, useState } from "react";

import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import type { HermesJob, JobsSnapshot } from "@/contracts/cockpit";
import { cn } from "@/lib/cn";
import { formatShanghaiTime } from "@/lib/time";

function stateStatus(state: HermesJob["state"]): "ready" | "paused" | "completed" | "running" {
  return state === "enabled" ? "ready" : state;
}

function lastRunLabel(job: HermesJob): string {
  return job.lastRun ? formatShanghaiTime(job.lastRun) : "Never";
}

function nextRunLabel(job: HermesJob): string {
  if (job.nextRun) return formatShanghaiTime(job.nextRun);
  if (job.state === "paused") return "Paused";
  if (job.state === "completed") return "Completed";
  return "Not scheduled";
}

function createdAtLabel(job: HermesJob): string {
  return job.createdAt ? formatShanghaiTime(job.createdAt) : "Unavailable";
}

function resultLabel(job: HermesJob): string | undefined {
  return job.lastStatus === "failed" && job.failureStreak > 0
    ? `failed ×${job.failureStreak}`
    : undefined;
}

function finishedAtLabel(execution: HermesJob["executions"][number]): string {
  if (execution.finishedAt) return `Finished ${formatShanghaiTime(execution.finishedAt)}`;
  return execution.status === "running" ? "In progress" : "Finish time unavailable";
}

export function JobsBrowser({
  definitionsState = "ready",
  executionsState = "ready",
  failure,
  jobs,
}: {
  definitionsState?: JobsSnapshot["definitionsState"];
  executionsState?: JobsSnapshot["executionsState"];
  failure?: string | undefined;
  jobs: HermesJob[];
}) {
  const first = jobs[0];
  const [selectedId, setSelectedId] = useState(first?.id ?? "");
  const detailRef = useRef<HTMLDivElement>(null);
  const shouldRevealDetail = useRef(false);
  const selected = jobs.find((job) => job.id === selectedId) ?? first;

  useEffect(() => {
    if (!shouldRevealDetail.current) return;
    shouldRevealDetail.current = false;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);

  function selectJob(jobId: string) {
    const revealDetail =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1279px)").matches;
    shouldRevealDetail.current = revealDetail && jobId !== selectedId;
    if (revealDetail && jobId === selectedId) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedId(jobId);
  }

  if (!selected) {
    return (
      <SourceState
        kind={definitionsState === "ready" ? "empty" : definitionsState}
        detail={
          failure ??
          (definitionsState === "ready"
            ? "No scheduled jobs were found for the resolved Hermes profile."
            : "The scheduled job definitions could not be safely loaded.")
        }
      />
    );
  }

  const ledger = [
    { label: "Created at", value: createdAtLabel(selected), mono: true },
    { label: "Schedule", value: selected.schedule, mono: true },
    { label: "Delivery", value: selected.delivery },
    { label: "Profile", value: selected.profile, mono: true },
    {
      label: "Skills / toolsets",
      value: selected.toolsets.join(", ") || "None declared",
      mono: true,
    },
    {
      label: "Recorded attempts",
      value:
        executionsState === "ready"
          ? `${selected.recordedAttempts} in retained ledger`
          : "Unavailable",
      mono: true,
    },
  ];

  return (
    <div className="jobs-layout">
      <section className="table-panel" aria-label="Scheduled jobs">
        <div className="table-scroll" role="region" aria-label="Scheduled jobs table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Schedule</th>
                <th>State</th>
                <th>Last run</th>
                <th>Next run</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className={cn(job.id === selected.id && "is-selected")}
                  onClick={() => selectJob(job.id)}
                >
                  <th scope="row">
                    <button type="button" aria-pressed={job.id === selected.id}>
                      {job.name}
                    </button>
                  </th>
                  <td className="mono">{job.schedule}</td>
                  <td>
                    <StatusLabel status={stateStatus(job.state)} />
                  </td>
                  <td className="mono">{lastRunLabel(job)}</td>
                  <td className="mono">{nextRunLabel(job)}</td>
                  <td>
                    <StatusLabel status={job.lastStatus} label={resultLabel(job)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div
        className="job-detail"
        ref={detailRef}
        role="region"
        aria-label={`${selected.name} details`}
        tabIndex={-1}
      >
        <SourceLedger title={selected.name} items={ledger} />
        <section className="execution-log">
          <h2>Recent executions</h2>
          {executionsState !== "ready" ? (
            <SourceState
              kind={executionsState}
              detail={
                failure ??
                "Recent execution history is unavailable; job definitions remain visible."
              }
            />
          ) : selected.executions.length ? (
            <ol>
              {selected.executions.map((execution) => (
                <li key={execution.id}>
                  <StatusLabel status={execution.status} />
                  <span className="mono">Started {formatShanghaiTime(execution.startedAt)}</span>
                  <small className="mono">{finishedAtLabel(execution)}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No recent execution records.</p>
          )}
        </section>
      </div>
    </div>
  );
}
