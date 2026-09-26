/* ==========================================================
   WAYPOINT — Smart To-Do
   All data lives in localStorage (see README.md for how to
   swap this for a real backend + database).
   ========================================================== */

const STORE_KEY = "waypoint.v1";

const DEFAULT_CATEGORIES = [
  { id: "work",     name: "Work",     color: "#3B6E5E" },
  { id: "study",    name: "Study",    color: "#5D7BB0" },
  { id: "personal", name: "Personal", color: "#C08A2E" },
  { id: "health",   name: "Health",   color: "#5C7F51" },
];

const COLOR_CHOICES = ["#3B6E5E","#5D7BB0","#C08A2E","#5C7F51","#C8553D","#8E6BB0","#B0567F","#4A9AA6"];

// ---------- Firebase (optional cloud sync — see js/firebase-config.js) ----------
let auth = null, db = null, currentUser = null, authMode = "signin", saveDebounceTimer = null;
if (typeof FIREBASE_CONFIGURED !== "undefined" && FIREBASE_CONFIGURED && typeof firebase !== "undefined") {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
  } catch (e) { console.warn("Firebase failed to initialize", e); }
}

let state = loadState();
let ui = {
  filter: "all",
  search: "",
  sort: "smart",
  priorityFilter: "all",
  activeCategory: null,
  activeGoal: null,
  editingTaskId: null,
  editingSubtasks: [],
  selectedPriority: "medium",
};

// ---------- persistence ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("Could not read local storage", e); }
  return {
    tasks: [],
    categories: DEFAULT_CATEGORIES,
    goals: [],
    user: null,
    theme: "light",
  };
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("Couldn't save — your browser storage may be full.");
  }
  if (auth && currentUser && db) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      db.collection("users").doc(currentUser.uid).set(state)
        .catch((err) => toast("Cloud sync failed: " + err.message));
    }, 500);
  }
}

// When someone is signed in, load their cloud copy (or migrate the local one
// up on first sign-in) and re-render with it.
function initFirebaseAuthListener() {
  if (!auth) return;
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      const ref = db.collection("users").doc(user.uid);
      try {
        const snap = await ref.get();
        if (snap.exists) {
          state = snap.data();
        } else {
          state.user = { name: user.displayName || user.email.split("@")[0], email: user.email };
          await ref.set(state);
        }
        state.user = { name: user.displayName || state.user?.name || user.email.split("@")[0], email: user.email };
      } catch (e) {
        toast("Couldn't reach the cloud database: " + e.message);
      }
      applyTheme();
      renderAccount();
      populateCategorySelect();
      populateGoalSelect();
      setActiveFilterUI();
      render();
      toast(`Signed in as ${user.email} — synced to the cloud.`);
    } else {
      currentUser = null;
      renderAccount();
    }
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- DOM shortcuts ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ================= THEME =================
function applyTheme() {
  document.body.dataset.theme = state.theme;
}
$("#themeToggle").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
});

// ================= SIDEBAR TOGGLE (mobile) =================
$("#menuToggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
  $("#scrim").classList.toggle("show");
});
$("#scrim").addEventListener("click", closeSidebar);
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("show");
}

// ================= ACCOUNT (local-only demo auth) =================
function renderAccount() {
  const name = state.user?.name || "Guest";
  const initial = name.charAt(0).toUpperCase();
  $("#accountName").textContent = name;
  if (currentUser) {
    $("#accountSub").textContent = `${currentUser.email} · synced to the cloud`;
  } else if (state.user) {
    $("#accountSub").textContent = "Local profile · not signed in to the cloud";
  } else {
    $("#accountSub").textContent = "Working locally · not signed in";
  }
  $("#accountInitial").textContent = initial;
  $("#userInitial").textContent = initial;
  $("#authBtn").textContent = (currentUser || state.user) ? "Manage account" : "Sign in / Create account";
}

