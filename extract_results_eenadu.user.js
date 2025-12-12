// ==UserScript==
// @name         Eenadu Results Extractor (Mandal -> Panchayat Winners)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Scrape all mandal tables on Eenadu results page and download as XLSX/CSV (Mandal, Village, Winner, Party).
// @author       Cursor Agent
// @match        https://www.eenadu.net/telangana/panchayat-elections-results-phase1/*
// @match        file://*/*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    function cleanText(input) {
        if (input === null || input === undefined) {
            return "";
        }
        return String(input)
            .replace(/&zwnj;|&#8204;|&ZeroWidthNonJoiner;/g, "")
            .replace(/[\u200c\u200d\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseMandalName(rawThText) {
        const thText = cleanText(rawThText);
        const marker = "మండలం:";
        const idx = thText.indexOf(marker);
        const afterMarker = idx >= 0 ? thText.slice(idx + marker.length) : thText;
        return cleanText(afterMarker.replace(/\(.*?\)/g, ""));
    }

    function parseDistrictName() {
        const h2 = document.querySelector("h2.sec_head.mandal-ttl");
        if (!h2) {
            return "";
        }
        // Example: "నాగర్‌కర్నూల్ - 151 పంచాయతీలు"
        const text = cleanText(h2.textContent);
        return cleanText(text.split("-")[0]);
    }

    function extractRowsFromPage() {
        const rows = [];
        const tables = Array.from(document.querySelectorAll("table.panelcinn01"));

        for (const table of tables) {
            const mandalTh = table.querySelector("thead th[colspan='3'], thead th[colspan=\"3\"]");
            if (!mandalTh) {
                continue;
            }

            const mandal = parseMandalName(mandalTh.textContent);
            if (!mandal) {
                continue;
            }

            const trList = Array.from(table.querySelectorAll("tbody tr"));
            for (const tr of trList) {
                const tds = tr.querySelectorAll("td");
                if (tds.length < 3) {
                    continue;
                }

                const village = cleanText(tds[0].textContent);
                const winner = cleanText(tds[1].textContent);

                const partyCell = tds[2].cloneNode(true);
                partyCell.querySelectorAll(".mandal-party-icon").forEach((n) => n.remove());
                const party = cleanText(partyCell.textContent);

                if (!village && !winner && !party) {
                    continue;
                }

                rows.push({
                    mandal,
                    village,
                    winner,
                    party,
                });
            }
        }

        return rows;
    }

    function csvEscape(value) {
        if (value === null || value === undefined) {
            return "";
        }
        const s = String(value);
        if (/[",\n\r]/.test(s)) {
            return `"${s.replace(/"/g, "\"\"")}"`;
        }
        return s;
    }

    function toCsv(rows) {
        const header = ["mandal", "village", "winner", "party"];
        const lines = [header.join(",")];
        for (const r of rows) {
            lines.push(
                [
                    csvEscape(r.mandal),
                    csvEscape(r.village),
                    csvEscape(r.winner),
                    csvEscape(r.party),
                ].join(","),
            );
        }
        return `${lines.join("\n")}\n`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function yyyyMmDd() {
        const d = new Date();
        const yyyy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    function buildBaseFilename() {
        const district = parseDistrictName();
        const date = yyyyMmDd();
        const prefix = district ? `eenadu-results-${district}-${date}` : `eenadu-results-${date}`;
        return prefix.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim().replace(/\s+/g, "_") || `eenadu-results-${date}`;
    }

    function downloadXlsx(rows) {
        if (typeof XLSX === "undefined" || !XLSX.utils) {
            throw new Error("SheetJS (XLSX) library not available. Try downloading CSV instead.");
        }

        const sheetRows = rows.map((r) => ({
            Mandal: r.mandal,
            Village: r.village,
            Winner: r.winner,
            Party: r.party,
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(sheetRows, { skipHeader: false });
        XLSX.utils.book_append_sheet(wb, ws, "Results");

        const array = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        const blob = new Blob([array], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        downloadBlob(blob, `${buildBaseFilename()}.xlsx`);
    }

    function downloadCsv(rows) {
        const csv = toCsv(rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `${buildBaseFilename()}.csv`);
    }

    function addUi() {
        const existing = document.getElementById("tampermonkey-eenadu-results-panel");
        if (existing) {
            existing.remove();
        }

        const panel = document.createElement("div");
        panel.id = "tampermonkey-eenadu-results-panel";
        panel.style.position = "fixed";
        panel.style.top = "16px";
        panel.style.right = "16px";
        panel.style.zIndex = "999999";
        panel.style.padding = "12px";
        panel.style.background = "#111827";
        panel.style.color = "#ffffff";
        panel.style.borderRadius = "10px";
        panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
        panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
        panel.style.fontSize = "13px";
        panel.style.minWidth = "260px";

        const title = document.createElement("div");
        title.textContent = "Eenadu Results Extractor";
        title.style.fontWeight = "700";
        title.style.marginBottom = "8px";

        const status = document.createElement("div");
        status.textContent = "Ready";
        status.style.opacity = "0.9";
        status.style.marginBottom = "10px";

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "8px";

        const btnXlsx = document.createElement("button");
        btnXlsx.textContent = "Download XLSX";
        btnXlsx.style.flex = "1";
        btnXlsx.style.border = "0";
        btnXlsx.style.borderRadius = "8px";
        btnXlsx.style.padding = "10px 12px";
        btnXlsx.style.cursor = "pointer";
        btnXlsx.style.background = "#10b981";
        btnXlsx.style.color = "#06281e";
        btnXlsx.style.fontWeight = "700";

        const btnCsv = document.createElement("button");
        btnCsv.textContent = "Download CSV";
        btnCsv.style.flex = "1";
        btnCsv.style.border = "0";
        btnCsv.style.borderRadius = "8px";
        btnCsv.style.padding = "10px 12px";
        btnCsv.style.cursor = "pointer";
        btnCsv.style.background = "#60a5fa";
        btnCsv.style.color = "#0b1b33";
        btnCsv.style.fontWeight = "700";

        const run = (kind) => {
            try {
                status.textContent = "Extracting…";
                const rows = extractRowsFromPage();
                status.textContent = `Found ${rows.length} rows. Downloading…`;

                if (rows.length === 0) {
                    alert("No rows found. Make sure the page has mandal tables (table.panelcinn01).");
                    status.textContent = "No rows found";
                    return;
                }

                if (kind === "xlsx") {
                    downloadXlsx(rows);
                } else {
                    downloadCsv(rows);
                }

                status.textContent = `Done (${rows.length} rows)`;
                console.log("[Eenadu Results Extractor] Rows:", rows);
            } catch (e) {
                console.error("[Eenadu Results Extractor] Error:", e);
                alert(`Extraction failed: ${e && e.message ? e.message : String(e)}`);
                status.textContent = "Failed (see console)";
            }
        };

        btnXlsx.addEventListener("click", () => run("xlsx"));
        btnCsv.addEventListener("click", () => run("csv"));

        btnRow.appendChild(btnXlsx);
        btnRow.appendChild(btnCsv);

        panel.appendChild(title);
        panel.appendChild(status);
        panel.appendChild(btnRow);
        document.body.appendChild(panel);
    }

    function init() {
        addUi();
    }

    if (document.readyState === "loading") {
        window.addEventListener("load", () => setTimeout(init, 500));
    } else {
        setTimeout(init, 500);
    }
})();


