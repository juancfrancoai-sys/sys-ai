
// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
let API = '', KEY = ''
let sessionToken = localStorage.getItem('aw_session') || ''
let currentUser = null
let sseSource = null
let activeConvId = null
let convFilter = 'all'
let allConvs = []
let customAgents = []
let naKeywords = []
let _agentActive = {}
let _bizLogo = ''
let _bizName = ''
let _usersCache = []

function hdrs(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra }
  if (KEY) h['X-Dashboard-Key'] = KEY
  if (sessionToken) h['X-Session-Token'] = sessionToken
  return h
}
async function apiFetch(path, opts = {}) {
  const r = await fetch(API + path, { headers: hdrs(), ...opts })
  return r.json()
}

// ═══════════════════════════════════════════════════════════════════
// SETUP & AUTH
// ═══════════════════════════════════════════════════════════════════
function showWorkerSetup() {
  document.getElementById('setup-step1').style.display = 'flex'
  document.getElementById('setup-login').style.display = 'none'
}

function saveSetup() {
  const url = document.getElementById('su-url').value.trim().replace(/\/$/, '')
  const key = document.getElementById('su-key').value.trim()
  if (!url) { toast('Ingresá la URL del worker', 'err'); return }
  localStorage.setItem('aw_url', url)
  localStorage.setItem('aw_key', key)
  API = url; KEY = key
  document.getElementById('setup-step1').style.display = 'none'
  showLoginScreen()
}

async function showLoginScreen() {
  // Try to load business branding for login screen
  try {
    const d = await fetch(API + '/api/settings').then(r => r.json()).catch(() => ({}))
    const s = d.settings || {}
    if (s.business_name) document.getElementById('login-biz-name').textContent = s.business_name
    if (s.business_logo) {
      document.getElementById('login-logo-emoji').style.display = 'none'
      const img = document.getElementById('login-logo-img')
      img.src = s.business_logo
      img.style.display = 'block'
    }
  } catch {}
  document.getElementById('setup-login').style.display = 'flex'
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim()
  const password = document.getElementById('login-pass').value
  const errEl = document.getElementById('login-error')
  const btn = document.getElementById('login-btn')
  errEl.style.display = 'none'
  if (!username || !password) { errEl.textContent = 'Ingresá usuario y contraseña'; errEl.style.display = 'block'; return }
  btn.textContent = 'Conectando…'; btn.disabled = true
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const r = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { 'X-Dashboard-Key': KEY } : {}) },
      body: JSON.stringify({ username, password }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    const d = await r.json()
    if (d.ok && d.token) {
      sessionToken = d.token
      currentUser = d.user
      localStorage.setItem('aw_session', sessionToken)
      document.getElementById('setup-login').style.display = 'none'
      bootApp()
    } else {
      errEl.textContent = d.error || 'Usuario o contraseña incorrectos'
      errEl.style.display = 'block'
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      errEl.textContent = 'El servidor tardó demasiado en responder. Si está en Render, puede estar iniciando (espera 30s y reintentá).'
    } else {
      errEl.textContent = 'No se pudo conectar con el servidor. Verificá la URL del worker.'
    }
    errEl.style.display = 'block'
  } finally {
    btn.textContent = 'Ingresar al sistema →'; btn.disabled = false
  }
}

function logout() {
  if (!confirm('¿Cerrar sesión?')) return
  sessionToken = ''
  currentUser = null
  localStorage.removeItem('aw_session')
  location.reload()
}

function clearSetup() {
  if (!confirm('¿Desconectar y borrar configuración?')) return
  localStorage.removeItem('aw_url')
  localStorage.removeItem('aw_key')
  localStorage.removeItem('aw_session')
  location.reload()
}

function bootApp() {
  document.getElementById('app').style.display = 'block'
  document.getElementById('cfg-url').textContent = API.replace('https://', '')
  // Update sidebar user info
  if (currentUser) {
    const roleLabels = { superadmin: 'Superadmin', administracion: 'Administración', usuario: 'Usuario' }
    document.getElementById('sidebar-user-name').textContent = currentUser.name || currentUser.username
    document.getElementById('sidebar-user-role').textContent = roleLabels[currentUser.role] || currentUser.role
    document.getElementById('sidebar-user-avatar').textContent = (currentUser.name || currentUser.username || '?')[0].toUpperCase()
    applyRoleNav(currentUser.role)
  }
  initHours()
  initCalendar()
  loadProducts()
  loadCatalog()
  loadSettings().then(() => initAgents())
  init()
  // Load notification count + connect live stream
  loadNotifications()
  connectNotifStream()
}

function applyRoleNav(role) {
  // superadmin: all; administracion: no usuarios; usuario: only negocio+inbox
  const allNavs = { panel: true, negocio: true, agentes: true, inbox: true, notif: true, config: true, usuarios: false }
  if (role === 'superadmin') {
    allNavs.usuarios = true
  } else if (role === 'administracion') {
    allNavs.usuarios = false
    allNavs.config = true
  } else {
    // usuario
    allNavs.panel = false
    allNavs.agentes = false
    allNavs.config = false
    allNavs.usuarios = false
  }
  for (const [id, show] of Object.entries(allNavs)) {
    const el = document.getElementById('nav-' + id)
    if (el) el.style.display = show ? '' : 'none'
  }
}

function boot() {
  // Legacy compatibility — called from old boot path when no session needed
  bootApp()
}

// ═══════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════
const titles = { panel:'Panel', negocio:'Mi Negocio', agentes:'Agentes IA', inbox:'Conversaciones', notif:'Notificaciones', config:'Configuración', usuarios:'Usuarios' }
function nav(id, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
  document.getElementById('view-' + id).classList.add('active')
  btn.classList.add('active')
  document.getElementById('hdr-title').textContent = titles[id]
  stopConvPolling()
  if (id === 'inbox') loadConversations()
  if (id === 'negocio') loadSettings()
  if (id === 'agentes') { loadSettings().then(initAgents) }
  if (id === 'config') { loadStatus(); loadSettings() }
  if (id === 'usuarios') { loadUsers(); loadActivityLog() }
  if (id === 'notif') loadNotifications()
}

function bizTab(id, btn) {
  document.querySelectorAll('.biz-tab').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.biz-panel').forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById('biz-' + id).classList.add('active')
  if (id === 'turnos') initCalendar()
}

// ═══════════════════════════════════════════════════════════════════
// INIT & REFRESH
// ═══════════════════════════════════════════════════════════════════
async function init() {
  await Promise.all([loadStats(), loadStatus(), loadConvsPanel()])
}
function refreshAll() { init(); toast('Datos actualizados') }

// ═══════════════════════════════════════════════════════════════════
// STATS & CHARTS
// ═══════════════════════════════════════════════════════════════════
let weeklyChart, hourlyChart

async function loadStats() {
  try {
    const d = await apiFetch('/api/stats')
    document.getElementById('kpi-convs').textContent = d.total_conversations ?? '—'
    document.getElementById('kpi-contacts').textContent = d.total_contacts ?? '—'
    document.getElementById('kpi-msgs24').textContent = d.messages_24h ?? '—'
    document.getElementById('kpi-ai').textContent = d.ai_messages ?? '—'
    // Funnel
    const c = parseInt(d.total_contacts) || 0
    const h = Math.round(c * 0.65)
    const r = Math.round(c * 0.28)
    document.getElementById('fn-consultas').textContent = c
    document.getElementById('fn-c1').textContent = c
    document.getElementById('fn-historial').textContent = h
    document.getElementById('fn-c2').textContent = h
    document.getElementById('fn-recurrentes').textContent = r
    document.getElementById('fn-c3').textContent = r
    setTimeout(() => {
      if (c > 0) {
        document.getElementById('fn-bar2').style.width = Math.round((h/c)*100) + '%'
        document.getElementById('fn-bar3').style.width = Math.round((r/c)*100) + '%'
      }
    }, 300)
  } catch {}
  loadWeeklyChart()
  loadHourlyChart()
}

async function loadWeeklyChart() {
  try {
    const d = await apiFetch('/api/stats/weekly')
    const rows = d.data || []
    const days = rows.map(r => new Date(r.day).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }))
    const client = rows.map(r => r.client)
    const ai = rows.map(r => r.ai)
    if (weeklyChart) weeklyChart.destroy()
    weeklyChart = new Chart(document.getElementById('chart-weekly'), {
      type: 'line',
      data: {
        labels: days.length ? days : ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'],
        datasets: [
          { label: 'Clientes', data: client.length ? client : [0,0,0,0,0,0,0], borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,.08)', fill: true, tension: .4, pointRadius: 3, pointBackgroundColor: '#10B981' },
          { label: 'Agente', data: ai.length ? ai : [0,0,0,0,0,0,0], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.06)', fill: true, tension: .4, pointRadius: 3, pointBackgroundColor: '#3b82f6' },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
    })
  } catch {}
}