function setAuthMode(mode) {
  authMode = mode;
  $$("#authModeSeg .seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("#authNameField").style.display = mode === "signup" ? "flex" : "none";
  $("#authTitle").textContent = mode === "signup" ? "Create account" : "Sign in";
  $("#saveAuthBtn").textContent = mode === "signup" ? "Create account" : "Sign in";
}
$$("#authModeSeg .seg").forEach((btn) => btn.addEventListener("click", () => setAuthMode(btn.dataset.mode)));

function showAuthError(msg) {
  $("#authError").textContent = msg;
  $("#authError").style.display = "block";
}

$("#authBtn").addEventListener("click", () => {
  $("#authError").style.display = "none";
  $("#authName").value = state.user?.name || "";
  $("#authEmail").value = currentUser?.email || state.user?.email || "";
  $("#authPassword").value = "";
  $("#signOutBtn").hidden = !currentUser && !state.user;

  const cloudOn = !!auth;
  $("#authModeSeg").style.display = cloudOn ? "flex" : "none";
  $("#authPasswordField").style.display = cloudOn ? "flex" : "none";
  $("#authCloudHint").style.display = cloudOn ? "none" : "block";
  setAuthMode("signin");

  $("#authModalBackdrop").classList.add("open");
});
$("#userChip").addEventListener("click", () => $("#authBtn").click());
$("#closeAuthModal").addEventListener("click", () => $("#authModalBackdrop").classList.remove("open"));
$("#cancelAuthBtn").addEventListener("click", () => $("#authModalBackdrop").classList.remove("open"));

$("#saveAuthBtn").addEventListener("click", async () => {
  const name = $("#authName").value.trim();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  $("#authError").style.display = "none";

  // No Firebase keys configured yet — fall back to a local-only nickname.
  if (!auth) {
    if (!name) { toast("Add a name to continue."); return; }
    state.user = { name, email };
    saveState();
    renderAccount();
    $("#authModalBackdrop").classList.remove("open");
    toast(`Welcome, ${name}. This profile lives only in this browser — add Firebase keys for real cloud accounts (see README).`);
    return;
  }

  if (!email || password.length < 6) {
    showAuthError("Enter an email and a password of at least 6 characters.");
    return;
  }

  try {
    if (authMode === "signup") {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      if (name) await cred.user.updateProfile({ displayName: name });
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
    $("#authModalBackdrop").classList.remove("open");
  } catch (err) {
    showAuthError(err.message);
  }
});

$("#signOutBtn").addEventListener("click", async () => {
  if (auth && currentUser) {
    await auth.signOut();
    state = loadState(); // fall back to this browser's local guest data
  }
  state.user = null;
  currentUser = null;
  saveState();
  renderAccount();
  populateCategorySelect();
  populateGoalSelect();
  setActiveFilterUI();
  render();
  $("#authModalBackdrop").classList.remove("open");
  toast("Signed out. Working locally now.");
});

// ================= CATEGORIES =================
function renderCategoryNav() {
  const nav = $("#categoryNav");
  nav.innerHTML = `<p class="nav-label">Categories</p>`;
  state.categories.forEach((cat) => {
    const count = state.tasks.filter((t) => t.category === cat.id && !t.archived).length;
    const btn = document.createElement("button");
    btn.className = "nav-item cat-item" + (ui.activeCategory === cat.id ? " active" : "");
    btn.innerHTML = `<span class="swatch" style="background:${cat.color}"></span>${escapeHtml(cat.name)}<em>${count}</em>`;
    btn.addEventListener("click", () => {
      ui.activeCategory = ui.activeCategory === cat.id ? null : cat.id;
      ui.filter = "all";
      setActiveFilterUI();
      render();
    });
    nav.appendChild(btn);
  });
}

function populateCategorySelect() {
  const sel = $("#taskCategory");
  sel.innerHTML = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

$("#addCategoryBtn").addEventListener("click", () => {
  $("#catName").value = "";
  renderColorRow();
  $("#catModalBackdrop").classList.add("open");
});
$("#closeCatModal").addEventListener("click", () => $("#catModalBackdrop").classList.remove("open"));
$("#cancelCatBtn").addEventListener("click", () => $("#catModalBackdrop").classList.remove("open"));

let selectedColor = COLOR_CHOICES[0];
function renderColorRow() {
  const row = $("#colorRow");
  row.innerHTML = "";
  selectedColor = COLOR_CHOICES[Math.floor(Math.random() * COLOR_CHOICES.length)];
  COLOR_CHOICES.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (c === selectedColor ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      selectedColor = c;
      $$(".color-swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
    row.appendChild(sw);
  });
}
$("#saveCatBtn").addEventListener("click", () => {
  const name = $("#catName").value.trim();
  if (!name) { toast("Give the category a name."); return; }
  state.categories.push({ id: uid(), name, color: selectedColor });
  saveState();
  populateCategorySelect();
  renderCategoryNav();
  $("#catModalBackdrop").classList.remove("open");
  toast(`Category "${name}" created.`);
});

// ================= GOALS =================
function renderGoalsNav() {
  const nav = $("#goalsNav");
  nav.innerHTML = `<p class="nav-label">Goals</p>`;
  state.goals.forEach((g) => {
    const linked = state.tasks.filter((t) => t.goalId === g.id);
    const done = linked.filter((t) => t.completed).length;
    const pct = linked.length ? Math.round((done / linked.length) * 100) : 0;
    const btn = document.createElement("button");
    btn.className = "nav-item" + (ui.activeGoal === g.id ? " active" : "");
    btn.innerHTML = `<span>🎯</span>${escapeHtml(g.name)}<em>${pct}%</em>`;
    btn.addEventListener("click", () => {
      ui.activeGoal = ui.activeGoal === g.id ? null : g.id;
      ui.filter = "all";
      setActiveFilterUI();
      render();
    });
    nav.appendChild(btn);
  });
}
function populateGoalSelect() {
  const sel = $("#taskGoal");
  sel.innerHTML = `<option value="">No goal</option>` +
    state.goals.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
}
$("#addGoalBtn").addEventListener("click", () => {
  $("#goalName").value = "";
  $("#goalDate").value = "";
  $("#goalModalBackdrop").classList.add("open");
});
$("#closeGoalModal").addEventListener("click", () => $("#goalModalBackdrop").classList.remove("open"));
$("#cancelGoalBtn").addEventListener("click", () => $("#goalModalBackdrop").classList.remove("open"));
$("#saveGoalBtn").addEventListener("click", () => {
  const name = $("#goalName").value.trim();
  if (!name) { toast("Give the goal a name."); return; }
  state.goals.push({ id: uid(), name, targetDate: $("#goalDate").value || null });
  saveState();
  populateGoalSelect();
  renderGoalsNav();
  $("#goalModalBackdrop").classList.remove("open");
  toast(`Goal "${name}" created — link tasks to it from the task editor.`);
});

// ================= FILTER NAV =================
$$(".nav-item[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    ui.filter = btn.dataset.filter;
    ui.activeCategory = null;
    ui.activeGoal = null;
    setActiveFilterUI();
    render();
    closeSidebar();
  });
});
function setActiveFilterUI() {
  $$(".nav-item[data-filter]").forEach((b) => b.classList.toggle("active", b.dataset.filter === ui.filter && !ui.activeCategory && !ui.activeGoal));
  renderCategoryNav();
  renderGoalsNav();
  const titles = {
    all: ["All tasks", "Everything on your plate"],
    today: ["Today", "Due before midnight"],
    pending: ["Pending", "Not yet completed"],
    overdue: ["Overdue", "Past their due date"],
    completed: ["Completed", "Nicely done"],
    archived: ["Archive", "Completed tasks you tucked away"],
  };
  if (ui.activeCategory) {
    const cat = state.categories.find((c) => c.id === ui.activeCategory);
    $("#viewTitle").textContent = cat ? cat.name : "Category";
    $("#viewSub").textContent = "Filtered by category";
  } else if (ui.activeGoal) {
    const goal = state.goals.find((g) => g.id === ui.activeGoal);
    $("#viewTitle").textContent = goal ? goal.name : "Goal";
    $("#viewSub").textContent = "Tasks linked to this goal";
  } else {
    const t = titles[ui.filter] || titles.all;
    $("#viewTitle").textContent = t[0];
    $("#viewSub").textContent = t[1];
  }
}

