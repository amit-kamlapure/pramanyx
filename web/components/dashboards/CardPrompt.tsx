"use client";

/**
 * A chart's own prompt (the user, 2026-11-19, of a peer product's per-chart assistant: "how it delivers results — pin-point
 * precision"): the spark on a card opens one line across the card's top, and what is typed there is asked in the Ask
 * panel's conversation about that card alone. On a dashboard the person keeps, the conversation may change how that one
 * chart is drawn — staged there, line by line, for their Allow; on one shared with them, it answers about it. The brand's
 * colours stand here because a person is talking to the model.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { brandEdge } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import { askInPanel, changeable, type AskSubject } from "@/lib/askSubject";

/** The most a chart's prompt takes: one request, said in a line. */
export const MAX_PROMPT = 500;

export function CardPrompt({ subject, onClose }: { subject: AskSubject; onClose: () => void }) {
  const [text, setText] = useState("");
  const edits = changeable(subject);
  const words = edits ? "Ask to edit this chart" : "Ask about this chart";
  const send = () => {
    const asked = text.trim();
    if (!asked) return;
    askInPanel(subject, asked);
    onClose();
  };
  return (
    <div data-testid="card-prompt" role="group" aria-label={words}
      style={{ ...brandEdge("var(--bg-2)"), position: "absolute", top: 6, left: 6, right: 6, zIndex: 5, borderRadius: 10,
        display: "flex", alignItems: "center", gap: 2, padding: "3px 4px 3px 10px", boxShadow: "var(--shadow-md)" }}>
      <input autoFocus aria-label={words} placeholder={`${words}…`} value={text} maxLength={MAX_PROMPT} className="aug-fs-sm"
        data-testid="card-prompt-input" onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--t1)", fontFamily: "inherit", padding: "4px 0" }} />
      <Button size="icon-xs" variant="ghost" aria-label="Close the prompt" title="Close" data-testid="card-prompt-close" onClick={onClose}>
        <Icon name="close" size={14} />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Ask it" title="Ask it in the Ask panel" data-testid="card-prompt-send" disabled={!text.trim()} onClick={send}>
        <Icon name="send" size={14} />
      </Button>
    </div>
  );
}
