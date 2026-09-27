const bloodEl = document.getElementById("blood");
const cityEl = document.getElementById("city");
const locationEl = document.getElementById("location");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("count");

let allDonors = [];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function textMatches(filterValue, donorValue) {
  const filter = normalize(filterValue);
  const donor = normalize(donorValue);
  if (!filter) return true;
  if (!donor) return false;
  return donor.includes(filter);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const d = new Date(Date.UTC(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(dateValue) {
  const d = parseDate(dateValue);
  if (!d) return "N/A";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function eligibilityDate(lastDonation) {
  const d = parseDate(lastDonation);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, d.getUTCDate()));
}

function effectiveAvailable(donor) {
  if (donor.last_donation) {
    const eligible = eligibilityDate(donor.last_donation);
    if (eligible) {
      return eligible.getTime() <= today().getTime();
    }
  }
  return !!donor.available;
}

function effectiveAvailableDate(donor) {
  if (donor.last_donation) {
    return eligibilityDate(donor.last_donation);
  }
  return donor.available_from ? parseDate(donor.available_from) : null;
}

function createSupabaseClient() {
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("YOUR_PROJECT_REF")) {
    return null;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    return null;
  }
  return window.supabase.createClient(url, key);
}

function filteredDonors() {
  const blood = normalize(bloodEl?.value);
  const city = normalize(cityEl?.value);
  const location = normalize(locationEl?.value);
  const status = normalize(statusEl?.value);

  if (!city && !location) {
    return [];
  }

  return allDonors.filter((donor) => {
    const donorBlood = normalize(donor.blood_group ?? donor.blood);
    const donorCity = normalize(donor.city);
    const donorLocation = normalize(donor.location);

    if (blood && donorBlood !== blood) return false;
    if (city && donorCity !== city) return false;
    if (location && !textMatches(location, donorLocation)) return false;

    const available = effectiveAvailable(donor);
    if (status === "available" && !available) return false;
    if (status === "unavailable" && available) return false;

    return true;
  });
}

function donorCard(donor) {
  const isAvailable = effectiveAvailable(donor);
  const nextDate = effectiveAvailableDate(donor);
  const blood = donor.blood_group || donor.blood || "Unknown";
  const city = donor.city ? escapeHtml(donor.city) : "";
  const location = donor.location ? escapeHtml(donor.location) : "";
  const fullLocation = [location, city].filter(Boolean).join(", ") || "Location not specified";

  return `
    <div class="donor-card">
      <div class="donor-header">
        <h3>${escapeHtml(donor.name || "Anonymous")}</h3>
        <span class="blood-badge">${escapeHtml(blood)}</span>
      </div>
      <div class="donor-status ${isAvailable ? "status-available" : "status-unavailable"}">
        ${isAvailable ? "Available" : "Unavailable"}
      </div>
      <div class="donor-details">
        <p><strong>Location:</strong> ${fullLocation}</p>
        <p><strong>Last Donation:</strong> ${formatDate(donor.last_donation)}</p>
        <p><strong>Available From:</strong> ${nextDate ? formatDate(nextDate) : "Now"}</p>
        ${donor.verified_at ? `<p><strong>Verified:</strong> ${formatDate(donor.verified_at)}</p>` : ""}
      </div>
      ${donor.phone ? `
        <div class="donor-actions">
          <a href="tel:${escapeHtml(donor.phone)}" class="contact-btn">Contact Donor</a>
        </div>
      ` : ""}
    </div>
  `;
}

function render() {
  const donors = filteredDonors();
  if (countEl) countEl.textContent = donors.length;

  if (resultsEl) {
    if (donors.length === 0) {
      const citySelected = normalize(cityEl?.value);
      const locSelected = normalize(locationEl?.value);
      if (!citySelected && !locSelected) {
        resultsEl.innerHTML = `<div class="no-results">Please select a City or enter a Specific Location to view donors.</div>`;
      } else {
        resultsEl.innerHTML = `<div class="no-results">No donors found matching your search.</div>`;
      }
    } else {
      resultsEl.innerHTML = donors.map(donorCard).join("");
    }
  }
}

async function loadDonors() {
  const supabase = createSupabaseClient();

  if (!supabase) {
    allDonors = [
      {
        id: "1",
        name: "Salman Ahmed Saimon",
        blood_group: "B+",
        city: "Dhaka",
        location: "Zahurul Huq Hall",
        last_donation: "2026-04-15",
        available: true,
        phone: "01700000000"
      },
      {
        id: "2",
        name: "Amanulla Emon",
        blood_group: "B+",
        city: "Dhaka",
        location: "Zahurul Huq Hall",
        last_donation: "2026-09-02",
        available: false,
        phone: "01800000000"
      }
    ];
    render();
    return;
  }

  try {
    const { data, error } = await supabase.from("donors").select("*");
    if (error) throw error;
    allDonors = Array.isArray(data) ? data : [];
    render();
  } catch (err) {
    console.error("Failed to load donors from Supabase:", err);
    allDonors = [];
    render();
  }
}

[bloodEl, cityEl, locationEl, statusEl].forEach((element) => {
  if (element) {
    element.addEventListener("input", render);
    element.addEventListener("change", render);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadDonors();
});