$("#searchInput").addEventListener("input", (e) => { ui.search = e.target.value.toLowerCase(); render(); });
$("#sortSelect").addEventListener("change", (e) => { ui.sort = e.target.value; render(); });
$("#priorityFilter").addEventListener("change", (e) => { ui.priorityFilter = e.target.value; render(); });

// ================= TASK HELPERS =================
function dueDateTime(task) {
  if (!task.date) return null;
  return new Date(`${task.date}T${task.time || "23:59"}`);
}
function isOverdue(task) {
  if (task.completed || task.archived) return false;
  const dt = dueDateTime(task);
  return dt && dt.getTime() < Date.now();
}
function isToday(task) {
  if (!task.date) return false;
  const today = new Date();
  const [y, m, d] = task.date.split("-").map(Number);
  return y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
}
function subtaskProgress(task) {
  if (!task.subtasks || !task.subtasks.length) return null;
  const done = task.subtasks.filter((s) => s.done).length;
  return { done, total: task.subtasks.length, pct: Math.round((done / task.subtasks.length) * 100) };
}

function visibleTasks() {
  let list = state.tasks.slice();

  if (ui.activeCategory) list = list.filter((t) => t.category === ui.activeCategory && !t.archived);
  else if (ui.activeGoal) list = list.filter((t) => t.goalId === ui.activeGoal);
  else {
    switch (ui.filter) {
      case "today": list = list.filter((t) => isToday(t) && !t.archived); break;
      case "pending": list = list.filter((t) => !t.completed && !t.archived); break;
      case "overdue": list = list.filter((t) => isOverdue(t) && !t.archived); break;
      case "completed": list = list.filter((t) => t.completed && !t.archived); break;
      case "archived": list = list.filter((t) => t.archived); break;
      default: list = list.filter((t) => !t.archived);
    }
  }

  if (ui.priorityFilter !== "all") list = list.filter((t) => t.priority === ui.priorityFilter);
  if (ui.search) {
    list = list.filter((t) =>
      t.title.toLowerCase().includes(ui.search) ||
      (t.description || "").toLowerCase().includes(ui.search) ||
      categoryName(t.category).toLowerCase().includes(ui.search)
    );
  }

  const prioRank = { high: 0, medium: 1, low: 2 };
  switch (ui.sort) {
    case "due":
      list.sort((a, b) => (dueDateTime(a)?.getTime() ?? Infinity) - (dueDateTime(b)?.getTime() ?? Infinity));
      break;
    case "priority":
      list.sort((a, b) => prioRank[a.priority] - prioRank[b.priority]);
      break;
    case "created":
      list.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "alpha":
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default: // smart: overdue first, then soonest due, then priority
      list.sort((a, b) => {
        const aOver = isOverdue(a), bOver = isOverdue(b);
        if (aOver !== bOver) return aOver ? -1 : 1;
        const aDue = dueDateTime(a)?.getTime() ?? Infinity;
        const bDue = dueDateTime(b)?.getTime() ?? Infinity;
        if (aDue !== bDue) return aDue - bDue;
        return prioRank[a.priority] - prioRank[b.priority];
      });
  }
  return list;
}

