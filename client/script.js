let currentDate = new Date();
let selectedDate = null;
let resources = []; // Store resources from API
let bookings = new Map(); // Store bookings: date -> [{resource, time}]

// Fetch resources from API
async function fetchResources() {
    try {
        console.log('Fetching resources from server...');
        const response = await axios.get('/resources');
        resources = response.data;
        console.log('Resources fetched:', resources);
        updateResourceSelects();
        return resources;
    } catch (error) {
        console.error('Error fetching resources:', error);
        alert('Error loading resources. Please try again.');
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
        defaultOption.textContent = 'Select a resource...';
        select.appendChild(defaultOption);

        // Add resources from server
        resources.forEach(resource => {
            const option = document.createElement('option');
            option.value = resource.resourceId;
            option.textContent = resource.name;
            select.appendChild(option);
        });

        // Restore previous selection if it exists
        if (currentValue && resources.some(r => r.resourceId === currentValue)) {
            select.value = currentValue;
        }
    });
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
        const response = await axios.get('/availability', {
            params: {
                date: date,
                resourceId: resourceId
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting availability:', error);
        throw error;
    }
}

// Handle resource selection
async function handleResourceSelection(resourceId, container, timeSlotsContainer) {
    const resource = resources.find(r => r.resourceId === resourceId);
    if (!resource || !selectedDate || !container) return;

    try {
        // Get availability from server
        const dateStr = selectedDate.toISOString().split('T')[0];
        const { resource: resourceDetails, availability } = await getResourceAvailability(resourceId, dateStr);

        // Show resource information
        const resourceInfo = `
            <div class="resource-details">
                <p><strong>${resourceDetails.name}</strong></p>
                <p>${resourceDetails.description || ''}</p>
                <p>Booking duration: ${resourceDetails.bookingConfig.duration} minutes</p>
                <p>Available: ${resourceDetails.bookingConfig.startTime} - ${resourceDetails.bookingConfig.endTime}</p>
            </div>
        `;
        container.innerHTML = resourceInfo;

        // Handle time slots display
        if (timeSlotsContainer) {
            // Day view
            timeSlotsContainer.innerHTML = `
                <h3>Available Time Slots</h3>
                <div class="time-grid">
                    ${availability.map(slot => `
                        <div class="time-slot ${slot.isAvailable ? 'available' : 'booked'}">
                            <div class="time-label">${slot.time}</div>
                            <div class="booking-container">
                                ${slot.isAvailable ? 
                                    `<button onclick="handleInlineBooking('${resourceId}', '${slot.time}')">Book</button>` : 
                                    '<span class="booked-label">Booked</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            // Modal view
            const timeSlotSelect = document.getElementById('timeSlot');
            const nextButton = document.getElementById('nextStep');
            
            if (timeSlotSelect) {
                const availableSlots = availability.filter(slot => slot.isAvailable);
                timeSlotSelect.innerHTML = availableSlots.length > 0 ?
                    availableSlots.map(slot => 
                        `<option value="${slot.time}">${slot.time}</option>`
                    ).join('') :
                    '<option value="">No available time slots</option>';
                
                if (nextButton) {
                    nextButton.disabled = availableSlots.length === 0;
                }
            }
        }
    } catch (error) {
        console.error('Error handling resource selection:', error);
        container.innerHTML = '<p class="error">Error loading resource availability</p>';
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
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
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

    // Add export button handler
    document.getElementById('exportBookings').addEventListener('click', exportBookings);

    renderCalendar();
    updateBookingsDisplay();
}

// Render the calendar
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Update month display
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    monthDisplay.textContent = `${monthNames[month]} ${year}`;

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
    for (let day = 1; day <= totalDays; day++) {
        const isToday = today.getDate() === day && 
                       today.getMonth() === month && 
                       today.getFullYear() === year;
        const dayDiv = createDayElement(day, false, isToday);
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
function createDayElement(day, isOtherMonth, isToday = false) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    if (isOtherMonth) dayDiv.classList.add('other-month');
    if (isToday) dayDiv.classList.add('today');

    // Check for bookings on this day
    if (!isOtherMonth) {
        const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
            .toISOString().split('T')[0];
        const dayBookings = bookings.get(dateStr);
        
        if (dayBookings && dayBookings.length > 0) {
            dayDiv.classList.add('has-bookings');
            const count = document.createElement('span');
            count.className = 'booking-count';
            count.textContent = dayBookings.length;
            dayDiv.appendChild(count);
        }
    }

    dayDiv.textContent = day;
    
    if (!isOtherMonth) {
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
                <h2>Select Resource</h2>
                <select id="resourceSelect" required>
                    <option value="">Select a resource...</option>
                </select>
                <div id="resourceInfo"></div>
                <button type="button" id="nextStep" disabled>Next</button>
            `;
            
            // Step 2: Time Selection
            const step2 = document.createElement('div');
            step2.id = 'step2';
            step2.style.display = 'none';
            step2.innerHTML = `
                <h2>Select Time</h2>
                <select id="timeSlot" required></select>
                <button type="button" id="prevStep">Back</button>
                <button type="submit">Book</button>
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
    } catch (error) {
        console.error('Error preparing booking modal:', error);
        alert('Error loading resources. Please try again.');
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
    try {
        if (!selectedDate) return;

        // Check if we have resources
        if (resources.length === 0) {
            alert('No resources available. Please add resources to the system.');
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
        const dateStr = selectedDate.toISOString().split('T')[0];
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        
        const dateHeader = document.createElement('h2');
        dateHeader.textContent = selectedDate.toLocaleDateString('en-US', {
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
        instruction.textContent = 'First, select a resource to see available time slots:';
        resourceSection.appendChild(instruction);

        // Create resource select
        const resourceSelect = document.createElement('select');
        resourceSelect.id = 'dayViewResourceSelect';
        resourceSelect.required = true;

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a resource...';
        resourceSelect.appendChild(defaultOption);

        // Add resources
        resources.forEach(resource => {
            const option = document.createElement('option');
            option.value = resource.resourceId;
            option.textContent = resource.name;
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
        alert('Error loading day view. Please try again.');
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
    defaultOption.textContent = 'Select a resource...';
    select.appendChild(defaultOption);

    // Add resources
    resources.forEach(resource => {
        const option = document.createElement('option');
        option.value = resource.resourceId;
        option.textContent = resource.name;
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
            const { resource, availability } = await getResourceAvailability(resourceId, selectedDate.toISOString().split('T')[0]);
            
            // Show resource information
            resourceInfoDiv.innerHTML = `
                <p><strong>${resource.name}</strong></p>
                <p>${resource.description || ''}</p>
                <p>Booking duration: ${resource.bookingConfig.duration} minutes</p>
                <p>Available: ${resource.bookingConfig.startTime} - ${resource.bookingConfig.endTime}</p>
            `;

            // Show available time slots
            if (availability.some(slot => slot.isAvailable)) {
                timeSlotDiv.innerHTML = `
                    <h4>Available Times</h4>
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
                timeSlotDiv.innerHTML = '<p>No available time slots for this resource today.</p>';
                timeSlotDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Error getting resource availability:', error);
            resourceInfoDiv.innerHTML = '<p class="error">Error loading resource information.</p>';
        }
    };
    
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
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
            date: selectedDate.toISOString().split('T')[0],
            time: time
        });

        // Refresh bookings for this date
        await fetchBookingsForMonth(currentDate);
        
        // Update displays
        updateBookingsDisplay();
        renderCalendar(); // Refresh calendar to show new booking indicators

        // Instead of refreshing the entire day view, just update the availability
        const resourceSelect = document.getElementById('dayViewResourceSelect');
        if (resourceSelect && resourceSelect.value === resource) {
            // Trigger the change event to refresh availability
            resourceSelect.dispatchEvent(new Event('change'));
        }
        
        // Show confirmation
        alert('Booking confirmed!');
    } catch (error) {
        if (error.response && error.response.status === 409) {
            alert('This time slot is already booked!');
        } else {
            console.error('Error creating booking:', error);
            alert('Error creating booking. Please try again.');
        }
    }
}

// Fetch bookings for a specific month
async function fetchBookingsForMonth(date) {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    try {
        const response = await axios.get('/events', {
            params: {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0]
            }
        });
        
        // Clear existing bookings for this month
        bookings.clear();
        
        // Group bookings by date
        response.data.forEach(booking => {
            const dateStr = new Date(booking.date).toISOString().split('T')[0];
            if (!bookings.has(dateStr)) {
                bookings.set(dateStr, []);
            }
            bookings.get(dateStr).push({
                resource: booking.resourceId,
                time: booking.time
            });
        });
        
        updateBookingsDisplay();
        renderCalendar();
    } catch (error) {
        console.error('Error fetching bookings:', error);
        alert('Error loading bookings. Please try again.');
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
            date: selectedDate.toISOString().split('T')[0],
            time: time
        });

        // Close modal and reset form
        bookingModal.style.display = 'none';
        bookingForm.reset();
        
        // Show confirmation
        alert('Booking confirmed!');
        
        // Refresh bookings for this date
        await fetchBookingsForMonth(currentDate);
        
        // Update displays
        updateBookingsDisplay();
        renderCalendar();
    } catch (error) {
        if (error.response && error.response.status === 409) {
            alert('This time slot is already booked!');
        } else {
            console.error('Error creating booking:', error);
            alert('Error creating booking. Please try again.');
        }
    }
}

// Update bookings display
function updateBookingsDisplay() {
    const bookingsDisplay = document.getElementById('bookingsDisplay');
    if (!bookingsDisplay) return;

    const bookingsObj = {};
    
    // Convert Map to regular object for JSON display
    for (const [date, dayBookings] of bookings) {
        bookingsObj[date] = dayBookings;
    }
    
    bookingsDisplay.textContent = JSON.stringify(bookingsObj, null, 2);
}

// Export bookings as JSON file
function exportBookings() {
    const bookingsObj = {};
    for (const [date, dayBookings] of bookings) {
        bookingsObj[date] = dayBookings;
    }
    
    const dataStr = JSON.stringify(bookingsObj, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportLink = document.createElement('a');
    exportLink.setAttribute('href', dataUri);
    exportLink.setAttribute('download', 'bookings.json');
    document.body.appendChild(exportLink);
    exportLink.click();
    document.body.removeChild(exportLink);
}

// Add styles for modals
const styles = document.createElement('style');
styles.textContent = `
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Initializing calendar...');
        await fetchResources(); // This updates the global resources array
        if (resources.length === 0) {
            alert('No resources available. Please add some resources to the system.');
        }
        await fetchBookingsForMonth(currentDate);
        initCalendar();
        console.log('Calendar initialized successfully');
    } catch (error) {
        console.error('Error during initialization:', error);
        alert('Error initializing the calendar. Please refresh the page.');
    }
});
