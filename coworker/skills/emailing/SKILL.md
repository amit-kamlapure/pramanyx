---
name: emailing
description: Writing an email of an answer or an analysis for the person to read, change and send — its body, and the analysis attached as PDF, Excel, Word or PowerPoint. Read before draft_email.
user-invocable: false
metadata:
  reads-first: mcp__pramanyx__draft_email
---

# Emailing an answer

Write it with `draft_email`, using the figures the answers gave; it opens for the person to read, change and send. You
cannot send it, so never say it was sent.

The body is the summary they asked for. When they want the analysis itself, attach it with `attach_answer` (the
answer's investigation_id) and `attach_format` (pdf, xlsx, docx or pptx).