async function loadHourlyChart() {
  try {
    const d = await apiFetch('/api/stats/hourly')
    const rows = d.data || Array.from({length:24},(_,h)=>({hour:h,total:0}))
    if (hourlyChart) hourlyChart.destroy()
    hourlyChart = new Chart(document.getElementById('chart-hourly'), {
      type: 'bar',
      data: {
        labels: rows.map(r => r.hour + 'h'),
        datasets: [{ label: 'Mensajes', data: rows.map(r => r.total), backgroundColor: (ctx) => { const v = ctx.raw; const max = Math.max(...rows.map(r => r.total), 1); return v === max ? '#10B981' : 'rgba(16,185,129,.2)' }, borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } } } }
    })
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// STATUS / QR
// ═══════════════════════════════════════════════════════════════════
async function loadStatus() {
  try {
    const d = await apiFetch('/api/qr')
    updateWABadge(d.status)
    const status = await apiFetch('/api/status')
    document.getElementById('cfg-uptime').textContent = fmtUptime(status.uptime_minutes)
    document.getElementById('cfg-msgs').textContent = status.messages_processed ?? '—'
    document.getElementById('cfg-restarts').textContent = status.restarts ?? '—'
    document.getElementById('cfg-wa-status').textContent = fmtStatus(d.status)
    const area = document.getElementById('qr-area')
    if (d.status === 'connected') {
      area.innerHTML = `<div class="connected-state"><div class="connected-icon">✅</div><h3 style="font-size:17px;font-weight:700;margin:12px 0 6px">WhatsApp conectado</h3><p style="color:var(--text2);font-size:13px">El agente está activo y recibiendo mensajes.</p></div>`
    } else if (d.hasQR) {
      area.innerHTML = `<div class="qr-display"><img class="qr-img" src="${d.qrImage}"/><p style="font-size:12px;color:var(--text2);text-align:center">WhatsApp → Dispositivos vinculados → Vincular<br/><small>Recargá si expiró</small></p><button class="btn btn-ghost btn-sm" onclick="loadStatus()">↺ Recargar QR</button></div>`
    } else {
      area.innerHTML = `<div class="connected-state"><div style="font-size:48px;opacity:.4">📱</div><p style="color:var(--text2);font-size:13px;margin-top:10px">${fmtStatus(d.status)}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadStatus()">↺ Reintentar</button></div>`
    }
  } catch { updateWABadge('error') }
}

function updateWABadge(s) {
  const dot = document.getElementById('wa-dot')
  const txt = document.getElementById('wa-status-text')
  dot.className = 'wa-dot ' + (s === 'connected' ? 'connected' : s === 'qr' ? 'qr' : 'disconnected')
  txt.textContent = fmtStatus(s)
  txt.style.color = s === 'connected' ? '#10B981' : s === 'qr' ? '#f59e0b' : '#ef4444'
}

// ═══════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════
async function loadConvsPanel() {
  try {
    const d = await apiFetch('/api/conversations')
    const c = (d.conversations || []).slice(0, 5)
    const el = document.getElementById('panel-convs')
    if (!c.length) { el.innerHTML = '<div class="empty-state" style="padding:24px"><span class="empty-icon" style="font-size:28px">💬</span><p>Sin conversaciones aún</p></div>'; return }
    el.innerHTML = c.map(cv => `
      <div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;cursor:pointer" onclick="nav('inbox',document.querySelector('[onclick*=inbox]'))">
        <div class="conv-av" style="width:36px;height:36px;font-size:13px">${(cv.name || cv.phone || '?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(cv.name || cv.phone)}</div>
          <div style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cv.last_sender === 'ai' ? '🤖 ' : ''}${esc((cv.last_message || '—').substring(0, 50))}</div>
        </div>
        <div style="font-size:10px;color:var(--text3)">${fmtDate(cv.last_message_at)}</div>
      </div>`).join('')
  } catch {}
}

async function loadConversations() {
  const list = document.getElementById('conv-list-inbox')
  list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">Cargando…</div>'
  try {
    const d = await apiFetch('/api/conversations')
    allConvs = d.conversations || []
    renderConvList()
  } catch { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger)">Error al cargar</div>' }
}

function renderConvList() {
  const list = document.getElementById('conv-list-inbox')
  const q = document.getElementById('conv-search')?.value?.toLowerCase() || ''
  let convs = allConvs
  if (convFilter === 'today') {
    const today = new Date().toDateString()
    convs = convs.filter(c => c.last_message_at && new Date(c.last_message_at).toDateString() === today)
  }
  if (convFilter === 'bot') convs = convs.filter(c => c.last_sender === 'ai')
  if (q) convs = convs.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
  if (!convs.length) { list.innerHTML = '<div class="empty-state" style="padding:32px"><span class="empty-icon">💬</span><p>Sin resultados</p></div>'; return }
  list.innerHTML = convs.map(c => `
    <div class="conv-row ${activeConvId === c.id ? 'active' : ''}" onclick="openConv(${c.id},'${esc(c.name || c.phone)}','${c.phone}')">
      <div class="conv-av">${(c.name || c.phone || '?')[0].toUpperCase()}</div>
      <div class="conv-info">
        <div class="conv-name">${esc(c.name || 'Sin nombre')}<span class="conv-time">${fmtDate(c.last_message_at)}</span></div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px">${c.phone}</div>
        <div class="conv-preview ${c.last_sender === 'ai' ? 'conv-bot' : ''}">${esc((c.last_message || '—').substring(0, 45))}</div>
      </div>
    </div>`).join('')
}

function filterConvs(q) { renderConvList() }
function setFilter(f, btn) {
  convFilter = f
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'))
  btn.classList.add('active')
  renderConvList()
}

// Human-in-the-loop state


function buildMsgHtml(m) {
  const isAI = m.sender === 'ai'
  const isHuman = m.sender === 'human'
  const agentMeta = (isAI || isHuman)
    ? (isHuman ? { icon: '🧑', label: 'Operador', cls: 'at-generalista' } : agentLabel(m.agent_type))
    : { icon: '👤', label: 'Cliente', cls: 'at-cliente' }
  const imgHtml = m.media_url ? `<img src="${m.media_url}" style="max-width: 250px; border-radius: 8px; margin-bottom: 8px; display: block;" alt="Imagen enviada"/>` : ''
  return `<div class="bubble-wrap ${m.sender === 'client' ? 'client' : 'ai'}" data-msg-id="${m.id}">
    <div class="bubble-av" title="${agentMeta.label}">${agentMeta.icon}</div>
    <div>
      <div class="bubble">${imgHtml}${esc(m.content || '')}</div>
      <div class="bubble-meta">${fmtDateTime(m.created_at)}<span class="audit-tag ${agentMeta.cls}">${agentMeta.label}</span></div>
    </div>
  </div>`
}

async function refreshConvMessages(id) {
  const area = document.getElementById('msgs-area')
  if (!area || activeConvId !== id) return
  try {
    const d = await apiFetch(`/api/conversations/${id}/messages`)
    const msgs = d.messages || []
    if (!msgs.length) { area.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px">Sin mensajes</div>'; return }
    const lastRendered = area.lastElementChild?.dataset?.msgId
    const lastFetched  = String(msgs[msgs.length - 1].id)
    if (lastRendered === lastFetched) return   // nada nuevo
    const scrolledToBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 80
    area.innerHTML = msgs.map(buildMsgHtml).join('')
    if (scrolledToBottom) area.scrollTop = area.scrollHeight
    renderMediaGallery(msgs)
  } catch {}
}

function renderMediaGallery(msgs) {
  const gallery = document.getElementById('contact-media-gallery')
  if (!gallery) return
  const mediaMsgs = msgs.filter(m => m.media_url)
  if (!mediaMsgs.length) {
    gallery.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text3);text-align:center;padding:10px 0">Sin multimedia</div>'
    return
  }
  gallery.innerHTML = mediaMsgs.map(m => `<a href="${m.media_url}" target="_blank"><img src="${m.media_url}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border)" title="${esc(m.content||'Imagen')}"></a>`).join('')
}

async function openConv(id, name, phone) {
  activeConvId = id
  startConvPolling(id)
  renderConvList()
  const cv = allConvs.find(c => c.id === id) || {}
  const area = document.getElementById('chat-area')
  area.innerHTML = `<div class="chat-header"><div class="conv-av" style="width:36px;height:36px;font-size:14px">${(name||'?')[0].toUpperCase()}</div><div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(name)}</div><div style="font-size:11px;color:var(--text2)">${phone}</div></div><span class="badge ${cv.bot_paused ? 'badge-blue' : 'badge-green'}">${cv.bot_paused ? '🧑 Agente humano' : '🤖 Bot activo'}</span></div><div class="chat-msgs" id="msgs-area"><div style="text-align:center;color:var(--text2);padding:20px">Cargando…</div></div><div class="chat-input-area" id="chat-input-zone"></div>`
  renderInputZone(id)
  document.getElementById('contact-detail').innerHTML = `
    <div class="contact-panel">
      <div class="contact-av-lg">${(name||'?')[0].toUpperCase()}</div>
      <div style="text-align:center;margin-bottom:14px"><div style="font-weight:600;font-size:14px">${esc(name)}</div><div style="font-size:12px;color:var(--text2)">${phone}</div></div>
      <div class="info-row"><span class="label">Mensajes</span><span class="val">${cv.message_count || 0}</span></div>
      <div class="info-row"><span class="label">Primer contacto</span><span class="val">${fmtDate(cv.first_contact_at)}</span></div>
      <div class="info-row"><span class="label">Último mensaje</span><span class="val">${fmtDate(cv.last_message_at)}</span></div>
      <div class="hil-card">
        <h4>Human-in-the-loop</h4>
        <p style="font-size:12px;color:var(--text2);margin-bottom:10px">${cv.bot_paused ? 'Estás controlando esta conversación manualmente.' : 'El bot está respondiendo automáticamente.'}</p>
        <button class="btn hil-btn ${cv.bot_paused ? 'btn-ghost' : 'btn-danger'}" onclick="toggleHil(${id})">${cv.bot_paused ? '🤖 Devolver al bot' : '🧑 Tomar control'}</button>
      </div>
      <div class="divider"></div>
      <div class="fg"><label>Notas del contacto</label><textarea rows="3" placeholder="Anotá info relevante del cliente…" style="width:100%"></textarea></div>
      <div style="margin-top:10px"><label class="fg" style="display:block;margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Tags</span></label><div style="display:flex;flex-wrap:wrap;gap:4px"><span class="chip">cliente</span><span class="chip">+ tag</span></div></div>
      <div class="divider"></div>
      <div class="media-gallery-section" style="margin-top:10px">
        <label class="fg" style="display:block;margin-bottom:10px"><span style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Multimedia Compartida</span></label>
        <div id="contact-media-gallery" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"></div>
      </div>
    </div>`
  await refreshConvMessages(id)
}

function renderInputZone(id) {
  const zone = document.getElementById('chat-input-zone')
  if (!zone) return
  const active = allConvs.find(c => c.id === id)?.bot_paused
  zone.innerHTML = active ? `
    <div style="background:var(--info-lt);padding:6px 14px;font-size:11px;color:#1d4ed8;font-weight:500">🧑 Modo manual activo — tus mensajes van directo al cliente por WhatsApp</div>
    <div class="chat-input-row" style="padding:10px 14px">
      <textarea id="manual-input" placeholder="Escribí tu respuesta…" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendManual(${id})}"></textarea>
      <button class="btn btn-primary btn-sm" onclick="sendManual(${id})">Enviar</button>
    </div>` : `<div style="padding:10px 14px;text-align:center;font-size:12px;color:var(--text2)">🤖 El bot está manejando esta conversación automáticamente.<br/><span style="font-size:11px;color:var(--text3)">Tomá el control para responder manualmente.</span></div>`
}

async function toggleHil(id) {
  const cv = allConvs.find(c => c.id === id)
  if (!cv) return
  const newPaused = !cv.bot_paused
  try {
    const res = await apiFetch(`/api/conversations/${id}/pause`, { method: 'POST', body: JSON.stringify({ paused: newPaused }) })
    if (res.error) throw new Error(res.error)
    cv.bot_paused = newPaused
    openConv(id, cv.name || '', cv.phone || '')
    toast(newPaused ? 'Tomaste el control de la conversación' : 'El bot retomó la conversación')
  } catch (err) { toast('Error cambiando el control: ' + err.message, 'err') }
}

let _convPollInterval = null

function stopConvPolling() {
  if (_convPollInterval) { clearInterval(_convPollInterval); _convPollInterval = null }
}

function startConvPolling(id) {
  stopConvPolling()
  // Fallback poll cada 3s — el SSE ya dispara al instante cuando llega un mensaje
  _convPollInterval = setInterval(() => {
    if (activeConvId !== id) { stopConvPolling(); return }
    refreshConvMessages(id)
  }, 3000)
}

async function sendManual(id) {
  const input = document.getElementById('manual-input')
  const msg = input?.value.trim()
  if (!msg) return
  input.disabled = true
  try {
    const d = await apiFetch(`/api/conversations/${id}/send`, { method: 'POST', body: JSON.stringify({ message: msg }) })
    if (d.ok) {
      input.value = ''
      // Force immediate refresh (bypass last-id cache)
      const area = document.getElementById('msgs-area')
      if (area) area.lastElementChild?.removeAttribute('data-msg-id')
      await refreshConvMessages(id)
    } else toast(d.error || 'Error al enviar', 'err')
  } catch { toast('Error de conexión', 'err') }
  finally { if (input) input.disabled = false; input?.focus() }
}

// ═══════════════════════════════════════════════════════════════════
// AGENTES IA
// ═══════════════════════════════════════════════════════════════════
const NATIVE_AGENTS = [
  {
    type: 'generalista', emoji: '🤖', name: 'EDY · General',
    badge: { cls: 'badge-gray', label: 'Generalista' },
    badgeCls: 'at-generalista',
    desc: 'Primer punto de contacto. Responde saludos y consultas generales, y orienta al cliente hacia el agente correcto.',
    keywords: ['hola', 'buenos días', 'buenas tardes', 'consulta', 'información', 'ayuda'],
    trigger: 'Se activa cuando el mensaje no corresponde a ningún otro agente',
  },
  {
    type: 'servicios', emoji: '🔨', name: 'Agente Servicios',
    badge: { cls: 'badge-blue', label: 'Servicios' },
    badgeCls: 'at-servicios',
    desc: 'Especialista en reformas, impermeabilización, estructuras, pintura y obras en general. Explica servicios y ofrece visita sin cargo.',
    keywords: ['reforma', 'impermeabilizar', 'gotera', 'humedad', 'filtración', 'membrana', 'pintura', 'obra', 'albañil', 'revoque', 'piso', 'cerámico'],
    trigger: 'reforma, obra, humedad, pintura, membrana, estructura…',
  },
  {
    type: 'productos', emoji: '🏷️', name: 'Agente Productos',
    badge: { cls: 'badge-purple', label: 'Productos' },
    badgeCls: 'at-productos',
    desc: 'Asesor de marcas: PIATTI (aberturas PVC/aluminio), LIV (mobiliario), INTERIA (cocinas y vestidores), Escaleras a medida.',
    keywords: ['piatti', 'portón', 'abertura', 'ventana', 'puerta', 'pvc', 'aluminio', 'liv', 'sillón', 'interia', 'cocina', 'vestidor', 'escalera', 'mueble'],
    trigger: 'PIATTI, portón, LIV, sillón, INTERIA, cocina, escalera…',
  },
  {
    type: 'cotizacion', emoji: '💰', name: 'Agente Cotización',
    badge: { cls: 'badge-amber', label: 'Cotización' },
    badgeCls: 'at-cotizacion',
    desc: 'Captura la consulta de presupuesto y orienta al cliente para obtener una cotización a medida con un asesor.',
    keywords: ['presupuesto', 'cotización', 'precio', 'cuánto cuesta', 'cuánto vale', 'costo', 'tarifa', 'financiación'],
    trigger: 'presupuesto, precio, cuánto cuesta, cotización…',
  },
  {
    type: 'redireccion', emoji: '📱', name: 'Agente Redirección',
    badge: { cls: 'badge-red', label: 'Redirección' },
    badgeCls: 'at-redireccion',
    desc: 'Cuando el cliente pide hablar con un asesor: envía el link de WhatsApp del asesor y le manda al asesor un resumen de la conversación.',
    keywords: ['hablar con persona', 'hablar con asesor', 'quiero un asesor', 'quiero ser atendido', 'derivame', 'un humano'],
    trigger: '"quiero hablar con un asesor", "me comunican", "hablen conmigo"…',
  },
]

let agentOverrides = {}   // loaded from DB

function initAgents() {
  const grid = document.getElementById('native-agents')
  grid.innerHTML = NATIVE_AGENTS.map((a) => {
    const override = agentOverrides[a.type] || {}
    const name = override.name || a.name
    const emoji = override.emoji || a.emoji
    const desc = override.desc || a.desc
    const keywords = override.keywords || a.keywords
    
    const isActive = _agentActive[a.type] !== false  // default true
    return `<div class="agent-card ${isActive ? 'active-card' : ''}" style="${isActive ? 'border-left:4px solid var(--accent)' : 'opacity:.6'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <span class="agent-emoji" style="font-size:24px">${emoji}</span>
        <span class="badge ${a.badge.cls}">${a.badge.label}</span>
      </div>
      <div class="agent-name" style="margin-bottom:4px">${name}</div>
      <div class="agent-desc" style="margin-bottom:10px">${desc}</div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:10px">Activa con: ${a.trigger}</div>
      <div class="keyword-chips" style="margin-bottom:12px">${keywords.map(k => `<span class="chip" style="font-size:10px">${esc(k)}</span>`).join('')}</div>
      <div class="agent-toggle">
        <button class="btn btn-ghost btn-sm" onclick="openAgentDrawer('${a.type}')">Editar</button>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--text2)">${isActive ? 'Activo' : 'Inactivo'}</span>
          <div class="toggle ${isActive ? 'on' : ''}" onclick="toggleAgentActive('${a.type}',this)" title="Activar/desactivar agente"></div>
        </div>
      </div>
    </div>`
  }).join('')
}

async function toggleAgentActive(type, toggleEl) {
  toggleEl.classList.toggle('on')
  const isNowActive = toggleEl.classList.contains('on')
  _agentActive[type] = isNowActive
  try {
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ agent_active: _agentActive }) })
    toast(`Agente ${isNowActive ? 'activado' : 'desactivado'}`)
    initAgents()
  } catch { toast('Error al guardar', 'err') }
}

