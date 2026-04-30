'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const currentGroup = window.location.pathname.split('/').filter(Boolean)[1] || null;
let activeGroup = currentGroup;
let allGroups = [];

// Called by i18n.js when language changes — re-render current tab
function onLanguageChange() { loadCurrentTab(); }

let currentUser = null;
let authToken   = localStorage.getItem('adminToken');
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
        axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
        await bootApp();
    } catch (e) {
        codeError.textContent = e.response?.data?.error || t('admin_err_invalid_code');
    }
});

document.getElementById('btnLogout').addEventListener('click', () => {
    localStorage.removeItem('adminToken');
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
                currentUser = { id: payload._id, email: payload.email, role: payload.role };
            } catch {
                localStorage.removeItem('adminToken');
                loginOverlay.style.display = 'flex';
                return;
            }
        }
    }

    if (!['admin', 'superadmin'].includes(currentUser.role)) {
        loginOverlay.style.display = 'flex';
        loginError.textContent = t('admin_err_access_denied');
        return;
    }

    // Show app
    loginOverlay.style.display = 'none';
    appEl.style.display = '';

    document.getElementById('groupLabel').textContent = currentGroup || '—';
    document.getElementById('currentUserName').textContent = `${currentUser.name || currentUser.email} (${currentUser.role})`;

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupQuery() {
    return activeGroup ? `?group=${activeGroup}` : '';
}

function groupBody(extra = {}) {
    return activeGroup ? { group: activeGroup, ...extra } : extra;
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
    sel.addEventListener('change', e => {
        activeGroup = e.target.value;
        document.getElementById('groupLabel').textContent = activeGroup;
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
    tbody.innerHTML = `<tr><td colspan="6">${t('admin_loading')}</td></tr>`;
    try {
        const res = await axios.get(`/admin/resources${groupQuery()}`);
        tbody.innerHTML = res.data.map(r => `
            <tr>
                <td><code>${r.resourceId}</code></td>
                <td>${localize(r.name)}</td>
                <td>${r.slot_length}</td>
                <td>${r.earliest} – ${r.latest}</td>
                <td><span class="badge ${r.isActive ? 'badge-active' : 'badge-inactive'}">${r.isActive ? t('admin_yes') : t('admin_no_val')}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-warning" onclick="editResource('${r._id}')">${t('admin_btn_edit')}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteResource('${r._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`).join('') || `<tr><td colspan="6">${t('admin_no_resources')}</td></tr>`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:red">${apiError(e)}</td></tr>`;
    }
}

function resourceForm(r = {}) {
    const nameSv = r.name?.sv || r.name || '';
    const nameEn = r.name?.en || '';
    const descSv = r.description?.sv || r.description || '';
    const descEn = r.description?.en || '';
    return `
        <div class="field"><label>${t('admin_field_resource_id')}</label>
            <input id="f-resourceId" value="${r.resourceId || ''}" ${r._id ? 'readonly' : ''}>
            <div class="hint">${t('admin_hint_resource_id')}</div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_name_sv')}</label><input id="f-nameSv" value="${nameSv}"></div>
            <div class="field"><label>${t('admin_field_name_en')}</label><input id="f-nameEn" value="${nameEn}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_desc_sv')}</label><input id="f-descSv" value="${descSv}"></div>
            <div class="field"><label>${t('admin_field_desc_en')}</label><input id="f-descEn" value="${descEn}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_slot_len')}</label><input id="f-slotLen" type="number" value="${r.slot_length || 60}" min="5"></div>
            <div class="field"><label>${t('admin_field_active')}</label>
                <label class="toggle-label" style="margin-top:8px">
                    <input type="checkbox" id="f-isActive" ${r.isActive !== false ? 'checked' : ''}> ${t('admin_field_active')}
                </label>
            </div>
        </div>
        <div class="field-row">
            <div class="field"><label>${t('admin_field_earliest')}</label><input id="f-earliest" value="${r.earliest || '09:00'}" placeholder="09:00"></div>
            <div class="field"><label>${t('admin_field_latest')}</label><input id="f-latest" value="${r.latest || '17:00'}" placeholder="17:00"></div>
        </div>`;
}

function collectResource() {
    return {
        resourceId:  document.getElementById('f-resourceId').value.trim(),
        name:        { sv: document.getElementById('f-nameSv').value.trim(), en: document.getElementById('f-nameEn').value.trim() },
        description: { sv: document.getElementById('f-descSv').value.trim(), en: document.getElementById('f-descEn').value.trim() },
        slot_length: parseInt(document.getElementById('f-slotLen').value, 10),
        isActive:    document.getElementById('f-isActive').checked,
        earliest:    document.getElementById('f-earliest').value.trim(),
        latest:      document.getElementById('f-latest').value.trim(),
    };
}

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
                await axios.put(`/admin/users/${id}`, collectUser());
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
    tbody.innerHTML = `<tr><td colspan="6">${t('admin_loading')}</td></tr>`;
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
            return `<tr>
                <td>${dateStr}</td>
                <td>${e.time}</td>
                <td>${name}</td>
                <td>${e.userEmail}</td>
                <td><span class="badge badge-${e.status}">${e.status}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-danger" onclick="deleteBooking('${e._id}')">${t('admin_btn_delete')}</button>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="6">${t('admin_no_bookings')}</td></tr>`;
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
            await axios.post('/admin/groups', { name, public: pub });
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

// ── Init ──────────────────────────────────────────────────────────────────────

if (!currentGroup) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif"><h2>No group specified</h2><p>Access via <code>/admin/&lt;groupname&gt;</code>.</p></div>';
} else {
    initI18n();
    bootApp();
}
