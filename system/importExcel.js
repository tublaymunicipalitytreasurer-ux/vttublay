window.openImportExcelModal = function openImportExcelModal() {
    if (!window.XLSX) {
        alert('Excel import requires SheetJS (XLSX) library.');
        return;
    }

    let modal = document.getElementById('excelImportModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'excelImportModal';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.background = 'rgba(0,0,0,0.3)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.padding = '16px';
        modal.style.boxSizing = 'border-box';
        modal.style.overflow = 'auto';
        modal.style.zIndex = '12000';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:8px;box-shadow:0 2px 16px #0002;width:min(560px, calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;">
                <div class="modal-header" style="border-radius:8px 8px 0 0;">
                    <h2 style="margin:0;font-size:20px;">Import Excel</h2>
                    <span id="importExcelClose" class="close">&times;</span>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <p style="margin:0 0 12px;color:#555;">Download the format, fill in your violations, then import the file.</p>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                        <button id="importTemplateBtn" class="btn save" style="padding:10px 16px;">Download Format</button>
                    </div>
                    <label for="importExcelFile" style="display:block;margin-bottom:6px;">Choose Excel File</label>
                    <input id="importExcelFile" type="file" accept=".xlsx,.xls" style="width:100%;margin-bottom:14px;">
                    <div id="importExcelStatus" style="font-size:13px;color:#555;min-height:18px;"></div>
                    <div class="form-actions" style="margin-top:10px;padding-top:14px;">
                        <button id="importExcelCancel" type="button" class="btn cancel">Cancel</button>
                        <button id="importExcelOk" type="button" class="btn save">Import</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.style.display = 'flex';
    }

    const statusEl = document.getElementById('importExcelStatus');
    const fileEl = document.getElementById('importExcelFile');
    if (statusEl) statusEl.textContent = '';
    if (fileEl) fileEl.value = '';

    document.getElementById('importTemplateBtn').onclick = downloadImportTemplate;
    document.getElementById('importExcelClose').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('importExcelCancel').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('importExcelOk').onclick = async () => {
        await importExcelFile();
    };
};

