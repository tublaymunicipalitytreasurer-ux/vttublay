if (sessionStorage.getItem('isLoggedIn') !== 'true') {
    window.location.href = '../index.html';
}

(function () {
    try {
        if (window.SUPPRESS_VERBOSE) {
            console.log = function() {};
            console.info = function() {};
            console.debug = function() {};
            console.table = function() {};
            console.trace = function() {};
            console.warn = function() {};
        }
    } catch (e) {
    }
})();

function getSupabaseClient() {
    return window.supabaseClient || null;
}

async function waitForSupabaseClient(maxWaitMs = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        const client = getSupabaseClient();
        if (client && typeof client.from === 'function') return true;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

async function fetchSections() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        const { data, error } = await supabaseClient
            .from('sections')
            .select('*')
            .order('section_name');
        if (error) throw error;
        return { success: true, data: data || [], error: null };
    } catch (error) {
        console.error('Fetch sections error:', error);
        return { success: false, data: [], error: error.message };
    }
}

async function fetchOffensesBySection(sectionId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sectionId)) {
            console.warn('Invalid section ID format:', sectionId);
            return { success: false, data: [], error: 'Invalid section ID format' };
        }
        const { data, error } = await supabaseClient
            .from('offenses')
            .select('id, offense_name')
            .eq('section_id', sectionId)
            .order('offense_name');
        if (error) throw error;
        return { success: true, data: data || [], error: null };
    } catch (error) {
        console.error('Fetch offenses error:', error);
        return { success: false, data: [], error: error.message || 'Failed to fetch offenses' };
    }
}

async function fetchFinesByOffense(offenseId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data, error } = await supabaseClient
            .from('fines')
            .select('*')
            .eq('offense_id', offenseId)
            .order('level');

        if (error) throw error;

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Fetch fines error:', error);
        return { success: false, data: [], error: error.message };
    }
}

const appState = {
    currentEditId: null,
    lastChangedViolation: null,
    editingSection: null,
    editingOffense: null,
    currentViolationId: null,
    paymentEditMode: false,
    currentPage: 1,
    currentSort: { column: 'no', direction: 'asc' },
    
    setEditViolation(id) {
        this.currentEditId = id;
    },
    
    clearEditViolation() {
        this.currentEditId = null;
        this.lastChangedViolation = null;
    },
    
    setEditingOffense(section, offense) {
        this.editingSection = section;
        this.editingOffense = offense;
    },
    
    clearEditingOffense() {
        this.editingSection = null;
        this.editingOffense = null;
    },
    
    reset() {
        this.currentEditId = null;
        this.lastChangedViolation = null;
        this.editingSection = null;
        this.editingOffense = null;
        this.currentViolationId = null;
        this.paymentEditMode = false;
        this.currentPage = 1;
    }
};

let violations = [];
let isLoadingInitial = true;
let currentSort = appState.currentSort;
let currentViolationId = null;
let currentPage = appState.currentPage;
let editingSection = null;
let editingOffense = null;
let sectionsCache = [];
let additionalViolationRows = [];
let realtimeChannel = null;
let realtimeRefreshTimer = null;
let isRealtimeRefreshing = false;
const PAGE_SIZE = 100;

let tableBody, searchInput, searchBtn, addNewBtn, exportBtn, importBtn, manageOffensesBtn;
let violationModal, paymentModal, manageOffensesModal;
let closeBtns, cancelBtns, violationForm, paymentForm;
let sectionSelect, offensesSelect, levelSelect, fineInput, fineInfo;
let modalTitle, statusInput, noInput, clearDateBtn;

function fillSectionsIntoSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Select Section</option>';
    sectionsCache.forEach(section => {
        const option = document.createElement('option');
        option.value = section.id;
        option.textContent = section.section_name;
        selectEl.appendChild(option);
    });
}

async function populateOffensesForSelect(sectionId, offenseSelectEl) {
    if (!offenseSelectEl) return;
    offenseSelectEl.innerHTML = '<option value="">Loading offenses...</option>';
    offenseSelectEl.disabled = true;

    if (!sectionId) {
        offenseSelectEl.innerHTML = '<option value="">Select Section First</option>';
        offenseSelectEl.disabled = false;
        return;
    }

    const result = await fetchOffensesBySection(sectionId);
    if (!result.success) {
        offenseSelectEl.innerHTML = '<option value="">Error loading offenses</option>';
        offenseSelectEl.disabled = false;
        return;
    }

    offenseSelectEl.innerHTML = '<option value="">Select Offense</option>';
    result.data.forEach(offense => {
        const option = document.createElement('option');
        option.value = offense.id;
        option.textContent = escapeHTML(offense.offense_name);
        offenseSelectEl.appendChild(option);
    });
    offenseSelectEl.disabled = false;
}

async function updateFineForEntry(offenseSelectEl, levelSelectEl, fineInputEl) {
    const offenseId = offenseSelectEl?.value;
    const level = levelSelectEl?.value;
    if (!offenseId || !level || !fineInputEl) {
        if (fineInputEl) fineInputEl.value = '';
        return;
    }

    const result = await fetchFinesByOffense(offenseId);
    if (!result.success || !result.data) {
        fineInputEl.value = '';
        return;
    }

    const selectedFine = result.data.find(f => f.level === parseInt(level));
    fineInputEl.value = selectedFine ? selectedFine.amount : '';
}

function clearAdditionalViolationRows() {
    const container = document.getElementById('additionalViolationsContainer');
    if (container) container.innerHTML = '';
    additionalViolationRows = [];
}

function computeNextOffenseLevel(historyList, name, plateNumber, sectionId, offenseId, excludeId = null) {
    if (!sectionId || !offenseId) return '';
    if (!name || !plateNumber) return '1';

    const normalizedName = String(name).trim();
    const normalizedPlate = String(plateNumber).toUpperCase().trim();
    let maxLevel = 0;

    historyList.forEach(v => {
        const sameName = (v.name || '').trim() === normalizedName;
        const samePlate = (v.plateNumber || '').toUpperCase().trim() === normalizedPlate;
        const sameSection = v.section_id === sectionId;
        const sameOffense = v.offense_id === offenseId;
        const notExcluded = excludeId ? v.id !== excludeId : true;
        if (sameName && samePlate && sameSection && sameOffense && notExcluded) {
            const lvl = parseInt(v.level, 10);
            if (!isNaN(lvl)) maxLevel = Math.max(maxLevel, lvl);
        }
    });

    return String(Math.min(maxLevel + 1, 3));
}

async function refreshAutoLevels() {
    const nameInput = document.getElementById('name');
    const plateInput = document.getElementById('plateNumber');
    const nameValue = nameInput ? nameInput.value.trim() : '';
    const plateValue = plateInput ? plateInput.value.trim().toUpperCase() : '';

    if (levelSelect) {
        levelSelect.disabled = true;
    }

    additionalViolationRows.forEach(item => {
        if (item.levelSelect) item.levelSelect.disabled = true;
    });

    if (appState.currentEditId) {
        const currentViolation = violations.find(v => v.id === appState.currentEditId);
        if (levelSelect && currentViolation) {
            levelSelect.value = String(currentViolation.level || '');
        }
        await updateFine();
        return;
    }

    const history = [...violations];

    if (levelSelect) {
        const mainLevel = computeNextOffenseLevel(
            history,
            nameValue,
            plateValue,
            sectionSelect ? sectionSelect.value : '',
            offensesSelect ? offensesSelect.value : ''
        );
        levelSelect.value = mainLevel;
        if (mainLevel && sectionSelect?.value && offensesSelect?.value) {
            history.push({
                name: nameValue,
                plateNumber: plateValue,
                section_id: sectionSelect.value,
                offense_id: offensesSelect.value,
                level: mainLevel
            });
        }
    }

    for (const item of additionalViolationRows) {
        const rowLevel = computeNextOffenseLevel(
            history,
            nameValue,
            plateValue,
            item.sectionSelect.value,
            item.offenseSelect.value
        );
        item.levelSelect.value = rowLevel;
        if (rowLevel && item.sectionSelect.value && item.offenseSelect.value) {
            history.push({
                name: nameValue,
                plateNumber: plateValue,
                section_id: item.sectionSelect.value,
                offense_id: item.offenseSelect.value,
                level: rowLevel
            });
        }
        await updateFineForEntry(item.offenseSelect, item.levelSelect, item.fineInput);
    }

    await updateFine();
}

