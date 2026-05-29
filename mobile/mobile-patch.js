/**
 * mobile-patch.js — loaded before script.js in the Capacitor build.
 *
 * Responsibilities:
 *  1. Restore the selected group from localStorage so script.js can
 *     read it via window._mobileGroup instead of window.location.pathname.
 *  2. Expose window.mobileClearGroup() so logout/group-switch can clear state.
 */

(function () {
    const STORAGE_KEY = 'easybooking_group';

    // 1. Expose stored group so the patched script.js can read it
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        window._mobileGroup = stored;
    }

    // 2. Helper to clear stored group and reload (e.g. after logout)
    window.mobileClearGroup = function () {
        localStorage.removeItem(STORAGE_KEY);
        window._mobileGroup = null;
        window.location.reload();
    };

    // 3. Intercept #adminLink clicks: rewrite /admin/GROUP → /admin/index.html?group=GROUP
    //    Capacitor has no server-side routing so /admin/GROUP has no static file to serve.
    document.addEventListener('click', function (e) {
        const el = e.target.closest('#adminLink');
        if (!el) return;
        const href = el.getAttribute('href') || '';
        const match = href.match(/^\/admin\/(.+)$/);
        if (match) {
            e.preventDefault();
            window.location.href = '/admin/index.html?group=' + encodeURIComponent(match[1]);
        }
    });
}());
