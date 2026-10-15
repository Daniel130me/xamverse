#!/bin/bash
# Maps auto-generated UUID commit subjects to conventional commit messages.
# Used as git filter-branch --msg-filter; reads full message on stdin,
# rewrites the first line (subject), preserves any remaining body lines.
msg=$(cat)
subject=$(printf '%s' "$msg" | head -n1)
case "$subject" in
  "Initial commit")
    new="chore: initial project scaffold";;
  "4fd931a4-41d9-45d6-881a-16ed6820b694")
    new="feat: build exam platform prototype with role-based dashboards and exam flows";;
  "0cc0ede9-533f-4b8a-b609-fd38e29addcd")
    new="fix: resolve hydration mismatch and nested button console errors";;
  "7c048624-b15e-442d-989d-172749a319d6")
    new="fix: portal mobile nav drawer to escape backdrop-blur container";;
  "2cf2138a-72d0-439c-bc36-50506cc8a7fe")
    new="feat: add realistic login first page with user switcher";;
  "e617cf49-f4da-446d-99ad-91026e09c822")
    new="refactor: polish login entry flow and update worklog";;
  *)
    new="$subject";;
esac
printf '%s\n' "$new"
printf '%s' "$msg" | tail -n +2
