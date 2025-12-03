// ==UserScript==
// @name         Voter Data Extractor
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Extracts voter data from village page, navigates through all wards, and uploads to API with village ID.
// @author       Cursor Agent
// @match        https://finalgprolls.tsec.gov.in/gpwardwisevoterlistrural1.do
// @match        https://finalgprolls.tsec.gov.in/gpwardvoterselec1.do
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // Configuration
    const UPLOAD_URL = 'http://localhost:3000/web-app/gp-trotter/ingest';
    const VILLAGE_ID_KEY = 'voter_extractor_village_id';

    // Check if we're on the village page or ward page
    const isVillagePage = window.location.href.includes('gpwardwisevoterlistrural1.do');
    const isWardPage = window.location.href.includes('gpwardvoterselec1.do');

    // Function to extract data from ward page (popup)
    function extractDataFromWardPage(doc, villageId) {
        // 0. Detect Language
        let language = 'en';
        const pageText = doc.body.innerText;
        if (pageText.includes('గ్రామ పంచాయితి') || pageText.includes('సాధారణ ఎన్నికలు')) {
            language = 'te';
        }

        // 1. Extract Ward Number
        let wardNo = "";
        const wardTds = doc.querySelectorAll('#printArea td');
        for (let i = 0; i < wardTds.length; i++) {
            const text = wardTds[i].innerText.trim();
            if (text === 'Ward No.' || text.includes('వార్డు నె౦బరు')) {
                const nextTd = wardTds[i].nextElementSibling;
                if (nextTd) {
                    let val = nextTd.innerText.replace(/^:?\s*/, '').trim();
                    val = val.replace('Ward -', '').trim();
                    wardNo = parseInt(val, 10);
                    break;
                }
            }
        }

        // 2. Extract Men, Women, Other, and Total counts
        let menCount = 0;
        let womenCount = 0;
        let otherCount = 0;
        let totalCount = 0;

        const mainTable = doc.querySelector('#printArea table');
        if (mainTable) {
            const summaryRows = mainTable.querySelectorAll('tr');
            for (let i = 0; i < summaryRows.length; i++) {
                const rowText = summaryRows[i].innerText;
                if (rowText.includes('Total Voters Details') || rowText.includes('మొత్తం ఓటర్ల వివరాలు')) {
                    const cells = summaryRows[i].querySelectorAll('td');
                    if (cells.length >= 5) {
                        menCount = parseInt(cells[1].innerText.trim(), 10) || 0;
                        womenCount = parseInt(cells[2].innerText.trim(), 10) || 0;
                        otherCount = parseInt(cells[3].innerText.trim(), 10) || 0;
                        totalCount = parseInt(cells[4].innerText.trim(), 10) || 0;
                        break;
                    }
                }
            }
        }

        // 3. Extract Voters
        const voterTables = doc.querySelectorAll('#printArea table.bl.bb.br.bt');
        const voters = [];

        voterTables.forEach((table, index) => {
            const voter = {};
            const rows = table.querySelectorAll('tr');

            if (rows.length < 6) {
                console.warn(`Skipping table ${index}: insufficient rows.`);
                return;
            }

            try {
                const serialCell = rows[0].querySelector('td:nth-child(1)');
                if (serialCell) voter.serial_no = serialCell.innerText.trim();

                const detailsCell = rows[0].querySelector('td:nth-child(2)');
                if (detailsCell) {
                    const text = detailsCell.innerText;
                    const numbers = text.match(/(\d+)/g);
                    if (numbers && numbers.length >= 3) {
                        voter.ac_no = numbers[0];
                        voter.ps_no = numbers[1];
                        voter.sl_no = numbers[2];
                    }
                }

                const nameCell = rows[1].querySelector('td:nth-child(2) b');
                if (nameCell) voter.name = nameCell.innerText.replace(/^:\s*/, '').trim();

                const relTypeCell = rows[2].querySelector('td:nth-child(1)');
                const relNameCell = rows[2].querySelector('td:nth-child(2) b');
                if (relTypeCell) voter.relation_type = relTypeCell.innerText.trim();
                if (relNameCell) voter.relation_name = relNameCell.innerText.replace(/^:\s*/, '').trim();

                const row4Text = rows[3].innerText;
                const ageMatch = row4Text.match(/(\d+)/);
                const sexMatch = row4Text.match(/\b([MF])\b/i) || row4Text.match(/:([MF])/i);

                if (ageMatch) voter.age = ageMatch[1];
                if (sexMatch) voter.sex = sexMatch[1];

                const doorCell = rows[4].querySelector('td:nth-child(2) b');
                if (doorCell) voter.door_no = doorCell.innerText.replace(/^:\s*/, '').trim();

                const epicRow = rows[rows.length - 1];
                if (epicRow) {
                    const epicB = epicRow.querySelector('b');
                    if (epicB) {
                        voter.epic_no = epicB.innerText.trim();
                    }
                }

                voters.push(voter);
            } catch (err) {
                console.error(`Error extracting data for table ${index}`, err);
            }
        });

        return {
            village_id: villageId,
            ward_no: wardNo,
            language: language,
            total_men: menCount,
            total_women: womenCount,
            total_other: otherCount,
            total_votes: totalCount,
            voters: voters
        };
    }

    // Function to upload data
    function uploadData(payload) {
        return new Promise((resolve, reject) => {
            const jsonPayload = JSON.stringify(payload, null, 2);
            console.log(`Uploading ward ${payload.ward_no} data:`, jsonPayload);

            GM_xmlhttpRequest({
                method: "POST",
                url: UPLOAD_URL,
                data: jsonPayload,
                headers: {
                    "Content-Type": "application/json"
                },
                onload: function (response) {
                    console.log(`Upload Response for ward ${payload.ward_no}:`, response.responseText);
                    resolve(response);
                },
                onerror: function (error) {
                    console.error(`Upload Error for ward ${payload.ward_no}:`, error);
                    reject(error);
                }
            });
        });
    }

    // Function to fetch ward data directly (bypassing popup)
    function fetchWardData(url, params) {
        return new Promise((resolve, reject) => {
            // Construct form data string
            const formData = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                formData.append(key, value);
            }

            console.log(`Fetching data from ${url} with params:`, Object.fromEntries(formData));

            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                data: formData.toString(),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                onload: function (response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP Error ${response.status}`));
                    }
                },
                onerror: function (error) {
                    reject(error);
                }
            });
        });
    }

    // Function to process all buttons on village page
    async function processAllWards() {
        // Get village ID from storage or prompt
        let villageId = GM_getValue(VILLAGE_ID_KEY);

        if (!villageId) {
            const villageIdStr = prompt("Please enter the Village ID (Integer):");
            if (!villageIdStr) {
                return; // User cancelled
            }

            villageId = parseInt(villageIdStr, 10);
            if (isNaN(villageId)) {
                alert("Invalid Village ID. Please enter a valid integer.");
                return;
            }

            GM_setValue(VILLAGE_ID_KEY, villageId);
        } else {
            villageId = parseInt(villageId, 10);
        }

        console.log(`Starting extraction for Village ID: ${villageId}...`);

        // Find all "Electoral Rolls" buttons (both English and Telugu)
        const buttons = document.querySelectorAll('input[type="button"][value="Electoral Rolls"]');

        if (buttons.length === 0) {
            alert("No Electoral Rolls buttons found on this page!");
            return;
        }

        console.log(`Found ${buttons.length} buttons to process`);

        // Base URL for the request
        const baseUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/gpwardvoterselec1.do';

        // Process buttons sequentially
        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            console.log(`Processing button ${i + 1} of ${buttons.length}`);

            // Extract parameters from onclick attribute
            const onclickAttr = button.getAttribute('onclick');
            if (!onclickAttr) {
                console.warn(`Button ${i + 1} has no onclick attribute, skipping`);
                continue;
            }

            // Parse onclick to extract popupData parameters
            // Format: popupData('English','189','31','13','15','1')
            const match = onclickAttr.match(/popupData\(['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\)/);

            if (!match) {
                console.warn(`Could not parse onclick for button ${i + 1}: ${onclickAttr}`);
                continue;
            }

            const [, type, election_id, district_id, mandal_id, gpcode, ward_id] = match;

            // Determine mode based on type
            let mode = "";
            if (type == "English") {
                mode = "createViewInEnglishReport";
            } else if (type == "Telugu") {
                mode = "createViewInTeluguReport";
            } else if (type == "SuplEnglish") {
                mode = "createViewInEnglishSuplReport";
            } else if (type == "SuplTelugu") {
                mode = "createViewInTeluguSuplReport";
            } else if (type == "TeluguMptc") {
                mode = "showMptcWardVoters";
            }

            // Prepare parameters for POST request
            const params = {
                election_id: election_id,
                district_id: district_id,
                mandal_id: mandal_id,
                gpcode: gpcode,
                ward_id: ward_id,
                mode: mode
            };

            try {
                // Fetch data in background
                const htmlContent = await fetchWardData(baseUrl, params);

                // Parse HTML
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlContent, "text/html");

                // Extract data
                const payload = extractDataFromWardPage(doc, villageId);

                // If ward number is missing from extraction (sometimes header differs), use the one from params
                if (!payload.ward_no) {
                    payload.ward_no = parseInt(ward_id, 10);
                }

                console.log(`Extracted data from ward ${payload.ward_no}:`, payload);

                // Upload data
                await uploadData(payload);
                console.log(`Successfully processed ward ${payload.ward_no}`);

            } catch (err) {
                console.error(`Error processing ward ${ward_id}:`, err);
            }

            // Small delay to be nice to the server
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Clear village ID from storage
        GM_setValue(VILLAGE_ID_KEY, null);
        alert(`All ${buttons.length} wards processed successfully! Village ID cleared from storage.`);
    }

    // Function for ward page (original functionality)
    function extractAndUploadFromWardPage() {
        let villageId = GM_getValue(VILLAGE_ID_KEY);

        if (!villageId) {
            const villageIdStr = prompt("Please enter the Village ID (Integer):");
            if (!villageIdStr) {
                return;
            }

            villageId = parseInt(villageIdStr, 10);
            if (isNaN(villageId)) {
                alert("Invalid Village ID. Please enter a valid integer.");
                return;
            }
        } else {
            villageId = parseInt(villageId, 10);
        }

        const payload = extractDataFromWardPage(document, villageId);
        console.log("Extracted Data:", payload);

        uploadData(payload)
            .then(() => {
                alert(`Data extracted (${payload.voters.length} records) and uploaded successfully for Village ID ${villageId}!`);
                window.close();
            })
            .catch((error) => {
                alert("Upload failed. Check console for details.");
            });
    }

    // Add a floating button to trigger extraction
    function addTriggerButton() {
        // Remove existing button if any
        const existingBtn = document.getElementById("tampermonkey-extract-btn");
        if (existingBtn) {
            existingBtn.remove();
        }

        const btn = document.createElement('button');
        btn.innerText = isVillagePage ? "Extract All Wards" : "Extract & Upload Data";
        btn.id = "tampermonkey-extract-btn";
        btn.style.position = "fixed";
        btn.style.top = "20px";
        btn.style.right = "20px";
        btn.style.zIndex = "10000";
        btn.style.padding = "15px 20px";
        btn.style.backgroundColor = "#28a745";
        btn.style.color = "#fff";
        btn.style.border = "none";
        btn.style.borderRadius = "5px";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "16px";
        btn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";

        btn.addEventListener('click', () => {
            if (isVillagePage) {
                processAllWards();
            } else {
                extractAndUploadFromWardPage();
            }
        });

        document.body.appendChild(btn);
    }

    // Wait for page to load
    if (document.readyState === 'loading') {
        window.addEventListener('load', () => {
            setTimeout(addTriggerButton, 1000);
        });
    } else {
        setTimeout(addTriggerButton, 1000);
    }
})();