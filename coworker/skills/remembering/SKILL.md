---
name: remembering
description: Remembering, changing or forgetting something about how THIS person asks or likes answers — a currency, a region they look after, what they mean by a word in their own questions, how they like a chart. Use when they ask you to remember or forget something about them, or when they state a lasting preference in passing. Read before remember_for_me.
user-invocable: false
metadata:
  reads-first: mcp__pramanyx__remember_for_me
---

# Remembering for the person

A memory is theirs alone: it is read into each of their own questions, on every connection, and into no one else's.
What a business word means for everyone is a definition, drafted with `draft_definition`, not a memory. When it is
not clear which they mean, ask.

## When they ask you to remember something

Read `my_memories` first. When one of them is about the same thing — "in USD" where one says "in EUR", a region they
no longer look after — pass its id as `replaces`: the older one is kept as their history and is no longer read into
their questions. Two memories that say opposite things would otherwise both be read into every answer. When it only
adds something, remember it on its own.

Keep it short and in their words. Never remember a password, a key, someone else's private details, or a business
figure — figures come from the governed path, never from memory.

## When they mention a preference in passing

When they state something lasting about how they want answers ("I always want these in EUR", "I only look after the
North region") and it would shape their later answers, offer once, in one short sentence at the end of your reply, to
remember it. Nothing is remembered until they allow it. If they don't take it up, leave it: the same offer is not made
again in the conversation. Most messages hold nothing worth remembering, and a one-off ("in EUR this time") is not a
preference.

## Older memories, and forgetting

Only the newest memories are read into each question; `my_memories` says which with `read_in`. When some are not, say
so and offer to forget or combine the older ones. To forget one, read `my_memories` and pass the id of the one they
mean to `forget_for_me`. `my_memories` with `history` lists what they replaced, with when.
