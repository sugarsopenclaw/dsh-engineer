const LABELS = {
  good: "好",
  ordinary: "普通",
  poor: "差",
  software_fail: "软件失败",
  not_a_task: "非任务",
};
const ORDER = ["good", "ordinary", "poor", "software_fail", "not_a_task"];
const FOLLOW_LABELS = {
  open: "未处理",
  plan: "修复方案",
  fixed: "修复完成",
  accepted: "验收",
};
const FOLLOW_ORDER = ["open", "plan", "fixed", "accepted"];
const INTENT = {
  new_task: "新需求",
  clarification: "澄清",
  correction: "纠正",
  retry_similar: "重试",
  dissatisfied: "不满意",
  chitchat: "闲聊",
  other: "其它",
};
const TASK = {
  cad_read: "识图读数",
  cad_locate: "定位",
  cad_count: "统计",
  cad_draft: "出图改图",
  write_table: "写表",
  search_spec: "搜规范",
  chitchat: "闲聊",
  other: "其它",
};

const state = {
  tree: null,
  verdict: "",
  followup: "",
  query: "",
  followDraft: "open",
  openUsers: new Set(),
  openProjects: new Set(),
  selected: "",
};

function fmtMs(ms) {
  if (ms == null) return "—";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  return `${(n / 60000).toFixed(1)} min`;
}

function dots(counts) {
  return ORDER.filter((key) => counts[key])
    .map((key) => `<span class="dot ${key}">${LABELS[key]} ${counts[key]}</span>`)
    .join("");
}

