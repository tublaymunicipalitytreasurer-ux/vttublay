window.exportToExcel = function exportToExcel() {
    if (!window.XLSX) {
        alert('Excel export requires SheetJS (XLSX) library.');
        return;
    }
    const headers = [
        'No.', 'Name', 'Plate Number', 'Date', 'Section', 'Offense', 'Level', 'Fine', 'Status', 'Official Receipt', 'Date Paid'
    ];
    const ws_data = [headers];

    const inMemoryViolations = (typeof violations !== 'undefined') ? violations : (window.violations || []);

    const table = document.getElementById('violationTable');
    const rows = table ? table.querySelectorAll('tbody tr') : [];
    let hasData = false;

    rows.forEach(row => {
        if (row.querySelector('.no-data')) return;
        const id = row.getAttribute('data-id');
        let v = null;
        if (id && Array.isArray(inMemoryViolations)) {
            v = inMemoryViolations.find(x => String(x.id) === String(id));
        }
        if (v) {
            let levelText = '';
            if (v.level === '1' || v.level === 1) levelText = '1st Offense';
            else if (v.level === '2' || v.level === 2) levelText = '2nd Offense';
            else if (v.level === '3' || v.level === 3) levelText = '3rd Offense';
            else levelText = v.level || '';

            ws_data.push([
                v.no || '',
                v.name || '',
                v.plateNumber || '',
                v.date || '',
                v.section || '',
                v.offenses || '',
                levelText,
                (v.fine || 0).toString(),
                v.status || '',
                v.officialReceiptNumber || '',
                v.datePaid || ''
            ].map(val => (typeof val === 'string' ? val.trim() : val)));
            hasData = true;
            return;
        }

        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;

        const no = cells[0] ? cells[0].innerText.trim() : '';
        const name = cells[1] ? cells[1].innerText.trim() : '';
        const plate = cells[2] ? cells[2].innerText.trim() : '';
        const date = cells[3] ? cells[3].innerText.trim() : '';
        let section = '';
        let offense = '';
        if (cells[4]) {
            section = cells[4].innerText.trim();
        }
        if (cells[5]) {
            offense = cells[5].innerText.trim();
        }

        ws_data.push([no, name, plate, date, section, offense, '', '', '', '', '']);
        hasData = true;
    });

    if (!hasData) {
        alert('No data to export! Please adjust your filters or add violations.');
        return;
    }
    let modal = document.getElementById('excelExportModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'excelExportModal';
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
            <div style="background: #fff; padding: 24px 20px; border-radius: 8px; box-shadow: 0 2px 16px #0002; width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;">
                <h3 style="margin-top:0;">Export Excel</h3>
                <label for="excelFileName">File name:</label>
                <input id="excelFileName" type="text" value="violations_export" style="width: 100%; margin: 12px 0; padding: 8px; font-size: 16px;">
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="excelExportCancel" style="padding: 8px 18px;">Cancel</button>
                    <button id="excelExportOk" style="padding: 8px 18px; background: #4472C4; color: #fff; border: none; border-radius: 4px;">Export</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    } else {
        modal.style.display = 'flex';
    }
    document.getElementById('excelExportCancel').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('excelExportOk').onclick = () => {
        let fileName = document.getElementById('excelFileName').value.trim() || 'violations_export';
        if (!fileName.endsWith('.xlsx')) fileName += '.xlsx';
        modal.style.display = 'none';
        const ws = XLSX.utils.aoa_to_sheet(ws_data);

        function wrapString(str, maxLen) {
            if (!str) return '';
            const words = String(str).split(/(\s+)/);
            let line = '';
            const lines = [];
            words.forEach(tok => {
                if ((line + tok).replace(/\s+$/,'').length > maxLen) {
                    if (line.trim()) lines.push(line.trim());
                    line = tok;
                } else {
                    line += tok;
                }
            });
            if (line.trim()) lines.push(line.trim());
            return lines.join('\n');
        }

        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = 0; R <= range.e.r; ++R) {
            for (let C of [4,5]) {
                const coord = XLSX.utils.encode_cell({r: R, c: C});
                const cell = ws[coord];
                if (cell && typeof cell.v === 'string' && cell.v.length > 60) {
                    cell.v = wrapString(cell.v, 60);
                    cell.t = 's';
                }
            }
        }
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = ws[XLSX.utils.encode_cell({r:0, c:C})];
            if (cell) {
                cell.s = {
                    font: { bold: true, color: { rgb: 'FFFFFF' } },
                    fill: { fgColor: { rgb: '4472C4' } },
                    alignment: { wrapText: true, horizontal: 'center' }
                };
            }
        }
        for (let R = 1; R <= range.e.r; ++R) {
            const coordE = XLSX.utils.encode_cell({r: R, c: 4});
            let cellE = ws[coordE];
            if (!cellE) {
                cellE = { t: 's', v: '' };
                ws[coordE] = cellE;
            }
            cellE.s = Object.assign({}, cellE.s || {}, {
                fill: { fgColor: { rgb: 'E2EFDA' } },
                alignment: { wrapText: true, vertical: 'top' }
            });

            const coordF = XLSX.utils.encode_cell({r: R, c: 5});
            let cellF = ws[coordF];
            if (!cellF) {
                cellF = { t: 's', v: '' };
                ws[coordF] = cellF;
            }
            cellF.s = Object.assign({}, cellF.s || {}, {
                fill: { fgColor: { rgb: 'FFF2CC' } },
                alignment: { wrapText: true, vertical: 'top' }
            });
        }

        ws['!cols'] = headers.map((h, idx) => {
            if (idx === 4 || idx === 5) return { wch: 50 };
            return { wch: 20 };
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Violations');
        XLSX.writeFile(wb, fileName, { cellStyles: true });
    };
};
