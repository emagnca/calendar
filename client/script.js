let currentDate = new Date();
let selectedDate = null;
let selectedResourceId = null;
let resources = []; // Store resources from API
let bookings = new Map(); // Store bookings: date -> [{resource, time}]

// Read group from URL path: /<groupname>
const currentGroup = window.location.pathname.split('/').filter(Boolean)[0] || null;

// Format a Date as YYYY-MM-DD in local time (avoids UTC timezone shift)
function localDateStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Append group to any params object
function groupParam(params = {}) {
    return currentGroup ? { ...params, group: currentGroup } : params;
}

// Fetch resources from API
async function fetchResources() {
    try {
        console.log('Fetching resources from server...');
        const response = await axios.get('/resources', { params: groupParam() });
        resources = response.data;
        console.log('Resources fetched:', resources);
        updateResourceSelects();
        return resources;
    } catch (error) {
        console.error('Error fetching resources:', error);
        alert(t('alert_error_loading_resources'));
        return [];
    }
}

// Update all resource select dropdowns
function updateResourceSelects() {
    const selects = document.querySelectorAll('select[id^="resourceSelect"]');
    if (selects.length === 0) {
        console.warn('No resource select elements found');
        return;
    }

    console.log('Updating resource selects with:', resources);
    selects.forEach(select => {
        // Store current selection
        const currentValue = select.value;
        
        select.innerHTML = '';
        
        // Add a default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = t('select_resource_placeholder');
        select.appendChild(defaultOption);

        // Add resources from server
        resources.forEach(resource => {
            const option = document.createElement('option');
            option.value = resource.resourceId;
            option.textContent = localize(resource.name);
            select.appendChild(option);
        });

        // Restore previous selection if it exists
        if (currentValue && resources.some(r => r.resourceId === currentValue)) {
            select.value = currentValue;
        }
    });
}