function addAnotherViolationRow() {
    const container = document.getElementById('additionalViolationsContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'form-row additional-violation-row';
    row.innerHTML = `
        <div class="form-group">
            <label>Section *</label>
            <select class="extra-section">
                <option value="">Select Section</option>
            </select>
        </div>
        <div class="form-group">
            <label>Offense *</label>
            <select class="extra-offense" disabled>
                <option value="">Select Section First</option>
            </select>
        </div>
        <div class="form-group">
            <label>Offense Level *</label>
            <select class="extra-level">
                <option value="">Select Level</option>
                <option value="1">1st Offense</option>
                <option value="2">2nd Offense</option>
                <option value="3">3rd Offense</option>
            </select>
        </div>
        <div class="form-group">
            <label>Fee (₱)</label>
            <input type="number" class="extra-fine" readonly>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;">
            <button type="button" class="btn extra-remove-btn">Remove</button>
        </div>
    `;

    const extraSection = row.querySelector('.extra-section');
    const extraOffense = row.querySelector('.extra-offense');
    const extraLevel = row.querySelector('.extra-level');
    const extraFine = row.querySelector('.extra-fine');
    const removeBtn = row.querySelector('.extra-remove-btn');

    fillSectionsIntoSelect(extraSection);
    extraLevel.disabled = true;

    extraSection.addEventListener('change', async () => {
        await populateOffensesForSelect(extraSection.value, extraOffense);
        await refreshAutoLevels();
    });

    extraOffense.addEventListener('change', async () => {
        await refreshAutoLevels();
    });

    removeBtn.addEventListener('click', () => {
        row.remove();
        additionalViolationRows = additionalViolationRows.filter(item => item.row !== row);
        refreshAutoLevels();
    });

    container.appendChild(row);
    additionalViolationRows.push({ row, sectionSelect: extraSection, offenseSelect: extraOffense, levelSelect: extraLevel, fineInput: extraFine });
    refreshAutoLevels();
}

function initDOMElements() {
    tableBody = document.getElementById('tableBody');
    searchInput = document.getElementById('searchInput');
    searchBtn = document.getElementById('searchBtn');
    addNewBtn = document.getElementById('addNewBtn');
    exportBtn = document.getElementById('exportBtn');
    importBtn = document.getElementById('importBtn');
    manageOffensesBtn = document.getElementById('manageOffensesBtn');
    violationModal = document.getElementById('violationModal');
    paymentModal = document.getElementById('paymentModal');
    manageOffensesModal = document.getElementById('manageOffensesModal');
    closeBtns = document.querySelectorAll('.close');
    cancelBtns = document.querySelectorAll('.cancel');
    violationForm = document.getElementById('violationForm');
    paymentForm = document.getElementById('paymentForm');
    sectionSelect = document.getElementById('section');
    offensesSelect = document.getElementById('offenses');
    levelSelect = document.getElementById('level');
    fineInput = document.getElementById('fine');
    fineInfo = document.getElementById('fineInfo');
    modalTitle = document.getElementById('modalTitle');
    statusInput = document.getElementById('status');
    noInput = document.getElementById('no');
    clearDateBtn = document.getElementById('clearDateBtn');
}

async function initializeApp() {
    try {
        isLoadingInitial = true;
        
        const clientReady = await waitForSupabaseClient(8000);
        if (!clientReady) {
            throw new Error('Supabase client not initialized after timeout');
        }
        
        initDOMElements();
        
        const result = await fetchViolations();
        if (result.success) {
            violations = result.data;
            console.log(`Loaded ${violations.length} violations from Supabase`);
        } else {
            console.error('Failed to load violations:', result.error);
            showToast('Error loading data from server. Please refresh.', 'error');
            violations = [];
        }
        
        await init();
        
    } catch (error) {
        console.error(' Initialization error:', error);
        showToast('Failed to initialize app. Please refresh.', 'error');
        violations = [];
        isLoadingInitial = false;
        
        initDOMElements();
        await init();
    }
}

function cleanupRealtimeSync() {
    try {
        const supabaseClient = getSupabaseClient();
        if (supabaseClient && realtimeChannel) {
            supabaseClient.removeChannel(realtimeChannel);
        }
    } catch (error) {
        console.error('Failed to cleanup realtime channel:', error);
    } finally {
        realtimeChannel = null;
    }
}

async function refreshViolationsFromServer() {
    if (isRealtimeRefreshing) return;
    isRealtimeRefreshing = true;
    try {
        const result = await fetchViolations();
        if (result.success) {
            violations = result.data;
            renderTable(getFilteredData());
            await refreshAutoLevels();
        }
    } catch (error) {
        console.error('Realtime refresh failed:', error);
    } finally {
        isRealtimeRefreshing = false;
    }
}

function queueRealtimeRefresh(delayMs = 250) {
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(async () => {
        realtimeRefreshTimer = null;
        await refreshViolationsFromServer();
    }, delayMs);
}

function setupRealtimeSync() {
    const supabaseClient = getSupabaseClient();
    const userId = sessionStorage.getItem('userId');
    if (!supabaseClient || !userId || typeof supabaseClient.channel !== 'function') return;

    cleanupRealtimeSync();

    realtimeChannel = supabaseClient
        .channel(`realtime-vts-${userId}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'violations', filter: `user_id=eq.${userId}` },
            () => queueRealtimeRefresh(200)
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'sections' },
            async () => {
                await populateSections();
                await populateSectionFilter();
                await refreshAutoLevels();
                queueRealtimeRefresh(300);
            }
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'offenses' },
            async () => {
                if (typeof renderOffensesList === 'function') await renderOffensesList();
                await refreshAutoLevels();
            }
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'fines' },
            async () => {
                await refreshAutoLevels();
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('Realtime sync enabled');
            }
        });
}

async function init() {
    addLogoutButton();
    
    renderTable();
    await populateSections();
    
    if (typeof populateSectionFilter === 'function') {
        await populateSectionFilter();
    } else {
        console.warn('populateSectionFilter function not found');
    }
    
    setupEventListeners();
    setupRealtimeSync();
    

    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('paymentDate')) {
        document.getElementById('paymentDate').value = today;
    }
    
    isLoadingInitial = false;
    console.log('Application initialized successfully');
}



function setupEventListeners() {

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    if (searchInput) {
        // Live search: filter as you type
        searchInput.addEventListener('input', handleSearch);
    }


    if (addNewBtn) {
        addNewBtn.addEventListener('click', () => openModal());
    }


    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }

    if (importBtn && typeof openImportExcelModal === 'function') {
        importBtn.addEventListener('click', openImportExcelModal);
    }


    if (manageOffensesBtn) {
        manageOffensesBtn.addEventListener('click', () => openManageOffensesModal());
    }


    closeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });

    cancelBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });


    // Keep modal open on backdrop click; close only via explicit controls (X/Cancel).


    if (violationForm) {
        violationForm.addEventListener('submit', handleSubmit);
    }
    if (paymentForm) {
        paymentForm.addEventListener('submit', handlePaymentSubmit);
    }
    
    if (clearDateBtn) {
        clearDateBtn.addEventListener('click', () => {
            const dateInput = document.getElementById('date');
            if (dateInput) {
                dateInput.value = '';
            }
        });
    }


    if (sectionSelect) {
        sectionSelect.addEventListener('change', async () => {
            console.log('Section changed, populating offenses...');
            await populateOffenses();
            await refreshAutoLevels();
        });
    }


    if (offensesSelect) {
        offensesSelect.addEventListener('change', async () => {
            await refreshAutoLevels();
        });
    }

    const addAnotherViolationBtn = document.getElementById('addAnotherViolationBtn');
    if (addAnotherViolationBtn) {
        addAnotherViolationBtn.addEventListener('click', addAnotherViolationRow);
    }


    if (levelSelect) {
        levelSelect.disabled = true;
        levelSelect.addEventListener('change', async () => {
            await updateFine();
        });
    }


    if (noInput) {
        noInput.addEventListener('focus', () => {
            if (!noInput.value) {
                const maxNo = violations.reduce((max, v) => Math.max(max, v.no || 0), 0);
                noInput.value = maxNo + 1;
            }
        });
    }


    // Do not auto-fill the violation date input; leave blank for manual entry
    const dateInput = document.getElementById('date');
    if (dateInput) {
        // intentionally left blank
    }

    const nameInput = document.getElementById('name');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            refreshAutoLevels();
        });
    }

    const plateInput = document.getElementById('plateNumber');
    if (plateInput) {
        plateInput.addEventListener('input', () => {
            refreshAutoLevels();
        });
    }
    

    const receiptInput = document.getElementById('officialReceiptNumber');
    if (receiptInput) {
        receiptInput.addEventListener('input', checkDuplicateReceipt);
    }
}



function addLogoutButton() {

    if (document.getElementById('logoutBtn')) return;
    

    const header = document.querySelector('header');
    if (header) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logoutBtn';
        logoutBtn.className = 'logout-btn';
        logoutBtn.textContent = 'Logout';
        

        logoutBtn.style.position = 'absolute';
        logoutBtn.style.right = '20px';
        logoutBtn.style.top = '20px';
        logoutBtn.style.padding = '8px 20px';
        logoutBtn.style.background = '#e74c3c';
        logoutBtn.style.color = 'white';
        logoutBtn.style.border = 'none';
        logoutBtn.style.borderRadius = '4px';
        logoutBtn.style.cursor = 'pointer';
        logoutBtn.style.fontSize = '14px';
        logoutBtn.style.fontWeight = '500';
        logoutBtn.style.transition = 'all 0.2s';
        

        logoutBtn.addEventListener('mouseenter', function() {
            this.style.background = '#c0392b';
            this.style.transform = 'translateY(-1px)';
        });
        
        logoutBtn.addEventListener('mouseleave', function() {
            this.style.background = '#e74c3c';
            this.style.transform = 'translateY(0)';
        });
        

        logoutBtn.addEventListener('click', async function() {
            if (confirm('Are you sure you want to logout?')) {
                try {

                    if (typeof authLogout === 'function') {
                        await authLogout();
                    }
                } catch (error) {
                    console.error('Logout error:', error);
                }
                cleanupRealtimeSync();
                 

                appState.reset();
                violations = [];
                
                sessionStorage.removeItem('isLoggedIn');
                sessionStorage.removeItem('userId');
                sessionStorage.removeItem('userEmail');
                sessionStorage.removeItem('accessToken');
                

                window.location.href = '../index.html';
            }
        });
        

        header.style.position = 'relative';
        header.appendChild(logoutBtn);
    }
}



async function populateOffenses() {
    console.log('Populating offenses dropdown...');
    
    if (!offensesSelect) {
        console.error('Offenses select element not found');
        return;
    }
    
    const sectionId = sectionSelect.value;
    console.log('Selected section ID:', sectionId);
    

    offensesSelect.innerHTML = '<option value="">Loading offenses...</option>';
    offensesSelect.disabled = true;
    
    if (!sectionId) {
        offensesSelect.innerHTML = '<option value="">Select Section First</option>';
        offensesSelect.disabled = false;
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sectionId)) {
            console.error('Invalid section ID format:', sectionId);
            offensesSelect.innerHTML = '<option value="">Invalid Section ID</option>';
            offensesSelect.disabled = false;
            return;
        }
        
        const { data, error } = await supabaseClient
            .from('offenses')
            .select('id, offense_name')
            .eq('section_id', sectionId)
            .order('offense_name');
        
        if (error) {
            console.error('Error fetching offenses:', error);
            throw error;
        }
        
        offensesSelect.innerHTML = '<option value="">Select Offense</option>';
        
        if (data && data.length > 0) {
            data.forEach(offense => {
                const option = document.createElement('option');
                option.value = offense.id; // UUID
                option.textContent = escapeHTML(offense.offense_name);
                offensesSelect.appendChild(option);
            });
            console.log(`Loaded ${data.length} offenses for section`);
        } else {
            offensesSelect.innerHTML = '<option value="">No offenses found for this section</option>';
            console.log('No offenses found for section:', sectionId);
        }
        
        offensesSelect.disabled = false;
        
    } catch (error) {
        console.error('Error populating offenses:', error);
        offensesSelect.innerHTML = '<option value="">Error loading offenses</option>';
        offensesSelect.disabled = false;
        showToast('Failed to load offenses', 'error');
    }
}


async function populateSections() {
    if (!sectionSelect) return;
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return;
        
        const { data, error } = await supabaseClient
            .from('sections')
            .select('id, section_name')
            .order('section_name');
        
        if (error) throw error;
        
        sectionsCache = data || [];
        fillSectionsIntoSelect(sectionSelect);
    } catch (error) {
        console.error('Error populating sections:', error);
    }
}


async function populateSectionFilter() {
    console.log('Populating section filter dropdown...');
    const sectionFilter = document.getElementById('sectionFilter');
    if (!sectionFilter) {
        console.log('Section filter element not found in DOM');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.error('Supabase client not initialized');
            return;
        }
        
        const { data, error } = await supabaseClient
            .from('sections')
            .select('id, section_name')
            .order('section_name');
        
        if (error) throw error;
        
        sectionFilter.innerHTML = '<option value="">All Sections</option>';
        
        if (data && data.length > 0) {
            data.forEach(section => {
                const option = document.createElement('option');
                option.value = section.id; // UUID
                option.textContent = section.section_name;
                sectionFilter.appendChild(option);
            });
            console.log(`Populated section filter with ${data.length} sections`);
        } else {
            console.log('No sections found to populate filter');
            sectionFilter.innerHTML = '<option value="">All Sections (No sections found)</option>';
        }
    } catch (error) {
        console.error('Error populating section filter:', error);
        const sectionFilter = document.getElementById('sectionFilter');
        if (sectionFilter) {
            sectionFilter.innerHTML = '<option value="">All Sections (Error loading)</option>';
        }
    }
}



async function updateFine() {
    if (!sectionSelect || !offensesSelect || !levelSelect || !fineInput) return;
    
    const offenseId = offensesSelect.value;
    const level = levelSelect.value;
    
    if (offenseId && level) {
        try {
            const result = await fetchFinesByOffense(offenseId);
            if (result.success && result.data) {
                const fines = result.data;
                const selectedFine = fines.find(f => f.level === parseInt(level));
                
                if (selectedFine) {
                    fineInput.value = selectedFine.amount;
                    
                    if (fineInfo) {
                        const breakdown = fines
                            .sort((a, b) => a.level - b.level)
                            .map(f => `<div>Level ${f.level}: ₱${f.amount.toLocaleString()}</div>`)
                            .join('');
                        fineInfo.innerHTML = `<div><strong>Fine Schedule:</strong></div>${breakdown}`;
                    }
                }
            }
        } catch (error) {
            console.error('Error updating fine:', error);
        }
    } else {
        if (fineInput) fineInput.value = '';
        if (fineInfo) fineInfo.innerHTML = '';
    }
}

function renderTable(data) {
    if (!tableBody) return;
    // Remember last data used for rendering so toggles/resorts keep current filters
    if (typeof data === 'undefined' || data === null) data = getFilteredData();
    window.currentRenderedData = data;
    
    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="12" class="no-data">
                    No violations found. Click "+ Add New Violation" to add one.
                </td>
            </tr>
        `;
        return;
    }


    const sortedData = [...data].sort((a, b) => {
        let aValue = a[appState.currentSort.column];
        let bValue = b[appState.currentSort.column];
        

        if (appState.currentSort.column === 'no' || appState.currentSort.column === 'fine') {
            aValue = parseFloat(aValue) || 0;
            bValue = parseFloat(bValue) || 0;
        }
        

        if (appState.currentSort.column === 'date' || appState.currentSort.column === 'datePaid') {
            aValue = aValue ? new Date(aValue) : new Date(0);
            bValue = bValue ? new Date(bValue) : new Date(0);
        }
        

        if (typeof aValue === 'string' && typeof bValue === 'string') {
            aValue = aValue.toLowerCase();
            bValue = bValue.toLowerCase();
        }
        
        if (appState.currentSort.direction === 'asc') {
            return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        } else {
            return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
        }
    });

    // Track expanded rows
    if (!window.expandedRows) window.expandedRows = {};

    tableBody.innerHTML = sortedData.map((violation) => {
        let levelText = '';
        if (violation.level === '1') levelText = '1st Offense';
        else if (violation.level === '2') levelText = '2nd Offense';
        else if (violation.level === '3') levelText = '3rd Offense';
        else levelText = violation.level || '';

        const violationId = violation.id;
        const isExpanded = window.expandedRows[violationId] || false;

        let actionButtons = '';
        if (violation.status === 'Unpaid' || violation.status === 'Pending') {
            actionButtons = `
                <button class="action-btn edit-btn" data-id="${violationId}" data-action="edit">Edit</button>
                <button class="action-btn pay-btn" data-id="${violationId}" data-action="pay">Mark Paid</button>
                <button class="action-btn delete-btn" data-id="${violationId}" data-action="delete">Delete</button>
            `;
        } else if (violation.status === 'Paid') {
            actionButtons = `
                <button class="action-btn edit-btn" data-id="${violationId}" data-action="edit">Edit</button>
                <button class="action-btn undo-btn" data-id="${violationId}" data-action="undo">Undo</button>
                <button class="action-btn delete-btn" data-id="${violationId}" data-action="delete">Delete</button>
            `;
        }

        // Collapsed: show only key columns, smaller height
        if (!isExpanded) {
            return `
                <tr class="collapsible-row" data-id="${violationId}">
                    <td>${escapeHTML(violation.no || '')}</td>
                    <td>${escapeHTML(violation.name || '')}</td>
                    <td>${escapeHTML(violation.plateNumber || '')}</td>
                    <td>${escapeHTML(violation.date || '')}</td>
                    <td class="no-toggle">${escapeHTML(violation.section || '')}</td>
                    <td colspan="7" style="text-align:center;color:#888;font-size:12px;">Click to expand for actions</td>
                </tr>
            `;
        }
        // Expanded: show all columns and actions
        return `
            <tr class="collapsible-row expanded" data-id="${violationId}">
                <td>${escapeHTML(violation.no || '')}</td>
                <td>${escapeHTML(violation.name || '')}</td>
                <td>${escapeHTML(violation.plateNumber || '')}</td>
                <td>${escapeHTML(violation.date || '')}</td>
                <td>${escapeHTML(violation.section || '')}</td>
                <td>${escapeHTML(violation.offenses || '')}</td>
                <td>${escapeHTML(levelText)}</td>
                <td>₱${(violation.fine || 0).toLocaleString()}</td>
                <td><span class="status ${(violation.status || '').toLowerCase()}">${escapeHTML(violation.status || '')}</span></td>
                <td>${escapeHTML(violation.officialReceiptNumber || '')}</td>
                <td>${escapeHTML(violation.datePaid || '')}</td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    updateSortIndicators();

    // Add click listeners for collapsible rows
    document.querySelectorAll('.collapsible-row').forEach(row => {
        row.onclick = function(e) {
            // Ignore clicks on action buttons
            if (e.target.closest('.action-btn')) return;
            // Do not toggle when clicking cells marked as no-toggle (e.g., Section)
            const td = e.target.closest('td');
            if (td && td.classList.contains('no-toggle')) return;
            const id = row.getAttribute('data-id');
            window.expandedRows[id] = !window.expandedRows[id];
            renderTable();
        };
    });

    attachActionButtonListeners();
}


function attachActionButtonListeners() {

    document.querySelectorAll('.action-btn.edit-btn').forEach(btn => {
        btn.removeEventListener('click', handleEditClick);
        btn.addEventListener('click', handleEditClick);
    });
    

    document.querySelectorAll('.action-btn.pay-btn').forEach(btn => {
        btn.removeEventListener('click', handlePayClick);
        btn.addEventListener('click', handlePayClick);
    });
    

    document.querySelectorAll('.action-btn.delete-btn').forEach(btn => {
        btn.removeEventListener('click', handleDeleteClick);
        btn.addEventListener('click', handleDeleteClick);
    });
    

    document.querySelectorAll('.action-btn.undo-btn').forEach(btn => {
        btn.removeEventListener('click', handleUndoClick);
        btn.addEventListener('click', handleUndoClick);
    });
}


function handleEditClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.currentTarget.dataset.id;
    console.log('Edit violation clicked:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    const violation = violations.find(v => v.id === id);
    if (violation && violation.status === 'Paid') {
        openPaymentModal(id);
        return;
    }
    
    editViolation(id);
}


function handlePayClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.currentTarget.dataset.id;
    console.log('Pay violation clicked:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    openPaymentModal(id);
}


function handleDeleteClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.currentTarget.dataset.id;
    console.log('Delete violation clicked:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    deleteViolationHandler(id);
}


function handleUndoClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.currentTarget.dataset.id;
    console.log('Undo violation clicked:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    undoPaymentHandler(id);
}


function updateSortIndicators() {
    const sortIndicators = document.querySelectorAll('.sort-indicator');
    sortIndicators.forEach(indicator => {
        const column = indicator.id.replace('sort-', '');
        if (column === appState.currentSort.column) {
            indicator.textContent = appState.currentSort.direction === 'asc' ? '⬆️' : '⬇️';
        } else {
            indicator.textContent = '↕️';
        }
    });
}


function sortTable(column) {

    if (appState.currentSort.column === column) {
        appState.currentSort.direction = appState.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        appState.currentSort.column = column;
        appState.currentSort.direction = 'asc';
    }
    
    renderTable(getFilteredData());
}



function applyFilters() {
    renderTable(getFilteredData());
}


function getFilteredData() {
    const statusFilter = document.getElementById('statusFilter');
    const sectionFilter = document.getElementById('sectionFilter');
    const dateFrom = document.getElementById('dateFromFilter');
    const dateTo = document.getElementById('dateToFilter');
    const searchEl = document.getElementById('searchInput');

    const statusValue = statusFilter ? statusFilter.value : '';
    const sectionValue = sectionFilter ? sectionFilter.value : '';
    const dateFromValue = dateFrom ? dateFrom.value : '';
    const dateToValue = dateTo ? dateTo.value : '';
    const searchTerm = searchEl ? searchEl.value.toLowerCase().trim() : '';

    let filteredData = Array.isArray(violations) ? [...violations] : [];

    if (statusValue) {
        filteredData = filteredData.filter(v => v.status === statusValue);
    }

    if (sectionValue) {
        filteredData = filteredData.filter(v => v.section_id === sectionValue);
    }

    if (dateFromValue) {
        filteredData = filteredData.filter(v => {
            if (!v.date) return false;
            const violationDate = new Date(v.date);
            const fromDate = new Date(dateFromValue);
            return violationDate >= fromDate;
        });
    }

    if (dateToValue) {
        filteredData = filteredData.filter(v => {
            if (!v.date) return false;
            const violationDate = new Date(v.date);
            const toDate = new Date(dateToValue);
            return violationDate <= toDate;
        });
    }

    if (searchTerm) {
        filteredData = filteredData.filter(v => 
            (v.name && v.name.toLowerCase().includes(searchTerm)) ||
            (v.plateNumber && v.plateNumber.toLowerCase().includes(searchTerm)) ||
            (v.offenses && v.offenses.toLowerCase().includes(searchTerm)) ||
            (v.officialReceiptNumber && v.officialReceiptNumber.toLowerCase().includes(searchTerm))
        );
    }

    return filteredData;
}


function resetFilters() {
    const statusFilter = document.getElementById('statusFilter');
    const sectionFilter = document.getElementById('sectionFilter');
    const dateFrom = document.getElementById('dateFromFilter');
    const dateTo = document.getElementById('dateToFilter');
    
    if (statusFilter) statusFilter.value = '';
    if (sectionFilter) sectionFilter.value = '';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    
    renderTable(violations);
}


function handleSearch() {
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    if (!searchTerm) {
        renderTable(getFilteredData());
        return;
    }

    // Use combined filter function so search and other filters apply together
    renderTable(getFilteredData());
}



function openModal(violation = null) {
    if (!violationModal) return;
    
    if (violation) {

        modalTitle.textContent = 'Edit Violation';
        appState.setEditViolation(violation.id);
        
        document.getElementById('no').value = violation.no || '';
        document.getElementById('name').value = violation.name || '';
        document.getElementById('plateNumber').value = violation.plateNumber || '';
        document.getElementById('date').value = violation.date || '';
        

        document.getElementById('section').value = violation.section_id || violation.section || '';
        clearAdditionalViolationRows();
        const addAnotherViolationRowEl = document.getElementById('addAnotherViolationRow');
        if (addAnotherViolationRowEl) addAnotherViolationRowEl.style.display = 'none';
        const offenseHelperText = document.getElementById('offenseHelperText');
        if (offenseHelperText) offenseHelperText.style.display = 'none';
        

        populateOffenses().then(() => {
            document.getElementById('offenses').value = violation.offense_id || '';
            document.getElementById('level').value = violation.level || '';
            document.getElementById('fine').value = violation.fine || '';

            refreshAutoLevels();
        });
        
        statusInput.value = violation.status || 'Unpaid';
    } else {

        modalTitle.textContent = 'Add New Violation';
        appState.clearEditViolation();
        violationForm.reset();
        
        const dateInput = document.getElementById('date');
        if (dateInput) {
            dateInput.valueAsDate = new Date();
        }
        
        if (statusInput) {
            statusInput.value = 'Unpaid';
        }
        

        const maxNo = violations.reduce((max, v) => Math.max(max, v.no || 0), 0);
        const noInput = document.getElementById('no');
        if (noInput) {
            noInput.value = maxNo + 1;
        }
        

        if (offensesSelect) {
            offensesSelect.innerHTML = '<option value="">Select Section First</option>';
            offensesSelect.disabled = true;
        }
        clearAdditionalViolationRows();
        const addAnotherViolationRowEl = document.getElementById('addAnotherViolationRow');
        if (addAnotherViolationRowEl) addAnotherViolationRowEl.style.display = 'flex';
        const offenseHelperText = document.getElementById('offenseHelperText');
        if (offenseHelperText) offenseHelperText.style.display = 'block';
        if (fineInfo) {
            fineInfo.innerHTML = '';
        }
        if (fineInput) {
            fineInput.value = '';
        }
        refreshAutoLevels();
    }
    
    violationModal.style.display = 'flex';
}


function closeModal() {
    if (violationModal) {
        violationModal.style.display = 'none';
    }
    if (violationForm) {
        violationForm.reset();
    }
    

    if (offensesSelect) {
        offensesSelect.innerHTML = '<option value="">Select Offense</option>';
    }
    clearAdditionalViolationRows();
    const addAnotherViolationRowEl = document.getElementById('addAnotherViolationRow');
    if (addAnotherViolationRowEl) addAnotherViolationRowEl.style.display = 'flex';
    if (fineInfo) {
        fineInfo.innerHTML = '';
    }
    if (fineInput) {
        fineInput.value = '';
    }
    if (statusInput) {
        statusInput.value = 'Unpaid';
    }
    
    appState.clearEditViolation();
}


function openPaymentModal(id) {
    if (!paymentModal) return;
    
    console.log('Opening payment modal for violation ID:', id);
    const violation = violations.find(v => v.id === id);
    if (!violation) {
        console.error('Violation not found:', id);
        alert('Violation not found. Please refresh the page.');
        return;
    }
    
    appState.currentViolationId = id;
    appState.paymentEditMode = violation.status === 'Paid';
    
    document.getElementById('paymentName').value = violation.name || '';
    document.getElementById('paymentOffense').value = violation.offenses || '';
    document.getElementById('paymentFine').value = violation.fine || '';
    
    const paymentDateInput = document.getElementById('paymentDate');
    if (paymentDateInput) {
        paymentDateInput.value = violation.datePaid || new Date().toISOString().split('T')[0];
    }
    
    const receiptInput = document.getElementById('officialReceiptNumber');
    if (receiptInput) {
        receiptInput.value = violation.officialReceiptNumber || '';
    }

    const paymentModalTitle = document.getElementById('paymentModalTitle');
    if (paymentModalTitle) {
        paymentModalTitle.textContent = appState.paymentEditMode ? 'Edit Paid Details' : 'Mark as Paid';
    }

    const paymentSubmitBtn = document.getElementById('paymentSubmitBtn');
    if (paymentSubmitBtn) {
        paymentSubmitBtn.textContent = appState.paymentEditMode ? 'Update Payment Details' : 'Confirm Payment';
    }
    
    const warningElement = document.getElementById('receiptWarning');
    if (warningElement) {
        warningElement.style.display = 'none';
    }
    
    paymentModal.style.display = 'flex';
}


function closePaymentModal() {
    if (paymentModal) {
        paymentModal.style.display = 'none';
    }
    appState.currentViolationId = null;
    appState.paymentEditMode = false;
}



function validateViolationDate(dateString) {
    if (!dateString) {
        return { valid: true, error: null }; // Optional field
    }
    
    const selectedDate = new Date(dateString);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    if (selectedDate > today) {
        return {
            valid: false,
            error: 'Violation date cannot be in the future'
        };
    }
    

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    if (selectedDate < oneYearAgo) {
        return {
            valid: false,
            error: 'Violation date cannot be older than 1 year'
        };
    }
    
    return { valid: true, error: null };
}


function validateReceiptNumber(receiptNumber) {
    if (!receiptNumber) {
        return { valid: false, error: 'Receipt number is required' };
    }
    

    const validFormat = /^[A-Z0-9\-_]{3,50}$/i;
    
    if (!validFormat.test(receiptNumber)) {
        return {
            valid: false,
            error: 'Invalid receipt format. Use letters, numbers, hyphens, underscores (3-50 chars). Example: OR-2026-001'
        };
    }
    
    return { valid: true, error: null };
}


function checkDuplicateReceipt() {
    const officialReceiptNumber = document.getElementById('officialReceiptNumber');
    const warningElement = document.getElementById('receiptWarning');
    
    if (!officialReceiptNumber || !warningElement) return;
    
    const receiptValue = officialReceiptNumber.value.trim();
    
    if (!receiptValue) {
        warningElement.style.display = 'none';
        return;
    }
    

    const validation = validateReceiptNumber(receiptValue);
    if (!validation.valid) {
        warningElement.textContent = validation.error;
        warningElement.style.display = 'block';
        return;
    }
    

    const duplicate = violations.find(v => 
        v.officialReceiptNumber && v.officialReceiptNumber === receiptValue && 
        v.id !== appState.currentViolationId
    );
    
    if (duplicate) {
        warningElement.textContent = 'This Official Receipt Number is already used!';
        warningElement.style.display = 'block';
    } else {
        warningElement.style.display = 'none';
    }
}



async function handleSubmit(e) {
    e.preventDefault();

    const no = parseInt(document.getElementById('no').value) || 0;
    const name = document.getElementById('name').value.trim();
    const plateNumber = document.getElementById('plateNumber').value.trim().toUpperCase();
    const date = document.getElementById('date').value || '';

    const sectionSelect = document.getElementById('section');
    const sectionText = sectionSelect.options[sectionSelect.selectedIndex]?.text || '';
    const sectionUuid = sectionSelect.value;
    const offenseText = offensesSelect.options[offensesSelect.selectedIndex]?.text || '';
    const offenseUuid = offensesSelect.value;

    const level = document.getElementById('level').value;

    const baseEntry = (sectionUuid && offenseUuid && level)
        ? [{ sectionId: sectionUuid, sectionName: sectionText, offenseId: offenseUuid, offenseName: offenseText, level }]
        : [];

    const extraEntries = additionalViolationRows
        .map(item => {
            const sId = item.sectionSelect.value;
            const sName = item.sectionSelect.options[item.sectionSelect.selectedIndex]?.text || '';
            const oId = item.offenseSelect.value;
            const oName = item.offenseSelect.options[item.offenseSelect.selectedIndex]?.text || '';
            const rowLevel = item.levelSelect.value;
            return (sId && oId && rowLevel) ? { sectionId: sId, sectionName: sName, offenseId: oId, offenseName: oName, level: rowLevel } : null;
        })
        .filter(Boolean);

    const selectedEntries = appState.currentEditId ? baseEntry : [...baseEntry, ...extraEntries];
    const status = document.getElementById('status').value || 'Unpaid';

    if (!no || selectedEntries.length === 0) {
        alert('Please fill in all required fields');
        return;
    }

    if (!appState.currentEditId) {
        const invalidRows = additionalViolationRows.some(item =>
            (item.sectionSelect.value && (!item.offenseSelect.value || !item.levelSelect.value)) ||
            (item.offenseSelect.value && (!item.sectionSelect.value || !item.levelSelect.value)) ||
            (item.levelSelect.value && (!item.sectionSelect.value || !item.offenseSelect.value))
        );
        if (invalidRows) {
            alert('Each additional violation row must have section, offense, and level selected.');
            return;
        }
    }

    const dateValidation = validateViolationDate(date);
    if (!dateValidation.valid) {
        alert(dateValidation.error);
        return;
    }

    try {
        const normalizedPlateNumber = plateNumber.toUpperCase().trim();
        const normalizedName = name.trim();

        const getNextOffenseLevel = (historyList, entry, excludeId = null) => {
            if (!normalizedName || !normalizedPlateNumber || !entry.sectionId || !entry.offenseId) {
                return entry.level || '1';
            }

            let maxLevel = 0;
            historyList.forEach(v => {
                const sameName = (v.name || '').trim() === normalizedName;
                const samePlate = ((v.plateNumber || '').toUpperCase().trim() === normalizedPlateNumber);
                const sameSection = v.section_id === entry.sectionId;
                const sameOffense = v.offense_id === entry.offenseId;
                const notExcluded = excludeId ? v.id !== excludeId : true;
                if (sameName && samePlate && sameSection && sameOffense && notExcluded) {
                    const lvl = parseInt(v.level, 10);
                    if (!isNaN(lvl)) {
                        maxLevel = Math.max(maxLevel, lvl);
                    }
                }
            });

            const nextLevel = Math.min(maxLevel + 1, 3);
            return String(nextLevel || 1);
        };

        const isExactDuplicate = (entry, excludeId = null) => {
            return violations.find(v =>
                (v.plateNumber || '').toUpperCase().trim() === normalizedPlateNumber &&
                (v.name || '') === name &&
                v.offenses === entry.offenseName &&
                v.section_id === entry.sectionId &&
                v.date === date &&
                v.level === entry.level &&
                (excludeId ? v.id !== excludeId : true)
            );
        };

        const getFineForOffense = async (offenseId, offenseLevel) => {
            const result = await fetchFinesByOffense(offenseId);
            if (!result.success || !result.data) {
                throw new Error('Failed to fetch fine for selected offense');
            }
            const selectedFine = result.data.find(f => f.level === parseInt(offenseLevel));
            if (!selectedFine) {
                throw new Error('No fine schedule found for one of the selected offenses at this level');
            }
            return Number(selectedFine.amount || 0);
        };

        if (appState.currentEditId) {
            const selectedEntry = selectedEntries[0];
            const duplicateNo = violations.find(v => v.no === no && v.id !== appState.currentEditId);
            if (duplicateNo) {
                alert(`Number ${no} is already assigned to violation #${duplicateNo.no}. Please use a different number.`);
                return;
            }

            const exactDuplicate = isExactDuplicate(selectedEntry, appState.currentEditId);
            if (exactDuplicate) {
                alert(`Cannot update: Another violation (#${exactDuplicate.no}) already exists with identical details in this section.`);
                return;
            }

            const fine = await getFineForOffense(selectedEntry.offenseId, selectedEntry.level);
            const violation = {
                no,
                name,
                plateNumber,
                date,
                section: selectedEntry.sectionName,
                section_id: selectedEntry.sectionId,
                offenses: selectedEntry.offenseName,
                offense_id: selectedEntry.offenseId,
                level: selectedEntry.level,
                fine,
                status
            };

            if (violation.status === 'Paid') {
                const originalViolation = violations.find(v => v.id === appState.currentEditId);
                if (originalViolation && originalViolation.officialReceiptNumber) {
                    violation.officialReceiptNumber = originalViolation.officialReceiptNumber;
                    violation.datePaid = originalViolation.datePaid || new Date().toISOString().split('T')[0];
                }
            }

            const result = await updateViolation(appState.currentEditId, violation);
            if (!result.success) {
                alert('Error saving violation: ' + result.error);
                return;
            }

            const index = violations.findIndex(v => v.id === appState.currentEditId);
            if (index !== -1) violations[index] = result.data;

            renderTable();
            closeModal();
            showToast('Violation updated successfully!', 'success');
            appState.clearEditViolation();
            return;
        }

        const levelHistory = [...violations];
        selectedEntries.forEach(entry => {
            const computedLevel = getNextOffenseLevel(levelHistory, entry);
            entry.level = computedLevel;
            levelHistory.push({
                name: normalizedName,
                plateNumber: normalizedPlateNumber,
                section_id: entry.sectionId,
                offense_id: entry.offenseId,
                level: computedLevel
            });
        });

        const duplicateNo = violations.find(v => v.no === no);
        if (duplicateNo) {
            alert(`Number ${no} is already assigned to violation #${duplicateNo.no}. Please use a different number.`);
            return;
        }

        for (const entry of selectedEntries) {
            const exactDuplicate = isExactDuplicate(entry);
            if (exactDuplicate) {
                alert(`Duplicate found for offense "${entry.offenseName}" (existing violation #${exactDuplicate.no}).`);
                return;
            }
        }

        let addedCount = 0;
        for (let i = 0; i < selectedEntries.length; i++) {
            const entry = selectedEntries[i];
            const fine = await getFineForOffense(entry.offenseId, entry.level);

            const newViolation = {
                no,
                name,
                plateNumber,
                date,
                section: entry.sectionName,
                section_id: entry.sectionId,
                offenses: entry.offenseName,
                offense_id: entry.offenseId,
                level: entry.level,
                fine,
                status: 'Unpaid'
            };

            const result = await addViolation(newViolation);
            if (!result.success) {
                throw new Error(result.error || 'Failed to add violation');
            }
            violations.push(result.data);
            addedCount += 1;
        }

        renderTable();
        closeModal();
        showToast(
            addedCount > 1 ? `${addedCount} violations added successfully!` : 'Violation added successfully!',
            'success'
        );
        appState.clearEditViolation();
    } catch (error) {
        console.error('Save violation error:', error);
        alert('Failed to save violation: ' + error.message);
    }
}

