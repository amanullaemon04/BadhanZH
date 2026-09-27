const { createClient } = window.supabase;
const db = createClient(
  APP_CONFIG.SUPABASE_URL,
  APP_CONFIG.SUPABASE_ANON_KEY
);

const $ = id => document.getElementById(id);

// Minimum gap between blood donations.
// The public site automatically calculates availability from last_donation.
const MIN_DONATION_GAP_MONTHS = 3;

let donors = [];

function parseDate(v) {
  if (!v) return null;

  const parts = String(v).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3) return null;

  const [y, m, d] = parts;
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function addMonths(date, months) {
  const day = date.getDate();

  const first = new Date(
    date.getFullYear(),
    date.getMonth(),
    1
  );

  first.setMonth(first.getMonth() + months);

  // Prevent dates such as Jan 31 + 1 month from rolling into March.
  const lastDay = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0
  ).getDate();

  first.setDate(Math.min(day, lastDay));

  return first;
}

function today() {
  const d = new Date();

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  );
}

function eligibilityDate(lastDonation) {
  const d = parseDate(lastDonation);

  return d
    ? addMonths(d, MIN_DONATION_GAP_MONTHS)
    : null;
}

/*
 * Availability rule:
 *
 * If a donor has a last donation date, that date controls availability.
 * This prevents the database "available" checkbox from incorrectly
 * showing someone as unavailable/available when the 3-month period
 * says otherwise.
 *
 * Examples:
 *   Sep 2, 2026 + 3 months = Dec 2, 2026 -> Unavailable today
 *   Apr 15, 2026 + 3 months = Jul 15, 2026 -> Available today
 *
 * If there is no last donation date, use the admin's available value.
 */
function effectiveAvailable(x) {
  const e = eligibilityDate(x.last_donation);

  if (e) return e <= today();

  return !!x.available;
}

function fmtDate(v) {
  const d = parseDate(v);

  if (!d) return "Not specified";

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

async function load() {
  const { data, error } = await db
    .from("donors")
    .select(
      "id,name,blood_group,available,city,location,last_donation,verified_at,phone"
    )
    .order("available", { ascending: false })
    .order("verified_at", { ascending: false });

  if (error) {
    console.error("Could not load donors:", error);
    donors = [];

    const results = $("results");
    if (results) {
      results.innerHTML = `
        <div class="card">
          <strong>Could not load donors.</strong>
          <div class="meta">
            ${esc(error.message || "Database error")}
          </div>
        </div>
      `;
    }

    if ($("count")) {
      $("count").textContent = "0 donors";
    }

    return;
  }

  donors = data || [];
}

function render() {
  let d = [...donors];

  const blood = $("blood")?.value || "";
  const city = $("city")?.value || "";
  const location = ($("location")?.value || "").trim().toLowerCase();
  const status = $("status")?.value || "";
  const sort = $("sort")?.value || "available";

  // Blood group filter
  if (blood) {
    d = d.filter(x => x.blood_group === blood);
  }

  // City/District filter
  if (city) {
    d = d.filter(
      x => String(x.city || "").trim().toLowerCase() === city.toLowerCase()
    );
  }

  // Specific location filter
  if (location) {
    d = d.filter(
      x =>
        String(x.location || "")
          .toLowerCase()
          .includes(location)
    );
  }

  // Availability filter
  if (status === "available") {
    d = d.filter(x => effectiveAvailable(x));
  }

  if (status === "unavailable") {
    d = d.filter(x => !effectiveAvailable(x));
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
    d.sort((a, b) => {
      const la = `${a.location || ""} ${a.city || ""}`;
      const lb = `${b.location || ""} ${b.city || ""}`;
      return la.localeCompare(lb);
    });
  }

  if (sort === "recent") {
    d.sort((a, b) =>
      String(b.verified_at || "").localeCompare(
        String(a.verified_at || "")
      )
    );
  }

  if ($("count")) {
    $("count").textContent =
      `${d.length} donor${d.length === 1 ? "" : "s"}`;
  }

  const results = $("results");
  if (!results) return;

  if (!d.length) {
    results.innerHTML = `
      <div class="card">
        <strong>No donors found.</strong>
        <div class="meta">Try another filter.</div>
      </div>
    `;
    return;
  }

  results.innerHTML = d
    .map(x => {
      const ok = effectiveAvailable(x);
      const eligibility = eligibilityDate(x.last_donation);

      const cooldown =
        !ok && eligibility
          ? `Available from: ${esc(fmtDate(eligibility))}`
          : "";

      const phone = String(x.phone || "").trim();

      return `
        <article class="card">
          <div class="card-top">
            <div class="name">${esc(x.name)}</div>
            <div class="blood">${esc(x.blood_group)}</div>
          </div>

          <div class="badge ${ok ? "yes" : "no"}">
            ${ok ? "Available" : "Unavailable"}
          </div>

          <div class="meta">
            Location: ${esc(x.city || "Not specified")}${x.location ? ` â€¢ ${esc(x.location)}` : ""}
            <br>
            Last donation: ${esc(fmtDate(x.last_donation))}
            ${cooldown ? `<br>${cooldown}` : ""}
            <br>
            Verified: ${esc(fmtDate(x.verified_at))}
          </div>

          ${
            phone
              ? `<a class="contact" href="tel:${encodeURIComponent(phone)}">Contact donor</a>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

["blood", "city", "location", "status", "sort"].forEach(id => {
  const el = $(id);

  if (el) {
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  }
});

(async () => {
  await load();
  render();
})();