function matchCase(item) {
  if (state.verdict && item.verdict !== state.verdict) return false;
  const follow = item.followup_status || "open";
  if (state.followup && follow !== state.followup) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [item.question, item.conversation_title, item.task_type, item.capability_family]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function visibleTree() {
  const users = [];
  for (const user of state.tree.users) {
    const projects = [];
    for (const project of user.projects) {
      const cases = project.cases.filter(matchCase);
      if (!cases.length) continue;
      const verdicts = Object.fromEntries(ORDER.map((key) => [key, 0]));
      for (const item of cases) verdicts[item.verdict] = (verdicts[item.verdict] || 0) + 1;
      projects.push({ ...project, cases, count: cases.length, verdicts });
    }
    if (!projects.length) continue;
    const verdicts = Object.fromEntries(ORDER.map((key) => [key, 0]));
    let count = 0;
    for (const project of projects) {
      count += project.count;
      for (const key of ORDER) verdicts[key] += project.verdicts[key] || 0;
    }
    users.push({ ...user, projects, count, verdicts });
  }
  return users;
}

function renderChips() {
  const all = state.tree.verdicts || {};
  const bits = [
    `<button class="chip ${state.verdict ? "" : "on"}" data-v="">全部<span class="n">${state.tree.successful}</span></button>`,
  ];
  for (const key of ORDER) {
    bits.push(
      `<button class="chip ${state.verdict === key ? "on" : ""}" data-v="${key}"><span class="swatch ${key}"></span>${LABELS[key]}<span class="n">${all[key] || 0}</span></button>`
    );
  }
  document.getElementById("verdict-chips").innerHTML = bits.join("");
  const follows = state.tree.followups || {};
  const fbits = [
    `<button class="chip ${state.followup ? "" : "on"}" data-f="">跟进全部</button>`,
  ];
  for (const key of FOLLOW_ORDER) {
    fbits.push(
      `<button class="chip ${state.followup === key ? "on" : ""}" data-f="${key}"><span class="swatch ${key}"></span>${FOLLOW_LABELS[key]}<span class="n">${follows[key] || 0}</span></button>`
    );
  }
  document.getElementById("followup-chips").innerHTML = fbits.join("");
}

function renderTree() {
  const users = visibleTree();
  const root = document.getElementById("tree");
  if (!users.length) {
    root.innerHTML = `<p class="empty-note">没有匹配的评审</p>`;
    return;
  }
  root.innerHTML = users
    .map((user) => {
      const open = state.openUsers.has(user.id);
      const name = user.display_name ? `${user.display_name} · ${user.email}` : user.email;
      const projects = open
        ? user.projects
            .map((project) => {
              const poke = `${user.id}::${project.id}`;
              const popen = state.openProjects.has(poke);
              let lastConv = null;
              const rows = [];
              if (popen) {
                for (const item of project.cases) {
                  if (item.conversation_title && item.conversation_title !== lastConv) {
                    lastConv = item.conversation_title;
                    rows.push(`<div class="conv-label">${esc(lastConv)}</div>`);
                  }
                  rows.push(
                    `<article class="case ${item.verdict} ${state.selected === item.id ? "sel" : ""}" data-case="${esc(item.id)}">
                      <span class="tag ${item.verdict}">${LABELS[item.verdict] || item.verdict}</span>
                      <div class="case-body">
                        <div class="q">${esc(item.question || "（无问题文本）")}</div>
                        <div class="meta">${esc(FOLLOW_LABELS[item.followup_status || "open"])} · 第 ${item.user_ordinal} 轮 · ${esc(TASK[item.task_type] || item.task_type || "")} · ${fmtMs(item.duration_ms)}</div>
                      </div>
                    </article>`
                  );
                }
              }
              return `<div class="project">
                <div class="row" data-project="${esc(poke)}">
                  <span class="caret">${popen ? "▾" : "▸"}</span>
                  <div>
                    <div class="title">${esc(project.name)}</div>
                    <div class="sub">${project.count} 条评审${project.unarchived ? " · usage" : ""}</div>
                  </div>
                  <div class="counts">${dots(project.verdicts)}</div>
                </div>
                ${popen ? `<div class="cases">${rows.join("")}</div>` : ""}
              </div>`;
            })
            .join("")
        : "";
      return `<div class="user">
        <div class="row" data-user="${esc(user.id)}">
          <span class="caret">${open ? "▾" : "▸"}</span>
          <div>
            <div class="title">${esc(name)}</div>
            <div class="sub">${user.count} 条 · ${user.projects.length} 个项目</div>
          </div>
          <div class="counts">${dots(user.verdicts)}</div>
        </div>
        ${open ? projects : ""}
      </div>`;
    })
    .join("");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function block(title, body) {
  if (body == null || body === "") return "";
  return `<section class="block"><h3>${esc(title)}</h3><pre>${esc(body)}</pre></section>`;
}

function renderDetail(data) {
  const op = data.opinion || {};
  const metrics = data.metrics || {};
  const follow = data.followup || { status: "open", note: "" };
  state.followDraft = follow.status || "open";
  const imgs = (data.images || [])
    .filter((img) => img.src)
    .map((img) => `<img src="${esc(img.src)}" alt="" />`)
    .join("");
  const feedback = Array.isArray(data.feedback)
    ? data.feedback.map((item) => JSON.stringify(item, null, 2)).join("\n")
    : data.feedback;
  const followBtns = FOLLOW_ORDER.map(
    (key) =>
      `<button type="button" data-follow="${key}" class="${state.followDraft === key ? "on" : ""}">${FOLLOW_LABELS[key]}</button>`
  ).join("");
  document.getElementById("detail").innerHTML = `
    <div class="kicker">${esc(data.email)} · ${esc(data.project_name)}${data.conversation_title ? " · " + esc(data.conversation_title) : ""} · 第 ${data.user_ordinal} 轮</div>
    <div class="badge-row"><span class="badge ${op.verdict}">${esc(LABELS[op.verdict] || op.verdict)}</span><span class="badge ${follow.status || "open"}">${esc(FOLLOW_LABELS[follow.status || "open"])}</span></div>
    <h2>${esc(data.question || "（无问题文本）")}</h2>
    <div class="grid">
      <div class="stat"><b>质量</b>${esc(LABELS[op.quality_label] || op.quality_label || "—")}</div>
      <div class="stat"><b>意图</b>${esc(INTENT[op.intent] || op.intent || "—")}</div>
      <div class="stat"><b>任务</b>${esc(TASK[op.task_type] || op.task_type || "—")}</div>
      <div class="stat"><b>证据</b>${esc(op.evidence_use || "—")}</div>
      <div class="stat"><b>纠正后</b>${esc(op.recovery || "—")}</div>
      <div class="stat"><b>能力标签</b>${esc(op.capability_family || "—")}</div>
      <div class="stat"><b>软件层</b>${esc(op.software_level || "—")}</div>
      <div class="stat"><b>用时</b>${fmtMs(metrics.duration_ms)}</div>
      <div class="stat"><b>tokens</b>${metrics.total_tokens != null ? Number(metrics.total_tokens).toLocaleString() : "—"}</div>
      <div class="stat"><b>工具</b>${metrics.tool_ok ?? 0} 成 / ${metrics.tool_fail ?? 0} 败</div>
      <div class="stat"><b>评委</b>${esc(data.judge_model || "—")}</div>
    </div>
    <section class="block">
      <h3>跟进状态</h3>
      <div class="follow-row">${followBtns}</div>
      <textarea id="follow-note" placeholder="写修复方案、改动说明或验收记录">${esc(follow.note || "")}</textarea>
      <div class="follow-actions"><button type="button" id="follow-save">保存跟进</button><span id="follow-msg">${follow.updated_at ? "上次 " + esc(follow.updated_at) : ""}</span></div>
    </section>
    ${block("LLM 结论", op.verdict_reason || op.llm_judge)}
    ${block("产品改进", op.product_note)}
    ${block("质量说明", op.quality_summary)}
    ${block("意图说明", op.intent_summary)}
    ${block("软件层说明", op.software_summary)}
    ${block("晓量回答", data.final_answer)}
    ${block("用户反馈", typeof feedback === "string" ? feedback : "")}
    ${imgs ? `<section class="block"><h3>本轮证据图</h3><div class="imgs">${imgs}</div></section>` : ""}
  `;
}

async function openCase(id) {
  state.selected = id;
  renderTree();
  const pane = document.getElementById("detail");
  pane.classList.remove("empty");
  pane.textContent = "读取这一轮…";
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`);
  if (!res.ok) {
    pane.textContent = "这一轮读不到。";
    return;
  }
  renderDetail(await res.json());
}

function patchTreeFollowup(caseId, status, note) {
  if (!state.tree) return;
  for (const user of state.tree.users) {
    for (const project of user.projects) {
      for (const item of project.cases) {
        if (item.id === caseId) {
          item.followup_status = status;
          item.followup_note = note;
        }
      }
    }
  }
  const counts = Object.fromEntries(FOLLOW_ORDER.map((key) => [key, 0]));
  for (const user of state.tree.users) {
    for (const project of user.projects) {
      for (const item of project.cases) {
        counts[item.followup_status || "open"] += 1;
      }
    }
  }
  state.tree.followups = counts;
}

async function saveFollowup(caseId) {
  const msg = document.getElementById("follow-msg");
  const note = document.getElementById("follow-note")?.value || "";
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: state.followDraft, note }),
  });
  if (!res.ok) {
    if (msg) msg.textContent = "保存失败";
    return;
  }
  patchTreeFollowup(caseId, state.followDraft, note);
  renderChips();
  renderTree();
  if (msg) msg.textContent = "已保存";
}

function bind() {
  document.getElementById("verdict-chips").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-v]");
    if (!btn) return;
    state.verdict = btn.getAttribute("data-v") || "";
    renderChips();
    renderTree();
  });
  document.getElementById("followup-chips").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-f]");
    if (!btn) return;
    state.followup = btn.getAttribute("data-f") || "";
    renderChips();
    renderTree();
  });
  document.getElementById("detail").addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-follow]");
    if (pick) {
      state.followDraft = pick.getAttribute("data-follow") || "open";
      for (const btn of document.querySelectorAll("[data-follow]")) {
        btn.classList.toggle("on", btn.getAttribute("data-follow") === state.followDraft);
      }
      return;
    }
    if (ev.target.id === "follow-save" && state.selected) {
      saveFollowup(state.selected);
    }
  });
  document.getElementById("search").addEventListener("input", (ev) => {
    state.query = ev.target.value;
    renderTree();
  });
  document.getElementById("tree").addEventListener("click", (ev) => {
    const user = ev.target.closest("[data-user]");
    if (user) {
      const id = user.getAttribute("data-user");
      if (state.openUsers.has(id)) state.openUsers.delete(id);
      else state.openUsers.add(id);
      renderTree();
      return;
    }
    const project = ev.target.closest("[data-project]");
    if (project) {
      const id = project.getAttribute("data-project");
      if (state.openProjects.has(id)) state.openProjects.delete(id);
      else state.openProjects.add(id);
      renderTree();
      return;
    }
    const item = ev.target.closest("[data-case]");
    if (item) openCase(item.getAttribute("data-case"));
  });
}

async function boot() {
  bind();
  const res = await fetch("/api/tree");
  state.tree = await res.json();
  const v = state.tree.verdicts || {};
  document.getElementById("summary-line").textContent =
    `${state.tree.successful} 条成功评审 · ${state.tree.users.length} 位用户 · 好 ${v.good || 0} / 普通 ${v.ordinary || 0} / 差 ${v.poor || 0} / 软件失败 ${v.software_fail || 0} / 非任务 ${v.not_a_task || 0}`;
  renderChips();
  renderTree();
}

boot().catch((err) => {
  document.getElementById("summary-line").textContent = `读库失败：${err}`;
});