// Render resource list on the main page
function renderResourceList() {
    const container = document.getElementById('resourceList');
    if (!container) return;

    if (resources.length === 0) {
        container.innerHTML = `<p>${t('no_resources')}</p>`;
        return;
    }

    container.innerHTML = resources.map(r => `
        <div class="resource-card" data-resource-id="${r.resourceId}">
            <div class="resource-card-name">${localize(r.name)}</div>
            ${r.description ? `<div class="resource-card-desc">${localize(r.description)}</div>` : ''}
            <div class="resource-card-meta">${r.earliest} – ${r.latest} &nbsp;|&nbsp; ${r.slot_length} min/slot</div>
            <div class="resource-card-hint">${t('card_click_hint')}</div>
        </div>
    `).join('');

    container.querySelectorAll('.resource-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedResourceId = card.dataset.resourceId;
            container.querySelectorAll('.resource-card').forEach(c => {
                c.classList.remove('selected');
                c.querySelector('.resource-card-hint').textContent = t('card_click_hint');
            });
            card.classList.add('selected');
            card.querySelector('.resource-card-hint').textContent = t('card_selected');
            document.getElementById('calendar').scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// Called by i18n engine when language changes
function onLanguageChange() {
    renderResourceList();
    updateResourceSelects();
    const months = tMonths();
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    if (monthDisplay) monthDisplay.textContent = `${months[month]} ${year}`;
}

// Elements
const calendar = document.getElementById('calendar');
const monthDisplay = document.getElementById('monthDisplay');
const bookingModal = document.getElementById('bookingModal');
const dayViewModal = document.getElementById('dayViewModal');
const bookingForm = document.getElementById('bookingForm');
const closeBookingBtn = document.querySelector('#bookingModal .close');
const closeDayViewBtn = document.querySelector('#closeDayView');

// Time slots from 9:00 to 17:00
const timeSlots = [
    '09:00', '10:00', '11:00', '12:00', '13:00',
    '14:00', '15:00', '16:00', '17:00'
];

// Get availability for a specific resource and date
async function getResourceAvailability(resourceId, date) {
    try {
        console.log('Hämtar tillgänglighet för:', { resourceId, date });
        const response = await axios.get('/availability', {
            params: groupParam({
                date: date,
                resourceId: resourceId
            })
        });
        console.log('Tillgänglighetsrespons:', response.data);
        return response.data;
    } catch (error) {
        console.error('Fel vid hämtning av tillgänglighet:', error);
        console.error('Feldetaljer:', {
            status: error.response?.status,
            data: error.response?.data,
            meddelande: error.message
        });
        throw error;
    }
}

// Returns true if the current user is allowed to cancel the given booking
function canCancelBooking(booking) {
    const role = currentUser?.role || 'user';
    if (role === 'superadmin') return true;
    if (role === 'admin') return true;  // group scoping enforced server-side
    return booking.userId === currentUser?.id;
}

// Cancel a booking
async function cancelBooking(bookingId, element) {
    if (!confirm(t('confirm_cancel_booking'))) {
        return;
    }

    try {
        await axios.patch(`/events/${bookingId}/cancel`, {}, { params: groupParam() });

        // Optimistic UI update
        if (element) {
            // Case 1: button is inside a .time-slot (day view popup)
            const timeSlot = element.closest('.time-slot');
            if (timeSlot) {
                const time = timeSlot.querySelector('.time-label')?.textContent?.trim();
                const resourceId = document.getElementById('dayViewResourceSelect')?.value;
                timeSlot.classList.remove('booked', 'cancelled');
                timeSlot.classList.add('available');
                const container = timeSlot.querySelector('.booking-container');
                if (container) {
                    container.innerHTML = resourceId && time
                        ? `<button onclick="handleInlineBooking('${resourceId}', '${time}')">${t('btn_book_slot')}</button>`
                        : '';
                }
            }
            // Case 2: button is inside a .booking-item (my bookings section)
            const bookingItem = element.closest('.booking-item');
            if (bookingItem) {
                bookingItem.remove();
            }
        }

        // Background refresh of calendar chips and my-bookings list
        await Promise.all([
            fetchBookingsForMonth(currentDate),
            fetchMyBookings().catch(() => {})
        ]);
        renderCalendar();
    } catch (error) {
        console.error('Fel vid avbokning av bokning:', error);
        alert(error.response?.data?.error || 'Fel vid avbokning av bokning');
    }
}

// Handle resource selection
async function handleResourceSelection(resourceId, container, timeSlotsContainer) {
    console.log('Hanterar resursval:', { resourceId, selectedDate });
    const resource = resources.find(r => r.resourceId === resourceId);
    const currentUserId = currentUser?.id;
    if (!resource) {
        console.error('Resursen hittades inte:', resourceId);
        return;
    }
    if (!selectedDate) {
        console.error('Inget datum valt');
        return;
    }
    if (!container) {
        console.error('No container provided');
        return;
    }

    try {
        // Get availability from server
        const dateStr = localDateStr(selectedDate);
        const { resource: resourceDetails, availability } = await getResourceAvailability(resourceId, dateStr);

        // Determine which slots are in the past (only relevant when selected date is today)
        const now = new Date();
        const isToday = selectedDate.toDateString() === now.toDateString();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const isSlotPast = (timeStr) => {
            if (!isToday) return false;
            const [h, m] = timeStr.split(':').map(Number);
            return (h * 60 + m) <= nowMinutes;
        };

        // Show resource information
        const resourceInfo = `
            <div class="resource-details">
                <p><strong>${localize(resourceDetails.name)}</strong></p>
                <p>${localize(resourceDetails.description)}</p>
                <p>${t('resource_duration', resourceDetails.bookingConfig.duration)}</p>
                <p>${t('resource_available', resourceDetails.bookingConfig.startTime, resourceDetails.bookingConfig.endTime)}</p>
            </div>
        `;
        container.innerHTML = resourceInfo;

        // Handle time slots display
        if (timeSlotsContainer) {
            // Day view
            timeSlotsContainer.innerHTML = `
                <h3>${t('available_times_title')}</h3>
                <div class="time-grid">
                    ${availability.map(slot => {
                        const past = isSlotPast(slot.time);
                        const cls = past ? 'past' : (slot.isAvailable ? 'available' : 'booked');
                        const action = past
                            ? ''
                            : slot.isAvailable
                                ? `<button onclick="handleInlineBooking('${resourceId}', '${slot.time}')">${t('btn_book_slot')}</button>`
                                : slot.booking
                                    ? `<span class="booking-info">
                                        <span class="status">${slot.booking.status}</span>
                                        ${canCancelBooking(slot.booking) && slot.booking.status === 'confirmed'
                                            ? `<button onclick="cancelBooking('${slot.booking.id}', this)">${t('btn_cancel_booking')}</button>`
                                            : ''}
                                       </span>`
                                    : `<span class="booked-label">${t('label_booked')}</span>`;
                        return `
                        <div class="time-slot ${cls}">
                            <div class="time-label">${slot.time}</div>
                            <div class="booking-container">${action}</div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        } else {
            // Modal view — exclude past slots
            const timeSlotSelect = document.getElementById('timeSlot');
            const nextButton = document.getElementById('nextStep');
            
            if (timeSlotSelect) {
                const availableSlots = availability.filter(slot => slot.isAvailable && !isSlotPast(slot.time));
                timeSlotSelect.innerHTML = availableSlots.length > 0 ?
                    availableSlots.map(slot => 
                        `<option value="${slot.time}">${slot.time}</option>`
                    ).join('') :
                    `<option value="">${t('no_slots_today')}</option>`;
                
                if (nextButton) {
                    nextButton.disabled = availableSlots.length === 0;
                }
            }
        }
    } catch (error) {
        console.error('Error handling resource selection:', error);
        container.innerHTML = `<p class="error">${t('alert_error_availability')}</p>`;
        if (timeSlotsContainer) {
            timeSlotsContainer.innerHTML = '';
        } else {
            const nextButton = document.getElementById('nextStep');
            if (nextButton) nextButton.disabled = true;
        }
    }
}

// Initialize calendar
function initCalendar() {
    document.getElementById('prevMonth').addEventListener('click', async () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() - 1);
        currentDate = newDate;
        await fetchBookingsForMonth(currentDate);
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', async () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + 1);
        currentDate = newDate;
        await fetchBookingsForMonth(currentDate);
        renderCalendar();
    });

    closeBookingBtn.addEventListener('click', () => {
        bookingModal.style.display = 'none';
        resetBookingForm();
    });

    // Set up booking form steps
    document.getElementById('resourceSelect')?.addEventListener('change', (e) => {
        const infoDiv = document.getElementById('resourceInfo');
        if (infoDiv) handleResourceSelection(e.target.value, infoDiv, null);
    });

    document.getElementById('nextStep')?.addEventListener('click', () => {
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = 'block';
    });

    document.getElementById('prevStep')?.addEventListener('click', () => {
        document.getElementById('step1').style.display = 'block';
        document.getElementById('step2').style.display = 'none';
    });

    closeDayViewBtn.addEventListener('click', () => {
        dayViewModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === bookingModal) {
            bookingModal.style.display = 'none';
        } else if (event.target === dayViewModal) {
            dayViewModal.style.display = 'none';
        }
    });

    bookingForm.addEventListener('submit', handleBooking);

    renderCalendar();
}