function openAgentDrawer(type = null) {
  const drawer = document.getElementById('agent-drawer')
  drawer.style.display = 'flex'
  naKeywords = []
  document.getElementById('na-keywords').innerHTML = ''
  document.getElementById('na-name').value = ''
  document.getElementById('na-desc').value = ''
  document.getElementById('na-emoji').value = ''
  document.getElementById('na-prompt').value = ''

  const nameRow = document.getElementById('agent-drawer-name-row')
  const banner = document.getElementById('agent-native-banner')
  const saveBtn = document.getElementById('agent-save-btn')

  if (type) {
    // Editing native agent
    drawer.dataset.editType = type
    drawer.dataset.editIdx = ''
    const a = NATIVE_AGENTS.find(x => x.type === type)
    const override = agentOverrides[type] || {}
    document.getElementById('agent-drawer-title').textContent = `Editar — ${override.name || a.name}`
    document.getElementById('na-name').value = override.name || a.name
    document.getElementById('na-desc').value = override.desc || a.desc
    document.getElementById('na-emoji').value = override.emoji || a.emoji
    document.getElementById('na-prompt').value = override.prompt || ''
    naKeywords = override.keywords ? [...override.keywords] : [...a.keywords]
    renderAgentKeywords()
    nameRow.style.display = 'flex'
    banner.style.display = 'block'
    saveBtn.textContent = 'Guardar cambios'
  } else {
    drawer.dataset.editType = ''
    drawer.dataset.editIdx = ''
    document.getElementById('agent-drawer-title').textContent = 'Nuevo agente personalizado'
    nameRow.style.display = 'flex'
    banner.style.display = 'none'
    saveBtn.textContent = 'Crear agente'
  }
}

function closeAgentDrawer() {
  document.getElementById('agent-drawer').style.display = 'none'
}

function addKeyword(e) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const val = e.target.value.trim()
  if (!val || naKeywords.includes(val)) { e.target.value = ''; return }
  naKeywords.push(val)
  renderAgentKeywords()
  e.target.value = ''
}

function removeKw(k) {
  naKeywords = naKeywords.filter(x => x !== k)
  renderAgentKeywords()
}

function renderAgentKeywords() {
  document.getElementById('na-keywords').innerHTML = naKeywords.map(k => `<span class="chip" onclick="removeKw('${esc(k)}')" style="cursor:pointer">${esc(k)} ✕</span>`).join('')
}

async function saveAgentDrawer() {
  const drawer = document.getElementById('agent-drawer')
  const editType = drawer.dataset.editType
  const prompt = document.getElementById('na-prompt').value.trim()

  if (editType) {
    // Save native agent overrides to DB
    const name = document.getElementById('na-name').value.trim()
    const emoji = document.getElementById('na-emoji').value.trim() || '🤖'
    const desc = document.getElementById('na-desc').value.trim()
    
    agentOverrides[editType] = { prompt: prompt || undefined, name, emoji, desc, keywords: [...naKeywords] }
    
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ agent_overrides: agentOverrides }) })
      toast(`Agente guardado`)
      closeAgentDrawer()
      initAgents()
    } catch { toast('Error guardando', 'err') }
    return
  }

  // Custom agent
  const name = document.getElementById('na-name').value.trim()
  const emoji = document.getElementById('na-emoji').value.trim() || '🧩'
  const desc = document.getElementById('na-desc').value.trim()
  if (!name) { toast('Ingresá un nombre', 'err'); return }

  const editIdx = drawer.dataset.editIdx !== '' ? parseInt(drawer.dataset.editIdx) : -1
  if (editIdx >= 0) {
    customAgents[editIdx] = { name, emoji, desc, prompt, keywords: [...naKeywords] }
    toast(`Agente "${name}" actualizado`)
  } else {
    customAgents.push({ name, emoji, desc, prompt, keywords: [...naKeywords] })
    toast(`Agente "${name}" creado`)
  }
  
  try {
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ custom_agents: customAgents }) })
    renderCustomAgents()
    closeAgentDrawer()
  } catch { toast('Error guardando', 'err') }
}

function renderCustomAgents() {
  const grid = document.getElementById('custom-agents')
  if (!grid) return
  if (!customAgents.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;border:1.5px dashed var(--border);border-radius:var(--r);"><span class="empty-icon">🧩</span><p>Aún no hay agentes personalizados.</p></div>'
    return
  }
  grid.innerHTML = customAgents.map((a, i) => `
    <div class="agent-card active-card">
      <span class="agent-emoji">${a.emoji}</span>
      <div class="agent-name">${esc(a.name)}</div>
      <div class="agent-desc">${esc(a.desc || 'Agente personalizado')}</div>
      ${a.keywords.length ? `<div class="keyword-chips" style="margin-bottom:10px">${a.keywords.map(k => `<span class="chip" style="font-size:10px">${esc(k)}</span>`).join('')}</div>` : ''}
      <div class="agent-toggle" style="margin-top:auto">
        <span class="badge badge-blue">Custom</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="editCustomAgent(${i})">Editar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteCustomAgent(${i})">✕</button>
        </div>
      </div>
    </div>`).join('')
}

function editCustomAgent(i) {
  const a = customAgents[i]
  const drawer = document.getElementById('agent-drawer')
  drawer.style.display = 'flex'
  drawer.dataset.editType = ''
  drawer.dataset.editIdx = i
  document.getElementById('agent-drawer-title').textContent = `Editar — ${a.name}`
  document.getElementById('na-name').value = a.name
  document.getElementById('na-desc').value = a.desc || ''
  document.getElementById('na-emoji').value = a.emoji || '🧩'
  document.getElementById('na-prompt').value = a.prompt || ''
  naKeywords = [...(a.keywords || [])]
  renderAgentKeywords()
  document.getElementById('agent-drawer-name-row').style.display = 'flex'
  document.getElementById('agent-native-banner').style.display = 'none'
  document.getElementById('agent-save-btn').textContent = 'Guardar cambios'
}

