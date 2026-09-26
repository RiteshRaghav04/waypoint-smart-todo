# Waypoint — Smart To-Do App

A responsive, feature-rich to-do app: tasks, subtasks, recurring tasks, categories,
goals, priorities, reminders, drag-and-drop, dark mode, dashboard stats, export/import,
voice input, and offline-friendly local storage.

## 1. How to run it (VS Code, no install needed for basic use)

1. Download/unzip the `smart-todo` folder.
2. Open the folder in VS Code (`File → Open Folder…`).
3. Easiest option: install the **"Live Server"** extension (by Ritwick Dey) from the
   Extensions tab, then right-click `index.html` → **"Open with Live Server."**
   - Why not just double-click `index.html`? It will mostly work, but a couple of
     browser features (like notification permissions) behave more reliably when the
     page is served over `http://` instead of `file://`. Live Server gives you that
     with one click, no server code required.
4. That's it — the app opens in your browser, fully working, saving data on your machine.

No `npm install`, no build step, no API keys required for the app to work.

```
smart-todo/
├── index.html      → structure of the app
├── css/style.css   → all styling (light + dark theme, responsive layout)
├── js/app.js       → all app logic (state, rendering, reminders, etc.)
└── README.md       → this file
```

## 2. About "the database" — what's actually happening

You're right that a real to-do app needs somewhere to store its data. Right now this
app stores everything in your **browser's `localStorage`** — a small built-in
key-value database every browser has. That's why it:

- ✅ Works completely offline, with zero setup or cost
- ✅ Remembers your tasks between visits (on that browser, that device)
- ❌ Does **not** sync between devices (your phone and laptop have separate storage)
- ❌ Isn't a "real" account system — the sign-in in this app is just a local nickname,
  not a secure login (this is explained in the app itself when you sign in)

This is the right call for something you run locally in VS Code and use yourself.
If you later want real accounts and cross-device sync, here's the honest picture of
what that requires and how to add it:

### Option A — Add a lightweight backend + real database (most control)
1. Create a small server, e.g. with **Node.js + Express**.
2. Add a real database:
   - **SQLite** (via `better-sqlite3`) — a single file, no server to install, great
     for a personal project.
   - **PostgreSQL** or **MySQL** — better if multiple people will use it.
3. Add authentication with a library like `passport.js` or `lucia-auth`, hashing
   passwords with `bcrypt`.
4. Replace the `localStorage` calls in `js/app.js` (`loadState` / `saveState`) with
   `fetch()` calls to your new API endpoints (e.g. `GET /api/tasks`, `POST /api/tasks`).

### Option B — Use a "backend-as-a-service" (fastest to set up)
- **Firebase** (Firestore + Firebase Auth) or **Supabase** (Postgres + Auth) both give
  you a real database and login system without writing your own server. You'd add
  their SDK via a `<script>` tag and swap the storage functions the same way as Option A.
- This is the quickest path to real "sign in on any device, see the same tasks."

### Option C — Keep it local, but sync your file yourself
- Use the **Export** button (sidebar) to download your data as a `.json` file, and
  **Import** it on another device. Not automatic, but zero setup and totally private.

### The app is already wired for Option B — you just need to add your own free keys

I've already built the Firebase integration into this app. Right now it runs in
**local-only mode** because `js/firebase-config.js` has placeholder keys. Once you
create your own free Firebase project and paste in your keys, the app automatically
switches on: real email/password sign-up, a per-user cloud database, and a single
link that works from any device.

## 3. Deploying with real accounts (free, ~10 minutes)

### Step 1 — Create your Firebase project
1. Go to **console.firebase.google.com** and click **Add project** (free — no card
   needed for what this app uses).
2. Once created, click the **`</>`** (web) icon to register a web app. Firebase shows
   you a `firebaseConfig` object — copy those values into `js/firebase-config.js`,
   replacing the placeholders.

### Step 2 — Turn on Authentication and the database
1. In the left sidebar: **Build → Authentication → Get started → Sign-in method →
   Email/Password → Enable**.
2. In the left sidebar: **Build → Firestore Database → Create database**. Choose a
   location, and start in **test mode** for now.
3. Then go to the **Rules** tab of Firestore and replace the default rules with this,
   so people can only ever read or write their own data:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
   Click **Publish**.

### Step 3 — Deploy to a free single link (Firebase Hosting)
In a terminal, from inside the `smart-todo` folder:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
```
When it asks questions, answer:
- "Use an existing project" → pick the project you just made
- "What do you want to use as your public directory?" → type `.` (a single dot —
  this folder is already the site)
- "Configure as a single-page app?" → No
- "Overwrite index.html?" → No

Then deploy:
```bash
firebase deploy
```
Firebase prints a live URL like `https://your-project.web.app` — that's your single
link. Share it with anyone; they can create their own account and their tasks stay
private to them, synced across whatever device they log in on.

Re-run `firebase deploy` any time you make changes.

### If you'd rather use Supabase + Netlify instead
Same idea, different providers: create a free project at **supabase.com** (enables
Postgres + Auth), swap `js/firebase-config.js` and the auth/database calls in
`js/app.js` for the Supabase JS client, then drag the `smart-todo` folder into
**app.netlify.com/drop** for a free hosted link. This is more setup than Firebase
since you're wiring two separate services together.

## 4. Notes on a few specific features

- **Reminders/notifications**: uses the browser's built-in Notification API. Click the
  bell icon once to grant permission; the app checks every 20 seconds for tasks whose
  reminder time has arrived. Notifications only fire while the browser tab is open (a
  real push-notification system needs a backend + service worker, covered by Option A/B
  above).
- **Voice task creation**: uses the browser's built-in Speech Recognition API (works in
  Chrome/Edge; not all browsers support it).
- **AI task breakdown**: ships with a small built-in rule-based suggestion engine (no
  API key needed) that proposes generic subtasks based on keywords in your title. To
  use a real AI model instead, you'd call an LLM API (like the Anthropic API) from
  your backend and swap out the `suggestBreakdown()` function in `js/app.js`.
- **Email/calendar integration**: not included, since it requires OAuth credentials
  from Google/Microsoft. The **Export** feature gives you a JSON file today; a future
  version could generate a `.ics` calendar file from your tasks fairly easily.

## 5. Customizing

- Colors, fonts, and spacing are all defined as CSS variables at the top of
  `css/style.css` — change the palette in one place.
- Default categories (Work, Study, Personal, Health) are set in `js/app.js` under
  `DEFAULT_CATEGORIES`.

Enjoy — and if you outgrow local storage, Option A or B above is the natural next step.