async function handlePaymentSubmit(e) {
    e.preventDefault();
    
    const violation = violations.find(v => v.id === appState.currentViolationId);
    if (!violation) {
        console.error('Violation not found:', appState.currentViolationId);
        alert('Violation not found. Please refresh the page.');
        return;
    }
    
    const officialReceiptNumber = document.getElementById('officialReceiptNumber').value.trim();
    const paymentDate = document.getElementById('paymentDate').value;
    

    const validation = validateReceiptNumber(officialReceiptNumber);
    if (!validation.valid) {
        alert(validation.error);
        return;
    }
    

    const submitBtn = paymentForm.querySelector('button[type="submit"]');
    const isEditPaidDetails = appState.paymentEditMode;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }
    
    try {
        console.log('Saving paid details:', {
            id: appState.currentViolationId,
            receipt: officialReceiptNumber,
            date: paymentDate
        });
        
        const result = await markAsPaid(appState.currentViolationId, officialReceiptNumber, paymentDate);
        
        if (result.success) {

            const index = violations.findIndex(v => v.id === appState.currentViolationId);
            if (index !== -1) {
                violations[index] = result.data;
            }
            
            closePaymentModal();
            renderTable();
            
            showToast(
                isEditPaidDetails
                    ? `Updated paid details: ${escapeHTML(violation.name)} - ${escapeHTML(violation.offenses)}`
                    : `Marked as paid: ${escapeHTML(violation.name)} - ${escapeHTML(violation.offenses)}`,
                'success'
            );
            appState.currentViolationId = null;
        } else {
            console.error('Error marking as paid:', result.error);
            alert('Error marking as paid: ' + result.error);
        }
    } catch (error) {
        console.error('Payment submit error:', error);
        alert('Failed to process payment: ' + error.message);
    } finally {

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = isEditPaidDetails ? 'Update Payment Details' : 'Confirm Payment';
        }
    }
}


