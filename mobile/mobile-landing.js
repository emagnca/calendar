/**
 * mobile-landing.js — loaded after script.js in the Capacitor build.
 *
 * Overrides showLandingPage() with a compact, full-screen mobile UI that
 * only shows the group selector and a link to register a new group.
 */
(function () {
    if (typeof showLandingPage !== 'function') return;

    // Inject mobile landing CSS once
    const style = document.createElement('style');
    style.textContent = `
        #mobileLanding {
            position: fixed;
            inset: 0;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: env(safe-area-inset-top, 24px) 32px env(safe-area-inset-bottom, 32px);
            z-index: 9999;
        }
        .ml-inner {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            max-width: 380px;
            gap: 12px;
        }
        .ml-title {
            color: white;
            font-size: 38px;
            font-weight: 700;
            letter-spacing: -1px;
            margin-bottom: 6px;
            text-align: center;
        }
        .ml-subtitle {
            color: rgba(255,255,255,0.8);
            font-size: 15px;
            text-align: center;
            margin-bottom: 20px;
        }
        .ml-input {
            width: 100%;
            padding: 15px 16px;
            border-radius: 10px;
            border: none;
            font-size: 16px;
            outline: none;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            box-sizing: border-box;
        }
        .ml-go-btn {
            width: 100%;
            padding: 15px;
            background: white;
            color: #667eea;
            font-size: 16px;
            font-weight: 700;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            transition: opacity 0.15s;
        }
        .ml-go-btn:active { opacity: 0.85; }
        .ml-divider {
            color: rgba(255,255,255,0.6);
            font-size: 13px;
            margin: 8px 0;
        }
        .ml-register-btn {
            display: block;
            width: 100%;
            padding: 15px;
            background: transparent;
            color: white;
            font-size: 16px;
            font-weight: 600;
            border: 2px solid rgba(255,255,255,0.8);
            border-radius: 10px;
            text-align: center;
            text-decoration: none;
            box-sizing: border-box;
        }
        .ml-register-btn:active {
            background: rgba(255,255,255,0.15);
        }
    `;
    document.head.appendChild(style);

    // Build the mobile landing element once
    function getMobileLanding() {
        let el = document.getElementById('mobileLanding');
        if (el) return el;

        el = document.createElement('div');
        el.id = 'mobileLanding';
        el.innerHTML = `
            <div class="ml-inner">
                <h1 class="ml-title" data-i18n="app_title">EasyBooking</h1>
                <p class="ml-subtitle" data-i18n="landing_cta_desc">Enter a group name to access the booking system:</p>
                <input type="text" id="mlGroupInput" class="ml-input"
                       autocapitalize="none" autocorrect="off" spellcheck="false"
                       data-i18n-placeholder="landing_input_placeholder" placeholder="Group name..." />
                <button id="mlGoBtn" class="ml-go-btn" data-i18n="landing_go_button">Go to Group</button>
                <span class="ml-divider">─── eller / or ───</span>
                <a href="/register/" class="ml-register-btn" data-i18n="link_register">Register new group</a>
            </div>
        `;
        document.body.appendChild(el);

        // Translate if i18n is ready
        if (typeof t === 'function') {
            el.querySelectorAll('[data-i18n]').forEach(node => {
                node.textContent = t(node.getAttribute('data-i18n'));
            });
            const inp = el.querySelector('#mlGroupInput');
            const phKey = inp.getAttribute('data-i18n-placeholder');
            if (phKey) inp.placeholder = t(phKey);
        }

        // Navigation handler
        const navigate = () => {
            const inp = document.getElementById('mlGroupInput');
            const group = (inp ? inp.value : '').trim().toLowerCase().replace(/\s+/g, '-');
            if (!group) return;
            localStorage.setItem('easybooking_group', group);
            window.location.reload();
        };

        el.querySelector('#mlGoBtn').addEventListener('click', navigate);
        el.querySelector('#mlGroupInput').addEventListener('keypress', e => {
            if (e.key === 'Enter') navigate();
        });

        return el;
    }

    // Override the full-page landing with the compact mobile one
    window.showLandingPage = function () {
        document.querySelector('.container').style.display = 'none';
        const res = document.querySelector('.resources-section');
        if (res) res.style.display = 'none';
        const full = document.getElementById('landingPage');
        if (full) full.style.display = 'none';

        getMobileLanding().style.display = 'flex';
    };
}());
