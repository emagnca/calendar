'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const currentGroup = window.location.pathname.split('/').filter(Boolean)[1] || null;
let activeGroup = currentGroup;
let allGroups = [];

// Called by i18n.js when language changes — re-render current tab
function onLanguageChange() { loadCurrentTab(); }

let currentUser      = null;
let currentGroupInfo = null;
let authToken        = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
if (authToken) axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

// ── Auth ──────────────────────────────────────────────────────────────────────

const loginOverlay = document.getElementById('loginOverlay');
const appEl        = document.getElementById('app');
const loginError   = document.getElementById('loginError');
const codeError    = document.getElementById('codeError');

document.getElementById('btnSendCode').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) { loginError.textContent = t('admin_err_enter_email'); return; }
    loginError.textContent = '';
    try {
        await axios.post('/send-login-code', { email });
        loginError.textContent = '';
        document.getElementById('loginStep1').style.display = 'none';
        document.getElementById('loginStep2').style.display = '';
        document.getElementById('loginCode').focus();
    } catch (e) {
        loginError.textContent = e.response?.data?.error || t('admin_err_send_code');
    }
});

document.getElementById('btnVerifyCode').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const code  = document.getElementById('loginCode').value.trim();
    codeError.textContent = '';
    try {
        const res = await axios.post('/login', { email, code });
        authToken   = res.data.token;
        currentUser = res.data.user;
        localStorage.setItem('adminToken', authToken);
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
        await bootApp();
    } catch (e) {
        codeError.textContent = e.response?.data?.error || t('admin_err_invalid_code');
    }
});

document.getElementById('btnLogout').addEventListener('click', () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    delete axios.defaults.headers.common['Authorization'];
    currentUser = null;
    appEl.style.display = 'none';
    loginOverlay.style.display = 'flex';
    document.getElementById('loginStep1').style.display = '';
    document.getElementById('loginStep2').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginCode').value = '';
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function bootApp() {
    if (!authToken) { loginOverlay.style.display = 'flex'; return; }

    // Verify token and load user info if not already loaded
    if (!currentUser) {
        try {
            const res = await axios.get('/users/me');
            currentUser = res.data;
        } catch {
            // Try to decode from token payload
            try {
                const payload = JSON.parse(atob(authToken.split('.')[1]));
                currentUser = { id: payload._id, email: payload.email, role: payload.role, groups: payload.groups || [] };
            } catch {
                localStorage.removeItem('adminToken');
                loginOverlay.style.display = 'flex';
                return;
            }
        }
    }

    const isAdminUser = currentUser.role === 'superadmin' ||
        (currentUser.groups || []).some(g => g.role === 'admin');
    if (!isAdminUser) {
        loginOverlay.style.display = 'flex';
        loginError.textContent = t('admin_err_access_denied');
        return;
    }

    // Show app
    loginOverlay.style.display = 'none';
    appEl.style.display = '';

    document.getElementById('groupLabel').textContent = currentGroup || '—';
    const displayRole = currentUser.role === 'superadmin' ? 'superadmin' : 'admin';
    document.getElementById('currentUserName').textContent = `${currentUser.name || currentUser.email} (${displayRole})`;
    if (currentGroup) document.getElementById('calendarLink').href = `/${currentGroup}`;

    // No group in URL — show the group picker instead of the tab UI
    if (!currentGroup) {
        document.getElementById('groupPicker').style.display = '';
        document.querySelector('.layout').style.display = 'none';

        let groups;
        if (currentUser.role === 'superadmin') {
            await loadAllGroups();
            groups = allGroups.map(g => g.name || g);
        } else {
            groups = (currentUser.groups || [])
                .filter(g => g.role === 'admin')
                .map(g => g.name);
        }

        document.getElementById('groupPickerList').innerHTML = groups.length
            ? groups.map(name => `
                <a href="/admin/${name}" style="
                    display:inline-block;padding:18px 32px;background:#1a73e8;color:#fff;
                    border-radius:8px;text-decoration:none;font-size:1.1rem;font-weight:600;
                    box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:background 0.2s,transform 0.15s"
                    onmouseover="this.style.background='#1558b0';this.style.transform='translateY(-2px)'"
                    onmouseout="this.style.background='#1a73e8';this.style.transform=''"
                >${name}</a>`).join('')
            : `<p style="color:#999">${t('admin_picker_no_groups')}</p>`;
        return;
    }

    try {
        const gRes = await axios.get(`/groups/${activeGroup}`);
        currentGroupInfo = gRes.data;
    } catch (_) {}

    // Show Groups tab only for superadmin
    if (currentUser.role === 'superadmin') {
        document.getElementById('groupsNav').style.display = '';
        await loadAllGroups();
        initGroupSwitcher();
    }

    initTabs();
    loadCurrentTab();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

let activeTab = 'resources';

function initTabs() {
    document.querySelectorAll('.sidebar a[data-tab]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            switchTab(link.dataset.tab);
        });
    });
}

