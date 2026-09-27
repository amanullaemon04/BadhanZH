const { createClient } = window.supabase;
const db = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

const MIN_DONATION_GAP_MONTHS = 3;
let donors = [];

function parseDate(v) {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function addMonths(date, months) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(
    d.getFullYear(),
    d.getMonth() + 1,
    0
  ).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function eligibilityDate(lastDonation) {
  const d = parseDate(lastDonation);
  return d ? addMonths(d, MIN_DONATION_GAP_MONTHS) : null;
}

function effectiveAvailable(x) {
  const e = eligibilityDate(x.last_donation);

  // Last donation à¦¥à¦¾à¦•à¦²à§‡ 3-month rule automatically applies.
  if (e) return e <= today();

  // Last donation à¦¨à¦¾ à¦¥à¦¾à¦•à¦²à§‡ admin-à¦à¦° availability à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦•à¦°à¦¬à§‡à¥¤
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
    console.error(error);
    donors = [];
    return;
  }

  donors = data || [];
}

function render() {
  let d = [...donors];

  const b = $("blood").value;
  const city = $("city").value;
  const l = $("location").value.trim().toLowerCase();
  const s = $("status").value;
  const sort = $("sort").value;

  if (b) {
    d = d.filter(x => x.blood_group === b);
  }

  if (city) {
    d = d.filter(
      x => (x.city || "").toLowerCase() === city.toLowerCase()
    );
  }

  if (l) {
    d = d.filter(
      x =>
        (x.location || "")
          .toLowerCase()
          .includes(l)
    );
  }

  if (s) {
    d = d.filter(x =>
      s === "available"
        ? effectiveAvailable(x)
        : !effectiveAvailable(x)
    );
  }

  if (sort === "available") {
    d.sort(
      (a, b) =>
        Number(effectiveAvailable(b)) -
        Number(effectiveAvailable(a))
    );
  }

  if (sort === "blood") {
    d.sort((a, b) =>
      a.blood_group.localeCompare(b.blood_group)
    );
  }

  if (sort === "location") {
    d.sort((a, b) =>
      `${a.city || ""} ${a.location || ""}`.localeCompare(
        `${b.city || ""} ${b.location || ""}`
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

  $("count").textContent =
    `${d.length} donor${d.length === 1 ? "" : "s"}`;

  $("results").innerHTML = d.length
    ? d.map(x => {
        const ok = effectiveAvailable(x);
        const e = eligibilityDate(x.last_donation);
        const cooldown =
          x.available && e && e > today();

        return `
          <article class="card">
            <div class="card-top">
              <div class="name">${esc(x.name)}</div>
              <div class="blood">${esc(x.blood_group)}</div>
            </div>

            <span class="badge ${ok ? "yes" : "no"}">
              ${ok ? "Available" : "Unavailable"}
            </span>

            <div class="meta">
              Location: ${esc(x.city || "Not specified")}${x.location ? ` â€¢ ${esc(x.location)}` : ""}<br>
              Last donation: ${esc(fmtDate(x.last_donation))}<br>
              ${cooldown ? `Available from: ${esc(fmtDate(e))}<br>` : ""}
              Verified: ${esc(fmtDate(x.verified_at))}
            </div>

            ${
              x.phone
                ? `<a class="contact" href="tel:${encodeURIComponent(
                    x.phone
                  )}">Contact donor</a>`
                : ""
            }
          </article>
        `;
      }).join("")
    : `
      <div class="card">
        <strong>No donors found.</strong>
        <div class="meta">Try another filter.</div>
      </div>
    `;
}

async function init() {
  try {
    await load();
    render();
  } catch (err) {
    console.error(err);
    donors = [];
    render();
  }
}

["blood", "city", "location", "status", "sort"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("input", render);
  if (el && el.tagName === "SELECT") {
    el.addEventListener("change", render);
  }
});

(async () => {
  await init();
})();