async function deleteCustomAgent(i) {
  if (!confirm('¿Eliminar agente?')) return
  customAgents.splice(i, 1)
  try {
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ custom_agents: customAgents }) })
    renderCustomAgents()
  } catch { toast('Error al eliminar', 'err') }
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════
let _whitelistAll    = true
let _blacklistAll    = false
let _whitelistPhones = []
let _blacklistPhones = []
let _faqs            = []
let _advisors        = []

async function loadSettings() {
  try {
    const d = await apiFetch('/api/settings')
    const s = d.settings || {}

    // AI Personality (now in Mi Negocio)
    const p = document.getElementById('cfg-personality')
    if (p) p.value = s.personality_prompt   || ''
    const b = document.getElementById('cfg-business')
    if (b) b.value = s.business_description  || ''
    const w = document.getElementById('cfg-welcome')
    if (w) w.value = s.welcome_message        || ''
    const g = document.getElementById('cfg-goals')
    if (g) g.value = s.goals                  || ''
    const r = document.getElementById('cfg-restrictions')
    if (r) r.value = s.restrictions           || ''
    const ap = document.getElementById('cfg-admin-phone')
    if (ap) ap.value = s.admin_phone           || ''
    _advisors = Array.isArray(s.advisors) ? s.advisors : []
    if (s.redirect_phone && _advisors.length === 0) {
      _advisors.push({ name: 'Asesor', phone: s.redirect_phone, role: 'General' })
    }
    renderAdvisors()

    if (s.business_hours) {
      const bh = s.business_hours
      hoursState.forEach((h, i) => {
        const stored = bh[DAYS[i]]
        if (stored) {
          h.on = stored.on !== false
          h.split = stored.split === true
          h.from = stored.from || '09:00'
          h.to = stored.to || '18:00'
          h.from2 = stored.from2 || '14:00'
          h.to2 = stored.to2 || '18:00'
        }
      })
      initHours()
    }

    // Whitelist / Blacklist
    const wl = Array.isArray(s.allowed_phones) ? s.allowed_phones : []
    _whitelistAll = wl.length === 0   // empty list = all allowed
    _whitelistPhones = wl
    renderWhitelistUI()

    _blacklistAll = !!s.blacklist_all
    _blacklistPhones = Array.isArray(s.blacklist_phones) ? s.blacklist_phones : []
    renderBlacklistUI()

    // Agent prompts
    agentPrompts = (s.agent_prompts && typeof s.agent_prompts === 'object') ? s.agent_prompts : {}

    // Agent overrides
    agentOverrides = (s.agent_overrides && typeof s.agent_overrides === 'object') ? s.agent_overrides : {}

    // Agent active state
    _agentActive = (s.agent_active && typeof s.agent_active === 'object') ? s.agent_active : {}

    // FAQs
    _faqs = Array.isArray(s.faqs) ? s.faqs : []
    renderFaqs()

    // Custom agents
    customAgents = Array.isArray(s.custom_agents) ? s.custom_agents : []
    renderCustomAgents()

    // Business identity
    _bizName = s.business_name || ''
    _bizLogo = s.business_logo || ''
    const bizNameInput = document.getElementById('cfg-biz-name')
    if (bizNameInput) bizNameInput.value = _bizName

    // Update sidebar branding
    if (_bizName) document.getElementById('sidebar-biz-name').textContent = _bizName
    const logoMark = document.getElementById('sidebar-logo-mark')
    const bizLogoImg = document.getElementById('biz-logo-img')
    const bizLogoEmoji = document.getElementById('biz-logo-emoji')
    if (_bizLogo && logoMark) {
      logoMark.innerHTML = `<img src="${_bizLogo}" style="width:100%;height:100%;object-fit:cover;border-radius:10px"/>`
    }
    if (bizLogoImg && _bizLogo) {
      bizLogoImg.src = _bizLogo
      bizLogoImg.style.display = 'block'
      if (bizLogoEmoji) bizLogoEmoji.style.display = 'none'
      const removeBtn = document.getElementById('biz-logo-remove')
      if (removeBtn) removeBtn.style.display = ''
    }

  } catch { toast('Error al cargar configuración', 'err') }
}

async function saveSettings(source = 'biz') {
  try {
    let body = {}
    if (source === 'identity') {
      const name = document.getElementById('cfg-biz-name')?.value?.trim() || undefined
      body = { business_name: name, business_logo: _bizLogo || null }
      // Update sidebar immediately
      if (name) { document.getElementById('sidebar-biz-name').textContent = name; _bizName = name }
    } else if (source === 'biz') {
      body = {
        personality_prompt:   document.getElementById('cfg-personality')?.value   || undefined,
        business_description: document.getElementById('cfg-business')?.value      || undefined,
        welcome_message:      document.getElementById('cfg-welcome')?.value       || undefined,
        goals:                document.getElementById('cfg-goals')?.value         || undefined,
        restrictions:         document.getElementById('cfg-restrictions')?.value  || undefined,
        admin_phone:          document.getElementById('cfg-admin-phone')?.value?.trim()   || undefined,
        advisors:             _advisors,
        business_hours:       hoursState.reduce((acc, h, i) => { acc[DAYS[i]] = h; return acc }, {}),
        holidays:             holidays,
      }
    } else {
      // 'cfg' = access control section
      body = {
        allowed_phones:   _whitelistAll ? [] : [..._whitelistPhones],
        blacklist_phones: [..._blacklistPhones],
        blacklist_all:    _blacklistAll,
      }
    }
    const d = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(body) })
    if (d.ok) {
      const okId = source === 'biz' ? 'biz-save-ok' : source === 'identity' ? 'biz-id-save-ok' : 'save-ok'
      const ok = document.getElementById(okId)
      if (ok) { ok.style.display = 'inline'; setTimeout(() => ok.style.display = 'none', 3000) }
      toast('Guardado correctamente')
    } else toast('Error al guardar', 'err')
  } catch { toast('Error de conexión', 'err') }
}

// ── Whitelist UI ─────────────────────────────────────────────────
function toggleWhitelistAll() {
  _whitelistAll = !_whitelistAll
  renderWhitelistUI()
}

function renderWhitelistUI() {
  const toggle = document.getElementById('wl-all-toggle')
  const area   = document.getElementById('wl-specific-area')
  const hint   = document.getElementById('wl-mode-hint')
  if (!toggle) return
  toggle.classList.toggle('on', _whitelistAll)
  area.style.display = _whitelistAll ? 'none' : 'block'
  hint.textContent = _whitelistAll
    ? 'El bot acepta mensajes de cualquier número'
    : (_whitelistPhones.length === 0 ? '⚠️ Lista vacía — el bot no responde a nadie' : `Solo ${_whitelistPhones.length} número(s) habilitado(s)`)
  renderWhitelistChips()
}

function renderWhitelistChips() {
  const el = document.getElementById('whitelist-chips')
  if (!el) return
  el.innerHTML = _whitelistPhones.map((p, i) => phoneChip(p, i, 'removeWhitelistPhone')).join('')
}

function addWhitelistPhone() {
  const input = document.getElementById('whitelist-input')
  const val = input.value.trim().replace(/\D/g, '')
  if (!val) return
  if (_whitelistPhones.includes(val)) { toast('Ese número ya está en la lista'); input.value = ''; return }
  _whitelistPhones.push(val)
  renderWhitelistUI()
  input.value = ''
  input.focus()
}

function removeWhitelistPhone(idx) {
  _whitelistPhones.splice(idx, 1)
  renderWhitelistUI()
}

// ── Blacklist UI ─────────────────────────────────────────────────
function toggleBlacklistAll() {
  _blacklistAll = !_blacklistAll
  renderBlacklistUI()
}

function renderBlacklistUI() {
  const toggle = document.getElementById('bl-all-toggle')
  const area   = document.getElementById('bl-specific-area')
  const hint   = document.getElementById('bl-mode-hint')
  if (!toggle) return
  toggle.classList.toggle('on', _blacklistAll)
  area.style.display = _blacklistAll ? 'none' : 'block'
  hint.textContent = _blacklistAll
    ? '⚠️ Bloqueo total activo — el bot no responde a nadie'
    : (_blacklistPhones.length === 0 ? 'El bot responde con normalidad' : `${_blacklistPhones.length} número(s) bloqueado(s)`)
  toggle.style.background = _blacklistAll ? 'var(--danger)' : ''
  renderBlacklistChips()
}

function renderBlacklistChips() {
  const el = document.getElementById('blacklist-chips')
  if (!el) return
  el.innerHTML = _blacklistPhones.map((p, i) => phoneChip(p, i, 'removeBlacklistPhone', true)).join('')
}

function addBlacklistPhone() {
  const input = document.getElementById('blacklist-input')
  const val = input.value.trim().replace(/\D/g, '')
  if (!val) return
  if (_blacklistPhones.includes(val)) { toast('Ese número ya está bloqueado'); input.value = ''; return }
  _blacklistPhones.push(val)
  renderBlacklistUI()
  input.value = ''
  input.focus()
}

function removeBlacklistPhone(idx) {
  _blacklistPhones.splice(idx, 1)
  renderBlacklistUI()
}

function phoneChip(phone, idx, removeFn, danger = false) {
  const color = danger ? 'var(--danger-lt)' : 'var(--bg3)'
  const border = danger ? '#fca5a5' : 'var(--border2)'
  const textColor = danger ? 'var(--danger)' : 'var(--text)'
  return `<span style="display:inline-flex;align-items:center;gap:5px;background:${color};border:1px solid ${border};border-radius:20px;padding:3px 10px 3px 12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:${textColor}">
    ${phone}
    <button onclick="${removeFn}(${idx})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;line-height:1;padding:0;margin-left:2px" title="Eliminar">×</button>
  </span>`
}

// ── ADVISORS UI ─────────────────────────────────────────────────
  function renderAdvisors() {
    const wrap = document.getElementById('advisors-list')
    if (!wrap) return
    wrap.innerHTML = _advisors.map((a, i) => `
      <div style="display:flex;gap:8px;align-items:center">
        <input placeholder="Nombre" value="${a.name||''}" onchange="_advisors[${i}].name=this.value" style="flex:1;min-width:80px;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px"/>
        <input placeholder="Especialidad (ej: Ventas)" value="${a.role||''}" onchange="_advisors[${i}].role=this.value" style="flex:1;min-width:80px;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px"/>
        <input placeholder="Teléfono" value="${a.phone||''}" onchange="_advisors[${i}].phone=this.value" style="flex:1.5;min-width:100px;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px;font-family:monospace"/>
        <button class="btn-icon" onclick="_advisors.splice(${i},1);renderAdvisors()" style="color:var(--danger)">✕</button>
      </div>
    `).join('')
  }
  function addAdvisor() {
    _advisors.push({ name: '', phone: '', role: '' })
    renderAdvisors()
  }

