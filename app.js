import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot,
  serverTimestamp, writeBatch, runTransaction, setDoc
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { firebaseConfig, tutorUid as configuredTutorUid } from "./firebase-config.js";

const criteria = [
  { key: "relevance", label: "Pertinencia con la carrera", short: "Pertinencia", weight: 20 },
  { key: "knowledge", label: "Manejo del tema", short: "Manejo", weight: 15 },
  { key: "scope", label: "Delimitación", short: "Enfoque", weight: 20 },
  { key: "feasibility", label: "Facilidad para investigarlo", short: "Viabilidad", weight: 25 },
  { key: "contribution", label: "Aporte del estudio", short: "Aporte", weight: 20 }
];
const scoreTopics = (values) => criteria.reduce((sum, item) => sum + (Number(values[item.key] || 0) * item.weight / 10), 0);
const $ = (id) => document.getElementById(id);
const state = { auth: null, db: null, user: null, profile: null, isTutor: false, phase: "setup", participants: [], topics: [], votes: [], drafts: {}, unsub: [], booting: false };

function alert(message, kind = "success") {
  const node = $(kind === "error" ? "firebase-alert" : "global-alert");
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(node._hideTimer);
  if (kind !== "error") node._hideTimer = window.setTimeout(() => node.hidden = true, 5200);
}
function setConnection(mode, label) {
  const node = $("connection");
  node.className = `connection ${mode}`;
  $("connection-label").textContent = label;
}
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function isConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REPLACE_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("REPLACE_") &&
    firebaseConfig.appId && !firebaseConfig.appId.startsWith("REPLACE_");
}
function voteId(uid, topicId) { return `${uid}__${topicId}`; }
function voteMap() { return new Map(state.votes.map((v) => [v.id, v.data])); }
function myVote(topicId) { return state.user ? voteMap().get(voteId(state.user.uid, topicId)) : null; }
function ownParticipant() { return state.profile?.participantId ?? null; }
function currentIsTutor() { return state.isTutor; }
function phaseLabel() { return ({ proposals: "Propuestas abiertas", voting: "Votación abierta", closed: "Sesión cerrada", setup: "Esperando configuración" })[state.phase] || "Esperando configuración"; }

function drawWeights() {
  $("weight-strip").innerHTML = criteria.map(c => `<div class="weight-chip"><span>${safeText(c.label)}</span><strong>${c.weight} puntos</strong></div>`).join("");
}

function switchView(name) {
  document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "vote") renderVoting();
  if (name === "results") renderRanking();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.go)));
$("tutor-open").addEventListener("click", () => { $("tutor-panel").hidden = false; $("tutor-panel").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("tutor-close").addEventListener("click", () => $("tutor-panel").hidden = true);

function listenToData() {
  state.unsub.forEach(fn => fn());
  state.unsub = [];
  const settingsRef = doc(state.db, "settings", "main");
  state.unsub.push(onSnapshot(settingsRef, snapshot => {
    state.phase = snapshot.exists() ? snapshot.data().phase : "setup";
    $("phase-pill").textContent = phaseLabel();
    renderTopics(); renderVoting(); renderRanking(); renderTutorState();
  }, error => alert(`No se pudo leer la etapa: ${error.message}`, "error")));
  state.unsub.push(onSnapshot(collection(state.db, "participants"), snapshot => {
    state.participants = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.active !== false).sort((a,b) => a.name.localeCompare(b.name, "es"));
    renderParticipantOptions(); renderTutorRoster(); updateMetrics();
  }, error => alert(`No se pudo cargar la lista de participantes: ${error.message}`, "error")));
  state.unsub.push(onSnapshot(collection(state.db, "topics"), snapshot => {
    state.topics = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name,"es") || a.slot-b.slot);
    renderTopics(); renderVoting(); renderRanking(); updateMetrics();
  }, error => alert(`No se pudieron cargar los temas: ${error.message}`, "error")));
  state.unsub.push(onSnapshot(collection(state.db, "votes"), snapshot => {
    state.votes = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
    renderVoting(); renderRanking(); updateMetrics();
  }, error => alert(`No se pudieron cargar los resultados: ${error.message}`, "error")));
}