// Render the calendar
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Update month display
    const months = tMonths();
    monthDisplay.textContent = `${months[month]} ${year}`;

    // Clear previous calendar days
    const calendarDays = document.getElementById('calendarDays');
    calendarDays.innerHTML = '';

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const firstDayIndex = firstDay.getDay();

    // Add previous month's days
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const dayDiv = createDayElement(prevMonthDays - i, true);
        calendarDays.appendChild(dayDiv);
    }

    // Add current month's days
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let day = 1; day <= totalDays; day++) {
        const dayDate = new Date(year, month, day);
        const isToday = dayDate.getTime() === today.getTime();
        const isPast = dayDate < today;
        const dayDiv = createDayElement(day, false, isToday, isPast);
        calendarDays.appendChild(dayDiv);
    }

    // Add next month's days
    const remainingDays = 42 - (firstDayIndex + totalDays);
    for (let day = 1; day <= remainingDays; day++) {
        const dayDiv = createDayElement(day, true);
        calendarDays.appendChild(dayDiv);
    }
}

// Create a day element
function createDayElement(day, isOtherMonth, isToday = false, isPast = false) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    if (isOtherMonth) dayDiv.classList.add('other-month');
    if (isToday) dayDiv.classList.add('today');
    if (isPast) dayDiv.classList.add('past');

    // Day number
    const dayNumber = document.createElement('span');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    dayDiv.appendChild(dayNumber);

    // Booking chips for current-month days
    if (!isOtherMonth) {
        const dateStr = localDateStr(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
        const dayBookings = bookings.get(dateStr);

        if (dayBookings && dayBookings.length > 0) {
            const MAX_CHIPS = 3;
            const visible = dayBookings.slice(0, MAX_CHIPS);
            const overflow = dayBookings.length - MAX_CHIPS;

            visible.forEach(b => {
                const resource = resources.find(r => r.resourceId === b.resource);
                const label = resource ? localize(resource.name) : b.resource;
                const chip = document.createElement('div');
                chip.className = 'day-booking-chip';
                chip.textContent = `${b.time} ${label}`;
                dayDiv.appendChild(chip);
            });

            if (overflow > 0) {
                const more = document.createElement('div');
                more.className = 'day-more';
                more.textContent = `+${overflow}`;
                dayDiv.appendChild(more);
            }
        }
    }

    if (!isOtherMonth && !isPast) {
        dayDiv.addEventListener('click', async (event) => {
            selectedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
            if (event.ctrlKey || event.metaKey) {
                await showBookingModal();
            } else {
                await showDayView();
            }
        });
    }

    return dayDiv;
}

// Show booking modal
async function showBookingModal() {
    try {
        // Create or get the booking modal
        let bookingModal = document.getElementById('bookingModal');
        if (!bookingModal) {
            bookingModal = document.createElement('div');
            bookingModal.id = 'bookingModal';
            bookingModal.className = 'modal';
            
            const modalContent = document.createElement('div');
            modalContent.className = 'modal-content';
            
            const closeButton = document.createElement('span');
            closeButton.className = 'close';
            closeButton.innerHTML = '&times;';
            closeButton.onclick = () => {
                bookingModal.style.display = 'none';
                resetBookingForm();
            };
            
            const form = document.createElement('form');
            form.id = 'bookingForm';
            
            // Step 1: Resource Selection
            const step1 = document.createElement('div');
            step1.id = 'step1';
            step1.innerHTML = `
                <h2>${t('step1_title')}</h2>
                <select id="resourceSelect" required>
                    <option value="">${t('select_resource_placeholder')}</option>
                </select>
                <div id="resourceInfo"></div>
                <button type="button" id="nextStep" disabled>${t('btn_next')}</button>
            `;
            
            // Step 2: Time Selection
            const step2 = document.createElement('div');
            step2.id = 'step2';
            step2.style.display = 'none';
            step2.innerHTML = `
                <h2>${t('step2_title')}</h2>
                <select id="timeSlot" required></select>
                <button type="button" id="prevStep">${t('btn_back')}</button>
                <button type="submit">${t('btn_book')}</button>
            `;
            
            form.appendChild(step1);
            form.appendChild(step2);
            
            modalContent.appendChild(closeButton);
            modalContent.appendChild(form);
            bookingModal.appendChild(modalContent);
            document.body.appendChild(bookingModal);
            
            // Add click outside to close
            bookingModal.onclick = (event) => {
                if (event.target === bookingModal) {
                    bookingModal.style.display = 'none';
                    resetBookingForm();
                }
            };
            
            // Set up form event handlers
            form.addEventListener('submit', handleBooking);
            document.getElementById('resourceSelect').addEventListener('change', (e) => {
                const infoDiv = document.getElementById('resourceInfo');
                if (infoDiv) handleResourceSelection(e.target.value, infoDiv, null);
            });
            document.getElementById('nextStep').addEventListener('click', () => {
                step1.style.display = 'none';
                step2.style.display = 'block';
            });
            document.getElementById('prevStep').addEventListener('click', () => {
                step1.style.display = 'block';
                step2.style.display = 'none';
            });
        }

        await fetchResources(); // Refresh resources before showing modal
        resetBookingForm(); // Reset form to first step
        bookingModal.style.display = 'block';

        // Pre-select resource if one was chosen from the resource list
        if (selectedResourceId) {
            const select = document.getElementById('resourceSelect');
            if (select) {
                select.value = selectedResourceId;
                select.dispatchEvent(new Event('change'));
                document.getElementById('nextStep').disabled = false;
            }
        }
    } catch (error) {
        console.error('Error preparing booking modal:', error);
        alert(t('alert_error_loading_resources'));
    }
}

