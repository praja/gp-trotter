// ==UserScript==
// @name         ULB Contestants Extractor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Extracts ULB ward contestants and uploads JSON array to API.
// @author       Cursor Agent
// @match        https://tsec.gov.in/knowPRUrban.se*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    "use strict";

    const TARGET_URL = "https://tsec.gov.in/knowPRUrban.se";
    // const UPLOAD_URL = "https://api.thecircleapp.in/web-app/gp-trotter/municipality-aslkdjfh";
    const UPLOAD_URL = "https://api.thecircleapp.in/web-app/gp-trotter/municipality-elections/ward-contestants/ingest";
    const BUTTON_ID = "tm-ulb-contestants-btn";

    if (!window.location.href.startsWith(TARGET_URL)) {
        return;
    }

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

    function parseWardHeader(text) {
        const wardMatch = text.match(/WARD\s*Name\s*:\s*([0-9]+)/i);
        const reservationMatch = text.match(/Reserved\s*for\s*:\s*([^,]+)/i);
        return {
            wardNo: wardMatch ? parseIntSafe(wardMatch[1]) : null,
            reservation: reservationMatch ? cleanText(reservationMatch[1]) : ""
        };
    }

    function extractContestants() {
        const table = document.querySelector("#GridView1");
        if (!table) {
            throw new Error("Could not find table #GridView1.");
        }

        const rows = Array.from(table.querySelectorAll("tr"));
        const out = [];
        let currentWardNo = null;
        let currentReservation = "";

        for (const row of rows) {
            const ths = row.querySelectorAll("th");
            if (ths.length > 0) {
                continue;
            }

            const tds = Array.from(row.querySelectorAll("td"));
            if (tds.length === 0) {
                continue;
            }

            if (tds.length === 1 && tds[0].getAttribute("colspan")) {
                const headerText = cleanText(tds[0].textContent);
                const parsed = parseWardHeader(headerText);
                if (parsed.wardNo !== null) {
                    currentWardNo = parsed.wardNo;
                }
                if (parsed.reservation) {
                    currentReservation = parsed.reservation;
                }
                continue;
            }

            if (tds.length < 3) {
                continue;
            }

            const name = cleanText(tds[1].textContent);
            const party = cleanText(tds[2].textContent);

            if (!name) {
                continue;
            }

            out.push({
                name: name,
                ward_no: currentWardNo,
                reservation: currentReservation,
                party_affiliation: party
            });
        }

        return out;
    }

    function uploadData(payload) {
        return new Promise((resolve, reject) => {
            const jsonPayload = JSON.stringify(payload, null, 2);
            console.log("Uploading contestants payload:", jsonPayload);

            GM_xmlhttpRequest({
                method: "POST",
                url: UPLOAD_URL,
                data: jsonPayload,
                headers: {
                    "Content-Type": "application/json"
                },
                onload: function (response) {
                    if (response.status >= 200 && response.status < 300) {
                        console.log("Upload response:", response.responseText);
                        resolve(response);
                        return;
                    }
                    const err = new Error(`Upload failed with status ${response.status}`);
                    err.status = response.status;
                    err.responseText = response.responseText;
                    reject(err);
                },
                onerror: function (error) {
                    console.error("Upload error:", error);
                    reject(error);
                }
            });
        });
    }

    function addButton() {
        const existing = document.getElementById(BUTTON_ID);
        if (existing) {
            existing.remove();
        }

        const btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.textContent = "Extract ULB Contestants";
        btn.style.position = "fixed";
        btn.style.top = "20px";
        btn.style.right = "20px";
        btn.style.zIndex = "10000";
        btn.style.padding = "12px 16px";
        btn.style.backgroundColor = "#2563eb";
        btn.style.color = "#ffffff";
        btn.style.border = "0";
        btn.style.borderRadius = "6px";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "14px";
        btn.style.boxShadow = "0 6px 12px rgba(0,0,0,0.15)";

        btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.style.opacity = "0.7";
            try {
                const rawVillageId = prompt("Enter village_id for this municipality (integer):");
                if (rawVillageId === null) {
                    return;
                }
                const villageId = parseIntSafe(rawVillageId);
                if (villageId === null) {
                    alert("Invalid village_id. Please enter an integer.");
                    return;
                }

                const data = extractContestants();
                if (data.length === 0) {
                    alert("No contestants found in the table.");
                    return;
                }

                const payload = data.map((row) => ({
                    ...row,
                    village_id: villageId
                }));

                await uploadData(payload);
                alert(`Uploaded ${payload.length} contestants successfully.`);
            } catch (err) {
                console.error("Extraction failed:", err);
                const msg = err && err.message ? err.message : String(err);
                const statusInfo = err && err.status ? ` (status ${err.status})` : "";
                alert(`Extraction/upload failed${statusInfo}: ${msg}`);
            } finally {
                btn.disabled = false;
                btn.style.opacity = "1";
            }
        });

        document.body.appendChild(btn);
    }

    if (document.readyState === "loading") {
        window.addEventListener("load", () => setTimeout(addButton, 500));
    } else {
        setTimeout(addButton, 500);
    }
})();