function updateMetrics() {
  $("topic-count").textContent = state.topics.length;
  $("participant-count").textContent = state.participants.length;
  const voters = new Set(state.votes.map(v => v.id.split("__")[0]));
  $("vote-count").textContent = voters.size;
}

function renderParticipantOptions() {
  const select = $("participant-select");
  const selectedId = state.profile?.participantId || select.value;
  const choices = state.participants.filter(p => !p.claimed || p.id === selectedId);
  select.innerHTML = `<option value="">Selecciona tu nombre</option>` + choices.map(p => `<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join("");
  if (selectedId) select.value = selectedId;
  select.disabled = Boolean(state.profile) || !state.user || state.isTutor;
  $("join-button").disabled = Boolean(state.profile) || !select.value || !state.user || state.isTutor;
  if (state.profile) {
    $("identity-state").hidden = false;
    $("identity-state").textContent = `Identidad activa: ${state.profile.displayName}`;
    $("identity-hint").hidden = true;
  } else {
    $("identity-state").hidden = true;
    $("identity-hint").hidden = false;
  }
}
$("participant-select").addEventListener("change", () => { $("join-button").disabled = !$("participant-select").value || !state.user || Boolean(state.profile); });

$("join-button").addEventListener("click", async () => {
  if (!state.user || state.isTutor) return;
  const participantId = $("participant-select").value;
  const participant = state.participants.find(p => p.id === participantId);
  if (!participant) return alert("Selecciona un nombre disponible.", "error");
  try {
    const profileRef = doc(state.db, "userProfiles", state.user.uid);
    const participantRef = doc(state.db, "participants", participantId);
    const claimRef = doc(state.db, "participantClaims", participantId);
    await runTransaction(state.db, async tx => {
      const [profileSnap, participantSnap] = await Promise.all([tx.get(profileRef), tx.get(participantRef)]);
      if (profileSnap.exists()) throw new Error("Este navegador ya está registrado con otro nombre.");
      if (!participantSnap.exists() || participantSnap.data().active === false) throw new Error("Ese nombre ya no está disponible.");
      if (participantSnap.data().claimed) throw new Error("Ese nombre ya fue seleccionado. Elige otro o consulta al tutor.");
      const displayName = participantSnap.data().name;
      tx.set(profileRef, { participantId, displayName, role: "student", createdAt: serverTimestamp() });
      tx.set(claimRef, { uid: state.user.uid, createdAt: serverTimestamp() });
      tx.update(participantRef, { claimed: true });
    });
    state.profile = { participantId, displayName: participant.name, role: "student" };
    renderParticipantOptions(); renderTopics(); renderVoting(); alert(`Listo, ${participant.name}. Ya puedes registrar tus temas.`);
  } catch (error) { alert(error.message || "No se pudo guardar tu identidad.", "error"); }
});

function renderTopics() {
  const root = $("topic-editor");
  const profile = state.profile;
  if (!profile || state.isTutor) {
    root.hidden = true; $("no-topics-message").hidden = false;
    $("no-topics-message").querySelector("h3").textContent = state.isTutor ? "El tutor participa en la votación" : "Primero elige tu nombre";
    $("no-topics-message").querySelector("p").textContent = state.isTutor ? "Puedes evaluar todas las propuestas desde la pestaña Votar." : "Después podrás guardar hasta tres propuestas.";
    return;
  }
  root.hidden = false; $("no-topics-message").hidden = true;
  const editable = state.phase === "proposals";
  root.innerHTML = [1,2,3].map(slot => {
    const topicId = `${profile.participantId}_${slot}`;
    const topic = state.topics.find(t => t.id === topicId);
    const value = topic?.title || "";
    const label = topic ? "Guardar cambios" : "Guardar tema";
    return `<div class="topic-row"><span class="topic-number">${slot}</span><input type="text" maxlength="180" aria-label="Tema ${slot}" placeholder="Escribe tu tema ${slot}" value="${safeText(value)}" data-topic-input="${topicId}" ${editable ? "" : "disabled"}><button class="button ${topic ? "outline" : "dark"}" type="button" data-save-topic="${slot}" ${editable ? "" : "disabled"}>${label}</button></div>`;
  }).join("");
  root.querySelectorAll("[data-save-topic]").forEach(button => button.addEventListener("click", () => saveTopic(Number(button.dataset.saveTopic))));
}

async function saveTopic(slot) {
  if (!state.profile || state.phase !== "proposals") return alert("El tutor cerró la etapa de propuestas.", "error");
  const topicId = `${state.profile.participantId}_${slot}`;
  const input = document.querySelector(`[data-topic-input="${topicId}"]`);
  const title = input?.value.trim();
  if (!title || title.length < 8) return alert("Escribe un tema de al menos 8 caracteres.", "error");
  if (title.length > 180) return alert("El tema no puede superar 180 caracteres.", "error");
  const topic = state.topics.find(t => t.id === topicId);
  const topicRef = doc(state.db, "topics", topicId);
  const ownerRef = doc(state.db, "topicOwners", topicId);
  const batch = writeBatch(state.db);
  if (topic) {
    batch.update(topicRef, { title, updatedAt: serverTimestamp() });
  } else {
    batch.set(topicRef, { participantId: state.profile.participantId, name: state.profile.displayName, slot, title, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(ownerRef, { uid: state.user.uid, participantId: state.profile.participantId, slot });
  }
  try { await batch.commit(); alert(topic ? "Tema actualizado." : "Tema guardado."); }
  catch (error) { alert(error.message || "No se pudo guardar el tema.", "error"); }
}

function renderVoting() {
  const list = $("voting-list");
  const canVote = Boolean(state.user && (state.profile || state.isTutor));
  $("vote-identity-needed").hidden = canVote;
  $("vote-footer").hidden = !canVote || state.phase !== "voting" || !state.topics.length;
  if (state.phase !== "voting") {
    list.innerHTML = `<div class="no-data"><strong>${state.phase === "closed" ? "La votación está cerrada" : "La votación aún no está abierta"}</strong>El tutor abrirá esta etapa cuando las propuestas estén listas.</div>`;
    return;
  }
  if (!canVote) { list.innerHTML = ""; return; }
  if (!state.topics.length) { list.innerHTML = `<div class="no-data"><strong>Aún no hay propuestas</strong>Cuando se registren los temas, aparecerán aquí para evaluarlos.</div>`; return; }
  const identity = state.isTutor ? "TUTOR" : safeText(state.profile.displayName);
  list.innerHTML = state.topics.map(topic => {
    const saved = myVote(topic.id);
    let draft = state.drafts[topic.id];
    if (!draft || (saved && !draft.dirty)) draft = { ...(saved?.criteria || Object.fromEntries(criteria.map(c => [c.key, 5]))), touched: Boolean(saved), dirty: false };
    state.drafts[topic.id] = draft;
    const controls = criteria.map(c => `<div class="score-control"><label for="score-${topic.id}-${c.key}"><span>${safeText(c.label)}</span><small>${c.weight} pt</small></label><input type="range" min="1" max="10" step="1" value="${Number(draft[c.key])}" id="score-${topic.id}-${c.key}" data-topic="${safeText(topic.id)}" data-criterion="${c.key}" aria-label="${safeText(c.label)} para ${safeText(topic.title)}"><div class="score-reading"><span>1</span><strong id="value-${topic.id}-${c.key}">${Number(draft[c.key])}</strong><span>10</span></div></div>`).join("");
    return `<article class="card vote-card" data-vote-card="${safeText(topic.id)}"><div class="vote-card-head"><div><p class="vote-author">${safeText(topic.name)} · TEMA ${topic.slot}</p><h3>${safeText(topic.title)}</h3></div>${saved ? `<span class="vote-self">Evaluado · puedes actualizarlo</span>` : ""}</div><div class="vote-grid">${controls}</div><div class="card-total">Puntaje calculado <strong id="total-${topic.id}">${scoreTopics(draft).toFixed(1)}</strong><span>/ 100</span></div></article>`;
  }).join("");
  updateVoteFooter();
}

$("voting-list").addEventListener("input", event => {
  const input = event.target.closest("input[data-topic][data-criterion]");
  if (!input) return;
  const { topic, criterion } = input.dataset;
  const draft = state.drafts[topic] || Object.fromEntries(criteria.map(c => [c.key, 5]));
  draft[criterion] = Number(input.value); draft.touched = true; draft.dirty = true; state.drafts[topic] = draft;
  $(`value-${topic}-${criterion}`).textContent = input.value;
  $(`total-${topic}`).textContent = scoreTopics(draft).toFixed(1);
  updateVoteFooter();
});

function updateVoteFooter() {
  const missing = state.topics.filter(t => !state.drafts[t.id]?.touched).length;
  $("vote-status-text").textContent = missing ? `Te falta evaluar ${missing} ${missing === 1 ? "tema" : "temas"}.` : `Evaluación completa para ${state.topics.length} temas.`;
  $("submit-votes").disabled = missing > 0;
}

$("submit-votes").addEventListener("click", async () => {
  if (!state.user || state.phase !== "voting") return;
  const missing = state.topics.filter(t => !state.drafts[t.id]?.touched);
  if (missing.length) return alert("Completa los cinco criterios para cada tema.", "error");
  const writes = [];
  for (const topic of state.topics) {
    const draft = state.drafts[topic.id];
    const previous = myVote(topic.id);
    const ref = doc(state.db, "votes", voteId(state.user.uid, topic.id));
    writes.push({ ref, data: {
      topicId: topic.id,
      criteria: Object.fromEntries(criteria.map(c => [c.key, Number(draft[c.key])])),
      score: Number(scoreTopics(draft).toFixed(1)),
      createdAt: previous?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }});
  }
  $("submit-votes").disabled = true;
  try {
    for (let start = 0; start < writes.length; start += 450) {
      const batch = writeBatch(state.db);
      for (const item of writes.slice(start, start + 450)) batch.set(item.ref, item.data);
      await batch.commit();
    }
    alert("Tus evaluaciones se guardaron. El ranking ya se está actualizando."); switchView("results");
  }
  catch (error) { alert(error.message || "No se pudieron guardar las evaluaciones.", "error"); }
  finally { updateVoteFooter(); }
});

function renderRanking() {
  const grouped = new Map();
  for (const vote of state.votes) {
    const topicId = vote.data.topicId;
    const current = grouped.get(topicId) || { total: 0, count: 0 };
    current.total += Number(vote.data.score || 0); current.count += 1; grouped.set(topicId, current);
  }
  const ranking = state.topics.map(topic => {
    const scores = grouped.get(topic.id) || { total: 0, count: 0 };
    return { ...topic, count: scores.count, average: scores.count ? scores.total / scores.count : null };
  }).sort((a,b) => (b.average ?? -1)-(a.average ?? -1) || a.title.localeCompare(b.title,"es"));
  updateMetrics();
  const leader = ranking.find(t => t.average !== null);
  $("leader-title").textContent = leader?.title || (ranking.length ? "Aún sin evaluaciones" : "Esperando propuestas");
  $("leader-caption").textContent = leader ? `${leader.name} · ${leader.count} ${leader.count === 1 ? "evaluación" : "evaluaciones"}` : "Cuando comiencen las evaluaciones, aquí aparecerá el tema con mayor promedio.";
  $("leader-score").textContent = leader ? leader.average.toFixed(1) : "—";
  const root = $("ranking-list");
  if (!ranking.length) { root.innerHTML = `<div class="no-data"><strong>Aún no hay temas registrados</strong>Las propuestas aparecerán aquí cuando el tutor abra el registro.</div>`; return; }
  root.innerHTML = ranking.map((t,i) => `<article class="rank-row"><span class="rank-position">${String(i+1).padStart(2,"0")}</span><div><div class="rank-title">${safeText(t.title)}</div><div class="rank-author">${safeText(t.name)} · ${t.count} ${t.count === 1 ? "evaluación" : "evaluaciones"}</div></div><div class="rank-bar"><span style="width:${Math.max(0,Math.min(100,t.average ?? 0))}%"></span></div><div class="rank-score">${t.average === null ? "—" : t.average.toFixed(1)}<small> / 100</small></div></article>`).join("");
}

function renderTutorRoster() {
  $("roster-list").innerHTML = state.participants.map(p => `<span class="roster-chip">${safeText(p.name)}${p.claimed ? " · asignada" : ""}</span>`).join("");
}

function renderTutorState() {
  const loggedIn = currentIsTutor();
  $("tutor-login").hidden = loggedIn;
  $("tutor-controls").hidden = !loggedIn;
  const uidConfigured = configuredTutorUid && !configuredTutorUid.startsWith("REPLACE_");
  $("tutor-session-status").textContent = loggedIn
    ? "Sesión de tutor autorizada en este navegador."
    : uidConfigured
      ? "Este navegador tiene acceso de participante. El panel administrativo está restringido al tutor."
      : "La conexión está lista; falta autorizar el navegador del tutor en la configuración de Firebase.";
}

$("add-participants").addEventListener("click", async () => {
  if (!state.isTutor) return;
  const names = $("roster-input").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const existing = new Set(state.participants.map(p => p.name.trim().toLocaleLowerCase("es")));
  const fresh = [];
  for (const name of names) {
    const normalized = name.toLocaleLowerCase("es");
    if (name.length > 80) return alert(`El nombre «${name.slice(0, 32)}…» supera el máximo de 80 caracteres.`, "error");
    if (!existing.has(normalized)) {
      existing.add(normalized);
      fresh.push(name);
    }
  }
  if (!fresh.length) return alert("Escribe nombres nuevos, uno por línea.", "error");
  if (fresh.length > 450) return alert("Agrega como máximo 450 nombres a la vez.", "error");
  const batch = writeBatch(state.db);
  for (const name of fresh) {
    const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,36) || "participante";
    const id = `${slug}-${crypto.randomUUID().slice(0,6)}`;
    batch.set(doc(state.db,"participants",id), { name, active:true, claimed:false, createdAt:serverTimestamp() });
  }
  try { await batch.commit(); $("roster-input").value = ""; alert(`Se agregaron ${fresh.length} participantes.`); }
  catch(error) { alert(error.message || "No se pudo actualizar la lista.","error"); }
});

document.querySelectorAll("[data-phase]").forEach(button => button.addEventListener("click", async () => {
  if (!state.isTutor) return;
  try {
    await setDoc(doc(state.db,"settings","main"), { phase:button.dataset.phase, updatedAt:serverTimestamp(), updatedBy:state.user.uid }, { merge:true });
    alert(`Etapa actualizada: ${phaseLabel()}.`);
  } catch(error) { alert(error.message || "No se pudo cambiar la etapa.","error"); }
}));

$("tutor-vote-button").addEventListener("click", () => switchView("vote"));

async function startApp() {
  drawWeights();
  if (!isConfigured()) {
    setConnection("offline","Firebase pendiente");
    $("firebase-alert").textContent = "La app está preparada, pero necesita la configuración del proyecto Firebase para guardar y sincronizar los datos.";
    $("firebase-alert").hidden = false;
    state.phase = "setup"; $("phase-pill").textContent = phaseLabel();
    renderTopics(); renderVoting(); renderRanking(); renderTutorState();
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app); state.db = getFirestore(app);
    onAuthStateChanged(state.auth, async user => {
      state.user = user;
      if (!user) {
        if (!state.booting) { state.booting = true; try { await signInAnonymously(state.auth); } catch(error) { state.booting=false; setConnection("offline","No disponible"); alert("Activa el acceso anónimo en Firebase Authentication para que las estudiantes puedan entrar.","error"); } }
        return;
      }
      state.booting = false;
      const uidConfigured = configuredTutorUid && !configuredTutorUid.startsWith("REPLACE_");
      state.isTutor = Boolean(uidConfigured && user.uid === configuredTutorUid);
      state.profile = null;
      if (!state.isTutor && user.isAnonymous) {
        try { const profileSnap = await getDoc(doc(state.db,"userProfiles",user.uid)); if (profileSnap.exists()) state.profile = profileSnap.data(); }
        catch(error) { console.warn("No se pudo cargar el perfil",error); }
      }
      setConnection("online","Firebase conectado");
      listenToData(); renderParticipantOptions(); renderTopics(); renderVoting(); renderTutorState();
      if (state.isTutor) {
        try { const settings=doc(state.db,"settings","main"); const snap=await getDoc(settings); if(!snap.exists()) await setDoc(settings,{phase:"proposals",updatedAt:serverTimestamp()}); }
        catch(error) { alert(error.message || "No se pudo inicializar la sesión.","error"); }
      }
    });
  } catch(error) { setConnection("offline","Error de configuración"); alert(error.message || "No se pudo conectar a Firebase.","error"); }
}

startApp();