// ═══════════════════════════════════════════════════════════════════
// HOURS
// ═══════════════════════════════════════════════════════════════════
  const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
  const hoursState = DAYS.map((_, i) => ({ on: i < 5, split: false, from: '09:00', to: '18:00', from2: '14:00', to2: '18:00' }))
  let holidays = []

  function initHours() {
    const g = document.getElementById('hours-grid')
    g.innerHTML = DAYS.map((d, i) => `
      <div style="display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg2)">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px; flex-wrap: wrap;">
          <div class="toggle ${hoursState[i].on ? 'on' : ''}" onclick="toggleDay(${i})" id="hday-${i}"></div>
          <span style="width:80px;color:var(--text${hoursState[i].on ? '' : '2'})" id="hlabel-${i}">${d}</span>
          
          <input type="time" value="${hoursState[i].from}" onchange="hoursState[${i}].from=this.value" id="hfrom-${i}" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px;${hoursState[i].on ? '' : 'opacity:.4'}"/>
          <span style="color:var(--text2)">a</span>
          <input type="time" value="${hoursState[i].to}" onchange="hoursState[${i}].to=this.value" id="hto-${i}" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px;${hoursState[i].on ? '' : 'opacity:.4'}"/>
          
          <div id="hsplit-row-${i}" style="display:${hoursState[i].split && hoursState[i].on ? 'flex' : 'none'};align-items:center;gap:8px;">
            <input type="time" value="${hoursState[i].from2}" onchange="hoursState[${i}].from2=this.value" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px"/>
            <span style="color:var(--text2)">a</span>
            <input type="time" value="${hoursState[i].to2}" onchange="hoursState[${i}].to2=this.value" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px"/>
          </div>

          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
            <label style="font-size:11px;color:var(--text2);cursor:pointer; display:flex;align-items:center;gap:4px;">
              <input type="checkbox" ${hoursState[i].split ? 'checked' : ''} onchange="toggleSplit(${i})" ${hoursState[i].on ? '' : 'disabled'} id="hsplit-${i}"/> Cortado
            </label>
            <button class="btn-icon" onclick="copyDayHours(${i})" title="Copiar horario a los demás días activos" style="color:var(--text2); font-size: 14px;">📋</button>
          </div>
        </div>
      </div>`).join('')
  }

  function copyDayHours(srcIdx) {
    const src = hoursState[srcIdx]
    hoursState.forEach((h, i) => {
      if (i !== srcIdx && h.on) {
        h.from = src.from; h.to = src.to;
        h.split = src.split; h.from2 = src.from2; h.to2 = src.to2;
      }
    })
    initHours()
  }

  function renderHolidays() {
    const list = document.getElementById('holidays-list')
    if (!list) return
    if (holidays.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text3)">No hay feriados cargados.</div>'
      return
    }
    // sort holidays
    holidays.sort()
    list.innerHTML = holidays.map((h, i) => `
      <div style="display:flex;gap:8px;align-items:center;background:var(--bg3);padding:6px 12px;border-radius:4px;width:fit-content">
        <span style="font-size:13px">${h}</span>
        <button class="btn-icon" onclick="removeHoliday(${i})" style="color:var(--danger)">✕</button>
      </div>
    `).join('')
  }

  function addHoliday() {
    const input = document.getElementById('holiday-date')
    const val = input?.value
    if (!val) return
    if (!holidays.includes(val)) {
      holidays.push(val)
      renderHolidays()
    }
    input.value = ''
  }

  function removeHoliday(i) {
    holidays.splice(i, 1)
    renderHolidays()
  }

  function toggleDay(i) {
    hoursState[i].on = !hoursState[i].on
    initHours()
  }

  function toggleSplit(i) {
    hoursState[i].split = !hoursState[i].split
    initHours()
  }

  function setHours(preset) {
    if (preset === 'lv') { hoursState.forEach((h, i) => { h.on = i < 5; h.split = false; h.from = '09:00'; h.to = '18:00' }) }
    if (preset === 'ls') { hoursState.forEach((h, i) => { h.on = i < 6; h.split = false; h.from = '09:00'; h.to = '20:00' }) }
    if (preset === '24') { hoursState.forEach(h => { h.on = true; h.split = false; h.from = '00:00'; h.to = '23:59' }) }
    initHours()
  }