// Reset booking form to initial state
function resetBookingForm() {
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('resourceSelect').value = '';
    document.getElementById('resourceInfo').innerHTML = '';
    document.getElementById('nextStep').disabled = true;
    document.getElementById('timeSlot').innerHTML = '';
}

// Show day view
async function showDayView() {
    const currentUserId = currentUser?.id;
    try {
        if (!selectedDate) return;

        // Check if we have resources
        if (resources.length === 0) {
            alert(t('alert_no_resources'));
            return;
        }

        // Create or get the day view modal
        let dayViewModal = document.getElementById('dayViewModal');
        let dayViewContent;

        if (!dayViewModal) {
            // Create the modal structure
            dayViewModal = document.createElement('div');
            dayViewModal.id = 'dayViewModal';
            dayViewModal.className = 'modal';
            
            const modalContent = document.createElement('div');
            modalContent.className = 'modal-content';
            
            const closeButton = document.createElement('span');
            closeButton.id = 'closeDayView';
            closeButton.className = 'close';
            closeButton.innerHTML = '&times;';
            closeButton.onclick = () => {
                dayViewModal.style.display = 'none';
            };
            
            dayViewContent = document.createElement('div');
            dayViewContent.id = 'dayViewContent';
            
            modalContent.appendChild(closeButton);
            modalContent.appendChild(dayViewContent);
            dayViewModal.appendChild(modalContent);
            document.body.appendChild(dayViewModal);

            // Add click outside to close
            dayViewModal.onclick = (event) => {
                if (event.target === dayViewModal) {
                    dayViewModal.style.display = 'none';
                }
            };
        } else {
            dayViewContent = document.getElementById('dayViewContent');
            if (!dayViewContent) {
                // If somehow the content div is missing, recreate it
                dayViewContent = document.createElement('div');
                dayViewContent.id = 'dayViewContent';
                dayViewModal.querySelector('.modal-content').appendChild(dayViewContent);
            }
        }

        dayViewModal.style.display = 'block';
        dayViewContent.innerHTML = '';

        // Add date header
        const dateStr = localDateStr(selectedDate);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        
        const dateHeader = document.createElement('h2');
        dateHeader.textContent = selectedDate.toLocaleDateString(getCurrentLang(), {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dayViewContent.appendChild(dateHeader);

        // Create resource selection section
        const resourceSection = document.createElement('div');
        resourceSection.className = 'resource-section';
        
        // Add instruction
        const instruction = document.createElement('p');
        instruction.textContent = t('select_resource_instruction');
        resourceSection.appendChild(instruction);

        // Create resource select
        const resourceSelect = document.createElement('select');
        resourceSelect.id = 'dayViewResourceSelect';
        resourceSelect.required = true;

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = t('select_resource_placeholder');
        resourceSelect.appendChild(defaultOption);

        // Add resources
        resources.forEach(resource => {
            const option = document.createElement('option');
            option.value = resource.resourceId;
            option.textContent = localize(resource.name);
            resourceSelect.appendChild(option);
        });

        resourceSection.appendChild(resourceSelect);

        // Create resource info div
        const resourceInfoDiv = document.createElement('div');
        resourceInfoDiv.id = 'dayViewResourceInfo';
        resourceSection.appendChild(resourceInfoDiv);

        dayViewContent.appendChild(resourceSection);

        // Create time slots container (initially empty)
        const timeSlotsContainer = document.createElement('div');
        timeSlotsContainer.id = 'dayViewTimeSlots';
        timeSlotsContainer.className = 'time-slots-container';
        dayViewContent.appendChild(timeSlotsContainer);

        // Handle resource selection
        resourceSelect.onchange = () => {
            const resourceId = resourceSelect.value;
            if (!resourceId) {
                resourceInfoDiv.innerHTML = '';
                timeSlotsContainer.innerHTML = '';
                return;
            }
            handleResourceSelection(resourceId, resourceInfoDiv, timeSlotsContainer);
        };

        // Pre-select resource if one was chosen from the resource list
        if (selectedResourceId) {
            resourceSelect.value = selectedResourceId;
            resourceSelect.dispatchEvent(new Event('change'));
        }

        // Close button handler
        closeDayViewBtn.onclick = () => {
            dayViewModal.style.display = 'none';
        };

        // Close when clicking outside the modal
        window.onclick = event => {
            if (event.target === dayViewModal) {
                dayViewModal.style.display = 'none';
            }
        };
    } catch (error) {
        console.error('Error showing day view:', error);
        alert(t('alert_error_day_view'));
    }
}

// Show inline booking form
async function showInlineBookingForm(container, time) {
    // Clear any existing form
    container.innerHTML = '';
    
    // Create form
    const form = document.createElement('form');
    form.className = 'inline-booking-form';
    
    // Create resource select
    const select = document.createElement('select');
    select.id = `resourceSelect-${time}`;
    select.required = true;

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = t('select_resource_placeholder');
    select.appendChild(defaultOption);

    // Add resources
    resources.forEach(resource => {
        const option = document.createElement('option');
        option.value = resource.resourceId;
        option.textContent = localize(resource.name);
        select.appendChild(option);
    });

    // Create resource info div
    const resourceInfoDiv = document.createElement('div');
    resourceInfoDiv.id = `resourceInfo-${time}`;
    resourceInfoDiv.className = 'resource-info';

    // Create time slot select (initially hidden)
    const timeSlotDiv = document.createElement('div');
    timeSlotDiv.id = `timeSlotDiv-${time}`;
    timeSlotDiv.style.display = 'none';
    
    // Add change handler for resource selection
    select.onchange = async () => {
        const resourceId = select.value;
        if (!resourceId) {
            resourceInfoDiv.innerHTML = '';
            timeSlotDiv.style.display = 'none';
            return;
        }

        try {
            const { resource, availability } = await getResourceAvailability(resourceId, localDateStr(selectedDate));
            
            // Show resource information
            resourceInfoDiv.innerHTML = `
                <p><strong>${localize(resource.name)}</strong></p>
                <p>${localize(resource.description)}</p>
                <p>${t('booking_duration', resource.bookingConfig.duration)}</p>
                <p>${t('available_hours', resource.bookingConfig.startTime, resource.bookingConfig.endTime)}</p>
            `;

            // Show available time slots
            if (availability.some(slot => slot.isAvailable)) {
                timeSlotDiv.innerHTML = `
                    <h4>${t('available_times_inline')}</h4>
                    <div class="time-slots">
                        ${availability
                            .filter(slot => slot.isAvailable)
                            .map(slot => `
                                <button type="button" class="time-slot" 
                                    onclick="handleInlineBooking('${resourceId}', '${slot.time}')">
                                    ${slot.time}
                                </button>
                            `).join('')}
                    </div>
                `;
                timeSlotDiv.style.display = 'block';
            } else {
                timeSlotDiv.innerHTML = `<p>${t('no_slots_today')}</p>`;
                timeSlotDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Error getting resource availability:', error);
            resourceInfoDiv.innerHTML = `<p class="error">${t('alert_error_resource_info')}</p>`;
        }
    };
    
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('btn_cancel');
    cancelButton.onclick = () => showDayView(); // Refresh the day view
    
    // Assemble form
    form.appendChild(select);
    form.appendChild(resourceInfoDiv);
    form.appendChild(timeSlotDiv);
    form.appendChild(cancelButton);
    
    container.appendChild(form);
}

async function handleInlineBooking(resource, time) {
    if (!selectedDate) return;
    
    try {
        // Create booking through API
        await axios.post('/events', {
            resourceId: resource,
            date: localDateStr(selectedDate),
            time: time
        }, { params: groupParam() });

        // Refresh bookings for this date
        await fetchBookingsForMonth(currentDate);
        
        // Update displays
        renderCalendar(); // Refresh calendar to show new booking indicators

        // Instead of refreshing the entire day view, just update the availability
        const resourceSelect = document.getElementById('dayViewResourceSelect');
        if (resourceSelect && resourceSelect.value === resource) {
            // Trigger the change event to refresh availability
            resourceSelect.dispatchEvent(new Event('change'));
        }
        
        // Show confirmation
        alert(t('alert_booking_confirmed'));
    } catch (error) {
        if (error.response && error.response.status === 409) {
            alert(t('alert_slot_already_booked'));
        } else {
            console.error('Error creating booking:', error);
            alert(t('alert_error_booking'));
        }
    }
}

// Fetch bookings for a specific month
async function fetchBookingsForMonth(date) {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    try {
        const response = await axios.get('/events', {
            params: groupParam({
                startDate: localDateStr(startDate),
                endDate: localDateStr(endDate)
            })
        });
        
        // Clear existing bookings for this month
        bookings.clear();
        
        // Group bookings by date
        response.data.forEach(booking => {
            const dateStr = localDateStr(new Date(booking.date));
            if (!bookings.has(dateStr)) {
                bookings.set(dateStr, []);
            }
            bookings.get(dateStr).push({
                resource: booking.resourceId,
                time: booking.time
            });
        });
        
        renderCalendar();
    } catch (error) {
        console.error('Error fetching bookings:', error);
        alert(t('alert_error_bookings'));
    }
}

// Handle booking submission
async function handleBooking(event) {
    event.preventDefault();
    
    if (!selectedDate) return;

    const resource = document.getElementById('resourceSelect').value;
    const time = document.getElementById('timeSlot').value;
    
    try {
        // Create booking through API
        await axios.post('/events', {
            resourceId: resource,
            date: localDateStr(selectedDate),
            time: time
        }, { params: groupParam() });

        // Close modal and reset form
        bookingModal.style.display = 'none';
        bookingForm.reset();
        
        // Show confirmation
        alert(t('alert_booking_confirmed'));
        
        // Refresh bookings for this date
        await fetchBookingsForMonth(currentDate);
        
        // Update displays
        renderCalendar();
    } catch (error) {
        if (error.response && error.response.status === 409) {
            alert(t('alert_slot_already_booked'));
        } else {
            console.error('Error creating booking:', error);
            alert(t('alert_error_booking'));
        }
    }
}

// Add styles for modals
const styles = document.createElement('style');
styles.textContent = `
    .error-message {
        color: #dc3545;
        padding: 10px;
        margin: 10px 0;
        border: 1px solid #dc3545;
        border-radius: 4px;
        background-color: #ffebee;
    }

    .error-message p {
        margin: 5px 0;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 15px;
    }

    .user-info span {
        color: #2c3e50;
        font-weight: 500;
    }

    .logout-button {
        padding: 8px 16px;
        background-color: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .logout-button:hover {
        background-color: #c82333;
    }

    .time-slot.past {
        background-color: #f5f5f5;
        border-color: #e0e0e0;
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }

    .past-label {
        font-size: 12px;
        color: #aaa;
        font-style: italic;
    }

    .time-slot.cancelled {
        background-color: #ffebee;
        opacity: 0.7;
    }

    .time-slot .booking-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }

    .time-slot .status {
        font-size: 12px;
        text-transform: uppercase;
        font-weight: 500;
    }

    .time-slot .user-label {
        font-size: 12px;
        color: #2196f3;
        font-weight: 500;
    }

    .time-slot.cancelled .status {
        color: #d32f2f;
    }

    .my-bookings {
        margin-top: 20px;
    }

    .booking-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px;
        margin-bottom: 10px;
        background-color: #f8f9fa;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        transition: transform 0.2s;
    }

    .booking-item:hover {
        transform: translateY(-2px);
    }

    .booking-item.cancelled {
        background-color: #ffebee;
        opacity: 0.7;
    }

    .booking-info {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .booking-info strong {
        color: #2c3e50;
        font-size: 16px;
    }

    .booking-info span {
        color: #6c757d;
        font-size: 14px;
    }

    .booking-info .status {
        text-transform: uppercase;
        font-size: 12px;
        font-weight: 500;
    }

    .booking-item.cancelled .status {
        color: #d32f2f;
    }

    .booking-item button {
        padding: 8px 16px;
        background-color: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .booking-item button:hover {
        background-color: #c82333;
    }

    .form-group {
        margin-bottom: 15px;
    }

    .form-group label {
        display: block;
        margin-bottom: 5px;
        color: #495057;
        font-weight: 500;
    }

    .form-group input {
        width: 100%;
        padding: 10px;
        border: 2px solid #e9ecef;
        border-radius: 6px;
        font-size: 16px;
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .form-group input:focus {
        outline: none;
        border-color: #4caf50;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
    }

    .modal {
        display: none;
        position: fixed;
        z-index: 1;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        background-color: rgba(0,0,0,0.4);
    }

    .modal-content {
        background-color: #fefefe;
        margin: 15% auto;
        padding: 20px;
        border: 1px solid #888;
        width: 80%;
        max-width: 600px;
        border-radius: 5px;
        position: relative;
    }

    .close {
        color: #aaa;
        float: right;
        font-size: 28px;
        font-weight: bold;
        cursor: pointer;
    }

    .close:hover,
    .close:focus {
        color: black;
        text-decoration: none;
        cursor: pointer;
    }

    .resource-section {
        margin-bottom: 20px;
    }

    .resource-details {
        margin: 10px 0;
        padding: 15px;
        background-color: #f8f9fa;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }

    .resource-details p {
        margin: 8px 0;
        line-height: 1.4;
    }

    .resource-details strong {
        color: #2c3e50;
    }

    select {
        width: 100%;
        padding: 10px;
        margin: 8px 0;
        border: 2px solid #e9ecef;
        border-radius: 6px;
        background-color: white;
        font-size: 16px;
        color: #495057;
        transition: border-color 0.2s, box-shadow 0.2s;
        appearance: none;
        background-image: url('data:image/svg+xml;charset=US-ASCII,<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%23495057"/></svg>');
        background-repeat: no-repeat;
        background-position: right 10px center;
        cursor: pointer;
    }

    select:focus {
        outline: none;
        border-color: #4caf50;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
    }

    select:hover {
        border-color: #ced4da;
    }

    button {
        padding: 10px 20px;
        margin: 5px;
        border: none;
        border-radius: 6px;
        background-color: #4caf50;
        color: white;
        font-size: 16px;
        cursor: pointer;
        transition: background-color 0.2s, transform 0.1s;
    }

    button:hover {
        background-color: #45a049;
        transform: translateY(-1px);
    }

    button:disabled {
        background-color: #cccccc;
        cursor: not-allowed;
        transform: none;
    }

    button[type="button"] {
        background-color: #6c757d;
    }

    button[type="button"]:hover {
        background-color: #5a6268;
    }

    .time-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 12px;
        margin-top: 15px;
    }

    .time-slot {
        padding: 12px;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        text-align: center;
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .time-slot:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }

    .time-slot.available {
        background-color: #e8f5e9;
        border-color: #c8e6c9;
    }

    .time-slot.booked {
        background-color: #ffebee;
        border-color: #ffcdd2;
    }

    .time-slot button {
        width: 100%;
        margin: 8px 0 0 0;
        padding: 8px;
        background-color: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    }

    .time-slot button:hover {
        background-color: #45a049;
    }

    .booked-label {
        color: #d32f2f;
        font-weight: bold;
        display: block;
        margin-top: 8px;
    }

    h2 {
        color: #2c3e50;
        margin-bottom: 20px;
        font-size: 24px;
    }

    .error {
        color: #d32f2f;
        padding: 10px;
        background-color: #ffebee;
        border-radius: 4px;
        margin: 10px 0;
    }
`;
document.head.appendChild(styles);

// Authentication state
let currentUser = null;
let authToken = localStorage.getItem('authToken');

// Try to restore user info from localStorage
try {
    const userJson = localStorage.getItem('currentUser');
    if (userJson) {
        currentUser = JSON.parse(userJson);
    }
} catch (error) {
    console.error('Error restoring user info:', error);
    localStorage.removeItem('currentUser');
}

// Show login form
function showLoginForm() {
    // Remove any existing login modal
    const existingModal = document.getElementById('loginModal');
    if (existingModal) {
        existingModal.remove();
    }

    const loginModal = document.createElement('div');
    loginModal.id = 'loginModal';
    loginModal.className = 'modal';
    loginModal.style.display = 'block';
    loginModal.style.zIndex = '1000';
    
    const loginModalContent = document.createElement('div');
    loginModalContent.className = 'modal-content';
    loginModalContent.innerHTML = `
        <h2>${t('login_title')}</h2>
        <form id="loginForm">
            <div class="form-group">
                <label for="loginEmail">${t('label_email')}</label>
                <input type="email" id="loginEmail" required>
            </div>
            <button type="button" id="sendCodeBtn">${t('btn_send_code')}</button>
            <div class="form-group" style="margin-top:12px;">
                <label for="loginCode">${t('label_code')}</label>
                <input type="text" id="loginCode" maxlength="6" placeholder="${t('placeholder_code')}">
            </div>
            <button type="submit">${t('btn_login')}</button>
        </form>
        <p>${t('text_no_account')} <a href="#" id="showRegister">${t('link_register')}</a></p>
    `;
    loginModal.appendChild(loginModalContent);
    
    document.body.appendChild(loginModal);

    // Handle send code
    document.getElementById('sendCodeBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value;
        if (!email) {
            alert(t('alert_enter_email'));
            return;
        }
        const btn = document.getElementById('sendCodeBtn');
        btn.disabled = true;
        btn.textContent = t('btn_sending');
        try {
            await axios.post('/send-login-code', { email });
            btn.textContent = t('btn_resend_code');
            btn.disabled = false;
        } catch (error) {
            alert(error.response?.data?.error || t('alert_send_code_failed'));
            btn.textContent = t('btn_send_code');
            btn.disabled = false;
        }
    });

    // Handle login
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const code = document.getElementById('loginCode').value;
        
        try {
            const response = await axios.post('/login', { email, code });
            authToken = response.data.token;
            currentUser = response.data.user;
            
            // Store token and user info
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            // Set default Authorization header for all future requests
            axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
            
            // Remove login modal and initialize calendar
            loginModal.remove();
            updateUserInfo();
            initializeCalendar();
        } catch (error) {
            alert(error.response?.data?.error || t('alert_login_failed'));
        }
    });
    
    // Show registration form
    document.getElementById('showRegister').addEventListener('click', () => {
        loginModal.remove();
        showRegisterForm();
    });
}

