/**
 * mobile-patch.js — loaded before script.js in the Capacitor build.
 *
 * Responsibilities:
 *  1. Restore the selected group from localStorage so script.js can
 *     read it via window._mobileGroup instead of window.location.pathname.
 *  2. Intercept the "Go to Group" button/input on the landing page so that
 *     selecting a group stores it to localStorage and reloads (instead of
 *     navigating to /<groupname> which doesn't work in Capacitor).
 *  3. Intercept any window.location.href = '/<group>' navigation that
 *     might still happen elsewhere.
 */

(function () {
    const STORAGE_KEY = 'easybooking_group';

    // 1. Expose stored group so the patched script.js can read it
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        window._mobileGroup = stored;
    }

    // 2. Helper: store group and reload
    function navigateMobile(groupName) {
        const clean = groupName.trim().toLowerCase().replace(/\s+/g, '-');
        if (!clean) return;
        localStorage.setItem(STORAGE_KEY, clean);
        window.location.reload();
    }

    // 3. Watch for the landing page elements being inserted into the DOM
    //    (showLandingPage() is called dynamically from script.js)
    const observer = new MutationObserver(function () {
        const btn   = document.getElementById('goToGroupBtn');
        const input = document.getElementById('groupInput');

        if (btn && !btn._mobilePatch) {
            btn._mobilePatch = true;
            btn.addEventListener('click', function (e) {
                e.stopImmediatePropagation();
                navigateMobile(input ? input.value : '');
            }, true);
        }

        if (input && !input._mobilePatch) {
            input._mobilePatch = true;
            input.addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    e.stopImmediatePropagation();
                    navigateMobile(input.value);
                }
            }, true);
        }
    });

    document.addEventListener('DOMContentLoaded', function () {
        observer.observe(document.body, { childList: true, subtree: true });
    });

    // 4. Expose a helper so the logout/group-switch flow can also clear the group
    window.mobileClearGroup = function () {
        localStorage.removeItem(STORAGE_KEY);
        window._mobileGroup = null;
        window.location.reload();
    };
}());