function editViolation(id) {
    console.log('Editing violation with ID:', id);
    const violation = violations.find(v => v.id === id);
    if (violation) {
        openModal(violation);
    } else {
        console.error('Violation not found:', id);
        alert('Violation not found. Please refresh the page.');
    }
}


async function deleteViolationHandler(id) {
    console.log('Deleting violation with ID:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    const violation = violations.find(v => v.id === id);
    if (!violation) {
        console.error('Violation not found:', id);
        alert('Violation not found. Please refresh the page.');
        return;
    }
    
    if (confirm(`Are you sure you want to delete violation #${violation.no} for ${violation.name}?`)) {
        try {
            const result = await deleteViolation(id);
            
            if (result.success) {
                violations = violations.filter(v => v.id !== id);
                renderTable();
                
                showToast(
                    `Deleted: ${escapeHTML(violation.name)} - ${escapeHTML(violation.offenses)}`,
                    'error'
                );
            } else {
                alert('Error deleting violation: ' + result.error);
            }
        } catch (error) {
            console.error('Delete violation error:', error);
            alert('Failed to delete violation. Please try again.');
        }
    }
}


async function undoPaymentHandler(id) {
    console.log('Undoing payment for violation ID:', id);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        console.error('Invalid violation ID format:', id);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    const violation = violations.find(v => v.id === id);
    if (!violation) {
        console.error('Violation not found:', id);
        alert('Violation not found. Please refresh the page.');
        return;
    }
    
    if (violation && violation.status === 'Paid') {
        if (confirm(`Are you sure you want to undo payment for violation #${violation.no}?`)) {
            try {
                const result = await undoPayment(id);
                
                if (result.success) {
                    const index = violations.findIndex(v => v.id === id);
                    if (index !== -1) {
                        violations[index] = result.data;
                    }
                    
                    renderTable();
                    
                    showToast(
                        `Payment undone: ${escapeHTML(violation.name)} - ${escapeHTML(violation.offenses)}`,
                        'warning'
                    );
                } else {
                    alert('Error undoing payment: ' + result.error);
                }
            } catch (error) {
                console.error('Undo payment error:', error);
                alert('Failed to undo payment. Please try again.');
            }
        }
    }
}



function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    let stringValue = String(value);
    

    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    
    return stringValue;
}