function categoryName(id) { return state.categories.find((c) => c.id === id)?.name || "Uncategorized"; }
function categoryColor(id) { return state.categories.find((c) => c.id === id)?.color || "#999"; }

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
function fmtDue(task) {
  if (!task.date) return "No due date";
  const dt = dueDateTime(task);
  const dateStr = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeStr = task.time ? dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}

// ================= RENDER TASK LIST =================
function render() {
  const list = visibleTasks();
  const container = $("#taskList");
  container.innerHTML = "";
  $("#emptyState").hidden = list.length > 0;
  if (!list.length) {
    $("#emptyText").textContent = ui.search
      ? `No tasks match "${ui.search}".`
      : "Add your first task to start mapping out your day.";
  }

  list.forEach((task) => {
    const row = document.createElement("div");
    row.className = `task-row priority-${task.priority}` + (task.completed ? " completed" : "") + (isOverdue(task) ? " overdue-flag" : "");
    row.draggable = true;
    row.dataset.id = task.id;

    const prog = subtaskProgress(task);
    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <button class="check-circle ${task.completed ? "done" : ""}" title="Mark complete"></button>
      <div class="task-main">
        <div class="task-top-row">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="badge ${task.priority}">${task.priority}</span>
          <span class="badge cat" style="color:${categoryColor(task.category)}">${escapeHtml(categoryName(task.category))}</span>
          ${task.recurrence !== "none" ? `<span class="badge recur">↻ ${task.recurrence}</span>` : ""}
        </div>
        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ""}
        <div class="task-meta">
          <span class="task-due">📅 ${fmtDue(task)}</span>
          ${prog ? `<span class="subtask-progress"><span class="mini-bar"><span style="width:${prog.pct}%"></span></span>${prog.done}/${prog.total}</span>` : ""}
          ${task.goalId ? `<span>🎯 ${escapeHtml(state.goals.find(g=>g.id===task.goalId)?.name || "")}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <button class="editBtn" title="Edit">✏️</button>
        <button class="archiveBtn" title="${task.archived ? 'Unarchive' : 'Archive'}">🗃️</button>
        <button class="deleteBtn" title="Delete">🗑️</button>
      </div>
    `;

    row.querySelector(".check-circle").addEventListener("click", () => toggleComplete(task.id));
    row.querySelector(".task-main").addEventListener("click", () => openTaskModal(task.id));
    row.querySelector(".editBtn").addEventListener("click", () => openTaskModal(task.id));
    row.querySelector(".archiveBtn").addEventListener("click", () => toggleArchive(task.id));
    row.querySelector(".deleteBtn").addEventListener("click", () => deleteTask(task.id));

    row.addEventListener("dragstart", () => row.classList.add("dragging"));
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); persistOrderFromDOM(); });

    container.appendChild(row);
  });

  renderDashboard();
  renderCategoryNav();
  renderGoalsNav();
  renderSidebarCounts();
}