function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.sidebar a[data-tab]').forEach(a => {
        a.classList.toggle('active', a.dataset.tab === name);
    });
    document.querySelectorAll('.tab').forEach(s => {
        s.classList.toggle('active', s.id === `tab-${name}`);
    });
    loadCurrentTab();
}

function loadCurrentTab() {
    if (activeTab === 'resources') loadResources();
    else if (activeTab === 'users')  loadUsers();
    else if (activeTab === 'bookings') loadBookings();
    else if (activeTab === 'groups') loadGroups();
    else if (activeTab === 'blocked')  loadBlockedPeriods();
    else if (activeTab === 'settings') loadSettings();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupQuery() {
    return activeGroup ? `?group=${activeGroup}` : '';
}

function groupBody(extra = {}) {
    return activeGroup ? { group: activeGroup, ...extra } : extra;
}

function groupLangs() {
    return currentGroupInfo?.languages?.length ? currentGroupInfo.languages : ['sv', 'en'];
}

async function loadAllGroups() {
    try {
        const res = await axios.get('/admin/groups');
        allGroups = res.data;
    } catch (e) { allGroups = []; }
}

function groupSelectorField(selectedGroup, readonly = false) {
    const val = selectedGroup || activeGroup || '';
    if (readonly) {
        return `<div class="field"><label>${t('admin_label_group')}</label><input id="f-group" value="${val}" readonly></div>`;
    }
    if (currentUser && currentUser.role === 'superadmin' && allGroups.length) {
        const opts = allGroups.map(g =>
            `<option value="${g.name}" ${g.name === val ? 'selected' : ''}>${g.name}</option>`
        ).join('');
        return `<div class="field"><label>${t('admin_label_group')}</label><select id="f-group">${opts}</select></div>`;
    }
    return `<input type="hidden" id="f-group" value="${val}">`;
}

function initGroupSwitcher() {
    const sel = document.getElementById('groupSwitcher');
    if (!sel) return;
    sel.innerHTML = allGroups.map(g =>
        `<option value="${g.name}" ${g.name === activeGroup ? 'selected' : ''}>${g.name}</option>`
    ).join('');
    sel.style.display = '';
    sel.addEventListener('change', async e => {
        activeGroup = e.target.value;
        document.getElementById('groupLabel').textContent = activeGroup;
        try {
            const gRes = await axios.get(`/groups/${activeGroup}`);
            currentGroupInfo = gRes.data;
        } catch (_) {}
        loadCurrentTab();
    });
}

function apiError(e) {
    return e.response?.data?.error || e.message || 'Unknown error';
}

// ── Modal ─────────────────────────────────────────────────────────────────────

let modalSaveHandler = null;

function openModal(title, bodyHtml, onSave) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    modalSaveHandler = onSave;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
    modalSaveHandler = null;
}

document.getElementById('btnModalClose').addEventListener('click', closeModal);
document.getElementById('btnModalCancel').addEventListener('click', closeModal);
document.getElementById('btnModalSave').addEventListener('click', async () => {
    if (modalSaveHandler) {
        const ok = await modalSaveHandler();
        if (ok) closeModal();
    }
});

// ── Resources ─────────────────────────────────────────────────────────────────

