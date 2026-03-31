let stores = [];
let events = [];
let registrations = {};  // keyed by state
let loadedStates = new Set();
let excludedStores = new Set();

const storeMap = {};  // id -> store

// --- Data Loading ---

async function loadJSON(path) {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
    return resp.json();
}

async function init() {
    try {
        const [storesData, eventsData, meta] = await Promise.all([
            loadJSON("data/stores.json"),
            loadJSON("data/events.json"),
            loadJSON("data/meta.json"),
        ]);
        stores = storesData;
        events = eventsData;

        stores.forEach(s => storeMap[s.id] = s);

        document.getElementById("last-updated").textContent =
            `Last updated: ${new Date(meta.last_fetch).toLocaleDateString("en-AU", { dateStyle: "medium" })}`;

        populateFilters();
        applyFilters();
    } catch (e) {
        document.getElementById("last-updated").textContent = "Error loading data. Run the fetch script first.";
        console.error(e);
    }
}

async function loadRegistrations(state) {
    if (loadedStates.has(state)) return;
    try {
        const data = await loadJSON(`data/registrations/${state}.json`);
        registrations[state] = data;
        loadedStates.add(state);
    } catch {
        registrations[state] = [];
        loadedStates.add(state);
    }
}

async function loadAllRegistrations() {
    const states = [...new Set(stores.map(s => s.state))].filter(Boolean);
    await Promise.all(states.map(s => loadRegistrations(s)));
}

// --- Filters ---

function populateFilters() {
    const stateSelect = document.getElementById("filter-state");
    const states = [...new Set(stores.map(s => s.state))].filter(Boolean).sort();
    states.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st;
        opt.textContent = st;
        stateSelect.appendChild(opt);
    });

    updateStoreDropdown();
}

function updateStoreDropdown() {
    const stateVal = document.getElementById("filter-state").value;
    const storeSelect = document.getElementById("filter-store");
    storeSelect.innerHTML = '<option value="">All</option>';

    let filtered = stores;
    if (stateVal) filtered = stores.filter(s => s.state === stateVal);

    // Only show stores that have events
    const storeIdsWithEvents = new Set(events.map(e => e.store_id));
    filtered = filtered.filter(s => storeIdsWithEvents.has(s.id));
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    filtered.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        storeSelect.appendChild(opt);
    });
}

function getFilteredEvents() {
    const state = document.getElementById("filter-state").value;
    const storeId = document.getElementById("filter-store").value;
    const category = document.getElementById("filter-category").value;
    const status = document.getElementById("filter-status").value;
    const from = document.getElementById("filter-from").value;
    const to = document.getElementById("filter-to").value;

    return events.filter(e => {
        const store = storeMap[e.store_id];
        if (!store) return false;
        if (state && store.state !== state) return false;
        if (storeId && e.store_id !== Number(storeId)) return false;
        if (category && e.category !== category) return false;
        if (status === "finished" && e.event_status !== "EVENT_FINISHED") return false;
        if (status === "scheduled" && e.event_status === "EVENT_FINISHED") return false;
        if (from && e.start_datetime < from) return false;
        if (to && e.start_datetime > to + "T23:59:59") return false;
        return true;
    });
}

function getFilteredEventsExcluded() {
    return getFilteredEvents().filter(e => !excludedStores.has(e.store_id));
}

async function applyFilters() {
    const state = document.getElementById("filter-state").value;
    if (state) {
        await loadRegistrations(state);
    } else {
        await loadAllRegistrations();
    }

    const allFiltered = getFilteredEvents();
    const included = getFilteredEventsExcluded();
    updateSummary(included, state);
    updateStoreTable(allFiltered, state);
    updateEventsTable(included);
    updateCharts(included);
}

// --- Summary Cards ---

function updateSummary(filtered, state) {
    // Exclude events with 0 attendance from summaries — stores that
    // don't record players through PlayHub would skew the numbers
    const withData = filtered.filter(e => e.starting_player_count > 0);

    document.getElementById("total-events").textContent = withData.length;

    const totalAtt = withData.reduce((sum, e) => sum + e.starting_player_count, 0);
    const avg = withData.length ? (totalAtt / withData.length).toFixed(1) : "—";
    document.getElementById("avg-attendance").textContent = avg;

    const eventIds = new Set(withData.map(e => e.id));
    const allRegs = state ? (registrations[state] || []) : Object.values(registrations).flat();
    const playerIds = new Set(
        allRegs
            .filter(r => eventIds.has(r.event_id))
            .map(r => r.user_id)
    );
    document.getElementById("unique-players").textContent = playerIds.size;

    const activeStores = new Set(withData.map(e => e.store_id));
    document.getElementById("total-stores").textContent = activeStores.size;
}