// ═══════════════════════════════════════════════════════════════════
// LOGS SSE
// ═══════════════════════════════════════════════════════════════════
function toggleLogs() {
  if (sseSource) { sseSource.close(); sseSource = null; setLogState(false) }
  else connectLogs()
}
function connectLogs() {
  sseSource = new EventSource(API + '/logs/stream')
  sseSource.onopen = () => setLogState(true)
  sseSource.onmessage = e => { try { appendLog(JSON.parse(e.data)) } catch {} }
  sseSource.onerror = () => setLogState(false)
}
function setLogState(on) {
  document.getElementById('log-dot').style.background = on ? '#10B981' : 'var(--text3)'
  document.getElementById('log-status').textContent = on ? 'En vivo' : 'Desconectado'
  document.getElementById('log-btn').textContent = on ? 'Desconectar' : 'Conectar'
}
function appendLog(e) {
  const body = document.getElementById('terminal-body')
  if (!body) return
  const ph = body.querySelector('[data-placeholder]')
  if (ph) ph.remove()
  const t = new Date(e.t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const line = document.createElement('div')
  line.className = 'log-line ' + (e.level || 'info')
  line.innerHTML = `<span class="log-time">${t}</span><span class="log-arrow">▸</span>${esc(e.msg)}`
  body.appendChild(line)
  while (body.children.length > 500) body.removeChild(body.firstChild)
  body.scrollTop = body.scrollHeight
}
function clearLogs() {
  const b = document.getElementById('terminal-body')
  if (b) b.innerHTML = '<div style="color:#484f58" data-placeholder>Log limpiado…</div>'
}

// ═══════════════════════════════════════════════════════════════════
// MI NEGOCIO — PRODUCTS  (API-backed)
// ═══════════════════════════════════════════════════════════════════
let products = []
let editingProductId = null
let pdTags = []
let pdImages = []

async function loadProducts() {
  try {
    const data = await apiFetch('/api/products')
    products = data.products || []
    renderProducts()
  } catch (err) {
    console.error('Error cargando productos:', err)
    renderProducts()
  }
}

function openProductDrawer(id = null) {
  editingProductId = id
  pdTags = []
  pdImages = []
  const fields = ['pd-name','pd-price','pd-desc','pd-avail','pd-when','pd-how']
  fields.forEach(f => { const el = document.getElementById(f); if (el) el.value = '' })
  document.getElementById('pd-cat').value = 'servicio'
  document.getElementById('pd-sendimg-toggle').classList.remove('on')
  document.getElementById('pd-imgs-preview').innerHTML = ''
  renderPdTags()

  if (id !== null) {
    const p = products.find(x => x.id === id)
    if (!p) return
    document.getElementById('prod-drawer-title').textContent = 'Editar producto'
    document.getElementById('pd-name').value = p.name || ''
    document.getElementById('pd-cat').value = p.category || 'servicio'
    document.getElementById('pd-price').value = p.price || ''
    document.getElementById('pd-desc').value = p.description || ''
    document.getElementById('pd-avail').value = p.availability || ''
    document.getElementById('pd-when').value = p.ai_when || ''
    document.getElementById('pd-how').value = p.ai_how || ''
    if (p.can_send_image) document.getElementById('pd-sendimg-toggle').classList.add('on')
    pdTags = [...(p.keywords || [])]
    pdImages = (p.images || []).filter(i => i.id).map(i => ({ id: i.id, src: i.data, name: i.name }))
    renderPdTags()
    renderPdImgPreview()
  } else {
    document.getElementById('prod-drawer-title').textContent = 'Nuevo producto'
  }

  document.querySelectorAll('.prod-dtab').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.prod-drawer-tab').forEach(b => b.classList.remove('active'))
  document.getElementById('prodtab-info').classList.add('active')
  document.querySelectorAll('.prod-drawer-tab')[0].classList.add('active')
  document.getElementById('prod-drawer-overlay').classList.add('open')
}

function closeProductDrawer() {
  document.getElementById('prod-drawer-overlay').classList.remove('open')
}

function switchProdTab(tab, btn) {
  document.querySelectorAll('.prod-dtab').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.prod-drawer-tab').forEach(b => b.classList.remove('active'))
  document.getElementById('prodtab-' + tab).classList.add('active')
  btn.classList.add('active')
}

function addPdTag(e) {
  if (e.key !== 'Enter' && e.key !== ',') return
  e.preventDefault()
  const val = e.target.value.trim().replace(/,$/, '')
  if (!val || pdTags.includes(val)) { e.target.value = ''; return }
  pdTags.push(val)
  e.target.value = ''
  renderPdTags()
}

function renderPdTags() {
  document.getElementById('pd-tags-chips').innerHTML = pdTags.map((t, i) =>
    `<span class="tag-chip">${esc(t)}<button onclick="pdTags.splice(${i},1);renderPdTags()">×</button></span>`).join('')
}

function handleProductImages(e) {
  Array.from(e.target.files).forEach(f => {
    if (f.size > 2 * 1024 * 1024) { toast('Imagen muy grande (máx. 2MB)', true); return }
    const reader = new FileReader()
    reader.onload = ev => { pdImages.push({ src: ev.target.result, name: f.name }); renderPdImgPreview() }
    reader.readAsDataURL(f)
  })
}

function renderPdImgPreview() {
  document.getElementById('pd-imgs-preview').innerHTML = pdImages.map((img, i) =>
    `<div style="position:relative">
      <img src="${img.src}" style="width:85px;height:65px;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block"/>
      <button onclick="pdImages.splice(${i},1);renderPdImgPreview()" style="position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:50%;background:var(--danger);color:#fff;border:none;font-size:10px;cursor:pointer;line-height:1">✕</button>
    </div>`).join('')
}

async function saveProduct() {
  const name = document.getElementById('pd-name').value.trim()
  if (!name) { toast('El nombre es obligatorio', true); return }

  const payload = {
    name,
    category:      document.getElementById('pd-cat').value,
    price:         document.getElementById('pd-price').value.trim(),
    description:   document.getElementById('pd-desc').value.trim(),
    availability:  document.getElementById('pd-avail').value.trim(),
    ai_when:       document.getElementById('pd-when').value.trim(),
    ai_how:        document.getElementById('pd-how').value.trim(),
    can_send_image: document.getElementById('pd-sendimg-toggle').classList.contains('on'),
    keywords:      [...pdTags],
    images:        [...pdImages],
  }

  try {
    if (editingProductId !== null) {
      await apiFetch(`/api/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(payload) })
      toast('Producto actualizado')
    } else {
      await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(payload) })
      toast('Producto agregado')
    }
    closeProductDrawer()
    await loadProducts()
  } catch (err) {
    toast('Error guardando producto', true)
  }
}

async function deleteProduct(id) {
  const p = products.find(x => x.id === id)
  if (!p || !confirm(`¿Eliminar "${p.name}"?`)) return
  try {
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' })
    toast('Producto eliminado')
    await loadProducts()
  } catch { toast('Error eliminando producto', true) }
}

function catEmoji(cat) {
  return { producto:'📦', servicio:'⚡', promocion:'🏷️', paquete:'🎁' }[cat] || '📦'
}

function renderProducts() {
  const filter = document.getElementById('prod-filter')?.value || ''
  const el = document.getElementById('products-grid')
  if (!el) return
  const list = filter ? products.filter(p => p.category === filter) : products
  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">📦</span><p>No hay productos cargados aún.<br/>Hacé click en "+ Agregar" para comenzar.</p></div>`
    return
  }
  el.innerHTML = list.map(p => {
    const firstImg = p.images?.find(i => i.data)
    const imgEl = firstImg
      ? `<img src="${firstImg.data}" style="width:100%;height:100%;object-fit:cover"/>`
      : `<span style="font-size:34px">${catEmoji(p.category)}</span>`
    return `<div class="prod-card">
      <div class="prod-card-img">${imgEl}</div>
      <div class="prod-card-body">
        <span class="prod-cat ${p.category}">${p.category}</span>
        <div class="prod-name">${esc(p.name)}</div>
        ${p.price ? `<div class="prod-price">${esc(p.price)}</div>` : ''}
        ${p.description ? `<div class="prod-desc">${esc(p.description)}</div>` : ''}
        ${p.keywords?.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px">${p.keywords.map(t => `<span style="background:var(--bg3);padding:2px 6px;border-radius:10px;font-size:10px;color:var(--text2)">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="prod-actions">
          <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openProductDrawer(${p.id})">Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteProduct(${p.id})" style="color:var(--danger)">✕</button>
        </div>
      </div>
    </div>`
  }).join('')
}

// ── Catalog of images  (API-backed) ──────────────────────────────
let catalog = []
let catImgData = null
let editingCatalogId = null

async function loadCatalog() {
  try {
    const data = await apiFetch('/api/catalog')
    catalog = data.images || []
    renderCatalog()
  } catch (err) {
    console.error('Error cargando catálogo:', err)
    renderCatalog()
  }
}

function openCatalogModal(id = null) {
  editingCatalogId = id
  catImgData = null
  document.getElementById('cat-name').value = ''
  document.getElementById('cat-desc').value = ''
  document.getElementById('cat-when').value = ''

  if (id !== null) {
    const item = catalog.find(x => x.id === id)
    if (!item) return
    document.getElementById('catalog-modal-title').textContent = 'Editar imagen del catálogo'
    document.getElementById('cat-name').value = item.name || ''
    document.getElementById('cat-desc').value = item.description || ''
    document.getElementById('cat-when').value = item.context_when || ''
    document.getElementById('cat-preview-wrap').innerHTML = `<img src="${item.image_data}" class="upload-preview"/>`
    catImgData = item.image_data  // keep existing unless replaced
  } else {
    document.getElementById('catalog-modal-title').textContent = 'Agregar imagen al catálogo'
    document.getElementById('cat-preview-wrap').innerHTML = `
      <div style="font-size:30px;margin-bottom:8px">📸</div>
      <div style="font-size:13px;font-weight:500;margin-bottom:4px">Hacé click o arrastrá la imagen</div>
      <div style="font-size:11px;color:var(--text3)">JPG, PNG, WEBP — máx. 2MB</div>`
    catImgData = null
  }

  document.getElementById('catalog-modal').classList.add('open')
}

function closeCatalogModal() {
  document.getElementById('catalog-modal').classList.remove('open')
}

function handleCatalogImage(e) {
  const f = e.target.files[0]
  if (!f) return
  if (f.size > 2 * 1024 * 1024) { toast('Imagen muy grande (máx. 2MB)', 'err'); return }
  const reader = new FileReader()
  reader.onload = ev => {
    catImgData = ev.target.result
    document.getElementById('cat-preview-wrap').innerHTML = `<img src="${catImgData}" class="upload-preview"/>`
    if (!document.getElementById('cat-name').value)
      document.getElementById('cat-name').value = f.name.replace(/\.[^.]+$/, '')
  }
  reader.readAsDataURL(f)
}

async function saveCatalogImage() {
  const name = document.getElementById('cat-name').value.trim()
  if (!name) { toast('El nombre es obligatorio', 'err'); return }
  if (!catImgData && editingCatalogId === null) { toast('Seleccioná una imagen primero', 'err'); return }

  const payload = {
    name,
    description:  document.getElementById('cat-desc').value.trim() || null,
    context_when: document.getElementById('cat-when').value.trim() || null,
    image_data:   catImgData || null,
  }

  try {
    if (editingCatalogId !== null) {
      await apiFetch(`/api/catalog/${editingCatalogId}`, { method: 'PUT', body: JSON.stringify(payload) })
      toast('Imagen actualizada')
    } else {
      await apiFetch('/api/catalog', { method: 'POST', body: JSON.stringify(payload) })
      toast('Imagen guardada en el catálogo')
    }
    closeCatalogModal()
    await loadCatalog()
  } catch { toast('Error guardando imagen', 'err') }
}

async function deleteCatalogItem(id) {
  const c = catalog.find(x => x.id === id)
  if (!c || !confirm(`¿Eliminar "${c.name}"?`)) return
  try {
    await apiFetch(`/api/catalog/${id}`, { method: 'DELETE' })
    toast('Imagen eliminada')
    await loadCatalog()
  } catch { toast('Error eliminando imagen', 'err') }
}

function renderCatalog() {
  const el = document.getElementById('catalog-grid')
  if (!el) return
  if (!catalog.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">🖼️</span><p>No hay imágenes en el catálogo aún.<br/>Agregá fotos de productos, tu local o resultados de trabajo.</p></div>`
    return
  }
  el.innerHTML = catalog.map(c => `
    <div class="cat-item">
      <div class="cat-item-img"><img src="${c.image_data}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/></div>
      <div class="cat-item-body">
        <div class="cat-item-name" title="${esc(c.name)}">${esc(c.name)}</div>
        ${c.context_when ? `<div class="cat-item-ctx">${esc(c.context_when)}</div>` : (c.description ? `<div class="cat-item-ctx">${esc(c.description)}</div>` : '')}
        <div style="display:flex;gap:4px;margin-top:6px">
          <button class="btn btn-ghost btn-sm" style="flex:1;font-size:10px" onclick="openCatalogModal(${c.id})">Editar</button>
          <button class="btn btn-ghost btn-sm" style="font-size:10px;color:var(--danger)" onclick="deleteCatalogItem(${c.id})">✕</button>
        </div>
      </div>
    </div>`).join('')
}

// ═══════════════════════════════════════════════════════════════════
// MI NEGOCIO — FAQS  (DB-backed via ai_settings.faqs)
// ═══════════════════════════════════════════════════════════════════
function addFaq() {
  const q = document.getElementById('faq-q')?.value.trim()
  const a = document.getElementById('faq-a')?.value.trim()
  if (!q) { toast('Escribí la pregunta primero', 'err'); return }
  _faqs.push({ q, a: a || '' })
  document.getElementById('faq-q').value = ''
  document.getElementById('faq-a').value = ''
  renderFaqs()
}

function renderFaqs() {
  const el = document.getElementById('faqs-list')
  if (!el) return
  if (!_faqs.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="empty-icon">❓</span><p>Agregá preguntas frecuentes.</p></div>'
    return
  }
  el.innerHTML = _faqs.map((f, i) => `
    <div style="border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:8px;overflow:hidden">
      <div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:var(--bg2)">
        <span style="font-size:13px;font-weight:500;flex:1;cursor:pointer" onclick="toggleFaq(${i})" title="Ver respuesta">${esc(f.q)}</span>
        <div style="display:flex;gap:4px;flex-shrink:0;margin-left:10px">
          <button class="btn btn-ghost btn-sm" onclick="editFaq(${i})">Editar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="_faqs.splice(${i},1);renderFaqs()">✕</button>
        </div>
      </div>
      <div id="faq-body-${i}" style="padding:10px 14px;font-size:13px;color:var(--text2);display:none;border-top:1px solid var(--border)">${esc(f.a || '(sin respuesta)')}</div>
    </div>`).join('')
}

function toggleFaq(i) {
  const el = document.getElementById('faq-body-' + i)
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
}

function editFaq(i) {
  const f = _faqs[i]
  document.getElementById('faq-q').value = f.q
  document.getElementById('faq-a').value = f.a || ''
  _faqs.splice(i, 1)
  renderFaqs()
  document.getElementById('faq-q').focus()
}

async function saveFaqs() {
  try {
    const d = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ faqs: _faqs }) })
    if (d.ok) {
      const ok = document.getElementById('faq-save-ok')
      if (ok) { ok.style.display = 'inline'; setTimeout(() => ok.style.display = 'none', 3000) }
      toast('FAQs guardadas')
    } else toast('Error al guardar', 'err')
  } catch { toast('Error de conexión', 'err') }
}

// ═══════════════════════════════════════════════════════════════════
// TURNOS / AGENDA
// ═══════════════════════════════════════════════════════════════════
let _calView = 'semana'   // 'semana' | 'mes'
let _calOffset = 0        // semanas o meses respecto a hoy
let _appointments = []
let _selectedAppt = null

function setCalView(v) {
  _calView = v
  _calOffset = 0
  document.getElementById('cal-view-semana').style.fontWeight = v === 'semana' ? '700' : '400'
  document.getElementById('cal-view-mes').style.fontWeight   = v === 'mes'    ? '700' : '400'
  renderCalendar()
}

function calNav(dir) { _calOffset += dir; renderCalendar() }
function calGoToday() { _calOffset = 0; renderCalendar() }

function getCalRange() {
  const today = new Date()
  if (_calView === 'semana') {
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + _calOffset * 7)
    monday.setHours(0,0,0,0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { start: monday, end: sunday }
  } else {
    const d = new Date(today.getFullYear(), today.getMonth() + _calOffset, 1)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return { start, end }
  }
}

function toYMD(d) { return d.toISOString().split('T')[0] }

async function loadAppointments() {
  try {
    const { start, end } = getCalRange()
    const d = await apiFetch(`/api/appointments?from=${toYMD(start)}&to=${toYMD(end)}`)
    _appointments = d.appointments || []
    renderCalendar()
  } catch { renderCalendar() }
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid')
  const label = document.getElementById('cal-label')
  const { start, end } = getCalRange()

  const fmt = (d) => d.toLocaleDateString('es-AR', { day:'numeric', month:'short' })
  label.textContent = _calView === 'semana'
    ? `${fmt(start)} — ${fmt(end)}`
    : start.toLocaleDateString('es-AR', { month:'long', year:'numeric' })

  if (_calView === 'semana') renderWeek(start)
  else renderMonth(start)
}

function apptStatusColor(status) {
  if (status === 'confirmado') return '#16a34a'
  if (status === 'completado') return '#0ea5e9'
  return '#f97316'  // pendiente o default
}