function escapeHTML(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}






function exportToCSV() {
    console.log('📊 Exporting to CSV...');
    

    let dataToExport = [...violations];
    

    const statusFilter = document.getElementById('statusFilter');
    const sectionFilter = document.getElementById('sectionFilter');
    const dateFrom = document.getElementById('dateFromFilter');
    const dateTo = document.getElementById('dateToFilter');
    

    if (statusFilter && statusFilter.value) {
        dataToExport = dataToExport.filter(v => v.status === statusFilter.value);
        console.log(`Filtered by status: ${statusFilter.value} -> ${dataToExport.length} records`);
    }
    

    if (sectionFilter && sectionFilter.value) {
        dataToExport = dataToExport.filter(v => v.section_id === sectionFilter.value);
        console.log(`Filtered by section: ${sectionFilter.value} -> ${dataToExport.length} records`);
    }
    

    if (dateFrom && dateFrom.value) {
        const fromDate = new Date(dateFrom.value);
        fromDate.setHours(0, 0, 0, 0);
        
        dataToExport = dataToExport.filter(v => {
            if (!v.date) return false;
            const violationDate = new Date(v.date);
            violationDate.setHours(0, 0, 0, 0);
            return violationDate >= fromDate;
        });
        console.log(`Filtered from date: ${dateFrom.value} -> ${dataToExport.length} records`);
    }
    

    if (dateTo && dateTo.value) {
        const toDate = new Date(dateTo.value);
        toDate.setHours(23, 59, 59, 999);
        
        dataToExport = dataToExport.filter(v => {
            if (!v.date) return false;
            const violationDate = new Date(v.date);
            return violationDate <= toDate;
        });
        console.log(`Filtered to date: ${dateTo.value} -> ${dataToExport.length} records`);
    }
    

    if (dataToExport.length === 0) {
        alert('No data to export! Please adjust your filters or add violations.');
        return;
    }
    
    try {

        const headers = [
            'NO.',
            'Name',
            'Plate Number',
            'Date',
            'Offenses',
            'Section',
            'Level',
            'Fine (₱)',
            'Status',
            'Official Receipt Number',
            'Date Paid'
        ];
        

        const csvRows = [];
        

        csvRows.push(headers.join(','));
        

        dataToExport.forEach((violation, index) => {

            let levelText = '';
            if (violation.level === '1') levelText = '1st Offense';
            else if (violation.level === '2') levelText = '2nd Offense';
            else if (violation.level === '3') levelText = '3rd Offense';
            else levelText = violation.level || '';
            

            const fineFormatted = violation.fine ? violation.fine.toLocaleString() : '0';
            

            let datePaidFormatted = violation.datePaid || '';
            if (datePaidFormatted) {
                const date = new Date(datePaidFormatted);
                if (!isNaN(date.getTime())) {
                    datePaidFormatted = date.toISOString().split('T')[0];
                }
            }
            

            let violationDateFormatted = violation.date || '';
            if (violationDateFormatted) {
                const date = new Date(violationDateFormatted);
                if (!isNaN(date.getTime())) {
                    violationDateFormatted = date.toISOString().split('T')[0];
                }
            }
            
            const row = [
                violation.no || '',
                escapeCSV(violation.name || ''),
                escapeCSV(violation.plateNumber || ''),
                violationDateFormatted,
                escapeCSV(violation.offenses || ''),
                escapeCSV(violation.section || ''),
                levelText,
                fineFormatted,
                violation.status || '',
                escapeCSV(violation.officialReceiptNumber || ''),
                datePaidFormatted
            ];
            
            csvRows.push(row.join(','));
        });
        

        const BOM = '\uFEFF';
        const csvContent = BOM + csvRows.join('\n');
        

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        
        let filterInfo = '';
        if (statusFilter?.value || sectionFilter?.value || dateFrom?.value || dateTo?.value) {
            filterInfo = '_filtered';
        }
        
        const filename = `violations_${dateStr}_${timeStr}${filterInfo}.csv`;
        

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        

        showToast(`Exported ${dataToExport.length} violation(s) to CSV`, 'success');
        console.log(`CSV export complete: ${filename} (${dataToExport.length} records)`);
        
    } catch (error) {
        console.error('CSV export error:', error);
        showToast('Failed to export CSV: ' + error.message, 'error');
    }
}