let dragOverBound = false;
function bindDragOver() {
  const container = $("#taskList");
  if (dragOverBound) return;
  dragOverBound = true;
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = container.querySelector(".dragging");
    if (!dragging) return;
    const after = [...container.querySelectorAll(".task-row:not(.dragging)")].find((el) => {
      const box = el.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (after) container.insertBefore(dragging, after);
    else container.appendChild(dragging);
  });
}
function persistOrderFromDOM() {
  const ids = $$("#taskList .task-row").map((r) => r.dataset.id);
  ids.forEach((id, i) => {
    const t = state.tasks.find((x) => x.id === id);
    if (t) t.order = i;
  });
  saveState();
}

function renderSidebarCounts() {
  const active = state.tasks.filter((t) => !t.archived);
  $("#count-all").textContent = active.length;
  $("#count-today").textContent = active.filter(isToday).length;
  $("#count-pending").textContent = active.filter((t) => !t.completed).length;
  $("#count-overdue").textContent = active.filter(isOverdue).length;
  $("#count-completed").textContent = active.filter((t) => t.completed).length;
  $("#count-archived").textContent = state.tasks.filter((t) => t.archived).length;
}

function renderDashboard() {
  const active = state.tasks.filter((t) => !t.archived);
  const total = active.length;
  const completed = active.filter((t) => t.completed).length;
  const overdue = active.filter(isOverdue).length;
  const pending = total - completed;
  $("#statTotal").textContent = total;
  $("#statCompleted").textContent = completed;
  $("#statPending").textContent = pending;
  $("#statOverdue").textContent = overdue;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  $("#progressPct").textContent = `${pct}%`;
  const circumference = 169.6;
  $("#ringFg").style.strokeDashoffset = circumference - (circumference * pct) / 100;
}

// ================= COMPLETE / ARCHIVE / DELETE =================
function toggleComplete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;

  if (task.completed && task.recurrence !== "none" && task.date) {
    spawnNextRecurrence(task);
  }
  saveState();
  render();
}