// Show registration form
function showRegisterForm() {
    // Remove any existing register modal
    const existingModal = document.getElementById('registerModal');
    if (existingModal) {
        existingModal.remove();
    }

    const registerModal = document.createElement('div');
    registerModal.id = 'registerModal';
    registerModal.className = 'modal';
    registerModal.style.display = 'block';
    registerModal.style.zIndex = '1000';
    
    const registerModalContent = document.createElement('div');
    registerModalContent.className = 'modal-content';
    registerModalContent.innerHTML = `
        <h2>${t('register_title')}</h2>
        <form id="registerForm">
            <div class="form-group">
                <label for="registerName">${t('label_name')}</label>
                <input type="text" id="registerName" required>
            </div>
            <div class="form-group">
                <label for="registerEmail">${t('label_email')}</label>
                <input type="email" id="registerEmail" required>
            </div>
            <div class="form-group">
                <label for="registerPassword">${t('label_password')}</label>
                <input type="password" id="registerPassword" required>
            </div>
            <button type="submit">${t('btn_register')}</button>
        </form>
        <p>${t('text_have_account')} <a href="#" id="showLogin">${t('link_login')}</a></p>
    `;
    registerModal.appendChild(registerModalContent);
    
    document.body.appendChild(registerModal);
    
    // Handle registration
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        
        try {
            const response = await axios.post('/register', { name, email, password });
            authToken = response.data.token;
            currentUser = response.data.user;
            
            // Store token and user info
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            // Set default Authorization header for all future requests
            axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
            
            // Remove register modal and initialize calendar
            registerModal.remove();
            updateUserInfo();
            initializeCalendar();
        } catch (error) {
            alert(error.response?.data?.error || t('alert_registration_failed'));
        }
    });
    
    // Show login form
    document.getElementById('showLogin').addEventListener('click', () => {
        registerModal.remove();
        showLoginForm();
    });
}