async function loadResources() {
    const tbody = document.getElementById('resourcesBody');
    tbody.innerHTML = `<tr><td colspan="7">${t('admin_loading')}</td></tr>`;
    try {
        const res = await axios.get(`/admin/resources${groupQuery()}`);
        tbody.innerHTML = res.data.map(r => `
            <tr>
                <td><code>${r.resourceId}</code></td>
                <td>${localize(r.name)}</td>
                <td>${r.slot_length}</td>
                <td>${r.capacity || 1}</td>
                <td>${r.earliest} – ${r.latest}</td>
                <td><span class="badge ${r.isActive ? 'badge-active' : 'badge-inactive'}">${r.isActive ? t('admin_yes') : t('admin_no_val')}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-warning" onclick="editResource('${r._id}')">${t('admin_btn_edit')}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteResource('${r._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`).join('') || `<tr><td colspan="7">${t('admin_no_resources')}</td></tr>`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:red">${apiError(e)}</td></tr>`;
    }
}

function resourceForm(r = {}) {
    const langs = groupLangs();
    const nameFields = langs.map(lang => {
        const val = (typeof r.name === 'object' ? (r.name?.[lang] ?? '') : (lang === (langs[0]) ? (r.name || '') : ''));
        return `<div class="field"><label>${t('admin_field_name')} (${lang.toUpperCase()})</label><input id="f-name-${lang}" value="${val}"></div>`;
    }).join('');
    return `
        ${r._id ? `
        <div class="field"><label>${t('admin_field_resource_id')}</label>
            <input id="f-resourceId" value="${r.resourceId || ''}" readonly>
            <div class="hint">${t('admin_hint_resource_id')}</div>
        </div>` : ''}
        <div class="field-row">
            ${nameFields}
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_slot_len')}</label><input id="f-slotLen" type="number" value="${r.slot_length || 60}" min="5"></div>
            <div class="field"><label>${t('admin_field_capacity')}</label><input id="f-capacity" type="number" value="${r.capacity || 1}" min="1"></div>
            <div class="field"><label>${t('admin_field_active')}</label>
                <label class="toggle-label" style="margin-top:8px">
                    <input type="checkbox" id="f-isActive" ${r.isActive !== false ? 'checked' : ''}> ${t('admin_field_active')}
                </label>
            </div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_earliest')}</label><input id="f-earliest" value="${r.earliest || '09:00'}" placeholder="09:00"></div>
            <div class="field"><label>${t('admin_field_latest')}</label><input id="f-latest" value="${r.latest || '17:00'}" placeholder="17:00"></div>
        </div>
        <div class="field">
            <label>${t('admin_field_bookable_days')}</label>
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">
                ${[[1,'day_mon'],[2,'day_tue'],[3,'day_wed'],[4,'day_thu'],[5,'day_fri'],[6,'day_sat'],[0,'day_sun']].map(([n, key]) => {
                    const chk = (!r.bookableDays || r.bookableDays.includes(n)) ? 'checked' : '';
                    return `<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="f-bookableDay" value="${n}" ${chk}> ${t(key)}</label>`;
                }).join('')}
            </div>
        </div>
        <div class="field">
            <label>${t('admin_field_blocked_slots')}</label>
            <div id="f-blockedSlots">
                ${(r.blockedSlots || []).map(s => `
                <div class="blocked-slot-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
                    <input class="f-bs-start" type="time" value="${s.start || ''}" style="width:100px">
                    <span>–</span>
                    <input class="f-bs-end" type="time" value="${s.end || ''}" style="width:100px">
                    <input class="f-bs-label" type="text" value="${s.label || ''}" placeholder="${t('admin_hint_blocked_slot_label')}" style="flex:1">
                    <button type="button" onclick="this.closest('.blocked-slot-row').remove()" style="color:red;font-weight:bold;border:none;background:none;cursor:pointer">✕</button>
                </div>`).join('')}
            </div>
            <button type="button" onclick="addBlockedSlotRow()" style="margin-top:6px;font-size:.85em">${t('admin_btn_add_blocked_slot')}</button>
        </div>`;
}