// --- Store Summary Table ---

function updateStoreTable(filtered, state) {
    // Only count events with actual attendance data
    const withData = filtered.filter(e => e.starting_player_count > 0);
    const byStore = {};

    withData.forEach(e => {
        if (!byStore[e.store_id]) {
            byStore[e.store_id] = { events: [], totalAtt: 0 };
        }
        byStore[e.store_id].events.push(e);
        byStore[e.store_id].totalAtt += e.starting_player_count;
    });

    // Get unique players per store from registrations
    const eventIdsByStore = {};
    withData.forEach(e => {
        if (!eventIdsByStore[e.store_id]) eventIdsByStore[e.store_id] = new Set();
        eventIdsByStore[e.store_id].add(e.id);
    });
    const playersByStore = {};
    const allRegs = state ? (registrations[state] || []) : Object.values(registrations).flat();
    if (allRegs.length) {
        allRegs.forEach(r => {
            for (const [storeId, eventIds] of Object.entries(eventIdsByStore)) {
                if (eventIds.has(r.event_id)) {
                    if (!playersByStore[storeId]) playersByStore[storeId] = new Set();
                    playersByStore[storeId].add(r.user_id);
                    break;
                }
            }
        });
    }

    const rows = Object.entries(byStore).map(([storeId, data]) => {
        const store = storeMap[Number(storeId)] || {};
        const avgAtt = data.events.length ? (data.totalAtt / data.events.length).toFixed(1) : 0;
        const dates = data.events.map(e => e.start_datetime).sort();
        const lastEvent = dates[dates.length - 1];
        const uniquePlayers = playersByStore[storeId]?.size || "—";
        return {
            storeId: Number(storeId),
            name: store.name || "Unknown",
            state: store.state || "",
            events: data.events.length,
            avg: parseFloat(avgAtt),
            players: uniquePlayers,
            last: lastEvent ? lastEvent.slice(0, 10) : "",
        };
    });

    rows.sort((a, b) => b.events - a.events);
    window._storeRows = rows;

    renderStoreRows(rows);
}

// --- Events Table ---

function updateEventsTable(filtered) {
    const sorted = [...filtered].sort((a, b) =>
        (b.start_datetime || "").localeCompare(a.start_datetime || "")
    );

    window._eventRows = sorted;

    const tbody = document.querySelector("#events-table tbody");
    tbody.innerHTML = sorted.map(e => {
        const store = storeMap[e.store_id] || {};
        const date = e.start_datetime ? e.start_datetime.slice(0, 10) : "";
        const tagClass = e.category === "championship" ? "tag-championship" : "tag-league";
        return `
            <tr>
                <td>${date}</td>
                <td>${esc(store.name || "Unknown")}</td>
                <td>${esc(e.name)}</td>
                <td><span class="tag ${tagClass}">${e.category}</span></td>
                <td class="num">${e.registered_user_count}</td>
                <td class="num">${e.starting_player_count}</td>
            </tr>
        `;
    }).join("");
}

// --- Sorting ---

function setupSorting() {
    document.querySelectorAll("th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
            const table = th.closest("table");
            const key = th.dataset.sort;
            const isDesc = th.classList.contains("sorted-asc");

            table.querySelectorAll("th").forEach(t => t.classList.remove("sorted-asc", "sorted-desc"));
            th.classList.add(isDesc ? "sorted-desc" : "sorted-asc");

            if (table.id === "store-table" && window._storeRows) {
                sortAndRender(window._storeRows, key, isDesc, renderStoreRows);
            } else if (table.id === "events-table" && window._eventRows) {
                sortAndRender(window._eventRows, key, isDesc, renderEventRows);
            }
        });
    });
}

