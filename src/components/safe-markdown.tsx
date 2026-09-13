"use client";

import { Children, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { HighlightedText } from "@/components/highlighted-text";

function highlighted(children: ReactNode, query: string): ReactNode {
  return Children.map(children, (child) => (
    typeof child === "string" ? <HighlightedText text={child} query={query} /> : child
  ));
}

export function SafeMarkdown({
  ariaLabel = "Document preview",
  content,
  query,
}: {
  ariaLabel?: string;
  content: string;
  query: string;
}) {
  return (
    <div
      className="document-preview safe-markdown"
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <span className="inert-link">{highlighted(children, query)}</span>,
          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
          code: ({ children }) => <code>{highlighted(children, query)}</code>,
          h1: ({ children }) => <h1>{highlighted(children, query)}</h1>,
          h2: ({ children }) => <h2>{highlighted(children, query)}</h2>,
          h3: ({ children }) => <h3>{highlighted(children, query)}</h3>,
          img: ({ alt }) => <span className="omitted-image">[Image omitted: {alt || "untrusted source"}]</span>,
          li: ({ children }) => <li>{highlighted(children, query)}</li>,
          p: ({ children }) => <p>{highlighted(children, query)}</p>,
          strong: ({ children }) => <strong>{highlighted(children, query)}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
