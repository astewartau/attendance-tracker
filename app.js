let stores = [];
let events = [];
let registrations = {};  // keyed by state
let loadedStates = new Set();

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
    if (!state || loadedStates.has(state)) return;
    try {
        const data = await loadJSON(`data/registrations/${state}.json`);
        registrations[state] = data;
        loadedStates.add(state);
    } catch {
        registrations[state] = [];
        loadedStates.add(state);
    }
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
    const from = document.getElementById("filter-from").value;
    const to = document.getElementById("filter-to").value;

    return events.filter(e => {
        const store = storeMap[e.store_id];
        if (!store) return false;
        if (state && store.state !== state) return false;
        if (storeId && e.store_id !== Number(storeId)) return false;
        if (category && e.category !== category) return false;
        if (from && e.start_datetime < from) return false;
        if (to && e.start_datetime > to + "T23:59:59") return false;
        return true;
    });
}

async function applyFilters() {
    const state = document.getElementById("filter-state").value;
    if (state) await loadRegistrations(state);

    const filtered = getFilteredEvents();
    updateSummary(filtered, state);
    updateStoreTable(filtered, state);
    updateEventsTable(filtered);
}

// --- Summary Cards ---

function updateSummary(filtered, state) {
    const finishedEvents = filtered.filter(e => e.event_status === "EVENT_FINISHED");

    document.getElementById("total-events").textContent = finishedEvents.length;

    const totalAtt = finishedEvents.reduce((sum, e) => sum + (e.starting_player_count || 0), 0);
    const avg = finishedEvents.length ? (totalAtt / finishedEvents.length).toFixed(1) : "—";
    document.getElementById("avg-attendance").textContent = avg;

    // Unique players from registrations
    const storeIds = new Set(filtered.map(e => e.store_id));
    const eventIds = new Set(finishedEvents.map(e => e.id));
    let uniquePlayers = "—";
    if (state && registrations[state]) {
        const playerIds = new Set(
            registrations[state]
                .filter(r => eventIds.has(r.event_id))
                .map(r => r.user_id)
        );
        uniquePlayers = playerIds.size;
    }
    document.getElementById("unique-players").textContent = uniquePlayers;

    const activeStores = new Set(finishedEvents.map(e => e.store_id));
    document.getElementById("total-stores").textContent = activeStores.size;
}

// --- Store Summary Table ---

function updateStoreTable(filtered, state) {
    const finishedEvents = filtered.filter(e => e.event_status === "EVENT_FINISHED");
    const byStore = {};

    finishedEvents.forEach(e => {
        if (!byStore[e.store_id]) {
            byStore[e.store_id] = { events: [], totalAtt: 0 };
        }
        byStore[e.store_id].events.push(e);
        byStore[e.store_id].totalAtt += e.starting_player_count || 0;
    });

    // Get unique players per store from registrations
    const playersByStore = {};
    if (state && registrations[state]) {
        registrations[state].forEach(r => {
            const event = finishedEvents.find(e => e.id === r.event_id);
            if (event) {
                if (!playersByStore[event.store_id]) playersByStore[event.store_id] = new Set();
                playersByStore[event.store_id].add(r.user_id);
            }
        });
    }

    const rows = Object.entries(byStore).map(([storeId, data]) => {
        const store = storeMap[Number(storeId)] || {};
        const avgAtt = data.events.length ? (data.totalAtt / data.events.length).toFixed(1) : 0;
        const dates = data.events.map(e => e.start_datetime).sort();
        const lastEvent = dates[dates.length - 1];
        const uniquePlayers = playersByStore[Number(storeId)]?.size || "—";
        return {
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

    const tbody = document.querySelector("#store-table tbody");
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${esc(r.name)}</td>
            <td>${esc(r.state)}</td>
            <td class="num">${r.events}</td>
            <td class="num">${r.avg}</td>
            <td class="num">${r.players}</td>
            <td>${r.last}</td>
        </tr>
    `).join("");
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
    document.querySelector("#store-table tbody").innerHTML = rows.map(r => `
        <tr>
            <td>${esc(r.name)}</td>
            <td>${esc(r.state)}</td>
            <td class="num">${r.events}</td>
            <td class="num">${r.avg}</td>
            <td class="num">${r.players}</td>
            <td>${r.last}</td>
        </tr>
    `).join("");
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
    updateStoreDropdown();
    applyFilters();
});
["filter-store", "filter-category", "filter-from", "filter-to"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFilters);
});

setupSorting();
setupCSV();
init();