function sortAndRender(rows, key, desc, renderFn) {
    rows.sort((a, b) => {
        let va = getVal(a, key);
        let vb = getVal(b, key);
        if (typeof va === "string") va = va.toLowerCase();
        if (typeof vb === "string") vb = vb.toLowerCase();
        if (va < vb) return desc ? 1 : -1;
        if (va > vb) return desc ? -1 : 1;
        return 0;
    });
    renderFn(rows);
}

function getVal(row, key) {
    // Map sort keys to row properties
    const map = {
        date: "start_datetime", store: "store_id",
        registered: "registered_user_count", attended: "starting_player_count",
    };
    const prop = map[key] || key;
    const val = row[prop];
    if (val === "—") return -1;
    return val ?? "";
}

function renderStoreRows(rows) {
    const tbody = document.querySelector("#store-table tbody");
    tbody.innerHTML = rows.map(r => {
        const checked = !excludedStores.has(r.storeId) ? "checked" : "";
        return `
        <tr class="${excludedStores.has(r.storeId) ? "excluded" : ""}">
            <td class="check-col"><input type="checkbox" data-store-id="${r.storeId}" ${checked}></td>
            <td>${esc(r.name)}</td>
            <td>${esc(r.state)}</td>
            <td class="num">${r.events}</td>
            <td class="num">${r.avg}</td>
            <td class="num">${r.players}</td>
            <td>${r.last}</td>
        </tr>
        `;
    }).join("");

    // Attach checkbox listeners
    tbody.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", () => {
            const id = Number(cb.dataset.storeId);
            if (cb.checked) {
                excludedStores.delete(id);
            } else {
                excludedStores.add(id);
            }
            cb.closest("tr").classList.toggle("excluded", !cb.checked);
            // Re-run summary, events, and charts without rebuilding store table
            const state = document.getElementById("filter-state").value;
            const included = getFilteredEventsExcluded();
            updateSummary(included, state);
            updateEventsTable(included);
            updateCharts(included);
        });
    });
}

function renderEventRows(rows) {
    document.querySelector("#events-table tbody").innerHTML = rows.map(e => {
        const store = storeMap[e.store_id] || {};
        const date = e.start_datetime ? e.start_datetime.slice(0, 10) : "";
        const tagClass = e.category === "championship" ? "tag-championship" : "tag-league";
        return `
            <tr>
                <td>${date}</td>
                <td>${esc(store.name || "Unknown")}</td>
                <td>${esc(e.name)}</td>
                <td><span class="tag ${tagClass}">${e.category}</span></td>
                <td class="num">${e.registered_user_count}</td>
                <td class="num">${e.starting_player_count}</td>
            </tr>
        `;
    }).join("");
}

// --- Charts ---

let chartAttendance = null;
let chartStores = null;
let chartCategory = null;

const CHART_COLORS = {
    blue: "rgba(45, 45, 107, 0.85)",
    purple: "rgba(109, 76, 161, 0.85)",
    lightBlue: "rgba(74, 134, 232, 0.85)",
    lightPurple: "rgba(155, 120, 200, 0.85)",
    blueFill: "rgba(74, 134, 232, 0.15)",
    barColors: [
        "#2d2d6b","#4a86e8","#6d4ca1","#3b7dd8","#9b78c8",
        "#2563eb","#7c3aed","#4f8fea","#6b4fa0","#5b9fe8",
        "#8b5cf6","#3d5afe","#7e57c2","#448aff","#651fff",
    ],
};