function showToast(message, type = 'success') {

    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${escapeHTML(message)}</span>`;
    
    document.body.appendChild(toast);
    

    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}



async function openManageOffensesModal() {
    console.log('Opening manage offenses modal...');
    
    const modal = document.getElementById('manageOffensesModal');
    if (!modal) {
        console.error('Manage offenses modal not found!');
        return;
    }
    

    editingSection = null;
    editingOffense = null;
    

    modal.style.display = 'flex';
    

    try {
        await Promise.all([
            renderSectionsList(),
            renderOffensesList(),
            populateManageOffensesDropdowns()
        ]);
        

        switchTab('sections');
        
        console.log('Manage offenses modal ready');
    } catch (error) {
        console.error('Error loading manage offenses data:', error);
    }
}


function closeManageOffensesModal() {
    if (manageOffensesModal) {
        manageOffensesModal.style.display = 'none';
    }
}


async function addNewSection() {
    const sectionName = prompt('Enter new section name:');
    
    if (!sectionName || !sectionName.trim()) {
        return;
    }
    
    const trimmedName = sectionName.trim();
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }
        

        const { data: existingSection, error: checkError } = await supabaseClient
            .from('sections')
            .select('id')
            .eq('section_name', trimmedName)
            .maybeSingle();
        
        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }
        
        if (existingSection) {
            alert(`Section "${trimmedName}" already exists!`);
            return;
        }
        

        const { data: newSection, error: insertError } = await supabaseClient
            .from('sections')
            .insert({ section_name: trimmedName })
            .select()
            .single();
        
        if (insertError) throw insertError;
        

        await Promise.all([
            renderSectionsList(),
            populateSections(),
            populateSectionFilter(),
            populateManageOffensesDropdowns()
        ]);
        
        showToast(`Section "${escapeHTML(trimmedName)}" added successfully!`, 'success');
        
    } catch (error) {
        console.error('Error adding section:', error);
        alert('Failed to add section: ' + error.message);
    }
}


async function editSection(sectionId, sectionName) {

    if (editingSection) {
        cancelSectionEdit();
    }
    
    editingSection = sectionId;
    await renderSectionsList();
    

    setTimeout(() => {
        const sectionItem = document.querySelector(`.section-item[data-section-id="${sectionId}"]`);
        if (sectionItem) {
            const nameInput = sectionItem.querySelector('.section-name-input');
            if (nameInput) {
                nameInput.focus();
                nameInput.select();
            }
        }
    }, 50);
}


async function saveSectionEdit(sectionId) {
    const sectionItem = document.querySelector(`.section-item[data-section-id="${sectionId}"]`);
    if (!sectionItem) return;
    
    const newSectionName = sectionItem.querySelector('.section-name-input').value.trim();
    
    if (!newSectionName) {
        alert('Section name cannot be empty!');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        

        const { error } = await supabaseClient
            .from('sections')
            .update({ section_name: newSectionName })
            .eq('id', sectionId);
        
        if (error) throw error;
        

        editingSection = null;
        

        await renderSectionsList();
        await populateSections();
        await populateSectionFilter();
        await populateManageOffensesDropdowns();
        
        showToast(`Section updated to "${escapeHTML(newSectionName)}"`, 'success');
        
    } catch (error) {
        console.error('Error updating section:', error);
        alert('Failed to update section: ' + error.message);
    }
}


function cancelSectionEdit() {
    editingSection = null;
    renderSectionsList();
}


async function deleteSection(sectionId, sectionNameFromButton) {
    if (!sectionId) {
        console.error('No section ID provided');
        return;
    }
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sectionId)) {
        console.error('Invalid section ID format:', sectionId);
        alert('System error: Invalid violation ID format. Please refresh the page.');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        

        let sectionNameToUse = sectionNameFromButton;
        

        if (!sectionNameToUse) {
            const { data: section, error: fetchError } = await supabaseClient
                .from('sections')
                .select('section_name')
                .eq('id', sectionId)
                .maybeSingle();
            
            if (fetchError) throw fetchError;
            
            sectionNameToUse = section ? section.section_name : 'Unknown Section';
        }
        



        const { data: violationsData, error: violationsError } = await supabaseClient
            .from('violations')
            .select('id, no, name, plate_number')
            .eq('section_id', sectionId)
            .limit(5);
        
        if (violationsError) throw violationsError;
        
        const hasViolations = violationsData && violationsData.length > 0;
        



        const { data: offenses, error: offensesError } = await supabaseClient
            .from('offenses')
            .select('id, offense_name')
            .eq('section_id', sectionId);
        
        if (offensesError) throw offensesError;
        
        const hasOffenses = offenses && offenses.length > 0;
        



        let message = `Are you sure you want to delete section "${sectionNameToUse || 'Untitled'}"?`;
        message += `\n\n⚠️ THIS ACTION CANNOT BE UNDONE.`;

        if (hasViolations) {
            message += `\n\n🔴 ${violationsData.length} violation(s) are using this section.`;
            message += `\n\nDeleting this section will:`;
            message += `\n  • Remove the section from these violations`;
            message += `\n  • Set their section_id to NULL`;
            message += `\n  • Keep the violation records but without section reference`;
            
            if (violationsData.length > 0) {
                message += `\n\nAffected violations:`;
                violationsData.forEach(v => {
                    message += `\n  • #${v.no} - ${v.name} (${v.plate_number})`;
                });
                if (violationsData.length >= 5) {
                    message += `\n  • ... and ${violationsData.length - 5} more`;
                }
            }
        }

        if (hasOffenses) {
            message += `\n\n🟠 ${offenses.length} offense(s) belong to this section.`;
            message += `\n\nDeleting this section will:`;
            message += `\n  • DELETE ALL ${offenses.length} OFFENSES and their fines`;
            message += `\n  • Any violations using these offenses will have offense_id set to NULL`;
            
            if (offenses.length > 0) {
                message += `\n\nOffenses to be deleted:`;
                offenses.slice(0, 5).forEach(o => {
                    message += `\n  • ${o.offense_name}`;
                });
                if (offenses.length > 5) {
                    message += `\n  • ... and ${offenses.length - 5} more`;
                }
            }
        }

        if (!hasViolations && !hasOffenses) {
            message += `\n\n This section is empty and can be safely deleted.`;
        }
        



        if (confirm(message)) {

            if (hasViolations) {
                console.log('Removing section reference from violations...');
                const { error: updateViolationsError } = await supabaseClient
                    .from('violations')
                    .update({ 
                        section_id: null,
                        section: '[DELETED] ' + sectionNameToUse 
                    })
                    .eq('section_id', sectionId);
                
                if (updateViolationsError) throw updateViolationsError;
            }
            

            if (hasOffenses) {
                console.log('Removing offense references from violations...');
                const offenseIds = offenses.map(o => o.id);
                
                const { error: updateOffensesError } = await supabaseClient
                    .from('violations')
                    .update({ 
                        offense_id: null,
                        offenses: '[DELETED SECTION] ' + sectionNameToUse 
                    })
                    .in('offense_id', offenseIds);
                
                if (updateOffensesError) throw updateOffensesError;
                

                console.log('Deleting offenses...');
                const { error: deleteOffensesError } = await supabaseClient
                    .from('offenses')
                    .delete()
                    .in('id', offenseIds);
                
                if (deleteOffensesError) throw deleteOffensesError;
            }
            

            console.log('Deleting section...');
            const { error: deleteError } = await supabaseClient
                .from('sections')
                .delete()
                .eq('id', sectionId);
            
            if (deleteError) throw deleteError;
            



            console.log('🔄 Force refreshing all UI components...');
            

            editingSection = null;
            editingOffense = null;
            

            await Promise.all([
                renderSectionsList(),
                renderOffensesList(),
                populateSections(),
                populateSectionFilter(),
                populateManageOffensesDropdowns()
            ]);
            

            if (hasViolations || hasOffenses) {
                const violationsResult = await fetchViolations();
                if (violationsResult.success) {
                    violations = violationsResult.data;
                    renderTable();
                }
            }
            
            showToast(`Section "${escapeHTML(sectionNameToUse || '')}" and ${hasOffenses ? offenses.length + ' offense(s)' : ''} deleted!`, 'error');
            console.log('Section deletion complete, UI refreshed');
        }
        
    } catch (error) {
        console.error('Error deleting section:', error);
        
        if (error.code === '23503') {
            alert('Cannot delete section because it is still referenced by violations.');
        } else if (error.code === '22P02') {
            alert('Database schema error: UUID mismatch. Please refresh the page.');
        } else {
            alert('Failed to delete section. Please refresh the page and try again.');
        }
    }
}


async function populateManageOffensesDropdowns() {
    const newSectionSelect = document.getElementById('newSection');
    const offenseSectionFilter = document.getElementById('offenseSectionFilter');
    
    if (!newSectionSelect && !offenseSectionFilter) return;
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return;
        
        const { data: sections, error } = await supabaseClient
            .from('sections')
            .select('id, section_name')
            .order('section_name');
        
        if (error) throw error;
        

        if (newSectionSelect) {
            newSectionSelect.innerHTML = '<option value="">-- Select Section --</option>';
            
            sections.forEach(section => {
                const option = document.createElement('option');
                option.value = section.id;
                option.textContent = section.section_name;
                newSectionSelect.appendChild(option);
            });
            
            console.log(`opulated newSection dropdown with ${sections.length} sections`);
        }
        

        if (offenseSectionFilter) {
            offenseSectionFilter.innerHTML = '<option value="">All Sections</option>';
            
            sections.forEach(section => {
                const option = document.createElement('option');
                option.value = section.id;
                option.textContent = section.section_name;
                offenseSectionFilter.appendChild(option);
            });
            
            console.log(`Populated offenseSectionFilter dropdown with ${sections.length} sections`);
        }
        
    } catch (error) {
        console.error('Error populating manage offenses dropdowns:', error);
    }
}


function switchTab(tabName) {

    // Support both .tab-btn and .simple-tab-btn
    document.querySelectorAll('.tab-btn, .simple-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Find the correct tab button (case-insensitive, trims whitespace)
    const tabButton = Array.from(document.querySelectorAll('.tab-btn, .simple-tab-btn')).find(btn => 
        btn.textContent.trim().toLowerCase() === tabName.toLowerCase()
    );
    const tabContent = document.getElementById(`${tabName}Tab`);

    if (tabButton) tabButton.classList.add('active');
    if (tabContent) tabContent.classList.add('active');

    if (tabName === 'offenses') {
        const filterSelect = document.getElementById('offenseSectionFilter');
        if (filterSelect) {
            filterSelect.value = '';
            filterOffenses();
        }
    }
}


async function renderSectionsList() {
    const sectionsList = document.getElementById('sectionsList');
    if (!sectionsList) return;
    

    sectionsList.innerHTML = '<div class="loading-message">Loading sections...</div>';
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            sectionsList.innerHTML = '<div class="error-message">Supabase not initialized</div>';
            return;
        }


        console.log('Fetching fresh sections data...');
        
        const { data: sections, error } = await supabaseClient
            .from('sections')
            .select('id, section_name')
            .order('section_name', { ascending: true });
        
        if (error) {
            console.error('Error fetching sections:', error);
            throw error;
        }
        

        sectionsList.innerHTML = '';
        
        if (!sections || sections.length === 0) {
            sectionsList.innerHTML = '<div class="no-data">No sections found. Click "+ Add Section" to add one.</div>';
            return;
        }
        
        console.log(`Rendering ${sections.length} sections`);
        
        sections.forEach(section => {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = `section-item ${editingSection === section.id ? 'editing' : ''}`;
            sectionDiv.dataset.sectionId = section.id;
            sectionDiv.dataset.sectionName = section.section_name;
            
            const escapedSectionName = escapeHTML(section.section_name);
            
            if (editingSection === section.id) {

                sectionDiv.innerHTML = `
                    <div style="flex: 1;">
                        <div class="section-edit">
                            <input type="text" class="edit-input section-name-input" value="${escapedSectionName}" 
                                id="section-edit-${section.id}" name="section-edit-${section.id}" autofocus>
                            <div style="margin-top: 10px; display: flex; gap: 10px;">
                                <button type="button" class="btn small-btn save-section-btn" data-section-id="${section.id}">Save</button>
                                <button type="button" class="btn small-btn cancel-section-btn" data-section-id="${section.id}">Cancel</button>
                            </div>
                        </div>
                    </div>
                    <div class="offense-actions">
                        <button type="button" class="action-btn edit-btn" disabled style="opacity: 0.5;">Edit</button>
                        <button type="button" class="action-btn delete-btn" disabled style="opacity: 0.5;">Delete</button>
                    </div>
                `;
            } else {

                sectionDiv.innerHTML = `
                    <div>
                        <div class="section-name">${escapedSectionName}</div>
                    </div>
                    <div class="offense-actions">
                        <button type="button" class="action-btn edit-btn edit-section-btn" 
                            data-section-id="${section.id}" data-section-name="${escapedSectionName}">Edit</button>
                        <button type="button" class="action-btn delete-btn delete-section-btn" 
                            data-section-id="${section.id}" data-section-name="${escapedSectionName}">Delete</button>
                    </div>
                `;
            }
            
            sectionsList.appendChild(sectionDiv);
        });
        

        attachSectionEventListeners();
        
    } catch (error) {
        console.error('Error rendering sections list:', error);
        sectionsList.innerHTML = `<div class="error-message">Failed to load sections: ${escapeHTML(error.message)}</div>`;
    }
}


