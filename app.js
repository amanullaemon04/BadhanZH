/* Hall Blood Donor - public site
   UTF-8 safe version.
   Keeps the existing HTML/CSS design unchanged.
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

  // ---------- Safe text helpers ----------

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseDate(value) {
    if (!value) return null;

    const d = value instanceof Date
      ? new Date(value)
      : new Date(String(value));

    if (Number.isNaN(d.getTime())) return null;
    return d;
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

  // Uses calendar months, not a fixed 90-day approximation.
  function eligibilityDate(lastDonation) {
    const d = parseDate(lastDonation);
    if (!d) return null;

    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();

    // JS Date automatically handles month/year changes.
    return new Date(Date.UTC(
      year,
      month + 3,
      day
    ));
  }

  function today() {
    const now = new Date();

    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));
  }

  // Last donation থাকলে 3-month rule automatically applies.
  // Last donation না থাকলে admin-এর availability ব্যবহার করবে.
  function effectiveAvailable(x) {

    // A donor becomes available on the calculated eligibility date.
    // Compare timestamps explicitly so a valid past date can never be
    // treated as unavailable because of Date-object comparison quirks.
    const e = eligibilityDate(x.last_donation);

    if (e && Number.isFinite(e.getTime())) {
      return e.getTime() <= today().getTime();
    }

    // If there is no valid last-donation date, use the admin flag.
    return (
      x.available === true ||
      x.available === 1 ||
      x.available === "true"
    );
  }

  function effectiveAvailableDate(x) {
    const e = eligibilityDate(x.last_donation);

    if (e) return e;

    if (x.available_from) {
      return parseDate(x.available_from);
    }

    return null;
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function getAvailabilityLabel(x) {
    return effectiveAvailable(x)
      ? "Available"
      : "Unavailable";
  }

  // ---------- Supabase ----------

  function getConfigValue(names) {
    for (const name of names) {
      if (
        typeof window[name] !== "undefined" &&
        window[name]
      ) {
        return window[name];
      }
    }

    return "";
  }

  function createClient() {
    if (
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
    ) {
      throw new Error(
        "Supabase library could not be loaded."
      );
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

  // ---------- Donor data ----------

  async function loadDonors() {
    try {
      if (!supabaseClient) {
        supabaseClient = createClient();
      }

      const { data, error } = await supabaseClient
        .from("donors")
        .select("*");

      if (error) throw error;

      allDonors = Array.isArray(data)
        ? data
        : [];

      populateCities(allDonors);
      render();

    } catch (error) {
      console.error(
        "Could not load donors:",
        error
      );

      if (countEl) {
        countEl.textContent = "0 donors";
      }

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
          .map((x) =>
            String(x.city ?? "").trim()
          )
          .filter(Boolean)
      )
    ].sort((a, b) =>
      a.localeCompare(b)
    );

    // Keep the existing option/design,
    // only update its options.
    cityEl.innerHTML = "";

    const all = document.createElement("option");

    all.value = "";
    all.textContent = "All locations";

    cityEl.appendChild(all);

    cities.forEach((city) => {
      const option =
        document.createElement("option");

      option.value = city;
      option.textContent = city;

      cityEl.appendChild(option);
    });

    if (cities.includes(current)) {
      cityEl.value = current;
    } else {
      cityEl.value = "";
    }
  }

  // ---------- Filtering & sorting ----------

  function filteredDonors() {

    const blood =
      normalize(bloodEl?.value);

    const city =
      normalize(cityEl?.value);

    const location =
      normalize(locationEl?.value);

    const status =
      normalize(statusEl?.value);

    let list = allDonors.filter((x) => {

      const donorBlood =
        normalize(
          x.blood_group ?? x.blood
        );

      const donorCity =
        normalize(x.city);

      const donorLocation =
        normalize(x.location);

      // Blood group
      if (
        blood &&
        donorBlood !== blood
      ) {
        return false;
      }

      // City / District
      if (
        city &&
        donorCity !== city
      ) {
        return false;
      }

      // Specific location
      if (location) {

        const combinedLocation =
          `${donorCity} ${donorLocation}`;

        if (
          !combinedLocation.includes(location)
        ) {
          return false;
        }
      }

      const available =
        effectiveAvailable(x);

      // Availability
      if (
        status === "available" &&
        !available
      ) {
        return false;
      }

      if (
        status === "unavailable" &&
        available
      ) {
        return false;
      }

      return true;
    });

    const sort =
      sortEl?.value || "available";

    if (sort === "available") {

      list.sort((a, b) => {

        const av =
          effectiveAvailable(a)
            ? 0
            : 1;

        const bv =
          effectiveAvailable(b)
            ? 0
            : 1;

        if (av !== bv) {
          return av - bv;
        }

        const an =
          normalize(a.name);

        const bn =
          normalize(b.name);

        return an.localeCompare(bn);
      });

    } else if (sort === "blood") {

      list.sort((a, b) =>
        normalize(
          a.blood_group ?? a.blood
        ).localeCompare(
          normalize(
            b.blood_group ?? b.blood
          )
        )
      );

    } else if (sort === "location") {

      list.sort((a, b) => {

        const al =
          `${a.city ?? ""} ${a.location ?? ""}`;

        const bl =
          `${b.city ?? ""} ${b.location ?? ""}`;

        return al.localeCompare(bl);
      });

    } else if (sort === "recent") {

      list.sort((a, b) => {

        const ad =
          parseDate(
            a.verified_at
          )?.getTime() || 0;

        const bd =
          parseDate(
            b.verified_at
          )?.getTime() || 0;

        return bd - ad;
      });
    }

    return list;
  }

  // ---------- Donor card ----------

  function donorCard(x) {

    const name =
      escapeHtml(
        x.name ||
        "Unnamed donor"
      );

    const blood =
      escapeHtml(
        x.blood_group ??
        x.blood ??
        "—"
      );

    const city =
      escapeHtml(
        x.city || "—"
      );

    const location =
      escapeHtml(
        x.location ||
        "Not specified"
      );

    const available =
      effectiveAvailable(x);

    const statusClass =
      available
        ? "available"
        : "unavailable";

    const statusText =
      available
        ? "Available"
        : "Unavailable";

    const lastDonation =
      formatDate(
        x.last_donation
      );

    const availableFrom =
      formatDate(
        effectiveAvailableDate(x)
      );

    const verified =
      formatDate(
        x.verified_at
      );

    const phone =
      String(
        x.phone ?? ""
      ).trim();

    const contactButton =
      phone
        ? `<a class="contact-btn" href="tel:${escapeHtml(phone)}">Contact donor</a>`
        : `<button class="contact-btn" type="button" disabled>Contact donor</button>`;

    /*
      IMPORTANT:
      Keep these emoji strings as real UTF-8 characters.
      The HTML file already declares UTF-8 and the existing CSS controls
      the visual design, so this JS does not change the page layout.
    */

    return `
      <article class="donor-card">

        <div class="donor-card-head">
          <h3>${name}</h3>

          <strong class="blood-badge">
            ${blood}
          </strong>
        </div>

        <span class="status ${statusClass}">
          ${statusText}
        </span>

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

    const donors =
      filteredDonors();

    if (countEl) {

      countEl.textContent =
        `${donors.length} ${
          donors.length === 1
            ? "donor"
            : "donors"
        }`;
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

    resultsEl.innerHTML =
      donors
        .map(donorCard)
        .join("");
  }

  // ---------- Events ----------

  [
    bloodEl,
    cityEl,
    locationEl,
    statusEl,
    sortEl
  ].forEach((element) => {

    if (!element) return;

    element.addEventListener(
      "input",
      render
    );

    element.addEventListener(
      "change",
      render
    );
  });

  // Initial load.
  loadDonors();

})();