function getISOWeekKey(dateStr) {
    const d = new Date(dateStr);
    // Adjust to Monday-based ISO week
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    const year = d.getUTCFullYear();
    return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

function updateCharts(filtered) {
    const withData = filtered.filter(e => e.starting_player_count > 0);
    updateAttendanceChart(withData);
    updateStoreBarChart(withData);
    updateCategoryChart(withData);
}

function updateAttendanceChart(withData) {
    const weekMap = {};
    withData.forEach(e => {
        const week = getISOWeekKey(e.start_datetime);
        weekMap[week] = (weekMap[week] || 0) + e.starting_player_count;
    });
    const weeks = Object.keys(weekMap).sort();
    const values = weeks.map(w => weekMap[w]);

    const ctx = document.getElementById("chart-attendance").getContext("2d");
    if (chartAttendance) chartAttendance.destroy();
    chartAttendance = new Chart(ctx, {
        type: "line",
        data: {
            labels: weeks,
            datasets: [{
                label: "Total Attendance",
                data: values,
                borderColor: CHART_COLORS.blue,
                backgroundColor: CHART_COLORS.blueFill,
                fill: true,
                tension: 0.3,
                pointRadius: weeks.length > 30 ? 1 : 3,
                pointHoverRadius: 5,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    title: { display: true, text: "Week", font: { size: 11 } },
                    ticks: { maxRotation: 45, font: { size: 10 }, maxTicksLimit: 20 },
                },
                y: {
                    title: { display: true, text: "Attendance", font: { size: 11 } },
                    beginAtZero: true,
                },
            },
        },
    });
}

function updateStoreBarChart(withData) {
    const storeAtt = {};
    withData.forEach(e => {
        const name = (storeMap[e.store_id] || {}).name || "Unknown";
        storeAtt[name] = (storeAtt[name] || 0) + e.starting_player_count;
    });
    const sorted = Object.entries(storeAtt)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);
    const colors = labels.map((_, i) => CHART_COLORS.barColors[i % CHART_COLORS.barColors.length]);

    const ctx = document.getElementById("chart-stores").getContext("2d");
    if (chartStores) chartStores.destroy();
    chartStores = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Total Attendance",
                data: values,
                backgroundColor: colors,
                borderRadius: 3,
            }],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: "Total Attendance", font: { size: 11 } },
                },
                y: {
                    ticks: { font: { size: 10 } },
                },
            },
        },
    });
}

function updateCategoryChart(withData) {
    let league = 0, championship = 0;
    withData.forEach(e => {
        if (e.category === "championship") championship++;
        else league++;
    });

    const ctx = document.getElementById("chart-category").getContext("2d");
    if (chartCategory) chartCategory.destroy();
    chartCategory = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["League", "Championship"],
            datasets: [{
                data: [league, championship],
                backgroundColor: [CHART_COLORS.lightBlue, CHART_COLORS.purple],
                borderWidth: 1,
                borderColor: "#fff",
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { font: { size: 11 }, padding: 12 },
                },
            },
        },
    });
}

// --- CSV Export ---

function downloadCSV(filename, headers, rows) {
    const csvRows = [headers.join(",")];
    rows.forEach(r => {
        csvRows.push(r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function setupCSV() {
    document.getElementById("download-stores-csv").addEventListener("click", () => {
        const rows = (window._storeRows || []).map(r =>
            [r.name, r.state, r.events, r.avg, r.players, r.last]
        );
        downloadCSV("store_summary.csv", ["Store", "State", "Events", "Avg Attendance", "Unique Players", "Last Event"], rows);
    });

    document.getElementById("download-events-csv").addEventListener("click", () => {
        const rows = (window._eventRows || []).map(e => {
            const store = storeMap[e.store_id] || {};
            return [
                e.start_datetime ? e.start_datetime.slice(0, 10) : "",
                store.name || "",
                e.name,
                e.category,
                e.registered_user_count,
                e.starting_player_count,
            ];
        });
        downloadCSV("events.csv", ["Date", "Store", "Event", "Type", "Registered", "Attended"], rows);
    });
}

// --- Utils ---

function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

// --- Event Listeners ---

document.getElementById("filter-state").addEventListener("change", () => {
    excludedStores.clear();
    document.getElementById("store-select-all").checked = true;
    updateStoreDropdown();
    applyFilters();
});
["filter-store", "filter-category", "filter-status", "filter-from", "filter-to"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFilters);
});

document.getElementById("store-select-all").addEventListener("change", (e) => {
    const checked = e.target.checked;
    if (checked) {
        excludedStores.clear();
    } else {
        (window._storeRows || []).forEach(r => excludedStores.add(r.storeId));
    }
    document.querySelectorAll("#store-table tbody input[type=checkbox]").forEach(cb => {
        cb.checked = checked;
        cb.closest("tr").classList.toggle("excluded", !checked);
    });
    const state = document.getElementById("filter-state").value;
    const included = getFilteredEventsExcluded();
    updateSummary(included, state);
    updateEventsTable(included);
    updateCharts(included);
});

setupSorting();
setupCSV();
init();