function attachSectionEventListeners() {

    document.querySelectorAll('.edit-section-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.delete-section-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.save-section-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.cancel-section-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    

    document.querySelectorAll('.edit-section-btn').forEach(btn => {
        btn.addEventListener('click', handleSectionEditClick);
    });
    
    document.querySelectorAll('.delete-section-btn').forEach(btn => {
        btn.addEventListener('click', handleSectionDeleteClick);
    });
    
    document.querySelectorAll('.save-section-btn').forEach(btn => {
        btn.addEventListener('click', handleSectionSaveClick);
    });
    
    document.querySelectorAll('.cancel-section-btn').forEach(btn => {
        btn.addEventListener('click', handleSectionCancelClick);
    });
    
    console.log('Section event listeners attached');
}


function handleSectionEditClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = e.currentTarget;
    const sectionId = btn.dataset.sectionId;
    const sectionName = btn.dataset.sectionName;
    
    console.log('Edit section clicked:', { sectionId, sectionName });
    
    if (!sectionId) {
        console.error('No section ID found on button');
        return;
    }
    

    editingSection = sectionId;
    

    renderSectionsList();
}


async function handleSectionDeleteClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = e.currentTarget;
    const sectionId = btn.dataset.sectionId;
    const sectionName = btn.dataset.sectionName;
    
    console.log('Delete section clicked:', { sectionId, sectionName });
    
    if (!sectionId) {
        console.error('No section ID found on button');
        return;
    }
    
    try {

        await deleteSection(sectionId, sectionName);
    } catch (error) {
        console.error('Error in handleSectionDeleteClick:', error);
        alert('Failed to delete section: ' + error.message);
    }
}


async function handleSectionSaveClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = e.currentTarget;
    const sectionId = btn.dataset.sectionId;
    
    console.log('Save section clicked:', sectionId);
    
    if (!sectionId) {
        console.error('No section ID found on button');
        return;
    }
    
    await saveSectionEdit(sectionId);
}


function handleSectionCancelClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = e.currentTarget;
    const sectionId = btn.dataset.sectionId;
    
    console.log('Cancel section edit:', sectionId);
    
    editingSection = null;
    renderSectionsList();
}


function handleSectionEdit(e) {
    const sectionItem = e.currentTarget.closest('.section-item');
    const sectionId = sectionItem.dataset.sectionId; 
    const sectionName = sectionItem.querySelector('.section-name').textContent;
    
    editSection(sectionId, sectionName);
}


async function handleSectionSave(e) {
    const sectionItem = e.currentTarget.closest('.section-item');
    const sectionId = sectionItem.dataset.sectionId; 
    const newSectionName = sectionItem.querySelector('.section-name-input').value.trim(); 
    if (!newSectionName) {
        alert('Section name cannot be empty!');
        return;
    }
    
    try {

        const supabaseClient = getSupabaseClient();
        const { error } = await supabaseClient
            .from('sections')
            .update({ section_name: newSectionName })
            .eq('id', sectionId);
        
        if (error) throw error;
        

        editingSection = null;
        

        await renderSectionsList();
        await populateSections();
        await populateSectionFilter();
        
        showToast(`Section updated to "${escapeHTML(newSectionName)}"`, 'success');
        
    } catch (error) {
        console.error('Error updating section:', error);
        alert('Failed to update section: ' + error.message);
    }
}


function handleSectionCancel(e) {
    cancelSectionEdit();
}


function cancelSectionEdit() {
    editingSection = null;
    renderSectionsList();
}


async function handleSectionDelete(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const sectionItem = e.currentTarget.closest('.section-item');
    if (!sectionItem) return;
    
    const sectionId = sectionItem.dataset.sectionId;
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sectionId)) {
        console.error('Invalid section ID format:', sectionId);
        alert('System error: Invalid section ID format. Please refresh the page.');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        

        const { data: section, error: fetchError } = await supabaseClient
            .from('sections')
            .select('section_name')
            .eq('id', sectionId)
            .maybeSingle();
        
        if (fetchError) throw fetchError;
        
        if (!section) {
            alert('Section not found!');
            return;
        }
        
        const sectionName = section.section_name;
        

        await deleteSection(sectionId, sectionName);
        
    } catch (error) {
        console.error('Error deleting section:', error);
        
        if (error.code === '22P02') {
            alert('Database schema error: UUID mismatch. Please refresh the page or contact support.');
        } else {
            alert('Failed to delete section: ' + error.message);
        }
    }
}


async function renderOffensesList() {
    const offensesList = document.getElementById('offensesList');
    if (!offensesList) return;
    

    offensesList.innerHTML = '<div class="loading-message">Loading offenses...</div>';
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            offensesList.innerHTML = '<div class="error-message">Supabase not initialized</div>';
            return;
        }


        console.log('Fetching fresh offenses data...');
        
        const { data: offenses, error } = await supabaseClient
            .from('offenses')
            .select(`
                id,
                offense_name,
                section_id,
                sections!inner(section_name),
                fines(level, amount)
            `)
            .order('offense_name', { ascending: true });
        
        if (error) {
            console.error('Error fetching offenses:', error);
            throw error;
        }
        

        offensesList.innerHTML = '';
        
        if (!offenses || offenses.length === 0) {
            offensesList.innerHTML = '<div class="no-data">No offenses found. Click "Add New" tab to add one.</div>';
            return;
        }
        
        console.log(` Rendering ${offenses.length} offenses`);
        
        offenses.forEach(offense => {
            const offenseDiv = document.createElement('div');
            offenseDiv.className = `offense-item ${editingOffense === offense.id ? 'editing' : ''}`;
            

            offenseDiv.dataset.offenseId = offense.id;
            offenseDiv.dataset.sectionId = offense.section_id;
            

            const fines = {1: 0, 2: 0, 3: 0};
            if (offense.fines) {
                offense.fines.forEach(fine => {
                    fines[fine.level] = fine.amount;
                });
            }
            

            const escapedSectionName = escapeHTML(offense.sections?.section_name || '');
            const escapedOffenseName = escapeHTML(offense.offense_name);
            
            if (editingOffense === offense.id) {

                offenseDiv.innerHTML = `
                    <div style="flex: 1;">
                        <div class="section-name" style="font-size: 12px; color: #666;">${escapedSectionName}</div>
                        <div class="offense-edit">
                            <input type="text" class="edit-input offense-name-input" value="${escapedOffenseName}" 
                                placeholder="Enter offense name" autofocus>
                            <div class="fine-inputs">
                                <div class="fine-input-group">
                                    <label>1st Offense</label>
                                    <input type="number" class="fine-input first-fine" value="${fines[1]}" min="0" placeholder="Amount">
                                </div>
                                <div class="fine-input-group">
                                    <label>2nd Offense</label>
                                    <input type="number" class="fine-input second-fine" value="${fines[2]}" min="0" placeholder="Amount">
                                </div>
                                <div class="fine-input-group">
                                    <label>3rd Offense</label>
                                    <input type="number" class="fine-input third-fine" value="${fines[3]}" min="0" placeholder="Amount">
                                </div>
                            </div>
                            <div style="margin-top: 10px; display: flex; gap: 10px;">
                                <button type="button" class="btn small-btn save-offense-btn">Save</button>
                                <button type="button" class="btn small-btn cancel-offense-btn">Cancel</button>
                            </div>
                        </div>
                    </div>
                    <div class="offense-actions">
                        <button type="button" class="action-btn edit-btn" disabled style="opacity: 0.5;">Edit</button>
                        <button type="button" class="action-btn delete-btn delete-offense-btn" title="Delete Offense">Delete</button>
                    </div>
                `;
            } else {

                offenseDiv.innerHTML = `
                    <div style="flex: 1;">
                        <div class="section-name" style="font-size: 12px; color: #666;">${escapedSectionName}</div>
                        <div class="offense-name">${escapedOffenseName}</div>
                        <div class="offense-fines">
                            1st: ₱${fines[1].toLocaleString()} | 2nd: ₱${fines[2].toLocaleString()} | 3rd: ₱${fines[3].toLocaleString()}
                        </div>
                    </div>
                    <div class="offense-actions">
                        <button type="button" class="action-btn edit-btn edit-offense-btn" title="Edit Offense">Edit</button>
                        <button type="button" class="action-btn delete-btn delete-offense-btn" title="Delete Offense">Delete</button>
                    </div>
                `;
            }
            
            offensesList.appendChild(offenseDiv);
        });
        

        attachOffenseEventListeners();
        
    } catch (error) {
        console.error('Error rendering offenses list:', error);
        
        let errorMessage = 'Failed to load offenses. ';
        if (error.message?.includes('Failed to fetch')) {
            errorMessage += 'Network connection issue. Please check your internet connection.';
        } else {
            errorMessage += error.message || 'Unknown error';
        }
        
        offensesList.innerHTML = `<div class="error-message">${escapeHTML(errorMessage)}</div>`;
    }
}


function attachOffenseEventListeners() {

    document.querySelectorAll('.edit-offense-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.delete-offense-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.save-offense-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    document.querySelectorAll('.cancel-offense-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    

    document.querySelectorAll('.edit-offense-btn').forEach(btn => {
        btn.addEventListener('click', handleOffenseEdit);
    });
    
    document.querySelectorAll('.delete-offense-btn').forEach(btn => {
        btn.addEventListener('click', handleOffenseDelete);
    });
    
    document.querySelectorAll('.save-offense-btn').forEach(btn => {
        btn.addEventListener('click', handleOffenseSave);
    });
    
    document.querySelectorAll('.cancel-offense-btn').forEach(btn => {
        btn.addEventListener('click', handleOffenseCancel);
    });
    
    console.log('Offense event listeners attached');
}


function handleOffenseEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const offenseItem = e.currentTarget.closest('.offense-item');
    if (!offenseItem) {
        console.error('Offense item not found');
        return;
    }
    
    const offenseId = offenseItem.dataset.offenseId;
    console.log('Editing offense:', offenseId);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(offenseId)) {
        console.error('Invalid offense ID format:', offenseId);
        alert('System error: Invalid offense ID format. Please refresh the page.');
        return;
    }
    

    if (editingOffense === offenseId) {
        console.log('Already editing this offense');
        return;
    }
    

    if (editingOffense) {
        cancelOffenseEdit();
    }
    
    editingOffense = offenseId;
    renderOffensesList();
}