function spawnNextRecurrence(task) {
  const next = new Date(`${task.date}T${task.time || "00:00"}`);
  if (task.recurrence === "daily") next.setDate(next.getDate() + 1);
  if (task.recurrence === "weekly") next.setDate(next.getDate() + 7);
  if (task.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  const clone = {
    ...task,
    id: uid(),
    completed: false,
    createdAt: Date.now(),
    date: next.toISOString().slice(0, 10),
    subtasks: (task.subtasks || []).map((s) => ({ ...s, id: uid(), done: false })),
    notified: false,
  };
  state.tasks.push(clone);
  toast(`Next "${task.title}" scheduled for ${clone.date}.`);
}

function toggleArchive(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.archived = !task.archived;
  saveState();
  render();
  toast(task.archived ? "Task archived." : "Task restored.");
}

function deleteTask(id) {
  if (!confirm("Delete this task? This can't be undone.")) return;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveState();
  render();
  toast("Task deleted.");
}

// ================= TASK MODAL =================
function openTaskModal(id) {
  ui.editingTaskId = id || null;
  const task = id ? state.tasks.find((t) => t.id === id) : null;

  populateCategorySelect();
  populateGoalSelect();

  $("#modalTitle").textContent = task ? "Edit task" : "New task";
  $("#taskTitle").value = task?.title || "";
  $("#taskDesc").value = task?.description || "";
  $("#taskDate").value = task?.date || "";
  $("#taskTime").value = task?.time || "";
  $("#taskCategory").value = task?.category || state.categories[0]?.id || "";
  $("#taskRecurrence").value = task?.recurrence || "none";
  $("#taskReminder").value = task?.reminderMinutes ?? "0";
  $("#taskGoal").value = task?.goalId || "";
  $("#deleteTaskBtn").style.visibility = task ? "visible" : "hidden";

  ui.selectedPriority = task?.priority || "medium";
  setPrioritySeg(ui.selectedPriority);

  ui.editingSubtasks = task ? (task.subtasks || []).map((s) => ({ ...s })) : [];
  renderSubtaskList();
  $("#smartHint").textContent = "";

  $("#taskModalBackdrop").classList.add("open");
  setTimeout(() => $("#taskTitle").focus(), 50);
}
function closeTaskModal() { $("#taskModalBackdrop").classList.remove("open"); }
$("#closeModal").addEventListener("click", closeTaskModal);
$("#cancelTaskBtn").addEventListener("click", closeTaskModal);
$("#newTaskBtn").addEventListener("click", () => openTaskModal(null));
$("#emptyAddBtn").addEventListener("click", () => openTaskModal(null));

function setPrioritySeg(value) {
  ui.selectedPriority = value;
  $$("#prioritySeg .seg").forEach((b) => b.classList.toggle("active", b.dataset.value === value));
}
$$("#prioritySeg .seg").forEach((btn) => btn.addEventListener("click", () => setPrioritySeg(btn.dataset.value)));

function renderSubtaskList() {
  const wrap = $("#subtaskList");
  wrap.innerHTML = "";
  ui.editingSubtasks.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "subtask-item";
    row.innerHTML = `
      <input type="checkbox" ${s.done ? "checked" : ""}>
      <span class="${s.done ? "done" : ""}">${escapeHtml(s.text)}</span>
      <button title="Remove">✕</button>
    `;
    row.querySelector("input").addEventListener("change", (e) => { s.done = e.target.checked; renderSubtaskList(); });
    row.querySelector("button").addEventListener("click", () => { ui.editingSubtasks.splice(idx, 1); renderSubtaskList(); });
    wrap.appendChild(row);
  });
}
function addSubtaskFromInput() {
  const input = $("#subtaskInput");
  const text = input.value.trim();
  if (!text) return;
  ui.editingSubtasks.push({ id: uid(), text, done: false });
  input.value = "";
  renderSubtaskList();
}
$("#subtaskAddBtn").addEventListener("click", addSubtaskFromInput);
$("#subtaskInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSubtaskFromInput(); } });

// ---- "AI" breakdown (offline heuristic, see README for wiring a real model) ----
$("#aiBreakdownBtn").addEventListener("click", () => {
  const title = $("#taskTitle").value.trim();
  if (!title) { toast("Add a task title first."); return; }
  const steps = suggestBreakdown(title);
  steps.forEach((text) => ui.editingSubtasks.push({ id: uid(), text, done: false }));
  renderSubtaskList();
  toast("Added a suggested breakdown — edit it however you like.");
});
function suggestBreakdown(title) {
  const t = title.toLowerCase();
  if (/write|report|essay|article|blog/.test(t)) return ["Outline the structure", "Write a first draft", "Edit and proofread", "Share for feedback"];
  if (/launch|release|ship/.test(t)) return ["Define scope and checklist", "Finish remaining build work", "Test end to end", "Announce and monitor"];
  if (/study|exam|learn/.test(t)) return ["Gather the material", "Make summary notes", "Practice with questions", "Review weak spots"];
  if (/clean|organi[sz]e/.test(t)) return ["Sort into keep / donate / discard", "Clean the space", "Put everything back thoughtfully"];
  if (/meeting|call/.test(t)) return ["Prepare agenda", "Send invite", "Take notes during", "Send follow-up"];
  return ["Break the goal into a first concrete step", "Do the core piece of work", "Review the result", "Wrap up and close out"];
}

// ---- Smart suggestions: priority/category hinting as you type ----
$("#taskTitle").addEventListener("input", updateSmartHint);
$("#taskDate").addEventListener("change", updateSmartHint);
function updateSmartHint() {
  const title = $("#taskTitle").value.toLowerCase();
  const hints = [];
  if (/urgent|asap|important|deadline/.test(title)) {
    setPrioritySeg("high");
    hints.push("Marked High priority based on your wording.");
  }
  if ($("#taskDate").value) {
    const days = (new Date($("#taskDate").value) - new Date()) / 86400000;
    if (days <= 1 && days >= 0 && ui.selectedPriority !== "high") hints.push("Due very soon — consider High priority.");
  }
  if (/meeting|call|client|standup/.test(title)) suggestCategoryByName("Work");
  if (/gym|run|workout|doctor|sleep/.test(title)) suggestCategoryByName("Health");
  if (/study|exam|homework|read/.test(title)) suggestCategoryByName("Study");
  $("#smartHint").textContent = hints.join(" ");
}
function suggestCategoryByName(name) {
  const cat = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (cat) $("#taskCategory").value = cat.id;
}

$("#saveTaskBtn").addEventListener("click", () => {
  const title = $("#taskTitle").value.trim();
  if (!title) { toast("Give the task a title."); return; }

  const reminderVal = $("#taskReminder").value;
  const payload = {
    title,
    description: $("#taskDesc").value.trim(),
    date: $("#taskDate").value || null,
    time: $("#taskTime").value || null,
    priority: ui.selectedPriority,
    category: $("#taskCategory").value,
    recurrence: $("#taskRecurrence").value,
    reminderMinutes: reminderVal === "none" ? null : Number(reminderVal),
    goalId: $("#taskGoal").value || null,
    subtasks: ui.editingSubtasks,
  };

  if (ui.editingTaskId) {
    const task = state.tasks.find((t) => t.id === ui.editingTaskId);
    Object.assign(task, payload, { notified: false });
    toast("Task updated.");
  } else {
    state.tasks.push({
      id: uid(),
      ...payload,
      completed: false,
      archived: false,
      createdAt: Date.now(),
      order: state.tasks.length,
      notified: false,
    });
    toast("Task added.");
  }
  saveState();
  closeTaskModal();
  render();
});

$("#deleteTaskBtn").addEventListener("click", () => {
  if (ui.editingTaskId) { closeTaskModal(); deleteTask(ui.editingTaskId); }
});

// ================= REMINDERS / NOTIFICATIONS =================
$("#notifBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) { toast("This browser doesn't support notifications."); return; }
  const perm = await Notification.requestPermission();
  updateNotifDot();
  toast(perm === "granted" ? "Reminders enabled." : "Reminders need permission to work.");
});
function updateNotifDot() {
  const on = "Notification" in window && Notification.permission === "granted";
  $("#notifDot").classList.toggle("on", !on);
}
function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  state.tasks.forEach((task) => {
    if (task.completed || task.archived || task.notified || !task.date || task.reminderMinutes === null || task.reminderMinutes === undefined) return;
    const due = dueDateTime(task).getTime();
    const fireAt = due - task.reminderMinutes * 60000;
    if (now >= fireAt && now < due + 5 * 60000) {
      new Notification("⏰ " + task.title, {
        body: task.reminderMinutes > 0 ? `Due in ${task.reminderMinutes} min` : "Due now",
        tag: task.id,
      });
      task.notified = true;
      saveState();
    }
  });
}
setInterval(checkReminders, 20000);