function collectResource() {
    const resourceIdEl = document.getElementById('f-resourceId');
    const name = Object.fromEntries(
        groupLangs().map(lang => [lang, document.getElementById(`f-name-${lang}`)?.value.trim() || ''])
    );
    const blockedSlots = [...document.querySelectorAll('.blocked-slot-row')]
        .map(row => ({
            start: row.querySelector('.f-bs-start').value.trim(),
            end:   row.querySelector('.f-bs-end').value.trim(),
            label: row.querySelector('.f-bs-label').value.trim(),
        }))
        .filter(s => s.start && s.end);
    return {
        ...(resourceIdEl ? { resourceId: resourceIdEl.value.trim() } : {}),
        name,
        slot_length:  parseInt(document.getElementById('f-slotLen').value, 10),
        capacity:     parseInt(document.getElementById('f-capacity').value, 10) || 1,
        isActive:     document.getElementById('f-isActive').checked,
        earliest:     document.getElementById('f-earliest').value.trim(),
        latest:       document.getElementById('f-latest').value.trim(),
        bookableDays: [...document.querySelectorAll('.f-bookableDay:checked')].map(cb => parseInt(cb.value, 10)),
        blockedSlots,
    };
}

window.addBlockedSlotRow = () => {
    const placeholder = (typeof t === 'function') ? t('admin_hint_blocked_slot_label') : 'e.g. Lunch';
    const row = document.createElement('div');
    row.className = 'blocked-slot-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
    row.innerHTML = `
        <input class="f-bs-start" type="time" style="width:100px">
        <span>–</span>
        <input class="f-bs-end" type="time" style="width:100px">
        <input class="f-bs-label" type="text" placeholder="${placeholder}" style="flex:1">
        <button type="button" onclick="this.closest('.blocked-slot-row').remove()" style="color:red;font-weight:bold;border:none;background:none;cursor:pointer">✕</button>
    `;
    document.getElementById('f-blockedSlots').appendChild(row);
};

document.getElementById('btnAddResource').addEventListener('click', () => {
    openModal(t('admin_modal_add_resource'), resourceForm(), async () => {
        try {
            await axios.post('/admin/resources', groupBody(collectResource()));
            loadResources();
            return true;
        } catch (e) { alert(apiError(e)); return false; }
    });
});

window.editResource = async (id) => {
    try {
        const res = await axios.get(`/admin/resources${groupQuery()}`);
        const r = res.data.find(x => x._id === id);
        if (!r) return;
        openModal(t('admin_modal_edit_resource'), resourceForm(r), async () => {
            try {
                await axios.put(`/admin/resources/${id}`, collectResource());
                loadResources();
                return true;
            } catch (e) { alert(apiError(e)); return false; }
        });
    } catch (e) { alert(apiError(e)); }
};

window.deleteResource = async (id) => {
    if (!confirm(t('admin_confirm_delete_resource'))) return;
    try {
        await axios.delete(`/admin/resources/${id}`);
        loadResources();
    } catch (e) { alert(apiError(e)); }
};

// ── Users ─────────────────────────────────────────────────────────────────────

async function loadUsers() {
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = `<tr><td colspan="5">${t('admin_loading')}</td></tr>`;
    try {
        const res = await axios.get(`/admin/users${groupQuery()}`);
        tbody.innerHTML = res.data.map(u => `
            <tr>
                <td>${u.email}</td>
                <td>${u.name}</td>
                <td><span class="badge badge-${u.role}">${u.role}</span></td>
                <td><span class="badge ${u.isActive ? 'badge-active' : 'badge-inactive'}">${u.isActive ? t('admin_yes') : t('admin_no_val')}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-warning" onclick="editUser('${u._id}')">${t('admin_btn_edit')}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser('${u._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`).join('') || `<tr><td colspan="5">${t('admin_no_users')}</td></tr>`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red">${apiError(e)}</td></tr>`;
    }
}