function renderWeek(monday) {
  const grid = document.getElementById('calendar-grid')
  const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
  const today = new Date(); today.setHours(0,0,0,0)
  grid.style.display = 'grid'
  grid.style.gridTemplateColumns = 'repeat(7,1fr)'
  grid.style.gap = '8px'
  grid.style.padding = '12px'
  grid.innerHTML = days.map((d, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const ymd = toYMD(date)
    const isToday = date.getTime() === today.getTime()
    const appts = _appointments.filter(a => (a.appt_date || '').substring(0,10) === ymd)
    const apptHtml = appts.map(a =>
      `<div onclick="selectAppt(${a.id})" style="cursor:pointer;margin-top:4px;background:${apptStatusColor(a.status)};color:#fff;border-radius:4px;padding:3px 5px;font-size:10px;line-height:1.3">
        ${(a.time_start || '').substring(0,5)} ${(a.service||'').substring(0,14)}
      </div>`
    ).join('')
    return `<div style="text-align:center;border:1px solid ${isToday ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-sm);padding:8px 4px;${isToday ? 'background:var(--accent-lt)' : ''}">
      <div style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">${d}</div>
      <div style="font-size:18px;font-weight:700;margin:2px 0;${isToday ? 'color:var(--accent)' : ''}">${date.getDate()}</div>
      ${apptHtml || `<div style="font-size:10px;color:var(--text3)">–</div>`}
    </div>`
  }).join('')
}

function renderMonth(firstDay) {
  const grid = document.getElementById('calendar-grid')
  grid.style.display = 'block'
  grid.style.padding = '12px'
  const today = new Date(); today.setHours(0,0,0,0)
  const y = firstDay.getFullYear(), m = firstDay.getMonth()
  const lastDay = new Date(y, m+1, 0)
  const startDow = (firstDay.getDay() + 6) % 7  // 0=Mon
  const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
  let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">`
  html += days.map(d => `<div style="text-align:center;font-size:10px;font-weight:600;color:var(--text2);padding:4px">${d}</div>`).join('')
  html += `</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">`
  for (let i = 0; i < startDow; i++) html += `<div></div>`
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(y, m, day)
    const ymd = toYMD(date)
    const isToday = date.getTime() === today.getTime()
    const appts = _appointments.filter(a => (a.appt_date || '').substring(0,10) === ymd)
    const dotHtml = appts.length ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px">${appts.map(a => `<div onclick="selectAppt(${a.id})" title="${a.service}" style="cursor:pointer;background:${apptStatusColor(a.status)};border-radius:2px;padding:1px 3px;font-size:9px;color:#fff">${(a.time_start||'').substring(0,5)}</div>`).join('')}</div>` : ''
    html += `<div style="min-height:56px;border:1px solid ${isToday ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-xs);padding:4px;${isToday ? 'background:var(--accent-lt)' : ''}">
      <div style="font-size:12px;font-weight:${isToday ? '700' : '400'};color:${isToday ? 'var(--accent)' : 'var(--text)'}">${day}</div>
      ${dotHtml}
    </div>`
  }
  html += `</div>`
  grid.innerHTML = html
}

function selectAppt(id) {
  _selectedAppt = _appointments.find(a => a.id === id)
  if (!_selectedAppt) return
  const card = document.getElementById('appt-detail-card')
  card.style.display = 'block'
  document.getElementById('appt-detail-title').textContent = _selectedAppt.service
  document.getElementById('appt-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><div style="font-size:11px;color:var(--text2)">Fecha</div><div style="font-weight:600">${_selectedAppt.appt_date}</div></div>
      <div><div style="font-size:11px;color:var(--text2)">Horario</div><div style="font-weight:600">${_selectedAppt.time_start?.substring(0,5)} (${_selectedAppt.duration}min)</div></div>
      <div><div style="font-size:11px;color:var(--text2)">Contacto</div><div style="font-weight:600">${_selectedAppt.contact_name || _selectedAppt.contact_phone || '—'}</div></div>
      <div><div style="font-size:11px;color:var(--text2)">Agente</div><div style="font-weight:600">${_selectedAppt.agent_name || '—'}</div></div>
    </div>
    ${_selectedAppt.notes ? `<div style="margin-top:12px;padding:10px;background:var(--bg2);border-radius:var(--r-sm);font-size:13px">${_selectedAppt.notes}</div>` : ''}
  `
}

function closeApptDetail() {
  document.getElementById('appt-detail-card').style.display = 'none'
  _selectedAppt = null
}

function editAppt() {
  if (!_selectedAppt) return
  document.getElementById('appt-edit-id').value = _selectedAppt.id
  document.getElementById('appt-form-title').textContent = '✏️ Editar turno'
  document.getElementById('appt-service').value  = _selectedAppt.service || ''
  document.getElementById('appt-date').value     = _selectedAppt.appt_date || ''
  document.getElementById('appt-time').value     = _selectedAppt.time_start?.substring(0,5) || ''
  document.getElementById('appt-duration').value = _selectedAppt.duration || 60
  document.getElementById('appt-contact').value  = _selectedAppt.contact_name || _selectedAppt.contact_phone || ''
  document.getElementById('appt-agent').value    = _selectedAppt.agent_name || ''
  document.getElementById('appt-notes').value    = _selectedAppt.notes || ''
  document.getElementById('appt-cancel-btn').style.display = 'inline-flex'
  document.getElementById('appt-detail-card').style.display = 'none'
}

function cancelApptEdit() {
  document.getElementById('appt-edit-id').value  = ''
  document.getElementById('appt-form-title').textContent = '➕ Nuevo turno'
  document.getElementById('appt-service').value  = ''
  document.getElementById('appt-date').value     = ''
  document.getElementById('appt-time').value     = ''
  document.getElementById('appt-duration').value = '60'
  document.getElementById('appt-contact').value  = ''
  document.getElementById('appt-agent').value    = ''
  document.getElementById('appt-notes').value    = ''
  document.getElementById('appt-cancel-btn').style.display = 'none'
  document.getElementById('appt-form-title').textContent = '➕ Nuevo turno'
}

async function saveAppointment() {
  const errEl = document.getElementById('appt-form-err')
  errEl.style.display = 'none'
  const service  = document.getElementById('appt-service').value.trim()
  const apptDate = document.getElementById('appt-date').value
  const timeStart = document.getElementById('appt-time').value
  const duration  = parseInt(document.getElementById('appt-duration').value) || 60
  const contact   = document.getElementById('appt-contact').value.trim()
  const agent     = document.getElementById('appt-agent').value.trim() || currentUser?.name || currentUser?.username
  const notes     = document.getElementById('appt-notes').value.trim()
  const editId    = document.getElementById('appt-edit-id').value

  if (!service || !apptDate || !timeStart) {
    errEl.textContent = 'Completá servicio, fecha y horario'
    errEl.style.display = 'block'
    return
  }

  const body = { service, appt_date: apptDate, time_start: timeStart, duration, agent_name: agent, notes: notes || null }
  if (contact) body.contact_note = contact

  try {
    let d
    if (editId) {
      d = await apiFetch(`/api/appointments/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
    } else {
      d = await apiFetch('/api/appointments', { method: 'POST', body: JSON.stringify(body) })
    }
    if (d.ok || d.appointment) {
      toast(editId ? 'Turno actualizado' : 'Turno creado y notificado al asesor')
      cancelApptEdit()
      await loadAppointments()
    } else { errEl.textContent = d.error || 'Error al guardar'; errEl.style.display = 'block' }
  } catch { errEl.textContent = 'Error de conexión'; errEl.style.display = 'block' }
}

async function deleteAppt() {
  if (!_selectedAppt) return
  if (!confirm(`¿Cancelar el turno "${_selectedAppt.service}" del ${_selectedAppt.appt_date}?`)) return
  try {
    await apiFetch(`/api/appointments/${_selectedAppt.id}`, { method: 'DELETE' })
    toast('Turno cancelado')
    closeApptDetail()
    await loadAppointments()
  } catch { toast('Error al cancelar', 'err') }
}

function initCalendar() {
  const today = new Date()
  const y = today.getFullYear(), m = String(today.getMonth()+1).padStart(2,'0'), day = String(today.getDate()).padStart(2,'0')
  document.getElementById('appt-date').value = `${y}-${m}-${day}`
  document.getElementById('appt-time').value = '09:00'
  if (currentUser) document.getElementById('appt-agent').value = currentUser.name || currentUser.username || ''
  loadAppointments()
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
const NOTIF_META = {
  new_contact:   { icon: '👤', bg: 'var(--accent-lt)',  color: 'var(--accent-dk)',  label: 'Nuevo cliente' },
  conv_active:   { icon: '💬', bg: 'var(--info-lt)',    color: '#1d4ed8',           label: 'Conversación' },
  handoff:       { icon: '📱', bg: 'var(--danger-lt)',  color: '#b91c1c',           label: 'Derivación' },
  missing_image: { icon: '🖼️', bg: 'var(--warn-lt)',  color: '#b45309',           label: 'Imagen faltante' },
  image_sent:    { icon: '📸', bg: '#f3e8ff',           color: '#7c3aed',           label: 'Imagen enviada' },
  recontacto:    { icon: '🔄', bg: 'var(--bg3)',        color: 'var(--text2)',      label: 'Recontacto' },
  human_msg:     { icon: '🧑', bg: 'var(--info-lt)',    color: '#1d4ed8',           label: 'Mensaje manual' },
  human_takeover:{ icon: '🎛️', bg: 'var(--warn-lt)',  color: '#b45309',           label: 'Toma de control' },
  turno:         { icon: '📅', bg: '#d1fae5',           color: '#065f46',           label: 'Turno agendado' },
}

let _notifFilter = 'all'
let _allNotifs = []
let notifSseSource = null

function setNotifFilter(type, btn) {
  _notifFilter = type
  document.querySelectorAll('#notif-filters .filter-chip').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderNotifications()
}

async function loadNotifications() {
  try {
    const d = await apiFetch('/api/notifications')
    _allNotifs = d.notifications || []
    updateNotifBadge(d.unread || 0)
    renderNotifications()
  } catch {}
}

function renderNotifications() {
  const el = document.getElementById('notif-list')
  if (!el) return
  const filtered = _notifFilter === 'all' ? _allNotifs : _allNotifs.filter(n => n.type === _notifFilter)
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">🔔</span><p>Sin notificaciones' + (_notifFilter !== 'all' ? ' en esta categoría' : '') + '</p></div>'
    return
  }
  el.innerHTML = filtered.map(n => {
    const m = NOTIF_META[n.type] || { icon: '📋', bg: 'var(--bg3)', color: 'var(--text)', label: n.type }
    const data = n.data || {}
    let actions = ''
    if (data.convId) actions += `<a class="notif-action" onclick="nav('inbox',document.getElementById('nav-inbox'));setTimeout(()=>openConvById(${data.convId}),300)">→ Ver conversación</a>`
    if (data.waLink) actions += ` &nbsp; <a class="notif-action" href="${data.waLink}" target="_blank">📲 Abrir en WhatsApp</a>`
    if (data.productId) actions += ` &nbsp; <a class="notif-action" onclick="nav('negocio',document.getElementById('nav-negocio'));setTimeout(()=>{bizTab('productos',document.querySelector('[onclick*=productos]'))},300)">→ Ir al producto</a>`
    if (data.summary) actions += `<div style="margin-top:6px;background:var(--bg3);border-radius:var(--r-xs);padding:8px 10px;font-size:11px;color:var(--text2);line-height:1.5">${esc(data.summary)}</div>`
    return `<div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id},this)">
      <div class="notif-icon" style="background:${m.bg};color:${m.color}">${m.icon}</div>
      <div class="notif-body">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <span class="notif-title">${esc(n.title)}</span>
          <span class="badge badge-gray" style="font-size:10px">${m.label}</span>
        </div>
        <div class="notif-text">${esc(n.body || '')}</div>
        ${actions}
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`
  }).join('')
}

