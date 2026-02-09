// ==UserScript==
// @name         Praja Circle (ULB) PS Mapper
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Extract district + municipality (M&C) + ps_id rows from the ULB PS table and download JSON. Prompts for praja_circle_id.
// @author       Cursor Agent
// @match        https://tsec.gov.in/*
// @match        https://tsec.gov.in:443/*
// @match        file://*/*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    function cleanText(input) {
        if (input === null || input === undefined) {
            return "";
        }
        return String(input).replace(/\s+/g, " ").trim();
    }

    function parseIntSafe(value) {
        const n = parseInt(String(value || "").trim(), 10);
        return Number.isFinite(n) ? n : null;
    }

    function findFirstPopupQueryString() {
        const btn = document.querySelector("input[onclick*=\"popupDataUlb('\"], input[onclick*=\"popupDataUlb(\\\"\"]");
        if (!btn) {
            return null;
        }
        const onclick = btn.getAttribute("onclick") || "";
        const match = onclick.match(/popupDataUlb\(\s*['"]([^'"]+)['"]\s*\)/);
        return match ? match[1] : null;
    }

    function parseIdsFromPopupQueryString(qs) {
        // Example: psurban.do?mode=createViewInEnglishReport&election_id=190&district_id=01&mnc_id=1&ward_id=1&ps_id=1
        try {
            const url = new URL(qs, window.location.href);
            const districtId = parseIntSafe(url.searchParams.get("district_id"));
            const mncId = parseIntSafe(url.searchParams.get("mnc_id"));
            return { districtId, mncId };
        } catch {
            return { districtId: null, mncId: null };
        }
    }

    function findSelectedOptionTextByHint(hints) {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
            const idName = `${sel.id || ""} ${sel.name || ""}`.toLowerCase();
            if (!hints.some((h) => idName.includes(h))) {
                continue;
            }
            const opt = sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0] : sel.querySelector("option:checked");
            const txt = opt ? cleanText(opt.textContent) : "";
            if (txt && !/select/i.test(txt)) {
                return txt;
            }
        }
        return "";
    }

    function findLabelValueText(labelRegex) {
        // Looks for "District" / "Municipality" labels in the DOM and returns the adjacent value-ish text.
        const candidates = Array.from(document.querySelectorAll("td, th, label, span, div, b, strong"));
        for (const el of candidates) {
            const t = cleanText(el.textContent);
            if (!labelRegex.test(t)) {
                continue;
            }
            const next = el.nextElementSibling;
            if (next) {
                const val = cleanText(next.textContent).replace(/^:\s*/, "");
                if (val) {
                    return val;
                }
            }
            // Fallback: "District : XYZ" in same element
            const inline = t.split(":").slice(1).join(":");
            const inlineVal = cleanText(inline);
            if (inlineVal) {
                return inlineVal;
            }
        }
        return "";
    }

    function extractMeta() {
        const popupQs = findFirstPopupQueryString();
        const { districtId, mncId } = popupQs ? parseIdsFromPopupQueryString(popupQs) : { districtId: null, mncId: null };

        let districtName = findSelectedOptionTextByHint(["district"]);
        if (!districtName) {
            districtName = findLabelValueText(/\bdistrict\b/i);
        }

        let mncName = findSelectedOptionTextByHint(["mnc", "municipality", "ulb"]);
        if (!mncName) {
            mncName = findLabelValueText(/\b(m\s*&\s*c|municipality|mnc|ulb)\b/i);
        }

        return {
            districtId,
            districtName: districtName || "",
            mncId,
            mncName: mncName || "",
        };
    }

    function extractRows(prajaCircleId) {
        const table = document.querySelector("#GridView1");
        if (!table) {
            throw new Error("Could not find table #GridView1 on this page.");
        }

        const meta = extractMeta();
        const trs = Array.from(table.querySelectorAll("tbody tr"));
        const out = [];

        for (const tr of trs) {
            const tds = Array.from(tr.querySelectorAll("td"));
            if (tds.length < 3) {
                continue;
            }

            // Prefer ward_id from onclick (more reliable), fallback to parsing Ward cell.
            let wardId = null;
            const btnForWard = tr.querySelector("input[onclick*=\"ward_id=\"]");
            if (btnForWard) {
                const onclick = btnForWard.getAttribute("onclick") || "";
                const m = onclick.match(/[?&]ward_id=(\d+)/);
                if (m) {
                    wardId = parseIntSafe(m[1]);
                }
            }
            if (wardId === null && tds.length >= 2) {
                const wardText = cleanText(tds[1].textContent);
                const m = wardText.match(/(\d+)/);
                if (m) {
                    wardId = parseIntSafe(m[1]);
                }
            }

            // Prefer ps_id from onclick (more reliable), fallback to "P.S. No." cell.
            let psId = null;
            const btn = tr.querySelector("input[onclick*=\"ps_id=\"]");
            if (btn) {
                const onclick = btn.getAttribute("onclick") || "";
                const m = onclick.match(/[?&]ps_id=(\d+)/);
                if (m) {
                    psId = parseIntSafe(m[1]);
                }
            }
            if (psId === null) {
                psId = parseIntSafe(cleanText(tds[2].textContent));
            }
            if (psId === null) {
                continue;
            }

            out.push({
                district_id: meta.districtId,
                district_name: meta.districtName,
                municipality_id: meta.mncId,
                "M & C name": meta.mncName,
                praja_circle_id: prajaCircleId,
                ward_id: wardId,
                ps_id: psId,
            });
        }

        return out;
    }

    function downloadJson(data, filenameBase) {
        const json = `${JSON.stringify(data, null, 2)}\n`;
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filenameBase}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function yyyymmdd() {
        const d = new Date();
        const yyyy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}${mm}${dd}`;
    }

    function addUi() {
        const existing = document.getElementById("tm-praja-circle-ulb-panel");
        if (existing) {
            existing.remove();
        }

        const panel = document.createElement("div");
        panel.id = "tm-praja-circle-ulb-panel";
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
        panel.style.minWidth = "280px";

        const title = document.createElement("div");
        title.textContent = "Praja Circle ULB PS Mapper";
        title.style.fontWeight = "700";
        title.style.marginBottom = "8px";

        const status = document.createElement("div");
        status.textContent = "Ready";
        status.style.opacity = "0.9";
        status.style.marginBottom = "10px";

        const btn = document.createElement("button");
        btn.textContent = "Extract JSON";
        btn.style.width = "100%";
        btn.style.border = "0";
        btn.style.borderRadius = "8px";
        btn.style.padding = "10px 12px";
        btn.style.cursor = "pointer";
        btn.style.background = "#10b981";
        btn.style.color = "#06281e";
        btn.style.fontWeight = "700";

        btn.addEventListener("click", () => {
            try {
                const raw = prompt("Enter praja_circle_id (integer):");
                if (raw === null) {
                    return;
                }
                const prajaCircleId = parseIntSafe(raw);
                if (prajaCircleId === null) {
                    alert("Invalid praja_circle_id. Please enter an integer.");
                    return;
                }

                status.textContent = "Extracting…";
                const rows = extractRows(prajaCircleId);
                if (rows.length === 0) {
                    status.textContent = "No rows found";
                    alert("No PS rows found in #GridView1.");
                    return;
                }

                const meta = extractMeta();
                const base = [
                    "praja-circle-ulb-ps",
                    meta.districtId !== null ? `district-${meta.districtId}` : null,
                    meta.mncId !== null ? `mnc-${meta.mncId}` : null,
                    `praja-${prajaCircleId}`,
                    yyyymmdd(),
                ]
                    .filter(Boolean)
                    .join("-");

                downloadJson(rows, base);
                status.textContent = `Done (${rows.length} rows)`;
                console.log("[Praja Circle ULB PS Mapper] Rows:", rows);
            } catch (e) {
                console.error("[Praja Circle ULB PS Mapper] Error:", e);
                status.textContent = "Failed (see console)";
                alert(`Extraction failed: ${e && e.message ? e.message : String(e)}`);
            }
        });

        panel.appendChild(title);
        panel.appendChild(status);
        panel.appendChild(btn);
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