function userForm(u = {}) {
    const roles = ['user', 'admin', 'superadmin'].filter(r =>
        currentUser.role === 'superadmin' || r !== 'superadmin'
    );
    const roleOptions = roles.map(r =>
        `<option value="${r}" ${(u.role || 'user') === r ? 'selected' : ''}>${r}</option>`
    ).join('');
    return `
        <div class="field"><label>${t('admin_th_email')}</label><input id="f-email" type="email" value="${u.email || ''}"></div>
        <div class="field"><label>${t('label_name')}</label><input id="f-name" value="${u.name || ''}"></div>
        <div class="field"><label>${t('admin_th_role')}</label><select id="f-role">${roleOptions}</select></div>
        <div class="field"><label>${t('admin_field_password')} <span style="font-weight:400;color:#888">${t('admin_hint_password')}</span></label>
            <input id="f-password" type="password" placeholder="…"></div>
        <div class="field">
            <label class="toggle-label">
                <input type="checkbox" id="f-userActive" ${u.isActive !== false ? 'checked' : ''}> ${t('admin_field_active')}
            </label>
        </div>`;
}

function collectUser() {
    const pw = document.getElementById('f-password').value;
    const data = {
        email:    document.getElementById('f-email').value.trim(),
        name:     document.getElementById('f-name').value.trim(),
        role:     document.getElementById('f-role').value,
        isActive: document.getElementById('f-userActive').checked,
    };
    if (pw) data.password = pw;
    return data;
}

document.getElementById('btnAddUser').addEventListener('click', () => {
    openModal(t('admin_modal_add_user'), userForm(), async () => {
        try {
            await axios.post('/admin/users', groupBody(collectUser()));
            loadUsers();
            return true;
        } catch (e) { alert(apiError(e)); return false; }
    });
});

window.editUser = async (id) => {
    try {
        const res = await axios.get(`/admin/users${groupQuery()}`);
        const u = res.data.find(x => x._id === id);
        if (!u) return;
        openModal(t('admin_modal_edit_user'), userForm(u), async () => {
            try {
                await axios.put(`/admin/users/${id}`, groupBody(collectUser()));
                loadUsers();
                return true;
            } catch (e) { alert(apiError(e)); return false; }
        });
    } catch (e) { alert(apiError(e)); }
};

window.deleteUser = async (id) => {
    if (!confirm(t('admin_confirm_delete_user'))) return;
    try {
        await axios.delete(`/admin/users/${id}`);
        loadUsers();
    } catch (e) { alert(apiError(e)); }
};

// ── Bookings ──────────────────────────────────────────────────────────────────

