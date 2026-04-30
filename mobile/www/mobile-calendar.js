/**
 * mobile-calendar.js — loaded after script.js in the Capacitor build.
 *
 * After a successful booking, offers to add the event to the phone's
 * native calendar using the Web Share API with an .ics file.
 */
(function () {
    function padZ(n) { return String(n).padStart(2, '0'); }

    function toICSDate(d) {
        return `${d.getFullYear()}${padZ(d.getMonth() + 1)}${padZ(d.getDate())}` +
               `T${padZ(d.getHours())}${padZ(d.getMinutes())}00`;
    }

    function makeICS(startDate, title) {
        const end = new Date(startDate);
        end.setHours(end.getHours() + 1);
        const uid = `eb-${Date.now()}@easybooking`;
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//EasyBooking//Mobile//EN',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTART:${toICSDate(startDate)}`,
            `DTEND:${toICSDate(end)}`,
            `SUMMARY:${title}`,
            'DESCRIPTION:Booked via EasyBooking',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
    }

    function getResourceName(resourceId) {
        // Look up displayed name from any visible resource <select>
        for (const id of ['dayViewResourceSelect', 'resourceSelect']) {
            const sel = document.getElementById(id);
            if (sel) {
                const opt = sel.querySelector(`option[value="${CSS.escape(resourceId)}"]`);
                if (opt) return opt.textContent.trim();
            }
        }
        return resourceId;
    }

    window.offerCalendarAdd = async function (date, time, resourceId) {
        const name  = getResourceName(resourceId);
        const title = `${name} – EasyBooking`;

        if (!window.confirm(`Add "${title}" (${time}) to your calendar?`)) return;

        // Build start datetime from date + time string "HH:MM"
        const [h, m] = (time || '00:00').split(':').map(Number);
        const start  = new Date(date);
        start.setHours(h, m, 0, 0);

        const ics  = makeICS(start, title);
        const file = new File([ics], 'booking.ics', { type: 'text/calendar' });

        // Use Web Share API (routes through native share sheet → "Add to Calendar")
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title });
            } catch (e) {
                if (e.name !== 'AbortError') console.warn('Calendar share failed:', e);
            }
        } else {
            // Fallback: trigger .ics download
            const url = URL.createObjectURL(file);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'booking.ics';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
}());
