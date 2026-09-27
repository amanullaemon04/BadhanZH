/* Hall Blood Donor - public site
   UTF-8 safe version.
   Existing HTML/CSS design is unchanged.

   FILTER RULES:
   - City / District is the MAIN location filter and is required.
   - Specific location is optional and narrows the selected city.
   - Blood group is optional.
   - Availability is optional.
   - A donor is available only when admin availability is true AND,
     when a last donation date exists, the 3-calendar-month eligibility
     date has passed.
*/

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const bloodEl = $("blood");
  const cityEl = $("city");
  const locationEl = $("location");
  const statusEl = $("status");
  const sortEl = $("sort");
  const resultsEl = $("results");
  const countEl = $("count");

  // ---------- Safe text / normalization ----------

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  // Location comparison is deliberately tolerant of punctuation and
  // Unicode spacing, so "Zahurul Huq Hall" still matches a DB value
  // with extra spaces, punctuation, or different capitalization.
  function normalizeLocation(value) {
    return normalize(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function textMatches(filterValue, donorValue) {
    const filter = normalizeLocation(filterValue);
    const donor = normalizeLocation(donorValue);

    if (!filter) return true;
    if (!donor) return false;

    return donor.includes(filter);
  }

  // ---------- Date helpers ----------

  function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const raw = String(value).trim();

    // Supabase DATE: YYYY-MM-DD
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (iso) {
      const d = new Date(
        Date.UTC(
          Number(iso[1]),
          Number(iso[2]) - 1,
          Number(iso[3])
        )
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // MM/DD/YYYY
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (slash) {
      const d = new Date(
        Date.UTC(
          Number(slash[3]),
          Number(slash[1]) - 1,
          Number(slash[2])
        )
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    const d = parseDate(value);
    if (!d) return "Not specified";

    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  }

  function eligibilityDate(lastDonation) {
    const d = parseDate(lastDonation);
    if (!d) return null;

    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth() + 3,
        d.getUTCDate()
      )
    );
  }

  function today() {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      )
    );
  }

  // Keep the public site consistent with the Admin panel:
  // admin availability must be true, and the 3-month rule must pass.
  function effectiveAvailable(x) {
    if (x.available !== true) return false;

    if (x.last_donation) {
      const eligible = eligibilityDate(x.last_donation);
      if (eligible) {
        return eligible.getTime() <= today().getTime();
      }
    }

    return true;
  }

  function effectiveAvailableDate(x) {
    if (x.last_donation) {
      const eligible = eligibilityDate(x.last_donation);
      if (eligible) return eligible;
    }

    if (x.available_from) {
      return parseDate(x.available_from);
    }

    return null;
  }

  // ---------- Supabase ----------

  function getConfigValue(names) {
    for (const name of names) {
      if (typeof window[name] !== "undefined" && window[name]) {
        return window[name];
      }
    }

    // Also support the existing APP_CONFIG object.
    if (window.APP_CONFIG) {
      if (names.includes("SUPABASE_URL") && window.APP_CONFIG.SUPABASE_URL) {
        return window.APP_CONFIG.SUPABASE_URL;
      }
      if (
        names.includes("SUPABASE_ANON_KEY") &&
        window.APP_CONFIG.SUPABASE_ANON_KEY
      ) {
        return window.APP_CONFIG.SUPABASE_ANON_KEY;
      }
    }

    return "";
  }

  function createClient() {
    if (
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
    ) {
      throw new Error("Supabase library could not be loaded.");
    }

    const url = getConfigValue([
      "SUPABASE_URL",
      "supabaseUrl",
      "SUPABASE_PROJECT_URL",
      "PROJECT_URL"
    ]);

    const key = getConfigValue([
      "SUPABASE_ANON_KEY",
      "SUPABASE_KEY",
      "supabaseAnonKey",
      "ANON_KEY",
      "PUBLIC_SUPABASE_ANON_KEY"
    ]);

    if (!url || !key) {
      throw new Error(
        "Supabase configuration was not found. Check config.js."
      );
    }

    return window.supabase.createClient(url, key);
  }

  let supabaseClient = null;
  let allDonors = [];

  async function loadDonors() {
    try {
      if (!supabaseClient) {
        supabaseClient = createClient();
      }

      const { data, error } = await supabaseClient
        .from("donors")
        .select("*");

      if (error) throw error;

      allDonors = Array.isArray(data) ? data : [];

      populateCities(allDonors);
      render();
    } catch (error) {
      console.error("Could not load donors:", error);

      if (countEl) countEl.textContent = "0 donors";

      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            <strong>Could not load donors.</strong>
            <p>Please refresh the page and try again.</p>
          </div>
        `;
      }
    }
  }

  function populateCities(donors) {
    if (!cityEl) return;

    const current = cityEl.value;

    const cities = [
      ...new Set(
        donors
          .map((x) => String(x.city ?? "").trim())
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));

    cityEl.innerHTML = "";

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All cities / districts";
    cityEl.appendChild(all);

    cities.forEach((city) => {
      const option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      cityEl.appendChild(option);
    });

    const currentNormalized = normalize(current);
    const matchingCity = cities.find(
      (city) => normalize(city) === currentNormalized
    );

    cityEl.value = matchingCity || "";
  }

  // ---------- Filtering & sorting ----------

  function filteredDonors() {
    const blood = normalize(bloodEl?.value);
    const city = normalize(cityEl?.value);
    const location = normalizeLocation(locationEl?.value);
    const status = normalize(statusEl?.value);

    // Location is the main search condition.
    // No city selected = do not show the donor directory.
    if (!city) return [];

    const list = allDonors.filter((x) => {
      const donorBlood = normalize(x.blood_group ?? x.blood);
      const donorCity = normalize(x.city);
      const donorLocation = x.location ?? "";

      // Blood group is optional.
      if (blood && donorBlood !== blood) return false;

      // City / District is mandatory and is the main location filter.
      if (donorCity !== city) return false;

      // Specific location is optional and only narrows the selected city.
      // It NEVER searches the city field.
      if (location && !textMatches(location, donorLocation)) {
        return false;
      }

      const available = effectiveAvailable(x);

      if (status === "available" && !available) return false;
      if (status === "unavailable" && available) return false;

      return true;
    });

    const sort = sortEl?.value || "available";

    if (sort === "available") {
      list.sort((a, b) => {
        const av = effectiveAvailable(a) ? 0 : 1;
        const bv = effectiveAvailable(b) ? 0 : 1;

        if (av !== bv) return av - bv;

        return normalize(a.name).localeCompare(normalize(b.name));
      });
    } else if (sort === "blood") {
      list.sort((a, b) =>
        normalize(a.blood_group ?? a.blood).localeCompare(
          normalize(b.blood_group ?? b.blood)
        )
      );
    } else if (sort === "location") {
      list.sort((a, b) => {
        const al = `${a.city ?? ""} ${a.location ?? ""}`;
        const bl = `${b.city ?? ""} ${b.location ?? ""}`;
        return al.localeCompare(bl);
      });
    } else if (sort === "recent") {
      list.sort((a, b) => {
        const ad = parseDate(a.verified_at)?.getTime() || 0;
        const bd = parseDate(b.verified_at)?.getTime() || 0;
        return bd - ad;
      });
    }

    return list;
  }

  // ---------- Donor card ----------

  function donorCard(x) {
    const name = escapeHtml(x.name || "Unnamed donor");
    const blood = escapeHtml(x.blood_group ?? x.blood ?? "—");
    const city = escapeHtml(x.city || "—");
    const location = escapeHtml(x.location || "Not specified");

    const available = effectiveAvailable(x);
    const statusClass = available ? "available" : "unavailable";
    const statusText = available ? "Available" : "Unavailable";

    const lastDonation = formatDate(x.last_donation);
    const availableFrom = formatDate(effectiveAvailableDate(x));
    const verified = formatDate(x.verified_at);
    const phone = String(x.phone ?? "").trim();

    const contactButton = phone
      ? `<a class="contact-btn" href="tel:${escapeHtml(phone)}">Contact donor</a>`
      : `<button class="contact-btn" type="button" disabled>Contact donor</button>`;

    return `
      <article class="donor-card">
        <div class="donor-card-head">
          <h3>${name}</h3>
          <strong class="blood-badge">${blood}</strong>
        </div>

        <span class="status ${statusClass}">${statusText}</span>

        <div class="donor-location">
          📍 ${city} • ${location}
        </div>

        <div class="donor-date">
          🩸 Last donation: ${lastDonation}
        </div>

        <div class="donor-available">
          📅 Available from: ${availableFrom}
        </div>

        <div class="donor-verified">
          🛡️ Verified: ${verified}
        </div>

        ${contactButton}
      </article>
    `;
  }

  function render() {
    if (!resultsEl) return;

    const city = normalize(cityEl?.value);
    const donors = filteredDonors();

    if (countEl) {
      countEl.textContent = `${donors.length} ${
        donors.length === 1 ? "donor" : "donors"
      }`;
    }

    if (!city) {
      resultsEl.innerHTML = `
        <div class="empty-state">
          <strong>Select a city / district first.</strong>
          <p>Then choose a blood group or specific location if needed.</p>
        </div>
      `;
      return;
    }

    if (!donors.length) {
      resultsEl.innerHTML = `
        <div class="empty-state">
          <strong>No donors found.</strong>
          <p>Try another filter.</p>
        </div>
      `;
      return;
    }

    resultsEl.innerHTML = donors.map(donorCard).join("");
  }

  // ---------- Events ----------

  [bloodEl, cityEl, locationEl, statusEl, sortEl].forEach((element) => {
    if (!element) return;

    element.addEventListener("input", render);
    element.addEventListener("change", render);
  });

  loadDonors();
})();
