import { PageHeader } from "@/components/page-header";
import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { formatShanghaiTime } from "@/lib/time";
import { loadConversationPageData } from "@/server/services/conversations";

export default async function ConversationsPage() {
  const data = await loadConversationPageData();
  return (
    <div className="page-wrap">
      <PageHeader
        title="Conversations"
        description="Read normal interactive transcripts; cron, hidden, and archived sessions are excluded."
        observedAt={formatShanghaiTime(data.page.observedAt)}
        mode="LIVE / READ ONLY"
      />
      <ConversationBrowser
        initialPage={data.page}
        initialConversation={data.initialConversation}
        initialFailure={data.failure?.message}
      />
    </div>
  );
}
