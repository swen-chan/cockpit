export type SourceState = "ready" | "unavailable" | "error";

export interface SourceStamp {
  id: string;
  label: string;
  path: string;
  observedAt: string;
  state: SourceState;
  truncated?: boolean | undefined;
}

export interface LedgerItem {
  label: string;
  value: string;
  mono?: boolean | undefined;
}

export interface SystemCollectionItem {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "enabled" | "disabled" | "available" | "error";
  path?: string | undefined;
  modifiedAt?: string | undefined;
  previewable?: boolean | undefined;
}

export interface SystemCollection {
  kind: "skills" | "tools";
  items: SystemCollectionItem[];
}

export interface ProfileSummary {
  profile: string;
  profileKind: "default" | "named" | "custom" | "unavailable";
  homeLabel: string;
  resolutionSource: "explicit" | "environment" | "sticky" | "platform-default" | "unavailable";
  configState: SourceState;
  model: string | null;
  provider: string | null;
  modifiedAt?: string | undefined;
}

export interface SystemSource {
  id: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  stamp: SourceStamp;
  metadata: LedgerItem[];
  collection?: SystemCollection | undefined;
}

export interface SystemSnapshot {
  profile: ProfileSummary;
  sources: SystemSource[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  source: string;
  lastActivity: string;
  model: string;
  messageCount: number;
  toolCallCount: number;
  profile: string;
  workspace: string;
  messages: ConversationMessage[];
  truncated?: boolean | undefined;
}

export type ConversationSummary = Omit<Conversation, "messages" | "truncated">;

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
  observedAt: string;
}

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  entryType: "directory" | "file";
  kind: string;
  size: string;
  sizeBytes: number | null;
  modifiedAt: string;
  previewState: "available" | "metadata-only" | "unavailable";
  content?: string | undefined;
  truncated?: boolean | undefined;
}

export interface WorkspaceDirectory {
  path: string;
  parentPath: string | null;
  items: WorkspaceFile[];
  observedAt: string;
  truncated: boolean;
}

export interface JobExecution {
  id: string;
  status: "success" | "failed" | "running" | "unknown";
  startedAt: string;
  finishedAt: string | null;
}

export interface HermesJob {
  id: string;
  name: string;
  schedule: string;
  createdAt: string | null;
  state: "enabled" | "paused" | "completed" | "running";
  lastRun: string | null;
  nextRun: string | null;
  lastStatus: "success" | "failed" | "running" | "unknown" | "never";
  failureStreak: number;
  delivery: string;
  profile: string;
  toolsets: string[];
  recordedAttempts: number;
  executions: JobExecution[];
}

export interface JobsSnapshot {
  jobs: HermesJob[];
  observedAt: string;
  definitionsState: "ready" | "unavailable" | "error";
  executionsState: "ready" | "unavailable" | "error";
}

export interface OverviewSectionStatus {
  state: SourceState;
  observedAt: string;
  message?: string | undefined;
}

export interface OverviewProfile extends OverviewSectionStatus {
  profile: string;
  homeLabel: string;
  configState: SourceState;
  model: string | null;
  provider: string | null;
  modifiedAt?: string | undefined;
}

export interface OverviewConversationItem {
  id: string;
  title: string;
  preview: string;
  source: string;
  lastActivity: string;
}

export interface OverviewConversations extends OverviewSectionStatus {
  items: OverviewConversationItem[];
  hasMore: boolean;
}

export interface OverviewSystemItem {
  id: string;
  title: string;
  label: string;
  state: SourceState;
  observedAt: string;
  freshnessLabel: string;
  freshnessAt: string;
}

export interface OverviewSystem extends OverviewSectionStatus {
  items: OverviewSystemItem[];
}

export interface OverviewNextEvent {
  name: string;
  nextRun: string;
}

export interface OverviewJobs extends OverviewSectionStatus {
  total: number | null;
  enabled: number | null;
  paused: number | null;
  failedLastRun: number | null;
  executionsState: SourceState;
  nextEvent: OverviewNextEvent | null;
}

export interface OverviewWorkspaceItem {
  name: string;
  kind: string;
  size: string;
  modifiedAt: string;
}

export interface OverviewWorkspace extends OverviewSectionStatus {
  loadedCount: number | null;
  truncated: boolean;
  items: OverviewWorkspaceItem[];
}

export interface OverviewSnapshot {
  observedAt: string;
  profile: OverviewProfile;
  conversations: OverviewConversations;
  system: OverviewSystem;
  jobs: OverviewJobs;
  workspace: OverviewWorkspace;
}