async function markNotifRead(id, el) {
  if (el && !el.classList.contains('unread')) return
  if (el) el.classList.remove('unread')
  try {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' })
    const n = _allNotifs.find(x => x.id === id)
    if (n) n.read = true
    const unread = _allNotifs.filter(x => !x.read).length
    updateNotifBadge(unread)
  } catch {}
}

async function markAllRead() {
  try {
    await apiFetch('/api/notifications/read-all', { method: 'PUT' })
    _allNotifs.forEach(n => n.read = true)
    updateNotifBadge(0)
    renderNotifications()
    toast('Todo marcado como leído')
  } catch { toast('Error', 'err') }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('nav-notif-badge')
  if (!badge) return
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = '' }
  else badge.style.display = 'none'
}

function openConvById(id) {
  const conv = allConvs.find(c => c.id === id)
  if (conv) openConv(conv.id, conv.name || conv.phone, conv.phone)
  else loadConversations()
}

function connectNotifStream() {
  if (notifSseSource) return
  notifSseSource = new EventSource(API + '/api/notifications/stream')
  notifSseSource.onmessage = e => {
    try {
      const n = JSON.parse(e.data)
      _allNotifs.unshift(n)
      updateNotifBadge(_allNotifs.filter(x => !x.read).length)
      renderNotifications()
      if (['new_contact','handoff','missing_image'].includes(n.type)) toast(n.title)
      // Actualización instantánea de conversación abierta
      if (activeConvId && n.data?.convId === activeConvId) {
        refreshConvMessages(activeConvId)
      }
      // Si hay nueva conversación, actualizar la lista también
      if (['new_contact','conv_active'].includes(n.type)) loadConvsPanel()
    } catch {}
  }
  notifSseSource.onerror = () => {
    notifSseSource?.close(); notifSseSource = null
    setTimeout(connectNotifStream, 30000)
  }
}

// ═══════════════════════════════════════════════════════════════════
// ACCESS CONTROL POPUP
// ═══════════════════════════════════════════════════════════════════
function openAccessPopup() {
  renderWhitelistUI()
  renderBlacklistUI()
  const el = document.getElementById('access-popup')
  el.style.display = 'flex'
}
function closeAccessPopup() {
  document.getElementById('access-popup').style.display = 'none'
}

// ═══════════════════════════════════════════════════════════════════
// BUSINESS LOGO
// ═══════════════════════════════════════════════════════════════════
function handleBizLogo(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { toast('El logo no puede superar 2MB', 'err'); return }
  const reader = new FileReader()
  reader.onload = ev => {
    _bizLogo = ev.target.result
    const img = document.getElementById('biz-logo-img')
    const emoji = document.getElementById('biz-logo-emoji')
    const mark = document.getElementById('sidebar-logo-mark')
    if (img) { img.src = _bizLogo; img.style.display = 'block' }
    if (emoji) emoji.style.display = 'none'
    if (mark) mark.innerHTML = `<img src="${_bizLogo}" style="width:100%;height:100%;object-fit:cover;border-radius:10px"/>`
    const removeBtn = document.getElementById('biz-logo-remove')
    if (removeBtn) removeBtn.style.display = ''
  }
  reader.readAsDataURL(file)
}

function removeBizLogo() {
  _bizLogo = ''
  const img = document.getElementById('biz-logo-img')
  const emoji = document.getElementById('biz-logo-emoji')
  const mark = document.getElementById('sidebar-logo-mark')
  if (img) { img.src = ''; img.style.display = 'none' }
  if (emoji) emoji.style.display = ''
  if (mark) { mark.innerHTML = '🤖' }
  const removeBtn = document.getElementById('biz-logo-remove')
  if (removeBtn) removeBtn.style.display = 'none'
  const input = document.getElementById('biz-logo-input')
  if (input) input.value = ''
}

// ═══════════════════════════════════════════════════════════════════
// USUARIOS
// ═══════════════════════════════════════════════════════════════════
const ROLE_LABELS = { superadmin: 'Superadmin', administracion: 'Administración', usuario: 'Usuario' }
const ROLE_BADGE = { superadmin: 'badge-red', administracion: 'badge-blue', usuario: 'badge-gray' }

async function loadUsers() {
  const tbody = document.getElementById('users-tbody')
  if (!tbody) return
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Cargando…</td></tr>'
  try {
    const d = await apiFetch('/api/users')
    _usersCache = d.users || []
    if (!_usersCache.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">No hay usuarios</td></tr>'; return }
    tbody.innerHTML = _usersCache.map(u => `
      <tr>
        <td><span style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(u.username)}</span></td>
        <td>${esc(u.name || '—')}</td>
        <td><span class="badge ${ROLE_BADGE[u.role] || 'badge-gray'}">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td><span class="badge ${u.active ? 'badge-green' : 'badge-gray'}">${u.active ? '✓ Activo' : '✗ Inactivo'}</span></td>
        <td style="font-size:12px;color:var(--text2)">${fmtDate(u.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="openUserModalById(${u.id})">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteUser(${u.id},'${esc(u.username)}')">✕</button>
          </div>
        </td>
      </tr>`).join('')
  } catch { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:24px">Error al cargar</td></tr>' }
}

async function loadActivityLog() {
  const tbody = document.getElementById('activity-tbody')
  if (!tbody) return
  try {
    const d = await apiFetch('/api/activity')
    const logs = d.logs || []
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:24px">Sin actividad registrada</td></tr>'; return }
    tbody.innerHTML = logs.slice(0, 50).map(l => `
      <tr>
        <td style="font-size:11px;color:var(--text2);white-space:nowrap">${fmtDateTime(l.created_at)}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-size:11px">${esc(l.username || '—')}</span></td>
        <td style="font-size:13px">${esc(l.action)}</td>
      </tr>`).join('')
  } catch {}
}

function openUserModalById(id) {
  const u = _usersCache.find(x => x.id === id)
  if (u) openUserModal(u)
}

function openUserModal(u = null) {
  const modal = document.getElementById('user-modal')
  document.getElementById('um-id').value = ''
  document.getElementById('um-username').value = ''
  document.getElementById('um-name').value = ''
  document.getElementById('um-password').value = ''
  document.getElementById('um-role').value = 'usuario'
  document.getElementById('um-active-toggle').classList.add('on')
  document.getElementById('um-active-row').style.display = 'none'
  document.getElementById('um-pass-hint').textContent = '(requerida para nuevo usuario)'
  document.getElementById('user-modal-title').textContent = 'Nuevo usuario'

  if (u && typeof u === 'object') {
    document.getElementById('um-id').value = u.id
    document.getElementById('um-username').value = u.username || ''
    document.getElementById('um-name').value = u.name || ''
    document.getElementById('um-role').value = u.role || 'usuario'
    if (!u.active) document.getElementById('um-active-toggle').classList.remove('on')
    document.getElementById('um-active-row').style.display = ''
    document.getElementById('um-pass-hint').textContent = '(dejá vacía para no cambiarla)'
    document.getElementById('user-modal-title').textContent = `Editar — ${u.username}`
  }
  modal.style.display = 'flex'
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none'
}

async function saveUser() {
  const id = document.getElementById('um-id').value
  const username = document.getElementById('um-username').value.trim()
  const name = document.getElementById('um-name').value.trim()
  const password = document.getElementById('um-password').value
  const role = document.getElementById('um-role').value
  const active = document.getElementById('um-active-toggle').classList.contains('on')

  if (!username) { toast('Ingresá un nombre de usuario', 'err'); return }
  if (!id && !password) { toast('La contraseña es requerida para nuevos usuarios', 'err'); return }

  try {
    let d
    if (id) {
      const body = { name, role, active }
      if (password) body.password = password
      d = await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    } else {
      d = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ username, name, password, role }) })
    }
    if (d.ok || d.user) {
      toast(id ? 'Usuario actualizado' : 'Usuario creado')
      closeUserModal()
      loadUsers()
    } else toast(d.error || 'Error al guardar', 'err')
  } catch { toast('Error de conexión', 'err') }
}

async function deleteUser(id, username) {
  if (!confirm(`¿Eliminar usuario "${username}"? Esta acción no se puede deshacer.`)) return
  try {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' })
    toast('Usuario eliminado')
    loadUsers()
  } catch { toast('Error al eliminar', 'err') }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function fmtStatus(s) {
  return { connected: 'Conectado', qr: 'Esperando QR', disconnected: 'Desconectado', logged_out: 'Sesión cerrada', error: 'Sin respuesta' }[s] || s || '—'
}
function fmtUptime(m) {
  if (!m && m !== 0) return '—'
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}
function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
function fmtDateTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function agentLabel(type) {
  const map = {
    generalista:  { icon: '🤖', label: 'Ediluz · General',    cls: 'at-generalista' },
    servicios:    { icon: '🔨', label: 'Agente Servicios',     cls: 'at-servicios'   },
    productos:    { icon: '🏷️', label: 'Agente Productos',    cls: 'at-productos'   },
    cotizacion:   { icon: '💰', label: 'Agente Cotización',    cls: 'at-cotizacion'  },
    redireccion:  { icon: '📱', label: 'Agente Redirección',   cls: 'at-redireccion' },
  }
  return map[type] || { icon: '🤖', label: 'IA', cls: 'at-generalista' }
}
function toast(msg, type = 'ok') {
  const el = document.createElement('div')
  el.className = 'toast ' + type
  el.innerHTML = (type === 'ok' ? '✓ ' : '✗ ') + esc(msg)
  document.getElementById('toast').appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_WORKER_URL = 'https://sys-ai-a09h.onrender.com'

;(async () => {
  // Always use saved URL or default — skip step1 on first visit
  API = localStorage.getItem('aw_url') || DEFAULT_WORKER_URL
  KEY = localStorage.getItem('aw_key') || ''
  if (!localStorage.getItem('aw_url')) localStorage.setItem('aw_url', DEFAULT_WORKER_URL)

  // If we have a session token, validate it
  if (sessionToken) {
    try {
      const d = await fetch(API + '/api/users/me', { headers: { 'X-Session-Token': sessionToken } }).then(r => r.json())
      if (d.user) {
        currentUser = d.user
        bootApp()
        return
      }
    } catch {}
    // Token invalid — clear and show login
    sessionToken = ''
    localStorage.removeItem('aw_session')
  }
  showLoginScreen()
})()

// Auto-refresh stats cada 60s
setInterval(() => {
  if (document.getElementById('view-panel').classList.contains('active')) loadStats()
  loadStatus()
}, 60000)
