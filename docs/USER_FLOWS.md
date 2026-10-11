# ExamHub — USER_FLOWS.md

Step-by-step workflows. "Device" and "user" switches are performed with the **Device Simulator bar** at the bottom of the app (or auto-jumped via the Guided scenario drawer).

## 1. School onboarding (register a new school)
1. Open `#/` → **Register a new school**.
2. Step 1 — enter school name, type, address, city, phone, email → validation runs.
3. Step 2 — pick session and first term (default grading policy shown).
4. Step 3 — add classes (e.g. "SS1 A") and tick subjects.
5. Step 4 — create the first administrator (name, email, password ≥ 8 chars).
6. Step 5 — name the computer; a device identity (ID/port/storage) is displayed.
7. Step 6 — choose a plan and activation mode (online or offline).
8. Step 7 — review everything → **Finish setup** → initialization animation (database, device identity, licence request, configuration).
9. Completion offers **Go to sign in**. "Save & exit" persists partial progress locally at any step.

### 1b. Join an existing school
Welcome → **Join an existing school** → Scan LAN (or manual IP) → choose a discovered peer → optional invitation code → **Send pairing request** → wait → pairing approved → sign in. An administrator must approve the pairing on the destination peer (see flow 4).

### 1c. Restore / Import
Welcome → **Restore from backup** (choose `.ehbak`, see verified summary, restore, done) or **Import existing school data** (choose CSV, map columns, review duplicates, import with skip report).

## 2. Login and role switching
1. `#/login` shows the sign-in form bound to the **current simulated computer**.
2. Either submit the form (validation + real error states: unknown account, suspended, other-school account) or click a **demo account card** (no passwords needed).
3. The role determines navigation, dashboard, and permitted actions (compare Daniel the teacher vs Adaeze the administrator — completely different sidebars on the same computer).
4. Switch roles: simulator bar → **Switch demo user** (same computer) — instant session change.
5. Switch computers: simulator bar → **Switch simulated computer** — the session ends (authentication is per computer); sign in again.
6. Header menu: profile, change password (simulated), **lock session**, sign out. The header LAN chip toggles network state globally.

## 3. Teacher assessment creation (the guided scenario, steps 1–5)
1. Simulator: device **DEV-017**, user **Mr. Daniel Ibrahim**.
2. Dashboard → **New assessment** (or open the seeded draft "SS2 Mathematics — Mid-Term Examination" — it exists *only* on DEV-017).
3. Wizard: details (name, subject, classes, type, controlled) → questions (import from bank / AI-generate / create) → sections → schedule & rules → security & feedback → review → **Save draft**.
4. The draft is local-only. Proof: switch to DEV-043 — the assessment is not there.
5. Assessment detail → **Submit for approval** → choose reviewer computer (DEV-043) → request transfers (visible in the transfer queue; completes in seconds while online).
6. Status becomes **pending approval**; the teacher is notified when the decision returns.

## 4. Admin approval (steps 6–9)
1. Simulator: device **DEV-043**, user **Mrs. Adaeze Okafor** (session ended when the device changed — sign in again).
2. Approvals badge shows the new request. Open **Approvals**.
3. **Review** reveals the checklist (version identity, coverage, marks, distribution plan).
4. Approve (or reject / request changes with a note).
5. The decision is recorded **against v1 specifically** and audited; the assessment on DEV-043 now shows "approved v1". A decision transfer notifies the teacher's device.

## 5. P2P device discovery & pairing
1. **Computers & Sync** → **Discover peers**.
2. Scan LAN (simulated probe) lists unpaired computers with fingerprints; or connect by manual IP.
3. **Pair & trust** — the peer becomes trusted; the event is audited on both devices.
4. Unpair anytime from device detail (**Revoke pairing**). Unauthorized payloads from unpaired peers are rejected (see conflict CONF-005).

## 6. Assessment distribution to 100 computers (steps 10–16)
1. On DEV-043, open the approved assessment → **Distribute to computers**.
2. **Select all** (100 computers) → **Start distribution**.
3. Per-computer transfer tasks appear; each completes with its own progress and speed. Offline peers become **pending** and auto-resume when they reconnect (simulate with the device power toggle); retries are one click in the Sync Centre.
4. Every receiving computer stores its own sealed package (verify: open DEV-063 device detail → "Exam packages").

## 7. Student examination (steps 17–21)
1. Simulator: device **DEV-063**, user **Amina Yusuf**.
2. Dashboard shows "Exams available" — only packages delivered to DEV-063. **Start exam** (or `#/exam`).
3. Pre-exam info shows window, duration, approved version, randomization flags.
4. During the exam: timer counts down (demo speed ×1/×10/×60), answers auto-save after every change, palette tracks answered/flagged/unanswered.
5. Simulate a dropout: toggle **LAN offline** — a red banner explains that the package is stored locally and answers keep saving locally. The exam continues unaffected. Reconnect — submissions transfer automatically.
6. **Submit exam** → confirmation with answered/flagged counts → submitted screen shows local storage + transfer state to the three authorized collectors.
7. Objective questions are auto-marked on submission; essays go to the marking queue.

## 8. Result collection (steps 22–28)
1. Simulator: device **DEV-008**, user **Mr. Tunde Olawale** — a computer that was neither creator nor approver.
2. **Results & marking** shows the collection dashboard (progress bars, outstanding counts, duplicate annotations).
3. **Collect from peers** (Sync Centre) → select all reachable peers → collection tasks stream in; submissions from offline peers stay visibly outstanding (scenario 4 seeds exactly 97/100 with DEV-071/089/096 outstanding).
4. Reconnect those devices (simulator) and re-run collection → 100/100.
5. Duplicates (same content hash) are merged and flagged — never counted twice (CONF-004 demonstrates this live).

## 9. Conflict resolution
1. As an administrator, open **Conflicts** (DEV-043 holds six seeded cases).
2. **Inspect & resolve** → side-by-side versions with field diffs and a suggested resolution.
3. Choose **Keep A / Keep B / Manual merge / Preserve both / Defer** with a note.
4. The card shows BEFORE → AFTER and the resolver/time; the decision is audited.

## 10. Offline licence activation
1. **Licensing** → **Offline activation**.
2. Step 1 shows the device identifier. Step 2 **Generate request** (a `.ehreq` file). Step 3 — carry it to any internet-connected computer (explained). Step 4 **Import file** → activated. Step 5 explains validity and renewal.
3. Little Stars (DEV-101) demonstrates the **grace period** state: read-only, export allowed, records never destroyed.

## 11. Offline application updates
1. **Updates** → **Import offline update package** (v1.4.1, verified signature, release notes).
2. Select peers → **Push update to selected peers** — transfers run like any payload; receiving peers verify + back up before installing (simulated).
3. If an exam is active, a red safety banner blocks updates.

## 12. Essay marking & result release
1. After submissions arrive on an authorized computer, **Results & marking → Marking queue** lists attempts with essays.
2. **Mark now** → per-question view with the student's answer, auto-mark results, the rubric, marks input and examiner comment → **Submit marks**.
3. **Moderate & release** → stats → **Release results** (audited, irreversible) → students see results after the release syncs to their devices.