async function downloadImportTemplate() {
    const headers = [
        'No.',
        'Name',
        'Plate Number',
        'Date',
        'Section',
        'Offenses',
        'Level',
        'Fine',
        'Status',
        'Official Receipt Number',
        'Date Paid'
    ];
    const example = [
        1,
        'Juan Dela Cruz',
        'ABC-1234',
        '2026-02-24',
        'Helmet',
        'No Helmet',
        1,
        500,
        'Unpaid',
        '',
        ''
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = [
        { wch: 8 }, { wch: 24 }, { wch: 18 }, { wch: 14 },
        { wch: 24 }, { wch: 32 }, { wch: 8 }, { wch: 12 },
        { wch: 10 }, { wch: 24 }, { wch: 14 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Format');

    try {
        const referenceRows = [['Section', 'Offense']];
        const sectionsResult = await fetchSections();
        if (sectionsResult.success && sectionsResult.data) {
            for (const section of sectionsResult.data) {
                const offensesResult = await fetchOffensesBySection(section.id);
                const offenses = offensesResult.success ? (offensesResult.data || []) : [];
                if (!offenses.length) {
                    referenceRows.push([section.section_name, '']);
                } else {
                    offenses.forEach(offense => {
                        referenceRows.push([section.section_name, offense.offense_name]);
                    });
                }
            }
        }
        const wsRef = XLSX.utils.aoa_to_sheet(referenceRows);
        wsRef['!cols'] = [{ wch: 34 }, { wch: 42 }];
        XLSX.utils.book_append_sheet(wb, wsRef, 'Reference');
    } catch (error) {
        console.warn('Could not build Reference sheet for import template:', error);
    }

    XLSX.writeFile(wb, 'violations_import_format.xlsx');
}

function normalizeText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseLevel(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s === '1' || s === '1st offense' || s === '1st') return '1';
    if (s === '2' || s === '2nd offense' || s === '2nd') return '2';
    if (s === '3' || s === '3rd offense' || s === '3rd') return '3';
    return '';
}

function parseStatus(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return 'Unpaid';
    if (s === 'paid') return 'Paid';
    if (s === 'unpaid') return 'Unpaid';
    return 'Unpaid';
}

function findByFlexibleText(map, rawInput, label) {
    const input = normalizeText(rawInput);
    if (!input) return null;

    if (map.has(input)) return map.get(input);

    const candidates = [];
    for (const [key, value] of map.entries()) {
        if (key.includes(input) || input.includes(key)) {
            candidates.push(value);
        }
    }

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
        throw new Error(`${label} is ambiguous: "${rawInput}". Please use a more specific value.`);
    }
    return null;
}

async function importExcelFile() {
    const statusEl = document.getElementById('importExcelStatus');
    const fileInput = document.getElementById('importExcelFile');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        if (statusEl) statusEl.textContent = 'Please choose an Excel file first.';
        return;
    }

    const file = fileInput.files[0];
    const rows = await readExcelRows(file);
    if (!rows.length) {
        if (statusEl) statusEl.textContent = 'No rows found in file.';
        return;
    }

    if (statusEl) statusEl.textContent = 'Validating and importing...';

    const sectionsMap = await buildSectionsMap();
    const usedNos = new Set((typeof violations !== 'undefined' && Array.isArray(violations)) ? violations.map(v => Number(v.no)) : []);
    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNo = i + 2;
        try {
            const no = Number(r['No.'] ?? r['No'] ?? r['no']);
            const name = String(r['Name'] ?? '').trim();
            const plateNumber = String(r['Plate Number'] ?? r['plate number'] ?? '').trim().toUpperCase();
            const date = String(r['Date'] ?? '').trim();
            const sectionName = String(r['Section'] ?? '').trim();
            const offenseName = String(r['Offense'] ?? r['Offenses'] ?? '').trim();
            const level = parseLevel(r['Level']);
            const inputFine = Number(r['Fine'] ?? 0);
            const status = parseStatus(r['Status']);
            const officialReceiptNumber = String(r['Official Receipt Number'] ?? '').trim();
            const datePaid = String(r['Date Paid'] ?? '').trim();

            if (!no || !sectionName || !offenseName || !level) {
                throw new Error('Missing required fields: No., Section, Offense, Level');
            }
            if (usedNos.has(no)) {
                throw new Error(`No. ${no} already exists`);
            }

            const sectionEntry = findByFlexibleText(sectionsMap, sectionName, 'Section');
            if (!sectionEntry) throw new Error(`Section not found: ${sectionName}`);

            const offenseEntry = findByFlexibleText(sectionEntry.offenses, offenseName, 'Offense');
            if (!offenseEntry) throw new Error(`Offense not found in section "${sectionName}": ${offenseName}`);

            const fineResult = await fetchFinesByOffense(offenseEntry.id);
            if (!fineResult.success || !fineResult.data) throw new Error('Unable to fetch fine data');
            const selectedFine = fineResult.data.find(f => String(f.level) === String(level));
            if (!selectedFine) throw new Error(`No fine schedule for level ${level}`);

            if (status === 'Paid' && !officialReceiptNumber) {
                throw new Error('Official Receipt Number is required when Status is Paid');
            }

            const violation = {
                no,
                name,
                plateNumber,
                date: date || '',
                section: sectionEntry.name,
                section_id: sectionEntry.id,
                offenses: offenseEntry.name,
                offense_id: offenseEntry.id,
                level,
                fine: inputFine > 0 ? inputFine : Number(selectedFine.amount || 0),
                status
            };
            if (status === 'Paid') {
                violation.officialReceiptNumber = officialReceiptNumber;
                violation.datePaid = datePaid || new Date().toISOString().split('T')[0];
            }

            const result = await addViolation(violation);
            if (!result.success) throw new Error(result.error || 'Failed to import row');

            if (typeof violations !== 'undefined' && Array.isArray(violations)) {
                violations.push(result.data);
            }
            usedNos.add(no);
            imported += 1;
        } catch (err) {
            errors.push(`Row ${rowNo}: ${err.message}`);
        }
    }

    if (typeof renderTable === 'function') {
        renderTable();
    }

    const modal = document.getElementById('excelImportModal');
    if (imported > 0 && errors.length === 0 && modal) {
        modal.style.display = 'none';
    }

    if (typeof showToast === 'function') {
        if (imported > 0) showToast(`Imported ${imported} violation(s).`, 'success');
        if (errors.length > 0) showToast(`Import completed with ${errors.length} error(s).`, 'warning');
    }

    if (statusEl) {
        if (errors.length === 0) {
            statusEl.textContent = `Import successful: ${imported} row(s).`;
        } else {
            statusEl.innerHTML = `
                <div style="color:#b03a2e;">Imported ${imported} row(s), ${errors.length} error(s):</div>
                <div style="max-height:140px;overflow:auto;margin-top:6px;padding:6px;border:1px solid #eee;background:#fafafa;">
                    ${errors.map(e => `<div>${e}</div>`).join('')}
                </div>
            `;
        }
    }
}

async function buildSectionsMap() {
    const result = await fetchSections();
    if (!result.success || !result.data) throw new Error('Unable to load sections');

    const map = new Map();
    for (const s of result.data) {
        const offensesResult = await fetchOffensesBySection(s.id);
        const offensesMap = new Map();
        (offensesResult.data || []).forEach(o => {
            offensesMap.set(normalizeText(o.offense_name), { id: o.id, name: o.offense_name });
        });
        map.set(normalizeText(s.section_name), { id: s.id, name: s.section_name, offenses: offensesMap });
    }
    return map;
}

function readExcelRows(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
                resolve(json);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