// ================= VOICE TASK CREATION =================
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
$("#voiceBtn").addEventListener("click", () => {
  if (!SpeechRec) { toast("Voice input isn't supported in this browser — try Chrome."); return; }
  const rec = new SpeechRec();
  rec.lang = "en-US";
  rec.interimResults = false;
  toast("Listening… say your task.");
  rec.start();
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    openTaskModal(null);
    $("#taskTitle").value = text.charAt(0).toUpperCase() + text.slice(1);
    parseVoiceDate(text);
    updateSmartHint();
  };
  rec.onerror = () => toast("Didn't catch that — try again.");
});
function parseVoiceDate(text) {
  const t = text.toLowerCase();
  const today = new Date();
  if (t.includes("tomorrow")) {
    today.setDate(today.getDate() + 1);
    $("#taskDate").value = today.toISOString().slice(0, 10);
  } else if (t.includes("today")) {
    $("#taskDate").value = today.toISOString().slice(0, 10);
  }
}

// ================= EXPORT / IMPORT =================
$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `waypoint-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported your data as a JSON file.");
});
$("#importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported.tasks) throw new Error("bad file");
      state = {
        tasks: [...state.tasks, ...imported.tasks.map((t) => ({ ...t, id: uid() }))],
        categories: state.categories,
        goals: [...state.goals, ...(imported.goals || [])],
        user: state.user,
        theme: state.theme,
      };
      saveState();
      render();
      toast(`Imported ${imported.tasks.length} tasks.`);
    } catch {
      toast("That file doesn't look like a Waypoint export.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ================= TOAST =================
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ================= OFFLINE STATUS =================
window.addEventListener("offline", () => toast("You're offline — changes are saved locally and will stay on this device."));
window.addEventListener("online", () => toast("Back online."));

// ================= INIT =================
function init() {
  applyTheme();
  renderAccount();
  populateCategorySelect();
  populateGoalSelect();
  setActiveFilterUI();
  bindDragOver();
  updateNotifDot();
  render();
  initFirebaseAuthListener();

  if (!state.tasks.length) seedExampleTasks();
}

function seedExampleTasks() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  state.tasks.push(
    {
      id: uid(), title: "Plan the Europe trip", description: "Flights, hotel, and a rough day-by-day plan.",
      date: tomorrow, time: "18:00", priority: "medium", category: "personal", recurrence: "none",
      reminderMinutes: 60, goalId: null, completed: false, archived: false, createdAt: Date.now(), order: 0, notified: false,
      subtasks: [{ id: uid(), text: "Pack backpack", done: false }, { id: uid(), text: "Book museum tour", done: false }],
    },
    {
      id: uid(), title: "Send the quarterly report", description: "Double-check the numbers with finance first.",
      date: today, time: "17:00", priority: "high", category: "work", recurrence: "none",
      reminderMinutes: 30, goalId: null, completed: false, archived: false, createdAt: Date.now() - 1000, order: 1, notified: false,
      subtasks: [],
    },
    {
      id: uid(), title: "Morning run", description: "3km, easy pace.",
      date: today, time: "07:00", priority: "low", category: "health", recurrence: "daily",
      reminderMinutes: 10, goalId: null, completed: false, archived: false, createdAt: Date.now() - 2000, order: 2, notified: false,
      subtasks: [],
    }
  );
  saveState();
  render();
}

init();