async function loadBookings() {
    const tbody = document.getElementById('bookingsBody');
    tbody.innerHTML = `<tr><td colspan="7">${t('admin_loading')}</td></tr>`;
    try {
        const from = document.getElementById('bookingsFrom').value;
        const to   = document.getElementById('bookingsTo').value;
        let url = `/admin/events${groupQuery()}`;
        const params = [];
        if (from) params.push('startDate=' + from);
        if (to)   params.push('endDate='   + to);
        if (params.length) url += (groupQuery() ? '&' : '?') + params.join('&');
        const res = await axios.get(url);
        tbody.innerHTML = res.data.map(e => {
            const d = new Date(e.date);
            const dateStr = d.toLocaleDateString();
            const name = localize(e.resourceName) || e.resourceId;
            const msg = e.message ? `<span title="${e.message.replace(/"/g,'&quot;')}" style="cursor:help;border-bottom:1px dotted #999">${e.message.length > 40 ? e.message.slice(0,40)+'…' : e.message}</span>` : '';
            return `<tr>
                <td>${dateStr}</td>
                <td>${e.time}</td>
                <td>${name}</td>
                <td>${e.userEmail}</td>
                <td>${msg}</td>
                <td><span class="badge badge-${e.status}">${e.status}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-danger" onclick="deleteBooking('${e._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="7">${t('admin_no_bookings')}</td></tr>`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:red">${apiError(e)}</td></tr>`;
    }
}

document.getElementById('btnBookingsFilter').addEventListener('click', loadBookings);

window.deleteBooking = async (id) => {
    if (!confirm(t('admin_confirm_delete_booking'))) return;
    try {
        await axios.delete(`/admin/events/${id}`);
        loadBookings();
    } catch (e) { alert(apiError(e)); }
};

// ── Groups (superadmin) ───────────────────────────────────────────────────────

async function loadGroups() {
    const tbody = document.getElementById('groupsBody');
    tbody.innerHTML = `<tr><td colspan="3">${t('admin_loading')}</td></tr>`;
    try {
        const res = await axios.get('/admin/groups');
        tbody.innerHTML = res.data.map(g => `
            <tr>
                <td><strong>${g.name}</strong></td>
                <td><span class="badge ${g.public ? 'badge-public' : 'badge-private'}">${g.public ? t('admin_yes') : t('admin_no_val')}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-warning" onclick="editGroup('${g.name}', ${g.public})">${t('admin_btn_edit')}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteGroup('${g.name}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`).join('') || `<tr><td colspan="3">${t('admin_no_groups')}</td></tr>`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:red">${apiError(e)}</td></tr>`;
    }
}

function groupForm(g = {}) {
    return `
        <div class="field"><label>${t('admin_field_group_name')}</label>
            <input id="f-groupName" value="${g.name || ''}" ${g.name ? 'readonly' : ''}>
            <div class="hint">${t('admin_hint_group_name')}</div>
        </div>
        <div class="field">
            <label class="toggle-label">
                <input type="checkbox" id="f-groupPublic" ${g.public ? 'checked' : ''}> ${t('admin_field_group_public')}
            </label>
        </div>`;
}

document.getElementById('btnAddGroup').addEventListener('click', () => {
    openModal(t('admin_modal_add_group'), groupForm(), async () => {
        try {
            const name   = document.getElementById('f-groupName').value.trim();
            const pub    = document.getElementById('f-groupPublic').checked;
            const browserLang = (navigator.language || '').split('-')[0].toLowerCase();
            const defaultLangs = ['en'];
            if (browserLang !== 'en' && ALL_LANGS.some(l => l.code === browserLang)) defaultLangs.push(browserLang);
            await axios.post('/admin/groups', { name, public: pub, languages: defaultLangs });
            loadGroups();
            return true;
        } catch (e) { alert(apiError(e)); return false; }
    });
});

window.editGroup = (name, isPublic) => {
    openModal(t('admin_modal_edit_group'), groupForm({ name, public: isPublic }), async () => {
        try {
            await axios.patch(`/admin/groups/${name}`, { public: document.getElementById('f-groupPublic').checked });
            loadGroups();
            return true;
        } catch (e) { alert(apiError(e)); return false; }
    });
};

window.deleteGroup = async (name) => {
    if (!confirm(t('admin_confirm_delete_group', name))) return;
    try {
        await axios.delete(`/admin/groups/${name}`);
        loadGroups();
    } catch (e) { alert(apiError(e)); }
};

// ── Blocked Periods ──────────────────────────────────────────────────────────

let groupResources = [];

async function loadBlockedPeriods() {
    try {
        const [bpRes, resRes] = await Promise.all([
            axios.get(`/admin/blocked-periods${groupQuery()}`),
            axios.get(`/admin/resources${groupQuery()}`)
        ]);
        groupResources = resRes.data;
        const tbody = document.getElementById('blockedBody');
        tbody.innerHTML = bpRes.data.map(bp => {
            const res = bp.resourceId ? groupResources.find(r => r.resourceId === bp.resourceId) : null;
            const resLabel = res ? localize(res.name) : (bp.resourceId || t('admin_blocked_all_resources'));
            const start = bp.startDate.slice(0, 10);
            const end   = bp.endDate.slice(0, 10);
            const period = start === end ? start : `${start} – ${end}`;
            const time   = bp.startTime ? `${bp.startTime} – ${bp.endTime}` : t('admin_blocked_full_day');
            return `<tr>
                <td>${resLabel}</td>
                <td>${period}</td>
                <td>${time}</td>
                <td>${bp.reason || '–'}</td>
                <td class="actions">
                    <button class="btn btn-sm btn-danger" onclick="deleteBlockedPeriod('${bp._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="5">${t('admin_no_blocks')}</td></tr>`;
    } catch (e) {
        document.getElementById('blockedBody').innerHTML = `<tr><td colspan="5" style="color:red">${apiError(e)}</td></tr>`;
    }
}

function blockedPeriodForm() {
    const today = new Date().toISOString().slice(0, 10);
    const resOpts = [`<option value="">${t('admin_blocked_all_resources')}</option>`]
        .concat(groupResources.map(r => `<option value="${r.resourceId}">${localize(r.name)}</option>`))
        .join('');
    return `
        <div class="field">
            <label>${t('admin_th_resource')}</label>
            <select id="f-bp-resource">${resOpts}</select>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_start_date')}</label><input type="date" id="f-bp-start" value="${today}"></div>
            <div class="field"><label>${t('admin_field_end_date')}</label><input type="date" id="f-bp-end" value="${today}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_start_time')} <small style="color:#888">(${t('admin_optional')})</small></label><input type="time" id="f-bp-startTime"></div>
            <div class="field"><label>${t('admin_field_end_time')} <small style="color:#888">(${t('admin_optional')})</small></label><input type="time" id="f-bp-endTime"></div>
        </div>
        <div class="field"><label>${t('admin_field_reason')} <small style="color:#888">(${t('admin_optional')})</small></label><input id="f-bp-reason" placeholder="${t('admin_blocked_reason_placeholder')}"></div>`;
}

document.getElementById('btnAddBlock').addEventListener('click', () => {
    openModal(t('admin_blocked_btn_add'), blockedPeriodForm(), async () => {
        try {
            const startDate  = document.getElementById('f-bp-start').value;
            const endDate    = document.getElementById('f-bp-end').value || startDate;
            const startTime  = document.getElementById('f-bp-startTime').value;
            const endTime    = document.getElementById('f-bp-endTime').value;
            if (!startDate) { alert(t('admin_blocked_date_required')); return false; }
            if ((startTime && !endTime) || (!startTime && endTime)) {
                alert(t('admin_blocked_time_both')); return false;
            }
            await axios.post('/admin/blocked-periods', groupBody({
                resourceId: document.getElementById('f-bp-resource').value || null,
                startDate,
                endDate,
                startTime: startTime || null,
                endTime:   endTime   || null,
                reason:    document.getElementById('f-bp-reason').value.trim()
            }));
            loadBlockedPeriods();
            return true;
        } catch (e) { alert(apiError(e)); return false; }
    });
});

window.deleteBlockedPeriod = async (id) => {
    if (!confirm(t('admin_confirm_delete_block'))) return;
    try {
        await axios.delete(`/admin/blocked-periods/${id}`);
        loadBlockedPeriods();
    } catch (e) { alert(apiError(e)); }
};

// ── Settings ──────────────────────────────────────────────────────────────────

const ALL_LANGS = [
    { code: 'sv', label: '🇸🇪 Svenska' },
    { code: 'en', label: '🇬🇧 English' },
    { code: 'fr', label: '🇫🇷 Français' },
    { code: 'es', label: '🇪🇸 Español' },
    { code: 'zh', label: '🇨🇳 中文' },
];

async function loadSettings() {
    try {
        const res = await axios.get(`/groups/${activeGroup}`);
        const langs = res.data.languages || ALL_LANGS.map(l => l.code);
        const container = document.getElementById('langCheckboxes');
        container.innerHTML = ALL_LANGS.map(l =>
            `<label style="display:flex;align-items:center;gap:6px">
                <input type="checkbox" class="s-lang" value="${l.code}" ${langs.includes(l.code) ? 'checked' : ''}>
                ${l.label}
            </label>`
        ).join('');
    } catch (e) { console.error('Failed to load settings:', e); }
}

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    const languages = [...document.querySelectorAll('.s-lang:checked')].map(cb => cb.value);
    if (!languages.length) { alert(t('alert_select_one_language')); return; }
    try {
        await axios.patch(`/admin/groups/${activeGroup}`, { public: currentGroupInfo?.public ?? false, languages });
        alert(t('alert_settings_saved'));
    } catch (e) { alert(apiError(e)); }
});

// ── Init ──────────────────────────────────────────────────────────────────────

initI18n();
bootApp();
