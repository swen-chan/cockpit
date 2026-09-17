import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "@/components/safe-markdown";

describe("safe Markdown preview", () => {
  it("does not create active HTML, links, or remotely loading images", () => {
    const { container } = render(
      <SafeMarkdown
        content={
          "# Safe\n\n<script>window.compromised = true</script>\n\n![tracker](https://private.invalid/pixel.png)\n\n[link](https://private.invalid)"
        }
        query="Safe"
      />,
    );

    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/Image omitted: tracker/u)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Document preview" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("keeps an adversarial active-content corpus inert", () => {
    const { container } = render(
      <SafeMarkdown
        content={[
          '<img src="https://remote.invalid/pixel" onerror="alert(1)">',
          '<iframe src="https://remote.invalid/frame"></iframe>',
          '<style>@import url("https://remote.invalid/style.css");</style>',
          '<object data="https://remote.invalid/object"></object>',
          "![remote](https://remote.invalid/markdown.png)",
          "[external](https://remote.invalid)",
          "[script](javascript:alert(1))",
          "<https://remote.invalid/autolink>",
        ].join("\n\n")}
        query="remote"
      />,
    );

    for (const selector of ["script", "img", "iframe", "style", "object", "embed", "a"]) {
      expect(container.querySelector(selector)).toBeNull();
    }
    expect(container.querySelectorAll(".inert-link").length).toBeGreaterThan(0);
    expect(screen.getByText(/Image omitted: remote/u)).toBeInTheDocument();
  });
});