// Update user info display
function updateUserInfo() {
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    
    if (currentUser) {
        userName.textContent = `${currentUser.name} (${currentUser.email})`;
        userInfo.style.display = 'flex';
    } else {
        userInfo.style.display = 'none';
    }
}

// Handle logout
function handleLogout() {
    // Clear auth data
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    authToken = null;
    currentUser = null;
    
    // Clear axios default header
    delete axios.defaults.headers.common['Authorization'];
    
    // Update UI
    updateUserInfo();
    
    // Show login form
    showLoginForm();
}

// Initialize calendar after authentication
async function initializeCalendar() {
    try {
        console.log('Initializing calendar...', { currentUser });
        await fetchResources();
        renderResourceList();
        if (resources.length === 0) {
            alert(t('alert_no_resources'));
        }
        await fetchBookingsForMonth(currentDate);
        if (currentUser) await fetchMyBookings();
        initCalendar();
        console.log('Calendar initialized successfully');
    } catch (error) {
        console.error('Error during initialization:', error);
        alert(t('alert_error_init'));
    }
}

// Fetch user's bookings
async function fetchMyBookings() {
    try {
        const response = await axios.get('/events/my-bookings', { params: groupParam() });
        const bookings = response.data;
        displayMyBookings(bookings);
    } catch (error) {
        console.error('Error fetching my bookings:', error);
    }
}

