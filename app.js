const { createClient } = window.supabase;
const db = createClient(
  APP_CONFIG.SUPABASE_URL,
  APP_CONFIG.SUPABASE_ANON_KEY
);

const $ = (id) => document.getElementById(id);

// Minimum gap between blood donations.
// Change to 4 if you want a strict 4-month rule.
const MIN_DONATION_GAP_MONTHS = 3;

let donors = [];

/* ---------- Date helpers ---------- */

function parseDate(value) {
  if (!value) return null;

  const text = String(value).slice(0, 10);
  const parts = text.split("-").map(Number);

  if (parts.length !== 3) return null;

  const [y, m, d] = parts;

  if (!y || !m || !d) return null;

  return new Date(y, m - 1, d);
}

function addMonths(date, months) {
  const d = new Date(date);
  const originalDay = d.getDate();

  // Go to the first day to avoid month overflow.
  const first = new Date(
    d.getFullYear(),
    d.getMonth(),
    1
  );

  first.setMonth(first.getMonth() + months);

  // Last valid day of the target month.
  const lastDay = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0
  ).getDate();

  d.setFullYear(
    first.getFullYear(),
    first.getMonth(),
    Math.min(originalDay, lastDay)
  );

  return d;
}

function today() {
  const d = new Date();

  // Remove time so date comparison is consistent.
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  );
}

function eligibilityDate(lastDonation) {
  const d = parseDate(lastDonation);
  return d ? addMonths(d, MIN_DONATION_GAP_MONTHS) : null;
}

/*
 * A donor is effectively available only when:
 * 1. Their database 'available' field is true
 * 2. Their donation cooldown has ended
 *
 * If there is no last_donation date, the donor can be available
 * according to the database flag.
 */
function effectiveAvailable(donor) {
  if (!donor.available) return false;

  const eligible = eligibilityDate(donor.last_donation);

  // No previous donation date -> rely on database availability.
  if (!eligible) return true;

  return eligible <= today();
}

/* ---------- Formatting / security ---------- */

function fmtDate(value) {
  const d = parseDate(value);

  if (!d) return "Not specified";

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

/* ---------- Database ---------- */

async function load() {
  const { data, error } = await db
    .from("donors")
    .select(`
      id,
      name,
      blood_group,
      available,
      city,
      location,
      last_donation,
      verified_at,
      phone
    `)
    .order("available", { ascending: false })
    .order("verified_at", { ascending: false });

  if (error) {
    console.error("Supabase donor load error:", error);
    donors = [];
    return;
  }

  donors = data || [];
}

/* ---------- Rendering ---------- */

function render() {
  let d = [...donors];

  const blood = $("blood")?.value?.trim() || "";
  const city = $("city")?.value?.trim() || "";
  const location = $("location")?.value?.trim().toLowerCase() || "";
  const status = $("status")?.value || "";
  const sort = $("sort")?.value || "available";

  // Blood group
  if (blood) {
    d = d.filter(
      (x) => String(x.blood_group || "").toLowerCase() === blood.toLowerCase()
    );
  }

  // City / district
  // Empty or "all" means no city filter.
  if (city && city.toLowerCase() !== "all") {
    d = d.filter(
      (x) =>
        String(x.city || "").trim().toLowerCase() ===
        city.toLowerCase()
    );
  }

  // Specific location is OPTIONAL.
  // If empty, donors from the selected city are still shown.
  if (location) {
    d = d.filter((x) =>
      String(x.location || "").toLowerCase().includes(location)
    );
  }

  // Availability
  if (status === "available") {
    d = d.filter((x) => effectiveAvailable(x));
  } else if (status === "unavailable") {
    d = d.filter((x) => !effectiveAvailable(x));
  }

  // Sorting
  if (sort === "available") {
    d.sort(
      (a, b) =>
        Number(effectiveAvailable(b)) -
        Number(effectiveAvailable(a))
    );
  }

  if (sort === "blood") {
    d.sort((a, b) =>
      String(a.blood_group || "").localeCompare(
        String(b.blood_group || "")
      )
    );
  }

  if (sort === "location") {
    d.sort((a, b) =>
      `${a.location || ""} ${a.city || ""}`.localeCompare(
        `${b.location || ""} ${b.city || ""}`
      )
    );
  }

  if (sort === "recent") {
    d.sort((a, b) =>
      String(b.verified_at || "").localeCompare(
        String(a.verified_at || "")
      )
    );
  }

  // Donor count
  const countEl = $("count");
  if (countEl) {
    countEl.textContent = `${d.length} donor${d.length === 1 ? "" : "s"}`;
  }

  const results = $("results");
  if (!results) return;

  if (!d.length) {
    results.innerHTML = `
      <div class="card">
        <strong>No donors found.</strong>
        <div class="meta">
          Try another filter.
        </div>
      </div>
    `;
    return;
  }

  results.innerHTML = d
    .map((x) => {
      const ok = effectiveAvailable(x);
      const eligible = eligibilityDate(x.last_donation);

      let cooldownText = "";

      if (x.last_donation && !ok && eligible) {
        cooldownText = `
          <br>â³ Available from: ${esc(fmtDate(eligible))}
        `;
      }

      const phone = String(x.phone || "").trim();

      return `
        <article class="card">
          <div class="card-top">
            <div class="name">${esc(x.name)}</div>

            <div class="blood">
              ${esc(x.blood_group)}
            </div>
          </div>

          <span class="badge ${ok ? "yes" : "no"}">
            ${ok ? "ðŸŸ¢ Available" : "ðŸ”´ Unavailable"}
          </span>

          <div class="meta">
            ðŸ“ ${esc(x.city || "Not specified")}
            ${x.location ? ` Â· ${esc(x.location)}` : ""}

            <br>
            ðŸ©¸ Last donation:
            ${esc(fmtDate(x.last_donation))}

            ${cooldownText}

            <br>
            âœ“ Verified:
            ${esc(fmtDate(x.verified_at))}
          </div>

          ${
            phone
              ? `<a class="contact" href="tel:${encodeURIComponent(phone)}">
                   Contact donor
                 </a>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

/* ---------- Event listeners ---------- */

[
  "blood",
  "city",
  "location",
  "status",
  "sort"
].forEach((id) => {
  const element = $(id);

  if (!element) return;

  element.addEventListener("input", render);
  element.addEventListener("change", render);
});

/* ---------- Start ---------- */

(async () => {
  await load();
  render();
})();