async function handleOffenseSave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const offenseItem = e.currentTarget.closest('.offense-item');
    if (!offenseItem) {
        console.error('Offense item not found');
        return;
    }
    
    const offenseId = offenseItem.dataset.offenseId;
    console.log('Saving offense with ID:', offenseId);
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(offenseId)) {
        console.error('Invalid offense ID format:', offenseId);
        alert('System error: Invalid offense ID format. Please refresh the page.');
        return;
    }
    
    const newOffenseName = offenseItem.querySelector('.offense-name-input').value.trim();
    const firstFine = parseInt(offenseItem.querySelector('.first-fine').value);
    const secondFine = parseInt(offenseItem.querySelector('.second-fine').value);
    const thirdFine = parseInt(offenseItem.querySelector('.third-fine').value);
    
    if (!newOffenseName) {
        alert('Offense name cannot be empty!');
        return;
    }
    
    if (isNaN(firstFine) || isNaN(secondFine) || isNaN(thirdFine)) {
        alert('Please enter valid fine amounts!');
        return;
    }
    
    if (firstFine < 0 || secondFine < 0 || thirdFine < 0) {
        alert('Fine amounts cannot be negative!');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        

        const { error: offenseError } = await supabaseClient
            .from('offenses')
            .update({ offense_name: newOffenseName })
            .eq('id', offenseId); // This must be UUID
        
        if (offenseError) throw offenseError;
        

        const fines = [
            { level: 1, amount: firstFine },
            { level: 2, amount: secondFine },
            { level: 3, amount: thirdFine }
        ];
        
        for (const fine of fines) {
            const { error: fineError } = await supabaseClient
                .from('fines')
                .upsert({
                    offense_id: offenseId, // This must be UUID
                    level: fine.level,
                    amount: fine.amount
                }, { onConflict: 'offense_id,level' });
            
            if (fineError) throw fineError;
        }
        

        editingOffense = null;
        

        await renderOffensesList();
        
        showToast(`Offense "${escapeHTML(newOffenseName)}" updated!`, 'success');
        
    } catch (error) {
        console.error('Error updating offense:', error);
        
        if (error.code === '22P02') {
            alert('Database error: Invalid ID format. Please refresh the page and try again.');
        } else {
            alert('Failed to update offense: ' + error.message);
        }
    }
}


function handleOffenseCancel(e) {
    cancelOffenseEdit();
}


function cancelOffenseEdit() {
    editingOffense = null;
    renderOffensesList();
}


async function handleOffenseDelete(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const offenseItem = e.currentTarget.closest('.offense-item');
    if (!offenseItem) {
        console.error('Offense item not found');
        return;
    }
    
    const offenseId = offenseItem.dataset.offenseId;
    const offenseName = offenseItem.querySelector('.offense-name')?.textContent || 'Unknown';
    
    console.log('Deleting offense:', { offenseId, offenseName });
    

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(offenseId)) {
        console.error('Invalid offense ID format:', offenseId);
        alert('System error: Invalid offense ID format. Please refresh the page.');
        return;
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) throw new Error('Supabase not initialized');
        

        const { data: violations, error: checkError } = await supabaseClient
            .from('violations')
            .select('id, no, name, plate_number')
            .eq('offense_id', offenseId)
            .limit(5);
        
        if (checkError) throw checkError;
        
        const hasViolations = violations && violations.length > 0;
        
        let message = `Are you sure you want to delete offense "${offenseName}"?`;
        
        if (hasViolations) {
            message += `\n\n⚠️ WARNING: This offense is used in ${violations.length} violation(s).`;
            message += `\n\nDeleting this offense will:`;
            message += `\n  • Remove it from these violations`;
            message += `\n  • Set their offense_id to NULL`;
            message += `\n  • Keep the violation records but without offense reference`;
            message += `\n\nAffected violations:`;
            violations.forEach(v => {
                message += `\n  • #${v.no} - ${v.name} (${v.plate_number})`;
            });
            if (violations.length >= 5) {
                message += `\n  • ... and ${violations.length - 5} more`;
            }
            message += `\n\nThis action CANNOT be undone.`;
        }
        
        if (confirm(message)) {

            if (hasViolations) {
                console.log('Removing offense reference from violations...');
                const { error: updateError } = await supabaseClient
                    .from('violations')
                    .update({ 
                        offense_id: null,
                        offenses: '[DELETED] ' + offenseName 
                    })
                    .eq('offense_id', offenseId);
                
                if (updateError) throw updateError;
            }
            

            console.log('Deleting offense...');
            const { error: deleteError } = await supabaseClient
                .from('offenses')
                .delete()
                .eq('id', offenseId);
            
            if (deleteError) throw deleteError;
            

            editingOffense = null;
            

            console.log('🔄 Refreshing offenses list after deletion...');
            await renderOffensesList();
            await populateOffenses();
            await populateManageOffensesDropdowns();
            

            if (hasViolations) {
                const violationsResult = await fetchViolations();
                if (violationsResult.success) {
                    violations = violationsResult.data;
                    renderTable();
                }
            }
            
            showToast(`🗑️ Offense "${escapeHTML(offenseName)}" deleted!`, 'error');
        }
        
    } catch (error) {
        console.error('Error deleting offense:', error);
        
        if (error.code === '22P02') {
            alert('Database error: Invalid ID format. Please refresh the page.');
        } else {
            alert('Failed to delete offense: ' + error.message);
        }
    }
}


function filterOffenses() {
    const selectedSection = document.getElementById('offenseSectionFilter');
    if (!selectedSection) return;
    
    const selectedValue = selectedSection.value;
    const offenseItems = document.querySelectorAll('.offense-item');
    
    offenseItems.forEach(item => {
        if (selectedValue === '' || item.dataset.sectionId === selectedValue) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}


async function ensureSupabaseClientReady() {
    if (!window.supabaseClient) {
        console.error('Supabase client is not initialized. Retrying...');
        const clientReady = await waitForSupabaseClient(8000);
        if (!clientReady) {
            throw new Error('Supabase client failed to initialize after retrying.');
        }
    }
}


async function addNewOffense(event) {

    if (event) {
        event.preventDefault();
    }
    

    const sectionSelect = document.getElementById('newSection');
    const offenseNameInput = document.getElementById('newOffenseName');
    const firstFineInput = document.getElementById('firstOffense');
    const secondFineInput = document.getElementById('secondOffense');
    const thirdFineInput = document.getElementById('thirdOffense');
    

    if (!sectionSelect || !offenseNameInput || !firstFineInput || !secondFineInput || !thirdFineInput) {
        alert('Form elements not found! Please refresh the page.');
        return false;
    }
    

    const sectionId = sectionSelect.value;
    const offenseNameValue = offenseNameInput.value.trim();
    const firstFineValue = parseInt(firstFineInput.value);
    const secondFineValue = parseInt(secondFineInput.value);
    const thirdFineValue = parseInt(thirdFineInput.value);
    

    if (!sectionId) {
        alert('Please select a section!');
        return false;
    }
    
    if (!offenseNameValue) {
        alert('Please enter an offense name!');
        return false;
    }
    
    if (isNaN(firstFineValue) || isNaN(secondFineValue) || isNaN(thirdFineValue)) {
        alert('Please enter valid fine amounts!');
        return false;
    }
    
    if (firstFineValue < 0 || secondFineValue < 0 || thirdFineValue < 0) {
        alert('Fine amounts cannot be negative!');
        return false;
    }
    

    const submitBtn = document.querySelector('#newOffenseForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';
    }
    
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }
        

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sectionId)) {
            throw new Error('Invalid section ID format');
        }
        

        const { data: sectionData, error: sectionError } = await supabaseClient
            .from('sections')
            .select('section_name')
            .eq('id', sectionId)
            .single();
        
        if (sectionError) throw sectionError;
        const sectionName = sectionData.section_name;
        

        const { data: existingOffense, error: checkError } = await supabaseClient
            .from('offenses')
            .select('id')
            .eq('section_id', sectionId)
            .eq('offense_name', offenseNameValue)
            .maybeSingle();
        
        if (checkError) throw checkError;
        
        if (existingOffense) {
            alert(`⚠️ Offense "${offenseNameValue}" already exists in section "${sectionName}"!`);
            return false;
        }
        

        const { data: offenseData, error: offenseError } = await supabaseClient
            .from('offenses')
            .insert({ 
                section_id: sectionId, 
                offense_name: offenseNameValue 
            })
            .select()
            .single();
        
        if (offenseError) throw offenseError;
        

        const fines = [
            { offense_id: offenseData.id, level: 1, amount: firstFineValue },
            { offense_id: offenseData.id, level: 2, amount: secondFineValue },
            { offense_id: offenseData.id, level: 3, amount: thirdFineValue }
        ];
        
        const { error: finesError } = await supabaseClient
            .from('fines')
            .insert(fines);
        
        if (finesError) throw finesError;
        

        offenseNameInput.value = '';
        firstFineInput.value = '';
        secondFineInput.value = '';
        thirdFineInput.value = '';
        sectionSelect.value = '';
        

        console.log('🔄 Refreshing UI after adding offense...');
        
        await Promise.all([
            renderOffensesList(),
            populateOffenses(),
            populateManageOffensesDropdowns()
        ]);
        
        showToast(`Offense "${escapeHTML(offenseNameValue)}" added to "${escapeHTML(sectionName)}"!`, 'success');
        

        setTimeout(() => switchTab('offenses'), 100);
        
    } catch (error) {
        console.error('Error adding offense:', error);
        
        let errorMessage = error.message || 'Unknown error occurred';
        

        if (errorMessage.includes('duplicate key') || errorMessage.includes('23505')) {
            errorMessage = `Offense "${offenseNameValue}" already exists in this section.`;
        } else if (errorMessage.includes('permission denied') || errorMessage.includes('42501')) {
            errorMessage = 'Permission denied. Please log out and log in again.';
        } else if (errorMessage.includes('Failed to fetch')) {
            errorMessage = 'Network error. Please check your internet connection.';
        }
        
        alert('Failed to add offense:\n\n' + errorMessage);
        
    } finally {

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Offense';
        }
    }
    
    return false;
}

document.addEventListener('DOMContentLoaded', async () => {

    if (window.supabaseClient) {
        await initializeApp();
    } else {

        console.log('⏳ Waiting for Supabase client...');
        const checkInterval = setInterval(async () => {
            if (window.supabaseClient) {
                clearInterval(checkInterval);
                await initializeApp();
            }
        }, 200);
        

        setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.supabaseClient) {
                console.error('Supabase client initialization timeout');
                showToast('Failed to connect to database. Please refresh.', 'error');
            }
        }, 10000);
    }
});

window.addEventListener('beforeunload', () => {
    cleanupRealtimeSync();
});

function makeRowsCollapsible() {
    document.querySelectorAll('#tableBody tr').forEach(row => {
        row.addEventListener('click', function(e) {
            if (e.target.closest('.action-btn') || e.target.closest('.action-buttons')) {
                return;
            }
            
            this.classList.toggle('expanded');
        });
    });
}