// Display user's bookings
function displayMyBookings(bookings) {
    const myBookingsDiv = document.getElementById('myBookings');
    if (!myBookingsDiv) return;

    if (bookings.length === 0) {
        myBookingsDiv.innerHTML = `<p>${t('no_upcoming_bookings')}</p>`;
        return;
    }

    const bookingsList = bookings.map(booking => {
        const date = new Date(booking.date).toLocaleDateString(getCurrentLang());
        return `
            <div class="booking-item ${booking.status}">
                <div class="booking-info">
                    <strong>${booking.resourceName}</strong>
                    <span>${date} – ${booking.time}</span>
                    <span class="status">${booking.status}</span>
                </div>
                ${booking.status === 'confirmed' ? `
                    <button onclick="cancelBooking('${booking._id}', this)">${t('btn_cancel_booking')}</button>
                ` : ''}
            </div>
        `;
    }).join('');

    myBookingsDiv.innerHTML = bookingsList;
}


let _initDone = false;
// Initialize when DOM is loaded
async function init() {
    if (_initDone) return;
    _initDone = true;
    // Remove any existing modals
    const existingModals = document.querySelectorAll('.modal');
    existingModals.forEach(modal => modal.remove());

    // Update user info display
    updateUserInfo();

    // No group in URL — show an error
    if (!currentGroup) {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;"><h2>No group specified</h2><p>Please access the calendar via <code>/&lt;groupname&gt;</code>.</p></div>';
        return;
    }

    // Fetch group info to determine public/private
    let groupInfo;
    try {
        const res = await axios.get(`/groups/${currentGroup}`);
        groupInfo = res.data;
    } catch (e) {
        const url = `/groups/${currentGroup}`;
        console.error('Group fetch failed:', url, e?.response?.status, e?.response?.data, e?.message);
        document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;"><h2>Group not found</h2>
            <p>URL: <code>${url}</code></p>
            <p>Status: <code>${e?.response?.status}</code></p>
            <p>Response: <code>${JSON.stringify(e?.response?.data)}</code></p>
            <p>Message: <code>${e?.message}</code></p>
            <p>currentGroup: <code>${currentGroup}</code></p>
            <p>pathname: <code>${window.location.pathname}</code></p></div>`;
        return;
    }

    if (groupInfo.public) {
        // Public group: go straight to calendar, no login required
        initializeCalendar().catch(err => console.error('Init error:', err));
    } else {
        // Private group: require authentication
        if (authToken) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
            initializeCalendar().catch(error => {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    localStorage.removeItem('authToken');
                    authToken = null;
                    showLoginForm();
                } else {
                    console.error('Error during initialization:', error);
                    alert(t('alert_error_init'));
                }
            });
        } else {
            setTimeout(showLoginForm, 0);
        }
    }
}

// Set up event listeners and initialize once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
});
