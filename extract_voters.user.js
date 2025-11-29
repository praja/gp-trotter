// ==UserScript==
// @name         Voter Data Extractor
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Extracts voter data from the second table in #printArea, prints to console, and uploads to a dummy endpoint with a village ID.
// @author       Cursor Agent
// @match        https://finalgprolls.tsec.gov.in/gpwardvoterselec1.do
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // Configuration
    const UPLOAD_URL = 'https://nonvindicable-semipractical-jadiel.ngrok-free.dev/web-app/voters/ingest';

    function extractAndUpload() {
        // Prompt for Village ID
        const villageIdStr = prompt("Please enter the Village ID (Integer):");
        if (!villageIdStr) {
            return; // User cancelled
        }

        const villageId = parseInt(villageIdStr, 10);
        if (isNaN(villageId)) {
            alert("Invalid Village ID. Please enter a valid integer.");
            return;
        }

        console.log(`Starting extraction for Village ID: ${villageId}...`);

        // 0. Detect Language
        let language = 'en';
        const pageText = document.body.innerText;
        if (pageText.includes('గ్రామ పంచాయితి') || pageText.includes('సాధారణ ఎన్నికలు')) {
            language = 'te';
        }
        console.log(`Detected Language: ${language}`);

        // 1. Extract Ward Number
        let wardNo = "";
        const wardTds = document.querySelectorAll('#printArea td');
        for (let i = 0; i < wardTds.length; i++) {
            const text = wardTds[i].innerText.trim();
            // Check for "Ward No." in English or Telugu ("వార్డు నె౦బరు")
            if (text === 'Ward No.' || text.includes('వార్డు నె౦బరు')) {
                const nextTd = wardTds[i].nextElementSibling;
                if (nextTd) {
                    // Value is like ":Ward -1" or ":1"
                    let val = nextTd.innerText.replace(/^:?\s*/, '').trim();
                    // Remove "Ward -" prefix if present (English)
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

        // Strategy: Target the specific summary table structure directly.
        const mainTable = document.querySelector('#printArea table');
        if (mainTable) {
            const summaryRows = mainTable.querySelectorAll('tr');
            for (let i = 0; i < summaryRows.length; i++) {
                const rowText = summaryRows[i].innerText;
                // Check for "Total Voters Details" in English or "మొత్తం ఓటర్ల వివరాలు" in Telugu
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
        const voterTables = document.querySelectorAll('#printArea table.bl.bb.br.bt');

        if (voterTables.length === 0) {
            console.error("No voter tables found. Please check the selector.");
            alert("No voter tables found!");
            return;
        }

        const voters = [];

        voterTables.forEach((table, index) => {
            const voter = {};
            const rows = table.querySelectorAll('tr');

            if (rows.length < 6) {
                console.warn(`Skipping table ${index}: insufficient rows.`);
                return;
            }

            try {
                // --- Row 1: Serial No, AC No, PS No, SLNo ---
                const serialCell = rows[0].querySelector('td:nth-child(1)');
                if (serialCell) voter.serial_no = serialCell.innerText.trim();

                // Cell 2: AC, PS, SL Details
                // English: A.C No.:-<b>116</b> PS No.: -<b>60</b> SLNo.: -<b>1</b>
                // Telugu: ఎ.సి -పి.ఎస్ - వరుస సంఖ్య. : <b>116</b> - <b>60</b> - <b> 1</b>
                const detailsCell = rows[0].querySelector('td:nth-child(2)');
                if (detailsCell) {
                    // Use a more generic regex to capture numbers
                    // We expect 3 numbers in the text
                    const text = detailsCell.innerText;
                    const numbers = text.match(/(\d+)/g);

                    if (numbers && numbers.length >= 3) {
                        voter.ac_no = numbers[0];
                        voter.ps_no = numbers[1];
                        voter.sl_no = numbers[2];
                    }
                }

                // --- Row 2: Name ---
                const nameCell = rows[1].querySelector('td:nth-child(2) b');
                if (nameCell) voter.name = nameCell.innerText.replace(/^:\s*/, '').trim();

                // --- Row 3: Relation ---
                // Type is in the first cell (Father/Husband Name), Name is in the second cell
                const relTypeCell = rows[2].querySelector('td:nth-child(1)');
                const relNameCell = rows[2].querySelector('td:nth-child(2) b');
                if (relTypeCell) voter.relation_type = relTypeCell.innerText.trim();
                if (relNameCell) voter.relation_name = relNameCell.innerText.replace(/^:\s*/, '').trim();

                // --- Row 4: Age & Sex ---
                // English: Age : 24 Sex : F
                // Telugu: వయస్సు : 24 లింగము : F
                // The structure is typically label: value label: value. 
                // We can just find the numbers for age and M/F for sex.
                const ageSexCell = rows[3].querySelector('td:nth-child(2)'); // This selector might be tricky across langs if structure differs slightly
                // In Telugu HTML provided:
                // Row 4 (index 3) contains a nested table for Age/Sex
                // <table width="100%" ...> ... <td>Age/వయస్సు</td> <td>:24</td> ... </table>

                // Let's try to find the bold elements inside row 3 (which is the 4th row)
                // Actually, in the Telugu HTML, the Age/Sex row contains a nested table.
                // In English HTML, it is a direct TD.
                // However, we can just look for bold tags within this row generally.

                // Generic strategy for Age/Sex row:
                // Find the cell containing the values.
                // In English: `<td>:24 &nbsp; Sex : :F</td>` (approx)
                // In Telugu: It uses a nested table, but values are in bold tags.

                // Let's look for all bold tags in this row and infer.
                const bTags = rows[3].querySelectorAll('b');
                // Usually first bold is Age, second is Sex (if nested table)
                // Or just parse the text of the row.

                const row4Text = rows[3].innerText;
                const ageMatch = row4Text.match(/(\d+)/); // First number is likely age
                // Sex is M or F (or Telugu equivalent? Usually data is M/F even in Telugu forms)
                // In Telugu HTML: <td><b>:M</b></td>
                const sexMatch = row4Text.match(/\b([MF])\b/i) || row4Text.match(/:([MF])/i);

                if (ageMatch) voter.age = ageMatch[1];
                if (sexMatch) voter.sex = sexMatch[1];


                // --- Row 5: Door No ---
                // English: Door No. : 0000
                // Telugu: ఇ.నెం. : 0000
                const doorCell = rows[4].querySelector('td:nth-child(2) b');
                if (doorCell) voter.door_no = doorCell.innerText.replace(/^:\s*/, '').trim();

                // --- Row 6: EPIC No ---
                // Use the last row of the table to be safe, or check for specific text
                const epicRow = rows[rows.length - 1]; // Usually the last row
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

        // Construct Payload
        const payload = {
            village_id: villageId,
            ward_no: wardNo,
            language: language,
            total_men: menCount,
            total_women: womenCount,
            total_other: otherCount,
            total_votes: totalCount,
            voters: voters
        };

        // Print to console
        console.log("Extracted Data:", payload);
        const jsonPayload = JSON.stringify(payload, null, 2);
        console.log(jsonPayload);

        // Upload to Endpoint
        console.log(`Uploading to ${UPLOAD_URL}...`);
        GM_xmlhttpRequest({
            method: "POST",
            url: UPLOAD_URL,
            data: jsonPayload,
            headers: {
                "Content-Type": "application/json"
            },
            onload: function (response) {
                console.log("Upload Response:", response.responseText);
                alert(`Data extracted (${voters.length} records) and uploaded successfully for Village ID ${villageId}!`);
            },
            onerror: function (error) {
                console.error("Upload Error:", error);
                alert("Upload failed. Check console for details.");
            }
        });
    }

    // Add a floating button to trigger extraction
    function addTriggerButton() {
        const btn = document.createElement('button');
        btn.innerText = "Extract & Upload Data";
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

        btn.addEventListener('click', extractAndUpload);

        document.body.appendChild(btn);
    }

    // Wait a moment for page to fully render before adding button (optional)
    window.addEventListener('load', () => {
        setTimeout(addTriggerButton, 1000);
    });
})();
