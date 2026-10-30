<!--
Review summary template. Copy it into the review's summary comment.

Post it with `gh pr review <n> --comment --body-file <file>`: PRs come from the same GitHub
account, so a GitHub "approve" is not possible.
When the verdict is Approved or Approved with comments, the comment starts with
"APPROVED at <head SHA>" (the commit you reviewed); the Tech Lead merges only that SHA.

Inline comments start with a label: blocking: / should: / question: / nit:
Each says the problem, a case where it goes wrong, and the fix (suggestion block of 5 lines at most).

Verdict:
- Approved: nothing blocking, nothing unanswered
- Approved with comments: only should: and nit: left
- Questions first: a question decides whether something blocks
- Changes requested: at least one blocking:

Delete any empty section, and these comments.
-->

## Verdict: <Approved | Approved with comments | Questions first | Changes requested>

<For an approval: "APPROVED at <head SHA>".>
<One or two sentences: what is good and what stands in the way of merging.>

### Acceptance criteria check

<!-- Each criterion from the ticket, checked against the code and the tests. -->

- ✅ **AC1. <criterion>**: <how you checked it, a few words>
- ⚠️ **AC2. <criterion>**: <what differs or is missing> (blocking 1)

### Rules

<!-- CLAUDE.md, .claude/rules (nestjs-clean-typescript.md, nextjs-frontend.md: "mandatory" rules
are blocking, the rest nit), karpathy guidelines, and the PR template's rules. Only the rules this
PR touches, including ones the author did not list. -->

- ✅ **<rule>**: <how you checked it, a few words>
- ❌ **<rule>**: <what breaks it> (blocking 2)

### Blocking

1. `<path:line>`: <problem>. <Concrete failing case: input or state → wrong result.> <Fix.>

### Should fix

1. `<path:line>`: <problem and fix, one line>. <"Here" or "follow-up is fine".>

### Questions

1. `<path:line>`: <question>

### Missing tests

- <behavior or denied path with no test that proves it>

### Commands I ran

<!-- On the merge with main when the schema changes. Command and result in a few words. -->

- `<command>`: <result>

<!-- Nits stay inline. Mention only how many: "3 nits inline, none blocking." -->
